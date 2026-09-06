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
  // Conserver la sortie modele sans perte. Le MP3 public est encode une seule
  // fois, apres le mastering Vivy; SaveAudioMP3 ajoutait deja une generation
  // avec perte avant les passes V9/V10.
  save: 'SaveAudio',
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
  // Le 4B est un profil de qualite optionnel. Sur la RTX 5070 12 Go, le garder
  // hors du chemin par defaut evite de transformer chaque generation en test
  // d'offload VRAM. Il ne remplace jamais silencieusement le 1.7B stable.
  textEncoder2Qwen4: 'qwen_4b_ace15.safetensors',
  vae: 'ace_1.5_vae.safetensors',
  // Le turbo est entraine pour huit pas et un cfg de 1 ; monter coute du temps
  // et degrade le resultat au lieu de l'ameliorer.
  steps: 8,
  cfg: 1,
  // Le workflow ACE 1.5 distingue bien le CFG du sampler (1) de celui de
  // l'encodeur Qwen (2). Les confondre donnait cfg_scale=1 aux paroles.
  llmCfgScale: 2,
  shift: 3,
  sampler: 'euler',
  scheduler: 'simple',
  bpm: 120,
  // Aucune duree cible par defaut. L'API ACE-Step 1.5 officielle utilise -1
  // pour laisser le LM choisir selon les paroles. Le noeud ComfyUI 0.30.0 ne
  // sait pas recevoir ce sentinel (son latent exige un nombre positif), donc
  // le raccord Comfy calcule plus bas un canevas musical adapte au contenu.
  duration: null,
  // EmptyAceStep1.5LatentAudio refuse plus de 1000 secondes, meme si
  // TextEncodeAceStepAudio1.5 annonce 2000. La borne la plus basse fait foi.
  maxDuration: 1000,
  timesignature: '4',
  language: 'fr',
  keyscale: 'C minor',
  audioCodes: true,
  temperature: 0.85,
  topP: 0.9,
  topK: 0,
  minP: 0,
  mp3Quality: 'V0',
  // ComfyUI peut repondre 502 quelques secondes pendant le chargement des
  // noeuds ou la reconnexion du tunnel. Une chanson ne doit pas echouer sur
  // cette seule sonde transitoire apres plusieurs minutes d'ecriture.
  healthAttempts: 6,
  healthRetryMs: 3000,
};

function lireEnv(env, ...noms) {
  for (const nom of noms) {
    const v = String(env[nom] || '').trim();
    if (v) return v;
  }
  return '';
}

function lireNombreEnv(env, noms, defaut, min, max) {
  const brut = lireEnv(env, ...noms);
  if (!brut) return defaut;
  const nombre = Number(brut);
  return Number.isFinite(nombre) ? Math.min(max, Math.max(min, nombre)) : defaut;
}

function lireNombrePositifOptionnelEnv(env, noms, min, max) {
  const brut = lireEnv(env, ...noms);
  if (!brut) return null;
  const nombre = Number(brut);
  if (!Number.isFinite(nombre) || nombre <= 0) return null;
  return Math.min(max, Math.max(min, nombre));
}

function lireBooleenEnv(env, noms, defaut) {
  const brut = lireEnv(env, ...noms).toLowerCase();
  if (!brut) return defaut;
  if (['1', 'true', 'yes', 'on', 'oui'].includes(brut)) return true;
  if (['0', 'false', 'no', 'off', 'non'].includes(brut)) return false;
  return defaut;
}

