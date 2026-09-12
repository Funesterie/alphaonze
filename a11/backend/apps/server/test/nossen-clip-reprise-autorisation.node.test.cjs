'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Le module cree son dossier de clips au chargement ; /app n'existe pas en CI.
process.env.NOSSEN_CLIPS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'clip-reprise-autorisation-'));
const { estRefusAutorisation, estRefusDePolitique, PAUSE_REPRISE_AUTORISATION_MS } = require('../src/clips/clip-generator-v2.cjs');

// Messages reels : refus du noeud (09/09 et 11/09/2026) et refus de la passerelle
// MCP de Comfy (11/09/2026, FIGHTERZ CLUB au plan 4).
const REFUS_NOEUD = 'clip_video_generation_failed: Polling aborted due to error: Unauthorized: Please login first to use this node.';
const REFUS_PASSERELLE = 'mcp_bridge_http_500: {"ok":false,"error":"MCP error: {code:-32000, message: Unable to verify account access. Please try again. (reference: mcpgate_cbd6a4929cab)}"}';
const REFUS_FILTRE = 'clip_video_generation_failed: OutputVideoSensitiveContentDetected.PolicyViolation : the output video may be related to copyright restrictions';

test('les deux formes du refus d autorisation Comfy sont reconnues', () => {
  assert.equal(estRefusAutorisation(REFUS_NOEUD), true);
  assert.equal(estRefusAutorisation(REFUS_PASSERELLE), true);
});

test('refus d autorisation et refus du filtre ne se confondent pas', () => {
  assert.equal(estRefusAutorisation(REFUS_FILTRE), false, 'un refus du filtre ne se reessaie pas');
  assert.equal(estRefusDePolitique(REFUS_NOEUD), false, 'un refus d autorisation ne fait pas sauter le plan');
});

test('les pannes techniques ne declenchent pas de nouvel essai payant', () => {
  for (const autre of ['clip_video_submission_ambiguous: socket hang up', 'clip_video_wait_timeout: segment 3', 'unknown model', '', null, undefined]) {
    assert.equal(estRefusAutorisation(autre), false, String(autre));
  }
});

test('la pause avant le nouvel essai est bornee', () => {
  assert.ok(Number.isFinite(PAUSE_REPRISE_AUTORISATION_MS));
  assert.ok(PAUSE_REPRISE_AUTORISATION_MS >= 0 && PAUSE_REPRISE_AUTORISATION_MS <= 300000);
});
