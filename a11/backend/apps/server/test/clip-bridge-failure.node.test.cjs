'use strict';
/**
 * Ce que ce fichier protege : le motif REEL d'un echec de generation.
 *
 * Le 2026-09-07, NOSSEN rendait « Aucune vidéo générée » pendant que l'amont
 * Comfy repondait, en toutes lettres, « API key is invalid or expired (403 on
 * /api/prompt) ». Le message existait a chaque tentative et n'a jamais ete lu :
 * le pont MCP repond 200 avec { ok: true } et signale l'echec par
 * result.isError, alors que le generateur ne regardait que result.ok. La cause
 * ressortait donc en « No prompt_id in response », et il a fallu une journee et
 * une reproduction manuelle pour la retrouver.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

// Le module cree son dossier de clips a l'import : on le detourne vers un
// temporaire, sinon le test tente d'ecrire dans /app/runtime/clips.
process.env.NOSSEN_CLIPS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'clips-test-'));

const { describeBridgeFailure } = require('../src/clips/clip-generator-v2.cjs');
const source = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'clips', 'clip-generator-v2.cjs'),
  'utf8'
);

test('un echec d outil arrive en ok:true — c est le piege, et il est desamorce', () => {
  const reponse = {
    ok: true,
    result: {
      isError: true,
      content: [{ type: 'text', text: 'partner_generate failed: API key is invalid or expired (403 on /api/prompt).' }],
    },
  };
  const motif = describeBridgeFailure(reponse);
  assert.ok(motif, 'un isError doit etre reconnu comme un echec malgre ok:true');
  assert.match(motif, /API key is invalid or expired/);
});

test('un refus du pont lui-meme est rendu tel quel', () => {
  assert.equal(
    describeBridgeFailure({ ok: false, error: 'Tool not allowed: comfy__partner_generate' }),
    'Tool not allowed: comfy__partner_generate'
  );
});

test('une reponse vide ne passe pas pour un succes', () => {
  assert.equal(describeBridgeFailure(null), 'reponse vide du pont MCP');
  assert.equal(describeBridgeFailure({ ok: true, result: { isError: true, content: [] } }), 'echec amont sans message');
});

test('une reponse exploitable ne declenche aucun faux echec', () => {
  const bonne = { ok: true, result: { content: [{ type: 'text', text: 'prompt_id: 0a1b2c3d-1111-2222-3333-444455556666' }] } };
  assert.equal(describeBridgeFailure(bonne), null);
});

test('le generateur consulte ce motif au lieu de regarder seulement result.ok', () => {
  // La soumission doit lire l'erreur imbriquée, puis s'arrêter : répéter une
  // requête vidéo ambiguë peut débiter deux fois le même segment.
  assert.match(source, /const echecAmont = describeBridgeFailure\(result\);/);
  assert.match(source, /if \(echecAmont\) throw new Error\(echecAmont\);/);
  assert.doesNotMatch(source, /repli t2v|let retries = 2|retry\.\.\./i);
  assert.match(source, /un seul appel payant par segment/i);
  // Sans prompt_id, la reponse doit etre citee, pas resumee a un constat.
  assert.match(source, /Pas de prompt_id dans la reponse/);
});

test('un clip vide dit pourquoi il est vide', () => {
  assert.match(source, /let dernierEchec = '';/);
  assert.match(source, /dernierEchec = error\.message;/);
  assert.match(source, /Aucune vidéo générée — dernier échec/);
  // Le cas « zero segment demande » se distingue de « tous les segments ont rate ».
  assert.match(source, /aucun segment demandé/);
});

test('une duree illisible garde le repli au lieu de propager NaN', () => {
  // parseFloat('N/A') vaut NaN sans lever : l affectation directe detruisait le
  // repli de 180 s, numSegments devenait NaN, et la boucle ne tournait jamais.
  assert.match(source, /const mesure = Math\.ceil\(parseFloat\(brut\)\);/);
  assert.match(source, /if \(Number\.isFinite\(mesure\) && mesure > 0\) audioDuration = mesure;/);
  assert.doesNotMatch(source, /catch \(e\) \{\}/);
});
