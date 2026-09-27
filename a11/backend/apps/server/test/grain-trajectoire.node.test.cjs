'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('journal de trajectoire : une ligne par morceau, repetition comptee par grain', () => {
  const { journaliserTrajectoire, lireTrajectoire } = require('../src/persona/grain-trajectoire.cjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trajectoire-'));
  const env = { A11_GRAIN_TRAJECTOIRE_FILE: path.join(dir, 't.jsonl') };
  try {
    journaliserTrajectoire({ decisionId: 't1', grain: 'vivy', texture: 'x', mouvement: 'm' }, env);
    journaliserTrajectoire({ decisionId: 't2', grain: 'djeff', texture: 'x', mouvement: 'm' }, env);
    const troisieme = journaliserTrajectoire({ decisionId: 't3', grain: 'vivy', texture: 'x', mouvement: 'n' }, env);
    assert.equal(lireTrajectoire(env).length, 3);
    assert.equal(troisieme.tempsSemantique.rang, 2);
    assert.equal(troisieme.tempsSemantique.repetitionTexture, 1);
    assert.equal(troisieme.tempsSemantique.repetitionMouvement, 0);
    assert.equal(troisieme.retour, null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
