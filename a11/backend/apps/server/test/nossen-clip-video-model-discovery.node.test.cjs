'use strict';

const test = require('node:test');
const assert = require('node:assert');

const {
  T2V_DEFAUT,
  estImageVersVideo,
  pickVideoModels,
  generateOneVideo,
} = require('../src/clips/clip-generator-v2.cjs');

// Catalogue reellement renvoye par le pont le 09/09/2026: sept modeles video
// partenaires, TOUS en text-to-video. C'est ce qui a tue le clip FIGHTERZ CLUB,
// dont l'identite djeff demandait une image de reference.
const CATALOGUE_PROD = [
  { model_name: 'bfl/flux-3-video', type: 'video', source: 'partner', tags: ['bfl', 'flux', 'video', 'text-to-video'] },
  { model_name: 'minimax/hailuo-03-t2v', type: 'video', source: 'partner', tags: ['text-to-video'] },
  { model_name: 'byteplus/seedance-2.0-t2v', type: 'video', source: 'partner', tags: ['text-to-video'] },
  { model_name: 'kling/kling-v3-t2v', type: 'video', source: 'partner', tags: ['text-to-video'] },
  { model_name: 'ltx/ltx-2-5-t2v', type: 'video', source: 'partner', tags: ['text-to-video'] },
  { model_name: 'veo/veo-3-t2v', type: 'video', source: 'partner', tags: ['text-to-video'] },
  { model_name: 'hunyuan_video_v2_replace_image_to_video_720p_bf16.safetensors', type: 'diffusion_model', source: 'local', tags: [] },
];

test('sur le catalogue reel, aucun i2v: la reference doit etre abandonnee', () => {
  const { t2v, i2v } = pickVideoModels(CATALOGUE_PROD, {});
  assert.equal(i2v, null, 'aucun modele image-to-video partenaire n existe');
  assert.equal(t2v, 'byteplus/seedance-2.0-t2v');
});

test('un modele local image-to-video ne compte pas comme un partenaire', () => {
  const local = CATALOGUE_PROD.find((m) => m.source === 'local');
  assert.equal(pickVideoModels([local], {}).i2v, null);
});

test('le tag prime sur le nom: flux-3-video est du text-to-video', () => {
  assert.equal(estImageVersVideo(CATALOGUE_PROD[0]), false);
  assert.equal(estImageVersVideo({ model_name: 'x/quelque-chose-i2v', tags: [] }), true);
  assert.equal(estImageVersVideo({ model_name: 'x/modele', tags: ['image-to-video'] }), true);
});

test('un i2v present est choisi et permet la reference', () => {
  const avecI2v = [...CATALOGUE_PROD, { model_name: 'byteplus/seedance-3.0-i2v', type: 'video', source: 'partner', tags: ['image-to-video'] }];
  assert.equal(pickVideoModels(avecI2v, {}).i2v, 'byteplus/seedance-3.0-i2v');
});

test('un modele demande par variable n est retenu que s il existe vraiment', () => {
  assert.equal(pickVideoModels(CATALOGUE_PROD, { NOSSEN_CLIP_T2V_MODEL: 'veo/veo-3-t2v' }).t2v, 'veo/veo-3-t2v');
  // Le piege d origine: un identifiant en dur devenu faux. Il ne doit jamais
  // etre soumis simplement parce qu on l a demande.
  assert.equal(pickVideoModels(CATALOGUE_PROD, { NOSSEN_CLIP_T2V_MODEL: 'modele/inexistant' }).t2v, 'byteplus/seedance-2.0-t2v');
  assert.equal(pickVideoModels(CATALOGUE_PROD, { NOSSEN_CLIP_I2V_MODEL: 'byteplus/seedance-2.0-i2v' }).i2v, null);
});

test('un catalogue vide ou illisible retombe sur le defaut sans reference', () => {
  for (const vide of [[], null, undefined, 'pas un tableau']) {
    const r = pickVideoModels(vide, {});
    assert.equal(r.t2v, T2V_DEFAUT);
    assert.equal(r.i2v, null);
  }
});

test('sans i2v, la soumission part en t2v et ne porte aucune image', async () => {
  let envoye = null;
  const postJsonImpl = async (url, body) => {
    if (body.tool === 'comfy__partner_generate') { envoye = body.args; return { ok: true, result: { content: [{ type: 'text', text: '{"prompt_id":"p1"}' }] } }; }
    if (body.tool === 'comfy__get_job_status') return { ok: true, result: { content: [{ type: 'text', text: '{"status":"completed"}' }] } };
    return { ok: true, result: { content: [{ type: 'text', text: '{"output_url":"https://exemple.invalid/v.mp4"}' }] } };
  };
  const identity = { referenceImageUrls: ['https://vivy.funesterie.me/api/vivy/stream/identity/djeff-reference-01'], negativePrompt: '' };
  await generateOneVideo('plan', 0, 5000, identity, {
    postJsonImpl, sleepImpl: async () => {}, models: { t2v: 'byteplus/seedance-2.0-t2v', i2v: null },
  }).catch(() => {});
  assert.ok(envoye, 'une soumission a bien eu lieu');
  assert.equal(envoye.model, 'byteplus/seedance-2.0-t2v');
  assert.equal(envoye.image, undefined, 'aucune image ne doit accompagner un modele text-to-video');
});

// Les cinq references de djeff vont de 240x240 (4 Ko) a 720x720 (49 Ko). Le rang
// etait fige a [0] sans que rien ne le documente: pour une autre identite, cela
// peut designer une vignette incapable de verrouiller un visage.
test('le rang de la reference se choisit, et un rang absurde ne perd pas la reference', () => {
  const { choisirReference } = require('../src/clips/clip-generator-v2.cjs');
  const identite = { referenceImageUrls: ['r01', 'r02', 'r03', 'r04', 'r05'] };
  assert.equal(choisirReference(identite, {}), 'r01', 'par defaut, la premiere');
  assert.equal(choisirReference(identite, { NOSSEN_CLIP_REFERENCE_INDEX: '3' }), 'r04');
  for (const absurde of ['9', '-1', 'abc', '', undefined]) {
    assert.equal(choisirReference(identite, { NOSSEN_CLIP_REFERENCE_INDEX: absurde }), 'r01', String(absurde));
  }
});

test('une identite sans reference ne fabrique pas d image fantome', () => {
  const { choisirReference } = require('../src/clips/clip-generator-v2.cjs');
  assert.equal(choisirReference({ referenceImageUrls: [] }, {}), null);
  assert.equal(choisirReference(null, {}), null);
  assert.equal(choisirReference({}, {}), null);
});
