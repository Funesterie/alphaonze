'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { createRequire } = require('node:module');

// Avant ce correctif (23/09/2026), une passe de review qui timeout, dont le JSON ne
// parse pas, ou a qui on n'a jamais laisse la parole (cfg.review === false) rendait
// les scenes inchangees SANS RIEN SIGNALER. Un clip "revu" et un clip dont les trois
// passes ont toutes echoue silencieusement etaient indiscernables en aval. Ces tests
// verifient que scenes.reviewLog rend chaque passe honnete : executee, en erreur, ou
// sautee, avec le nombre de corrections quand elle en a applique.
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

test('A11-montage : une correction reelle est journalisee avec son compte', async () => {
  const { director } = loadDirector(JSON.stringify({
    corrections: [{ plan: 0, raison: 'plan trop generique', remplacement: 'A close shot on the hands typing fast on a keyboard.' }],
  }));
  const scenes = [{ name: 'Plan 0', visual: 'Generic shot.' }];
  const out = await director.reviewMontageA11(scenes, 'atelier', null, []);
  assert.equal(out.length, 1);
  assert.ok(Array.isArray(out.reviewLog));
  const entry = out.reviewLog.find((e) => e.pass === 'A11-montage');
  assert.equal(entry.status, 'ok');
  assert.equal(entry.corrections, 1);
  assert.equal(out[0].visual, 'A close shot on the hands typing fast on a keyboard.');
});

test('A11-montage : une reponse sans JSON exploitable se journalise en erreur, pas en silence', async () => {
  const { director } = loadDirector('desole, je ne peux pas repondre en JSON.');
  const scenes = [{ name: 'Plan 0', visual: 'Original.' }];
  const out = await director.reviewMontageA11(scenes, 'atelier', null, []);
  assert.equal(out[0].visual, 'Original.', 'rien ne change sans JSON');
  const entry = out.reviewLog.find((e) => e.pass === 'A11-montage');
  assert.equal(entry.status, 'error');
  assert.ok(entry.error, 'la raison de l echec doit etre tracee');
});

test('K44-scenario : meme comportement, journal explicite en cas de succes', async () => {
  const { director } = loadDirector(JSON.stringify({ corrections: [] }));
  const scenes = [{ name: 'Plan 0', visual: 'A room.' }];
  const out = await director.reviewScenarioK44(scenes, 'atelier', 'Test', []);
  const entry = out.reviewLog.find((e) => e.pass === 'K44-scenario');
  assert.equal(entry.status, 'ok');
  assert.equal(entry.corrections, 0);
});

test('reviewLog s accumule au fil des passes sur le meme tableau de scenes', async () => {
  const { director } = loadDirector(JSON.stringify({ corrections: [] }));
  const scenes = [{ name: 'Plan 0', visual: 'A room.' }];
  const apresA11 = await director.reviewMontageA11(scenes, 'atelier', null, []);
  const apresK44 = await director.reviewScenarioK44(apresA11, 'atelier', 'Test', []);
  assert.equal(apresK44.reviewLog.length, 2);
  // JSON.stringify plutot que deepEqual : reviewLog vient d'un vm.runInNewContext
  // (autre royaume JS), ses arrays ne sont jamais reference-egales a celles de ce
  // fichier meme a valeurs identiques -- artefact du harnais de test, pas du code.
  assert.equal(JSON.stringify(apresK44.reviewLog.map((e) => e.pass)), JSON.stringify(['A11-montage', 'K44-scenario']));
});

test('generateVisualScenes : Sol qui rend moins de plans que de beats demandes se signale', async () => {
  const { director } = loadDirector(JSON.stringify({
    lieu: 'a workshop',
    plans: [
      { name: 'Plan A', visual: 'Wide shot of the workshop.' },
      { name: 'Plan B', visual: 'Close shot on tools.' },
      { name: 'Plan C', visual: 'Medium shot, working.' },
    ],
  }));
  const beats = [
    { section: 'intro', acte: 'ouverture' },
    { section: 'verse', acte: 'travail' },
    { section: 'verse', acte: 'travail' },
    { section: 'outro', acte: 'fin' },
  ];
  const scenes = await director.generateVisualScenes('Test', 'lyrics', '', '', [], null, '', '', [], '', beats);
  assert.equal(scenes.beatsMismatch, true, '3 plans rendus pour 4 beats demandes');
});

test('generateVisualScenes : Sol qui rend exactement le compte demande ne se signale pas', async () => {
  const { director } = loadDirector(JSON.stringify({
    lieu: 'a workshop',
    plans: [
      { name: 'Plan A', visual: 'Wide shot of the workshop.' },
      { name: 'Plan B', visual: 'Close shot on tools.' },
    ],
  }));
  const beats = [
    { section: 'intro', acte: 'ouverture' },
    { section: 'verse', acte: 'travail' },
  ];
  const scenes = await director.generateVisualScenes('Test', 'lyrics', '', '', [], null, '', '', [], '', beats);
  assert.equal(scenes.beatsMismatch, false);
});
