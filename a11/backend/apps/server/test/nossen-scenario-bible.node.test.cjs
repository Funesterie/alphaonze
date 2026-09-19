'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  NOSSEN_SCENARIO_BIBLE,
  isNossenScenarioRequest,
  appendNossenScenarioBible,
} = require('../src/persona/nossen-scenario-bible.cjs');

// La bible part dans le contexte de K44. Elle ne doit JAMAIS porter le spoiler
// Ghost88, ni les noms reels des personnes derriere les personnages, ni le statut
// « histoire vraie » (docs/NOSSEN_LORE_CANON_2026-08-03.md, sections 7 et « sources »).

test('la bible ne contient ni le spoiler Ghost88 ni les noms reels', () => {
  const folded = NOSSEN_SCENARIO_BIBLE.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  for (const interdit of ['ghost', 'lyana', 'carval', 'marvin', 'histoire vraie', 'pour de vrai', 'bots nossen', 'enferm']) {
    assert.equal(folded.includes(interdit), false, `interdit dans la bible : ${interdit}`);
  }
});

test('la bible porte le canon de base, pas un univers invente', () => {
  for (const attendu of ['Tera', 'Rei 33', 'Kaen 44', 'A-11', 'Vivy 55', 'Nya-22', 'M66', 'datamining', 'Gilera GSM', 'glitcher', 'ne les invente pas']) {
    assert.ok(NOSSEN_SCENARIO_BIBLE.includes(attendu), `manque : ${attendu}`);
  }
});

test('la bible part seulement pour une demande de scenario NOSSEN, et seulement a K44', () => {
  const demande = { messages: [{ role: 'user', content: 'écrit moi le scenario du manga nossen' }] };
  assert.equal(isNossenScenarioRequest(demande), true);
  assert.ok(appendNossenScenarioBible('Je suis Kaen44.', demande, 'kaen44').includes('BIBLE NOSSEN'));
  assert.equal(appendNossenScenarioBible('Je suis A11.', demande, 'a11'), 'Je suis A11.');

  // NOSSEN nomme juste avant, demande d'episode ensuite : la bible suit.
  const suite = { messages: [
    { role: 'user', content: 'on bosse sur NOSSEN' },
    { role: 'assistant', content: 'ok' },
    { role: 'user', content: "fais-moi l'épisode 3" },
  ] };
  assert.equal(isNossenScenarioRequest(suite), true);

  // Hors sujet : pas de bible.
  assert.equal(isNossenScenarioRequest({ messages: [{ role: 'user', content: 'classe mes factures' }] }), false);
  assert.equal(isNossenScenarioRequest({ messages: [{ role: 'user', content: 'le logo nossen est cool' }] }), false);
});
