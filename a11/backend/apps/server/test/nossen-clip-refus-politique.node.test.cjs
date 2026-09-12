'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Le module cree son dossier de clips au chargement ; /app n'existe pas en CI.
process.env.NOSSEN_CLIPS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'clip-refus-politique-'));
const {
  PLAFOND_REFUS_POLITIQUE,
  estRefusDePolitique,
  extractComfyErrorDetail,
} = require('../src/clips/clip-generator-v2.cjs');

// Reponse reelle du pont le 09/09/2026: une notice generique d'abord, puis le
// JSON qui contient la vraie cause. On affichait la notice, tronquee.
const REPONSE_REELLE = {
  ok: true,
  result: {
    content: [
      { type: 'text', text: 'Job failed during execution. This failure most likely came from the node named in `error.node_type` rather than from Comfy Cloud infrastructure — the specific cause is in `error.message`.' },
      { type: 'text', text: JSON.stringify({ status: 'error', completed: false, error: { message: 'Polling aborted due to error: Task failed: {"error": {"code": "OutputVideoSensitiveContentDetected.PolicyViolation", "message": "the output video may be related to copyright restrictions"}}' } }) },
    ],
  },
};

test('la vraie cause est extraite, pas la notice generique', () => {
  const detail = extractComfyErrorDetail(REPONSE_REELLE);
  assert.match(detail, /PolicyViolation/, 'le code doit survivre a la troncature');
  assert.doesNotMatch(detail, /most likely came from the node/, 'la notice ne doit pas prendre la place');
});

test('une reponse sans erreur structuree ne fabrique pas de faux diagnostic', () => {
  assert.equal(extractComfyErrorDetail({ ok: true, result: { content: [{ type: 'text', text: 'tout va bien' }] } }), '');
  for (const vide of [null, undefined, {}, { result: {} }, 'pas un objet']) {
    assert.equal(extractComfyErrorDetail(vide), '');
  }
});

// Le filtre est probabiliste d'un plan a l'autre: sur un meme clip, le plan 0 est
// passe et le plan 1 a ete refuse. S'arreter au premier refus condamnait un clip
// de 26 plans a n'en rendre qu'un.
test('un refus du filtre se distingue d une panne technique', () => {
  const detail = extractComfyErrorDetail(REPONSE_REELLE);
  assert.equal(estRefusDePolitique(detail), true);
  assert.equal(estRefusDePolitique('OutputVideoSensitiveContentDetected'), true);
  assert.equal(estRefusDePolitique('the output video may be related to copyright restrictions'), true);
  // Ces echecs-la peuvent avoir soumis un travail payant: on ne continue pas.
  for (const technique of ['clip_video_submission_ambiguous: socket hang up', 'clip_video_wait_timeout: segment 3', 'unknown model', '']) {
    assert.equal(estRefusDePolitique(technique), false, technique);
  }
});

test('le nombre de refus tolerés est borné, pour ne pas payer 26 refus', () => {
  assert.ok(PLAFOND_REFUS_POLITIQUE >= 1);
  assert.ok(PLAFOND_REFUS_POLITIQUE <= 10, 'au-dela, le garde-fou de cout ne garde plus rien');
});
