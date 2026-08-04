const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildAceStepGraph,
  isAceStepConfigured,
  requestAceStepMusic,
  resolveAceStepConfig,
  NOEUDS,
} = require('../src/music/acestep-provider.cjs');

// Client factice : on verifie le contrat sans instance ComfyUI.
function faireClient({ noeuds = Object.values(NOEUDS), sante = { ok: true, vramLibre: 11e9 }, resultat, fichier, refus } = {}) {
  const vu = {};
  return {
    vu,
    health: async () => sante,
    listNodes: async () => noeuds,
    submit: async (g) => { vu.graphe = g; if (refus) throw new Error(refus); return 'pid-1'; },
    waitFor: async () => resultat || { ok: true, outputs: { 9: { audio: [{ filename: 'a.flac', type: 'output' }] } } },
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

test('la config se laisse surcharger par l environnement', () => {
  const c = resolveAceStepConfig({ ACESTEP_DIFFUSION_MODEL: 'autre.safetensors', ACESTEP_STEPS: '20' });
  assert.equal(c.diffusion, 'autre.safetensors');
  assert.equal(c.steps, 20);
  assert.match(c.textEncoder, /qwen_1\.7b/);
});

test('le graphe cable les noeuds lus dans ComfyUI 0.30.0', () => {
  const g = buildAceStepGraph({ tags: 'french rap', lyrics: 'seize mesures', duration: 30 });

  assert.equal(g[2].inputs.type, 'ace', 'le CLIPLoader doit etre de type ace');
  assert.equal(g[4].class_type, 'TextEncodeAceStepAudio1.5');
  assert.equal(g[6].class_type, 'EmptyAceStep1.5LatentAudio');
  assert.equal(g[8].class_type, 'VAEDecodeAudio');

  // Le cablage : encodeur -> conditioning -> sampler -> vae -> sauvegarde.
  assert.deepEqual(g[4].inputs.clip, ['2', 0]);
  assert.deepEqual(g[7].inputs.positive, ['4', 0]);
  assert.deepEqual(g[7].inputs.negative, ['5', 0]);
  assert.deepEqual(g[8].inputs.samples, ['7', 0]);
  assert.deepEqual(g[9].inputs.audio, ['8', 0]);
});

test('le francais est la langue par defaut', () => {
  // ACE-Step accepte 'fr' ; laisser 'en' abimerait la prononciation.
  assert.equal(buildAceStepGraph({}).inputs, undefined);
  assert.equal(buildAceStepGraph({}) [4].inputs.language, 'fr');
  assert.equal(buildAceStepGraph({ language: 'en' })[4].inputs.language, 'en');
});

test('le negatif ne porte ni paroles ni codes audio', () => {
  // Sinon on genere un second morceau au lieu de decrire ce qu on evite.
  const g = buildAceStepGraph({ lyrics: 'du texte', negative: 'saturation' });
  assert.equal(g[5].inputs.lyrics, '');
  assert.equal(g[5].inputs.tags, 'saturation');
  assert.equal(g[5].inputs.generate_audio_codes, false);
  assert.equal(g[4].inputs.generate_audio_codes, true);
});

test('les valeurs hors bornes sont ramenees, pas refusees', () => {
  const g = buildAceStepGraph({ bpm: 9000, duration: -5 });
  assert.equal(g[4].inputs.bpm, 300);
  assert.equal(g[4].inputs.duration, 1);
  assert.equal(buildAceStepGraph({ bpm: 'abc' })[4].inputs.bpm, 90);
});

test('la duree du latent suit celle demandee', () => {
  const g = buildAceStepGraph({ duration: 45 });
  assert.equal(g[6].inputs.seconds, 45);
  assert.equal(g[4].inputs.duration, 45);
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

test('ComfyUI eteint donne une raison lisible, pas une exception', async () => {
  const client = faireClient({ sante: { ok: false, raison: 'ECONNREFUSED' } });
  const r = await requestAceStepMusic({}, { client });
  assert.equal(r.ok, false);
  assert.match(r.raison, /injoignable.*ECONNREFUSED/);
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
