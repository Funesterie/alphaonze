const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildAceStepGraph,
  getAceStepMusicJob,
  isAceStepConfigured,
  requestAceStepMusic,
  resolveAceStepConfig,
  NOEUDS,
} = require('../src/music/acestep-provider.cjs');

// Client factice : on verifie le contrat sans instance ComfyUI.
function faireClient({ noeuds = Object.values(NOEUDS), sante = { ok: true, vramLibre: 11e9 }, santes, resultat, fichier, refus } = {}) {
  const vu = {};
  let healthIndex = 0;
  return {
    vu,
    health: async () => {
      vu.healthCalls = (vu.healthCalls || 0) + 1;
      if (!Array.isArray(santes) || !santes.length) return sante;
      const resultatSante = santes[Math.min(healthIndex, santes.length - 1)];
      healthIndex += 1;
      return resultatSante;
    },
    listNodes: async () => noeuds,
    submit: async (g) => { vu.graphe = g; if (refus) throw new Error(refus); return 'pid-1'; },
    waitFor: async () => resultat || { ok: true, outputs: { 9: { audio: [{ filename: 'a.flac', type: 'output' }] } } },
    getStatus: async () => resultat || { ok: true, state: 'done', outputs: { 9: { audio: [{ filename: 'a.flac', type: 'output' }] } } },
    firstOutputFile: (o) => (fichier === null ? null : (fichier || { filename: 'a.flac', type: 'output', kind: 'audio' })),
    fetchOutput: async () => Buffer.from('AUDIO'),
  };
}

test('actif quand ComfyUI est declare, coupable explicitement', () => {
  assert.equal(isAceStepConfigured({}), false);
  assert.equal(isAceStepConfigured({ COMFYUI_BASE_URL: 'http://127.0.0.1:8188' }), true);
  assert.equal(isAceStepConfigured({ ACESTEP_ENABLED: 'true' }), true);
  assert.equal(isAceStepConfigured({ COMFYUI_BASE_URL: 'http://x', ACESTEP_DISABLED: 'true' }), false);
});

test('la config se laisse entierement surcharger par l environnement', () => {
  const c = resolveAceStepConfig({
    ACESTEP_DIFFUSION_MODEL: 'autre.safetensors',
    ACESTEP_STEPS: '20',
    ACESTEP_KSAMPLER_CFG: '1.25',
    ACESTEP_LLM_CFG_SCALE: '2.5',
    ACESTEP_DEFAULT_DURATION_SECONDS: '300',
    ACESTEP_MAX_DURATION_SECONDS: '900',
    ACESTEP_SAMPLER: 'dpmpp_2m',
    ACESTEP_GENERATE_AUDIO_CODES: 'false',
  });
  assert.equal(c.diffusion, 'autre.safetensors');
  assert.equal(c.steps, 20);
  assert.equal(c.cfg, 1.25);
  assert.equal(c.llmCfgScale, 2.5);
  assert.equal(c.duration, 300);
  assert.equal(c.maxDuration, 900);
  assert.equal(c.sampler, 'dpmpp_2m');
  assert.equal(c.audioCodes, false);
  assert.match(c.textEncoder1, /qwen_0\.6b/);
  assert.match(c.textEncoder2, /qwen_1\.7b/);
});

test('le graphe suit le workflow officiel audio_ace_step_1_5_split', () => {
  const g = buildAceStepGraph({ tags: 'french rap', lyrics: 'seize mesures', duration: 30 });

  assert.equal(g[2].class_type, 'DualCLIPLoader', 'ACE-Step veut DEUX encodeurs');
  assert.equal(g[2].inputs.type, 'ace');
  assert.ok(g[2].inputs.clip_name1 && g[2].inputs.clip_name2);
  assert.equal(g[4].class_type, 'TextEncodeAceStepAudio1.5');
  assert.equal(g[6].class_type, 'EmptyAceStep1.5LatentAudio');
  assert.equal(g[8].class_type, 'VAEDecodeAudio');
  assert.equal(g[9].class_type, 'SaveAudio', 'la source ACE reste en FLAC jusqu au master final');
  assert.equal(g[9].inputs.quality, undefined, 'aucun MP3 intermediaire avec perte');

  assert.deepEqual(g[4].inputs.clip, ['2', 0]);
  assert.deepEqual(g[7].inputs.positive, ['4', 0]);
  assert.deepEqual(g[8].inputs.samples, ['7', 0]);
  assert.deepEqual(g[9].inputs.audio, ['8', 0]);
});

test('le modele passe par ModelSamplingAuraFlow avant le sampler', () => {
  // Sans ce patch le sampler recoit un modele non prepare. Il est dans tous les
  // workflows officiels ACE-Step 1.5, jamais optionnel.
  const g = buildAceStepGraph({});
  assert.equal(g[10].class_type, 'ModelSamplingAuraFlow');
  assert.deepEqual(g[10].inputs.model, ['1', 0]);
  assert.deepEqual(g[7].inputs.model, ['10', 0], 'le sampler doit lire le modele patche, pas le brut');
  assert.equal(g[10].inputs.shift, 3);
});

test('le turbo tourne en 8 pas et cfg 1', () => {
  // Valeurs du workflow officiel. Monter degrade au lieu d ameliorer.
  const g = buildAceStepGraph({});
  assert.equal(g[7].inputs.steps, 8);
  assert.equal(g[7].inputs.cfg, 1);
  assert.equal(g[7].inputs.sampler_name, 'euler');
  assert.equal(g[7].inputs.scheduler, 'simple');
  assert.equal(g[4].inputs.cfg_scale, 2, 'le CFG Qwen officiel est distinct du CFG sampler');
});

