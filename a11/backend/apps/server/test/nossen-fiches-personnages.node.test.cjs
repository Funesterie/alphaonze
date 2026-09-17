'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { createRequire } = require('node:module');

const {
  FICHES,
  renderCharacterSheet,
  renderCharacterSheets,
  condenseCharacterForShot,
} = require('../src/vivy/character-sheets.cjs');
const { IDENTITY_DEFINITIONS } = require('../src/vivy/visual-identities.cjs');

test('chaque personnage du registre visuel a une fiche longue, sourcée', () => {
  const ids = IDENTITY_DEFINITIONS.map((d) => d.id).sort();
  const fiches = Object.values(FICHES).map((f) => f.id).sort();
  assert.deepEqual(fiches, ids, 'un personnage du registre sans fiche, ou une fiche sans personnage');
  for (const fiche of Object.values(FICHES)) {
    const texte = renderCharacterSheet(fiche.id);
    assert.ok(texte.length >= 1200, `${fiche.id} : fiche trop courte (${texte.length})`);
    assert.ok(texte.length <= 4000, `${fiche.id} : fiche trop longue (${texte.length})`);
    for (const [, source] of fiche.sections) {
      assert.ok(['djeff', 'manga', 'registre'].includes(source), `${fiche.id} : source inconnue ${source}`);
    }
    assert.match(texte, /Non fixé, ne pas inventer/);
  }
});

test('la fiche lit l’apparence et les interdits dans le registre, sans la recopier', () => {
  const vivy = IDENTITY_DEFINITIONS.find((d) => d.id === 'vivy');
  const texte = renderCharacterSheet('vivy');
  assert.ok(texte.includes(vivy.prompt));
  for (const interdit of vivy.negative) assert.ok(texte.includes(interdit));
});

test('K44 est une femme dans sa fiche, et le condensé de plan reste court', () => {
  const k44 = renderCharacterSheet('K44');
  assert.match(k44, /genre : femme/);
  assert.match(k44, /male K44/);
  assert.doesNotMatch(k44, /\bil est\b|\bun homme\b/i);
  assert.equal(renderCharacterSheet('kaen44'), k44);
  for (const id of Object.keys(FICHES)) {
    const court = condenseCharacterForShot(id);
    assert.ok(court.length > 40 && court.length <= 450, `${id} : condensé ${court.length}`);
  }
  assert.match(condenseCharacterForShot('vivy', { film: true }), /real human actress/);
});

test('aucune fiche ne révèle Ghost88 ni une lecture non validée', () => {
  const tout = renderCharacterSheets(Object.keys(FICHES));
  assert.doesNotMatch(tout, /ghost\s*88/i);
  assert.doesNotMatch(tout, /\(lecture\)/i);
});

test('le registre de Djeff suit son selfie du 17/09, tenue fixe', () => {
  const djeff = IDENTITY_DEFINITIONS.find((d) => d.id === 'djeff');
  assert.doesNotMatch(djeff.prompt, /peau olive|m[ée]diterran|moustache|plaqu|carrure|d[ée]garni|perles|bois/i);
  assert.match(djeff.prompt, /un homme au début de la trentaine, visage rond et jeune/);
  assert.match(djeff.prompt, /barbe brune courte et régulière le long de la mâchoire/);
  assert.match(djeff.prompt, /Toujours la même tenue, corps entier avec les jambes visibles/);
  assert.deepEqual(djeff.defaultRefs, ['https://vivy.funesterie.me/api/vivy/stream/identity/djeff-reference-selfie-17-09']);
});

test('renderCharacterSheets ignore les inconnus et les doublons', () => {
  assert.equal(renderCharacterSheets(['kiro', 'vivy', 'VIVY', 'k44', 'kaen44']).match(/^FICHE /gm).length, 2);
  assert.equal(renderCharacterSheets([]), '');
  assert.equal(renderCharacterSheets(null), '');
});

function loadDirector(reply) {
  const filename = path.resolve(__dirname, '../src/clips/clip-vivy-director.cjs');
  const source = fs.readFileSync(filename, 'utf8');
  const calls = [];
  const https = { request(url, options, callback) {
    const req = new EventEmitter();
    req.write = (body) => calls.push(JSON.parse(body));
    req.destroy = () => {};
    req.end = () => queueMicrotask(() => {
      const res = new EventEmitter();
      res.statusCode = 200;
      callback(res);
      res.emit('data', Buffer.from(JSON.stringify({ choices: [{ message: { content: reply } }] })));
      res.emit('end');
    });
    return req;
  } };
  const realRequire = createRequire(filename);
  const module = { exports: {} };
  vm.runInNewContext(source, {
    module, exports: module.exports, require: (name) => (name === 'https' ? https : realRequire(name)),
    process: { env: { OPENROUTER_API_KEY: 'test-only-router', NOSSEN_OPENAI_API_KEY: 'test-only-direct' } },
    URL, Buffer, console: { log() {}, warn() {} },
  }, { filename });
  return { director: module.exports, calls };
}

test('K44 relit le scénario avec les fiches des personnages distribués', async () => {
  const { director, calls } = loadDirector('{"corrections":[]}');
  const scenes = [{ name: 'Plan 0', visual: 'K44 checks the cockpit.' }];
  const out = await director.reviewScenarioK44(scenes, 'garage', 'Test', [], ['k44', 'a11']);
  assert.equal(out.length, 1);
  const prompt = calls[0].messages[0].content;
  assert.match(prompt, /FICHES DES PERSONNAGES/);
  assert.match(prompt, /FICHE K44 \(KAEN44\) — genre : femme/);
  assert.match(prompt, /FICHE A11/);
  assert.doesNotMatch(prompt, /FICHE VIVY/);
  assert.match(prompt, /3\. aucun plan ne contredit les fiches/);
});

test('sans personnage distribué, la relecture K44 reste celle d’avant', async () => {
  const { director, calls } = loadDirector('{"corrections":[]}');
  await director.reviewScenarioK44([{ name: 'Plan 0', visual: 'Empty road.' }], 'route', 'Test', []);
  const prompt = calls[0].messages[0].content;
  assert.doesNotMatch(prompt, /FICHES DES PERSONNAGES|3\. aucun plan/);
  assert.match(prompt, /2\. aucun plan ne contredit ce que dit la chanson à ce moment-là\./);
});

test('casting « Moi » : K44 relit avec la fiche longue du compte', async () => {
  const { director, calls } = loadDirector('{"corrections":[]}');
  await director.reviewScenarioK44([{ name: 'Plan 0', visual: 'The lead performer walks.' }], 'rue', 'Test', [], ['moi'], 'Visage : ovale.\nCheveux : roux.');
  const prompt = calls[0].messages[0].content;
  assert.match(prompt, /FICHE DU PERSONNAGE PRINCIPAL \(the lead performer\) :\nVisage : ovale\.\nCheveux : roux\./);
  assert.match(prompt, /3\. aucun plan ne contredit les fiches/);
});