function resolveAceStepConfig(env = process.env) {
  const maxDuration = lireNombreEnv(env, ['ACESTEP_MAX_DURATION_SECONDS'], DEFAUTS.maxDuration, 1, 1000);
  return {
    baseUrl: resolveComfyBaseUrl(env),
    diffusion: lireEnv(env, 'ACESTEP_DIFFUSION_MODEL') || DEFAUTS.diffusion,
    textEncoder1: lireEnv(env, 'ACESTEP_TEXT_ENCODER_1') || DEFAUTS.textEncoder1,
    textEncoder2: lireEnv(env, 'ACESTEP_TEXT_ENCODER_2') || DEFAUTS.textEncoder2,
    textEncoder2Qwen4: lireEnv(env, 'ACESTEP_TEXT_ENCODER_2_QWEN4') || DEFAUTS.textEncoder2Qwen4,
    qwen4Enabled: lireBooleenEnv(env, ['ACESTEP_QWEN4_PROFILE_ENABLED'], false),
    vae: lireEnv(env, 'ACESTEP_VAE') || DEFAUTS.vae,
    steps: Math.round(lireNombreEnv(env, ['ACESTEP_STEPS'], DEFAUTS.steps, 1, 100)),
    cfg: lireNombreEnv(env, ['ACESTEP_KSAMPLER_CFG', 'ACESTEP_CFG'], DEFAUTS.cfg, 0, 100),
    llmCfgScale: lireNombreEnv(env, ['ACESTEP_LLM_CFG_SCALE'], DEFAUTS.llmCfgScale, 0, 100),
    shift: lireNombreEnv(env, ['ACESTEP_SHIFT'], DEFAUTS.shift, 0, 100),
    sampler: lireEnv(env, 'ACESTEP_SAMPLER') || DEFAUTS.sampler,
    scheduler: lireEnv(env, 'ACESTEP_SCHEDULER') || DEFAUTS.scheduler,
    bpm: lireNombreEnv(env, ['ACESTEP_DEFAULT_BPM'], DEFAUTS.bpm, 10, 300),
    // Compatibilite avec un profil fixe explicitement configure. La production
    // ne doit pas ecrire cette variable par defaut : absente, elle vaut auto.
    duration: lireNombrePositifOptionnelEnv(env, ['ACESTEP_DEFAULT_DURATION_SECONDS'], 1, maxDuration),
    maxDuration,
    timesignature: lireEnv(env, 'ACESTEP_TIME_SIGNATURE') || DEFAUTS.timesignature,
    language: lireEnv(env, 'ACESTEP_LANGUAGE') || DEFAUTS.language,
    keyscale: lireEnv(env, 'ACESTEP_KEYSCALE') || DEFAUTS.keyscale,
    audioCodes: lireBooleenEnv(env, ['ACESTEP_GENERATE_AUDIO_CODES'], DEFAUTS.audioCodes),
    temperature: lireNombreEnv(env, ['ACESTEP_TEMPERATURE'], DEFAUTS.temperature, 0, 2),
    topP: lireNombreEnv(env, ['ACESTEP_TOP_P'], DEFAUTS.topP, 0, 1),
    topK: Math.round(lireNombreEnv(env, ['ACESTEP_TOP_K'], DEFAUTS.topK, 0, 100)),
    minP: lireNombreEnv(env, ['ACESTEP_MIN_P'], DEFAUTS.minP, 0, 1),
    mp3Quality: lireEnv(env, 'ACESTEP_MP3_QUALITY') || DEFAUTS.mp3Quality,
    healthAttempts: Math.round(lireNombreEnv(env, ['ACESTEP_HEALTH_ATTEMPTS'], DEFAUTS.healthAttempts, 1, 20)),
    healthRetryMs: Math.round(lireNombreEnv(env, ['ACESTEP_HEALTH_RETRY_MS'], DEFAUTS.healthRetryMs, 0, 30000)),
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

function hashAceStepDurationSeed(value = '') {
  // FNV-1a 32 bits : stable entre comptes/processus, sans horloge ni hasard
  // cache. Deux structures differentes ne retombent pas toutes sur 2:00.
  let hash = 0x811c9dc5;
  for (const caractere of String(value)) {
    hash ^= caractere.codePointAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function estimateAceStepAutoDuration(demande = {}, config = {}) {
  // Compatibilite ComfyUI, pas l'auto-duree native ACE-Step : le LM officiel
  // accepte duration=-1/None, tandis que les deux noeuds Comfy locaux exigent
  // une valeur positive identique pour l'encodage et le latent. Cette fonction
  // dimensionne donc le canevas a partir de la composition sans minuterie fixe.
  const lyrics = String(demande.lyrics || '').trim();
  const tags = String(demande.tags || '').trim();
  const bpm = clamp(demande.bpm, 10, 300, config.bpm ?? DEFAUTS.bpm);
  const timesignature = String(demande.timesignature || config.timesignature || DEFAUTS.timesignature);
  const beatsPerBar = Math.max(2, Math.min(6, Number.parseInt(timesignature, 10) || 4));
  const secondsPerBeat = 60 / bpm;
  const secondsPerBar = beatsPerBar * secondsPerBeat;
  const maxDuration = Number(config.maxDuration ?? DEFAUTS.maxDuration) || DEFAUTS.maxDuration;
  const folded = `${tags}\n${lyrics}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const contentHash = hashAceStepDurationSeed(`${folded}\n${demande.seed ?? 0}\n${bpm}\n${timesignature}`);
  const longForm = /\b(long[ -]?form|epique|epic|progressif|progressive|suite|extended|ample)\b/.test(folded);
  const fastDelivery = /\b(rap|drill|trap|grime|double[ -]?time|rapide|nerveux|fast)\b/.test(folded);
  const slowDelivery = /\b(ballad|ballade|slow|lent|ambient|spoken|parle|slam)\b/.test(folded);
  const wordsPerMinute = fastDelivery ? 145 : slowDelivery ? 86 : 112;
  const rows = lyrics.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const sectionRows = rows.filter((line) => /^\[[^\]\n]{1,100}\]$/.test(line));
  const lyricRows = rows.filter((line) => !/^\[[^\]\n]{1,100}\]$/.test(line));
  const vocalText = lyricRows.join(' ')
    .replace(/\[(?:instrumental|music|solo|intro|outro)\]/gi, ' ')
    .trim();
  const words = vocalText.match(/[\p{L}\p{N}]+(?:['\u2019-][\p{L}\p{N}]+)*/gu) || [];
  const instrumental = words.length === 0 || /^\s*\[instrumental\]\s*$/i.test(lyrics);

  let seconds;
  let basis;
  if (instrumental) {
    // Sans paroles, varier une forme complete en nombre de mesures. Ce n'est
    // pas une cible ronde globale : le prompt/seed choisit le canevas.
    const baseBars = longForm ? 80 : 48;
    const variableBars = contentHash % (longForm ? 41 : 33);
    const tailBeats = 1 + ((contentHash >>> 8) % beatsPerBar);
    seconds = ((baseBars + variableBars) * secondsPerBar) + (tailBeats * secondsPerBeat);
    basis = 'comfy-instrumental-layout';
  } else {
    const vocalSeconds = (words.length / wordsPerMinute) * 60;
    const phrasingSeconds = lyricRows.length * secondsPerBar;
    const transitionBars = 8 + (sectionRows.length * 2) + (longForm ? 8 : 0);
    const tailBeats = 1 + ((contentHash >>> 8) % Math.max(1, beatsPerBar * 2));
    seconds = Math.max(vocalSeconds, phrasingSeconds)
      + (transitionBars * secondsPerBar)
      + (tailBeats * secondsPerBeat);
    basis = 'comfy-lyrics-layout';
  }

  // Aligner sur un demi-beat donne au latent une longueur musicale, pas un
  // entier arbitraire en minutes. Le plafond reste un garde-fou, pas une cible.
  const halfBeat = secondsPerBeat / 2;
  const musicalSeconds = Math.ceil(seconds / halfBeat) * halfBeat;
  return {
    seconds: Math.round(Math.min(maxDuration, Math.max(10, musicalSeconds)) * 100) / 100,
    mode: 'comfy-adaptive-fallback',
    basis,
    bpm,
    beatsPerBar,
    wordCount: words.length,
    lyricLineCount: lyricRows.length,
    sectionCount: sectionRows.length,
  };
}

function resolveAceStepDuration(demande = {}, config = {}) {
  const maxDuration = Number(config.maxDuration ?? DEFAUTS.maxDuration) || DEFAUTS.maxDuration;
  const requested = Number(demande.duration);
  if (Number.isFinite(requested) && requested > 0) {
    return {
      seconds: Math.min(maxDuration, Math.max(1, requested)),
      mode: 'explicit',
      basis: 'request',
    };
  }

  const configured = Number(config.duration);
  if (Number.isFinite(configured) && configured > 0) {
    return {
      seconds: Math.min(maxDuration, Math.max(1, configured)),
      mode: 'configured',
      basis: 'legacy-fixed-profile',
    };
  }

  return estimateAceStepAutoDuration(demande, config);
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
  const requestedTextEncoderProfile = String(
    demande.textEncoderProfile
    || demande.qwenProfile
    || demande.qualityProfile
    || ''
  ).trim().toLowerCase();
  const useQwen4 = config.qwen4Enabled === true
    && ['4b', 'qwen4', 'qwen-4b', 'quality-4b', 'experimental-4b'].includes(requestedTextEncoderProfile);
  const textEncoder2 = useQwen4
    ? (config.textEncoder2Qwen4 || DEFAUTS.textEncoder2Qwen4)
    : (config.textEncoder2 || DEFAUTS.textEncoder2);
  const duration = resolveAceStepDuration(demande, config);

  const commun = {
    seed,
    bpm: clamp(demande.bpm, 10, 300, config.bpm ?? DEFAUTS.bpm),
    duration: duration.seconds,
    timesignature: String(demande.timesignature || config.timesignature || DEFAUTS.timesignature),
    language: String(demande.language || config.language || DEFAUTS.language),
    keyscale: String(demande.keyscale || config.keyscale || DEFAUTS.keyscale),
    // Les codes audio ameliorent la qualite mais coutent cher en temps. On les
    // garde actifs par defaut : sur du rap, l'articulation est ce qui casse en
    // premier, et c'est exactement ce que cette etape rattrape.
    generate_audio_codes: demande.audioCodes == null ? config.audioCodes !== false : demande.audioCodes !== false,
    cfg_scale: clamp(demande.llmCfgScale ?? demande.cfgScale, 0, 100, config.llmCfgScale ?? DEFAUTS.llmCfgScale),
    temperature: clamp(demande.temperature, 0, 2, config.temperature ?? DEFAUTS.temperature),
    top_p: clamp(demande.topP, 0, 1, config.topP ?? DEFAUTS.topP),
    top_k: Math.round(clamp(demande.topK, 0, 100, config.topK ?? DEFAUTS.topK)),
    min_p: clamp(demande.minP, 0, 1, config.minP ?? DEFAUTS.minP),
  };

  return {
    1: { class_type: NOEUDS.unet, inputs: { unet_name: config.diffusion, weight_dtype: 'default' } },
    2: {
      class_type: NOEUDS.clip,
      inputs: { clip_name1: config.textEncoder1, clip_name2: textEncoder2, type: 'ace', device: 'default' },
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
        sampler_name: config.sampler || DEFAUTS.sampler,
        scheduler: config.scheduler || DEFAUTS.scheduler,
        denoise: 1,
      },
    },
    8: { class_type: NOEUDS.decode, inputs: { samples: ['7', 0], vae: ['3', 0] } },
    9: {
      class_type: NOEUDS.save,
      inputs: {
        audio: ['8', 0],
        filename_prefix: String(demande.prefix || 'funesterie/acestep'),
      },
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

  let etat;
  for (let tentative = 1; tentative <= config.healthAttempts; tentative += 1) {
    etat = await client.health();
    if (etat.ok || tentative === config.healthAttempts) break;
    const pause = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    await pause(config.healthRetryMs);
  }
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

  const duration = resolveAceStepDuration(demande, config);
  const graphe = buildAceStepGraph({ ...demande, duration: duration.seconds }, config);

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
        dureeMode: duration.mode,
        dureeBase: duration.basis,
        langue: graphe[4].inputs.language,
        keyscale: graphe[4].inputs.keyscale,
        lyricChars: String(demande.lyrics || '').length,
        llmCfgScale: graphe[4].inputs.cfg_scale,
        samplerCfg: graphe[7].inputs.cfg,
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
      dureeMode: duration.mode,
      dureeBase: duration.basis,
      langue: graphe[4].inputs.language,
      keyscale: graphe[4].inputs.keyscale,
      lyricChars: String(demande.lyrics || '').length,
      llmCfgScale: graphe[4].inputs.cfg_scale,
      samplerCfg: graphe[7].inputs.cfg,
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
  estimateAceStepAutoDuration,
  getAceStepMusicJob,
  isAceStepConfigured,
  requestAceStepMusic,
  resolveAceStepDuration,
  resolveAceStepConfig,
  verifierNoeuds,
};