test('le francais est la langue par defaut', () => {
  // ACE-Step accepte 'fr' ; laisser 'en' abimerait la prononciation.
  assert.equal(buildAceStepGraph({}).inputs, undefined);
  assert.equal(buildAceStepGraph({}) [4].inputs.language, 'fr');
  assert.equal(buildAceStepGraph({ language: 'en' })[4].inputs.language, 'en');
});

test('le negatif est un ConditioningZeroOut, pas un second encodage', () => {
  // Regression reelle : un TextEncode avec generate_audio_codes=false rend une
  // conditioning dont le tenseur est None. Le sampler tombe alors sur
  // « NoneType has no attribute shape » vingt lignes plus bas, sans aucun
  // rapport apparent avec la cause. Le workflow officiel met la positive a zero.
  const g = buildAceStepGraph({ lyrics: 'du texte', negative: 'saturation' });

  assert.equal(g[5].class_type, 'ConditioningZeroOut');
  assert.deepEqual(g[5].inputs.conditioning, ['4', 0]);
  assert.deepEqual(g[7].inputs.negative, ['5', 0]);
  assert.equal(g[4].inputs.generate_audio_codes, true);
});

test('les valeurs hors bornes sont ramenees, pas refusees', () => {
  const g = buildAceStepGraph({ bpm: 9000, duration: -5 });
  assert.equal(g[4].inputs.bpm, 300);
  assert.equal(g[4].inputs.duration, 1);
  assert.equal(buildAceStepGraph({ bpm: 'abc' })[4].inputs.bpm, 120);
});

test('la duree du latent suit celle demandee', () => {
  const g = buildAceStepGraph({ duration: 45 });
  assert.equal(g[6].inputs.seconds, 45);
  assert.equal(g[4].inputs.duration, 45);
});

test('la duree est bornee par le latent ACE a 1000 secondes', () => {
  const g = buildAceStepGraph({ duration: 2000 });
  assert.equal(g[4].inputs.duration, 1000);
  assert.equal(g[6].inputs.seconds, 1000);
});

test('genere et rend l audio', async () => {
  const client = faireClient();
  const r = await requestAceStepMusic({ tags: 'rap', lyrics: 'test', duration: 16 }, { client });

  assert.equal(r.ok, true);
  assert.equal(r.provider, 'acestep');
  assert.equal(r.audio.toString(), 'AUDIO');
  assert.equal(r.meta.langue, 'fr');
  assert.equal(r.meta.duree, 16);
});

test('le mode web soumet ACE-Step sans attendre la generation', async () => {
  const client = faireClient();
  const r = await requestAceStepMusic({ tags: 'rap', lyrics: 'test' }, { client, wait: false });
  assert.equal(r.ok, true);
  assert.equal(r.state, 'processing');
  assert.equal(r.promptId, 'pid-1');
  assert.equal(r.audio, undefined);
});

test('le polling ACE-Step recupere le fichier seulement quand il est pret', async () => {
  const pending = faireClient({ resultat: { ok: true, state: 'processing', outputs: {} } });
  assert.equal((await getAceStepMusicJob('pid-1', { client: pending })).state, 'processing');

  const done = faireClient();
  const r = await getAceStepMusicJob('pid-1', { client: done });
  assert.equal(r.state, 'done');
  assert.equal(r.audio.toString(), 'AUDIO');
});

test('ComfyUI eteint donne une raison lisible, pas une exception', async () => {
  const client = faireClient({ sante: { ok: false, raison: 'ECONNREFUSED' } });
  const r = await requestAceStepMusic({}, { client, config: { healthAttempts: 1 } });
  assert.equal(r.ok, false);
  assert.match(r.raison, /injoignable.*ECONNREFUSED/);
});

test('un 502 transitoire de ComfyUI est retente avant de stopper la chanson', async () => {
  const client = faireClient({
    santes: [
      { ok: false, raison: 'comfyui /system_stats a repondu 502' },
      { ok: true, vramLibre: 11e9 },
    ],
  });
  const pauses = [];
  const r = await requestAceStepMusic(
    { lyrics: 'paroles completes' },
    { client, wait: false, config: { healthAttempts: 3, healthRetryMs: 25 }, sleep: async (ms) => pauses.push(ms) },
  );
  assert.equal(r.ok, true);
  assert.equal(client.vu.healthCalls, 2);
  assert.deepEqual(pauses, [25]);
});

test('un noeud manquant est nomme avant toute generation', async () => {
  // Le vrai piege : une version de ComfyUI qui renomme un noeud. Sans ce
  // controle, ComfyUI rejette le graphe avec un message illisible.
  const client = faireClient({ noeuds: ['KSampler', 'VAELoader'] });
  const r = await requestAceStepMusic({}, { client });

  assert.equal(r.ok, false);
  assert.match(r.raison, /noeuds absents/);
  assert.match(r.raison, /TextEncodeAceStepAudio1\.5/);
  assert.equal(client.vu.graphe, undefined, 'un graphe a ete soumis malgre des noeuds absents');
});

test('un graphe refuse remonte la raison', async () => {
  const client = faireClient({ refus: 'modele introuvable' });
  const r = await requestAceStepMusic({}, { client });
  assert.equal(r.ok, false);
  assert.match(r.raison, /modele introuvable/);
});

test('une execution ratee ne pretend pas avoir produit un fichier', async () => {
  const client = faireClient({ resultat: { ok: false, raison: 'VRAM insuffisante' } });
  const r = await requestAceStepMusic({}, { client });
  assert.equal(r.ok, false);
  assert.match(r.raison, /VRAM/);
});

test('aucun fichier en sortie est un echec, pas un succes vide', async () => {
  const client = faireClient({ fichier: null });
  const r = await requestAceStepMusic({}, { client });
  assert.equal(r.ok, false);
  assert.match(r.raison, /aucun fichier/);
});
