'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  doitControler,
  verdictDepuisScores,
  enregistrerTache,
  lireTache,
  controlerTache,
  listerControles,
} = require('../src/music/voice-identity-check.cjs');

const ENV = { A11_VOICE_XTTS_RVC_URL: 'http://pont.test' };
const REFS = { cible: 'djeff-vagues-psy-vocals.wav', contraste: 'vivy-voix-reference.mp3' };
const PISTES = [
  { id: 'v1', audioUrl: 'https://cdn.test/v1.mp3' },
  { id: 'v2', audioUrl: 'https://cdn.test/v2.mp3' },
];

function dossier() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'voice-check-'));
}

// Faux reseau : l'audio de chaque piste, puis le pont qui rend des scores par piste.
function fauxFetch(scoresParPiste) {
  const appels = [];
  let derniere = '';
  const fetchImpl = async (url, options = {}) => {
    appels.push(String(url));
    if (String(url).startsWith('https://cdn.test/')) {
      derniere = path.basename(String(url), '.mp3');
      return { ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
    }
    assert.equal(String(url), 'http://pont.test/api/voice/identify');
    assert.equal(options.body.get('references'), `${REFS.cible},${REFS.contraste}`);
    return { ok: true, status: 200, json: async () => ({ ok: true, scores: scoresParPiste[derniere] }) };
  };
  return { fetchImpl, appels };
}

const djeff = { [REFS.cible]: 0.92, [REFS.contraste]: 0.53 };
const vivy = { [REFS.cible]: 0.70, [REFS.contraste]: 0.93 };

test('seule une voix suivie est controlee, et on peut tout couper', () => {
  assert.equal(doitControler('djeff', ENV), true);
  assert.equal(doitControler('Djeff', ENV), true);
  assert.equal(doitControler('ilyana', ENV), false, 'pas de reference, pas de controle');
  assert.equal(doitControler('djeff', { ...ENV, A11_VOICE_CHECK_ENABLED: 'false' }), false);
  const dir = dossier();
  assert.equal(enregistrerTache({ dir, taskId: 't0', voice: 'ilyana', body: {}, env: ENV }), null);
  assert.equal(lireTache(dir, 't0'), null);
});

test('le verdict juge l ecart entre la voix attendue et le contraste, pas un score absolu', () => {
  // Valeurs mesurees le 13/09 : temoin Djeff, puis « Djeff Est de Retour » chantee par Vivy.
  assert.deepEqual(verdictDepuisScores({ [REFS.cible]: 0.919, [REFS.contraste]: 0.537 }, REFS, ENV), { verdict: 'cible', ecart: 0.382 });
  assert.deepEqual(verdictDepuisScores({ [REFS.cible]: 0.749, [REFS.contraste]: 0.899 }, REFS, ENV), { verdict: 'autre', ecart: -0.15 });
  assert.equal(verdictDepuisScores({ [REFS.cible]: 0.8, [REFS.contraste]: 0.78 }, REFS, ENV).verdict, 'incertain');
  assert.equal(verdictDepuisScores({}, REFS, ENV).verdict, 'erreur');
});

test('une variante avec la bonne voix suffit : aucune relance, pas de credits', async () => {
  const dir = dossier();
  enregistrerTache({ dir, taskId: 't1', voice: 'djeff', body: { prompt: 'p', callBackUrl: 'https://x/?t=secret' }, env: ENV });
  const { fetchImpl } = fauxFetch({ v1: vivy, v2: djeff });
  let relances = 0;
  const { record } = await controlerTache({ dir, taskId: 't1', tracks: PISTES, env: ENV, fetchImpl, relancer: async () => { relances++; return 'x'; }, journal: null });
  assert.equal(record.verdict, 'ok');
  assert.equal(record.meilleure, 'v2');
  assert.equal(relances, 0);
  assert.equal(lireTache(dir, 't1').body, undefined, 'le corps (et son jeton) ne reste pas sur le disque');
  assert.equal((await controlerTache({ dir, taskId: 't1', tracks: PISTES, env: ENV, fetchImpl, journal: null })).skipped, 'deja_fait');
});

test('deux variantes sans la voix : une seule relance, puis la persona est marquee a refaire', async () => {
  const dir = dossier();
  const body = { prompt: 'Djeff est de retour', personaId: 'p1' };
  enregistrerTache({ dir, taskId: 't2', voice: 'djeff', body, env: ENV });
  const relancees = [];
  const derives = [];
  const relancer = async (corps) => { relancees.push(corps); return 't2-bis'; };
  const marquerDerive = (voix, detail) => derives.push([voix, detail]);

  const premier = await controlerTache({ dir, taskId: 't2', tracks: PISTES, env: ENV, fetchImpl: fauxFetch({ v1: vivy, v2: vivy }).fetchImpl, relancer, marquerDerive, journal: null });
  assert.equal(premier.record.verdict, 'rate');
  assert.equal(premier.record.retryTaskId, 't2-bis');
  assert.deepEqual(relancees, [body], 'la meme chanson, exactement');
  assert.equal(derives.length, 0, 'un premier rate peut etre un mauvais tirage');
  assert.equal(lireTache(dir, 't2-bis').retryOf, 't2');

  const second = await controlerTache({ dir, taskId: 't2-bis', tracks: PISTES, env: ENV, fetchImpl: fauxFetch({ v1: vivy, v2: vivy }).fetchImpl, relancer, marquerDerive, journal: null });
  assert.equal(second.record.verdict, 'rate');
  assert.equal(relancees.length, 1, 'jamais de deuxieme relance');
  assert.equal(derives.length, 1);
  assert.equal(derives[0][0], 'djeff');
  assert.equal(second.record.personaAReprendre, true);
  assert.deepEqual(listerControles(dir).map((r) => r.taskId).sort(), ['t2', 't2-bis']);
});

test('pont injoignable : erreur notee, ni relance ni persona touchee', async () => {
  const dir = dossier();
  enregistrerTache({ dir, taskId: 't3', voice: 'djeff', body: {}, env: ENV });
  const fetchImpl = async (url) => {
    if (String(url).startsWith('https://cdn.test/')) return { ok: true, arrayBuffer: async () => new ArrayBuffer(3) };
    return { ok: false, status: 503, json: async () => ({ detail: 'indisponible' }) };
  };
  let actions = 0;
  const { record } = await controlerTache({ dir, taskId: 't3', tracks: PISTES, env: ENV, fetchImpl, relancer: async () => { actions++; }, marquerDerive: () => { actions++; }, journal: null });
  assert.equal(record.verdict, 'erreur');
  assert.equal(actions, 0);
  assert.match(record.resultats[0].error, /voice_check_bridge_503/);
});

test('relance coupee par drapeau : le rate est note sans depenser', async () => {
  const dir = dossier();
  enregistrerTache({ dir, taskId: 't4', voice: 'djeff', body: {}, env: ENV });
  let relances = 0;
  const { record } = await controlerTache({ dir, taskId: 't4', tracks: PISTES, env: { ...ENV, A11_VOICE_CHECK_AUTO_RETRY: 'false' }, fetchImpl: fauxFetch({ v1: vivy, v2: vivy }).fetchImpl, relancer: async () => { relances++; }, journal: null });
  assert.equal(record.verdict, 'rate');
  assert.equal(relances, 0);
  assert.equal(record.retryTaskId, undefined);
});
