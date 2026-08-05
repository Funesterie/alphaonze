'use strict';

// ACE-Step 1.5 via un ComfyUI local — troisieme fournisseur musical, a cote de
// Suno et Mureka.
//
// Ce qu'il apporte que les deux autres n'ont pas : il tourne sur la machine, donc
// aucun contenu ne part chez un tiers et rien n'est refuse par un moderateur
// distant. Il sait aussi reprendre une SECTION deja generee au lieu de tout
// refaire, et accepte un LoRA entraine sur une voix maison.
//
// Les noms de noeuds et leurs entrees sont lus dans le ComfyUI 0.30.0 installe
// (comfy_extras/nodes_ace.py), pas devines. Ils restent surchargeables par
// l'environnement au cas ou une version ulterieure les renomme, et
// verifierNoeuds() les confronte a /object_info avant de lancer quoi que ce soit.

const { createComfyClient, isComfyEnabled, resolveComfyBaseUrl } = require('../video/comfyui-client.cjs');

const NOEUDS = {
  unet: 'UNETLoader',
  clip: 'DualCLIPLoader',
  vae: 'VAELoader',
  encode: 'TextEncodeAceStepAudio1.5',
  latent: 'EmptyAceStep1.5LatentAudio',
  patchModele: 'ModelSamplingAuraFlow',
  zeroOut: 'ConditioningZeroOut',
  sampler: 'KSampler',
  decode: 'VAEDecodeAudio',
  save: 'SaveAudioMP3',
};

// Valeurs relevees sur le workflow officiel livre avec ComfyUI 0.30.0 :
// templates/audio_ace_step_1_5_split.json. Trois d'entre elles ne se devinent
// pas et ma premiere version echouait dessus :
//
//   - DualCLIPLoader, pas CLIPLoader : ACE-Step veut DEUX encodeurs.
//   - ConditioningZeroOut pour le negatif, pas un second encodage. Un
//     TextEncode avec generate_audio_codes=false rend une conditioning dont le
//     tenseur est None, et le sampler tombe sur « NoneType has no attribute
//     shape » vingt lignes plus bas, sans rapport apparent avec la cause.
//   - ModelSamplingAuraFlow(shift=3) entre le modele et le sampler.
const DEFAUTS = {
  diffusion: 'acestep_v1.5_turbo.safetensors',
  textEncoder1: 'qwen_0.6b_ace15.safetensors',
  textEncoder2: 'qwen_1.7b_ace15.safetensors',
  vae: 'ace_1.5_vae.safetensors',
  // Le turbo est entraine pour huit pas et un cfg de 1 ; monter coute du temps
  // et degrade le resultat au lieu de l'ameliorer.
  steps: 8,
  cfg: 1,
  shift: 3,
  sampler: 'euler',
  scheduler: 'simple',
  bpm: 90,
  duration: 60,
  timesignature: '4',
  language: 'fr',
  keyscale: 'C minor',
};

function lireEnv(env, ...noms) {
  for (const nom of noms) {
    const v = String(env[nom] || '').trim();
    if (v) return v;
  }
  return '';
}

function resolveAceStepConfig(env = process.env) {
  return {
    baseUrl: resolveComfyBaseUrl(env),
    diffusion: lireEnv(env, 'ACESTEP_DIFFUSION_MODEL') || DEFAUTS.diffusion,
    textEncoder1: lireEnv(env, 'ACESTEP_TEXT_ENCODER_1') || DEFAUTS.textEncoder1,
    textEncoder2: lireEnv(env, 'ACESTEP_TEXT_ENCODER_2') || DEFAUTS.textEncoder2,
    vae: lireEnv(env, 'ACESTEP_VAE') || DEFAUTS.vae,
    steps: Number(lireEnv(env, 'ACESTEP_STEPS')) || DEFAUTS.steps,
    cfg: Number(lireEnv(env, 'ACESTEP_CFG')) || DEFAUTS.cfg,
    shift: Number(lireEnv(env, 'ACESTEP_SHIFT')) || DEFAUTS.shift,
  };
}

function isAceStepConfigured(env = process.env) {
  if (String(env.ACESTEP_DISABLED || '').trim().toLowerCase() === 'true') return false;
  // Actif des que ComfyUI est joignable : les modeles sont verifies au lancement,
  // pas ici — on ne veut pas d'appel reseau dans une fonction de configuration.
  return isComfyEnabled(env) || String(env.ACESTEP_ENABLED || '').trim().toLowerCase() === 'true';
}

function clamp(v, min, max, defaut) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : defaut;
}

/**
 * Construit le graphe ComfyUI au format API.
 *
 * @param {{tags?:string, lyrics?:string, seed?:number, bpm?:number, duration?:number,
 *          language?:string, keyscale?:string, timesignature?:string,
 *          negative?:string, prefix?:string}} demande
 * @param {object} [config]
 */
function buildAceStepGraph(demande = {}, config = resolveAceStepConfig()) {
  const tags = String(demande.tags || '').trim();
  const lyrics = String(demande.lyrics || '').trim();
  const seed = Number.isFinite(Number(demande.seed))
    ? Math.abs(Math.floor(Number(demande.seed)))
    : 0;

  const commun = {
    seed,
    bpm: clamp(demande.bpm, 10, 300, DEFAUTS.bpm),
    duration: clamp(demande.duration, 1, 2000, DEFAUTS.duration),
    timesignature: String(demande.timesignature || DEFAUTS.timesignature),
    language: String(demande.language || DEFAUTS.language),
    keyscale: String(demande.keyscale || DEFAUTS.keyscale),
    // Les codes audio ameliorent la qualite mais coutent cher en temps. On les
    // garde actifs par defaut : sur du rap, l'articulation est ce qui casse en
    // premier, et c'est exactement ce que cette etape rattrape.
    generate_audio_codes: demande.audioCodes !== false,
    cfg_scale: config.cfg,
    temperature: 0.85,
    top_p: 0.9,
    top_k: 0,
    min_p: 0,
  };

  return {
    1: { class_type: NOEUDS.unet, inputs: { unet_name: config.diffusion, weight_dtype: 'default' } },
    2: {
      class_type: NOEUDS.clip,
      inputs: { clip_name1: config.textEncoder1, clip_name2: config.textEncoder2, type: 'ace', device: 'default' },
    },
    3: { class_type: NOEUDS.vae, inputs: { vae_name: config.vae } },
    4: { class_type: NOEUDS.encode, inputs: { clip: ['2', 0], tags, lyrics, ...commun } },
    // Le negatif est la conditioning positive mise a zero, pas un second
    // encodage : c'est ce que fait le workflow officiel, et c'est la seule
    // forme qui donne un tenseur exploitable au sampler.
    5: { class_type: NOEUDS.zeroOut, inputs: { conditioning: ['4', 0] } },
    6: { class_type: NOEUDS.latent, inputs: { seconds: commun.duration, batch_size: 1 } },
    10: { class_type: NOEUDS.patchModele, inputs: { model: ['1', 0], shift: config.shift } },
    7: {
      class_type: NOEUDS.sampler,
      inputs: {
        model: ['10', 0],
        positive: ['4', 0],
        negative: ['5', 0],
        latent_image: ['6', 0],
        seed,
        steps: config.steps,
        cfg: config.cfg,
        sampler_name: DEFAUTS.sampler,
        scheduler: DEFAUTS.scheduler,
        denoise: 1,
      },
    },
    8: { class_type: NOEUDS.decode, inputs: { samples: ['7', 0], vae: ['3', 0] } },
    9: {
      class_type: NOEUDS.save,
      inputs: { audio: ['8', 0], filename_prefix: String(demande.prefix || 'funesterie/acestep'), quality: 'V0' },
    },
  };
}

/**
 * Confronte les noms de noeuds a ceux que l'instance expose reellement.
 * Mieux vaut un refus explicite qu'un graphe rejete avec un message obscur.
 */
async function verifierNoeuds(client) {
  const presents = new Set(await client.listNodes());
  const absents = Object.values(NOEUDS).filter((n) => !presents.has(n));
  return { ok: absents.length === 0, absents };
}

/**
 * Genere un morceau. Rend le meme contrat que les autres fournisseurs :
 * { ok, provider, audio: Buffer, meta } ou { ok: false, raison }.
 */
async function requestAceStepMusic(demande = {}, options = {}) {
  const env = options.env || process.env;
  const config = { ...resolveAceStepConfig(env), ...(options.config || {}) };
  const client = options.client || createComfyClient({ env, baseUrl: config.baseUrl });

  const etat = await client.health();
  if (!etat.ok) {
    return { ok: false, provider: 'acestep', raison: `ComfyUI injoignable sur ${config.baseUrl} — ${etat.raison}` };
  }

  const noeuds = await verifierNoeuds(client);
  if (!noeuds.ok) {
    return {
      ok: false,
      provider: 'acestep',
      raison: `noeuds absents de cette instance ComfyUI : ${noeuds.absents.join(', ')}`,
    };
  }

  const graphe = buildAceStepGraph(demande, config);

  let promptId;
  try {
    promptId = await client.submit(graphe);
  } catch (erreur) {
    return { ok: false, provider: 'acestep', raison: erreur.message };
  }

  // Une generation audio locale peut durer plusieurs minutes. Derriere
  // Cloudflare, attendre ici produit inevitablement un 524. La route web demande
  // donc une soumission asynchrone et sonde ensuite le prompt ComfyUI.
  if (options.wait === false) {
    return {
      ok: true,
      provider: 'acestep',
      state: 'processing',
      status: 'submitted',
      promptId,
      meta: {
        modele: config.diffusion,
        steps: config.steps,
        bpm: graphe[4].inputs.bpm,
        duree: graphe[4].inputs.duration,
        langue: graphe[4].inputs.language,
        keyscale: graphe[4].inputs.keyscale,
        vram: etat.vramLibre,
      },
    };
  }

  const resultat = await client.waitFor(promptId, { onProgress: options.onProgress || null });
  if (!resultat.ok) return { ok: false, provider: 'acestep', raison: resultat.raison, promptId };

  const fichier = client.firstOutputFile(resultat.outputs);
  if (!fichier) return { ok: false, provider: 'acestep', raison: 'aucun fichier produit', promptId };

  const audio = await client.fetchOutput(fichier);
  return {
    ok: true,
    provider: 'acestep',
    audio,
    filename: fichier.filename,
    promptId,
    meta: {
      modele: config.diffusion,
      steps: config.steps,
      bpm: graphe[4].inputs.bpm,
      duree: graphe[4].inputs.duration,
      langue: graphe[4].inputs.language,
      keyscale: graphe[4].inputs.keyscale,
      vram: etat.vramLibre,
    },
  };
}

async function getAceStepMusicJob(promptId, options = {}) {
  const env = options.env || process.env;
  const config = { ...resolveAceStepConfig(env), ...(options.config || {}) };
  const client = options.client || createComfyClient({ env, baseUrl: config.baseUrl });
  const resultat = await client.getStatus(promptId);
  if (!resultat.ok) {
    return {
      ok: false,
      provider: 'acestep',
      state: 'error',
      promptId,
      raison: resultat.raison || 'execution ACE-Step echouee',
    };
  }
  if (resultat.state !== 'done') {
    return { ok: true, provider: 'acestep', state: 'processing', status: 'running', promptId };
  }
  const fichier = client.firstOutputFile(resultat.outputs);
  if (!fichier) {
    return { ok: false, provider: 'acestep', state: 'error', promptId, raison: 'aucun fichier produit' };
  }
  const audio = await client.fetchOutput(fichier);
  return {
    ok: true,
    provider: 'acestep',
    state: 'done',
    status: 'completed',
    promptId,
    audio,
    filename: fichier.filename,
  };
}

module.exports = {
  DEFAUTS,
  NOEUDS,
  buildAceStepGraph,
  getAceStepMusicJob,
  isAceStepConfigured,
  requestAceStepMusic,
  resolveAceStepConfig,
  verifierNoeuds,
};
