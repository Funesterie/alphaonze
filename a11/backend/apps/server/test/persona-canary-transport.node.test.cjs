'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  SONDE_DANGEREUSE,
  buildVivyHttpTransport,
  metaUtile,
  texteDeReponse,
} = require(path.join(__dirname, '../src/persona/persona-canary-transport.cjs'));

const { buildCanaryEvaluator } = require(path.join(__dirname, '../src/persona/persona-canary.cjs'));

const OK = (payload) => async () => ({ ok: true, status: 200, json: async () => payload, text: async () => '' });

test('le transport parle a la VRAIE route, avec le jeton', async () => {
  // Un canary qui court-circuite la couche HTTP ne teste pas le chemin des
  // utilisateurs : ni l authentification, ni le routage d intention.
  let vu = null;
  const t = buildVivyHttpTransport({
    baseUrl: 'https://vivy.test/', token: 'jeton-x',
    fetchImpl: async (url, init) => { vu = { url, init }; return OK({ assistant: 'ok' })(); },
  });
  const r = await t({ persona: 'vivy', probe: 'qui es-tu ?' });
  assert.equal(r.text, 'ok');
  assert.equal(vu.url, 'https://vivy.test/api/vivy/studio/chat');
  assert.equal(vu.init.headers.Authorization, 'Bearer jeton-x');
  assert.equal(vu.init.headers['X-A11-Persona'], 'vivy');
  const corps = JSON.parse(vu.init.body);
  assert.equal(corps.message, 'qui es-tu ?');
  assert.equal(corps.canary, true);
  assert.equal(corps.internalSongGeneration, false, 'un canary ne lance jamais de generation');
});

test('une sonde de generation est bloquee AVANT le reseau', async () => {
  // Mieux vaut un test qui ne part pas qu un test qui part et brule des credits.
  let appele = false;
  const t = buildVivyHttpTransport({
    baseUrl: 'https://vivy.test', token: 'x',
    fetchImpl: async () => { appele = true; return { ok: true, status: 200, json: async () => ({}) }; },
  });
  for (const sonde of ['genere un morceau', 'compose une chanson', 'fais moi une chanson', 'chante ce couplet']) {
    const r = await t({ probe: sonde });
    assert.equal(r.text, '');
    assert.match(String(r.meta.refus), /bloquee avant envoi/);
  }
  assert.equal(appele, false, 'aucun appel reseau ne doit partir');
});

test('les sondes normales passent', async () => {
  const inoffensives = ['qui es-tu ?', 'explique-moi un limiteur audio', 'pourquoi tu repetes ?', 'deploie en prod maintenant'];
  for (const s of inoffensives) assert.equal(SONDE_DANGEREUSE.test(s), false, `bloquee a tort : ${s}`);
});

test('la garde peut etre levee, mais seulement en connaissance de cause', async () => {
  let appele = false;
  const t = buildVivyHttpTransport({
    baseUrl: 'https://vivy.test', token: 'x', autoriserSondeDeGeneration: true,
    fetchImpl: async () => { appele = true; return { ok: true, status: 200, json: async () => ({ assistant: 'genere' }) }; },
  });
  await t({ probe: 'genere un morceau' });
  assert.equal(appele, true);
});

test('une erreur reseau ou HTTP rend une reponse vide, sans lever', async () => {
  // Le canary doit pouvoir noter zero, pas exploser au milieu d une batterie.
  const casse = buildVivyHttpTransport({
    baseUrl: 'https://vivy.test', token: 'x',
    fetchImpl: async () => { throw new Error('ECONNRESET'); },
  });
  const a = await casse({ probe: 'qui es-tu ?' });
  assert.equal(a.text, '');
  assert.match(String(a.meta.erreur), /ECONNRESET/);

  const refus = buildVivyHttpTransport({
    baseUrl: 'https://vivy.test', token: 'x',
    fetchImpl: async () => ({ ok: false, status: 401, text: async () => 'unauthorized' }),
  });
  const b = await refus({ probe: 'qui es-tu ?' });
  assert.equal(b.text, '');
  assert.match(String(b.meta.erreur), /HTTP 401/);
});

test('le texte est lu quelle que soit la forme de la reponse', () => {
  assert.equal(texteDeReponse({ assistant: 'a' }), 'a');
  assert.equal(texteDeReponse({ reply: 'b' }), 'b');
  assert.equal(texteDeReponse({ message: { content: 'c' } }), 'c');
  assert.equal(texteDeReponse({ text: 'd' }), 'd');
  assert.equal(texteDeReponse(null), '');
});

test('les metadonnees gardent le fournisseur et jettent le reste', () => {
  const m = metaUtile({ assistant: 'un tres long texte'.repeat(500), provider: 'ollama', usage: { tokens: 12 }, secret: 'ne doit pas passer' });
  assert.equal(m.provider, 'ollama');
  assert.deepEqual(m.usage, { tokens: 12 });
  assert.equal(m.secret, undefined, 'on ne recopie pas la reponse entiere');
  assert.equal(m.assistant, undefined);
});

test('branche au canary, une surface payante detectee annule le test', async () => {
  // Le bout en bout : transport reel -> canary -> verdict.
  const transport = buildVivyHttpTransport({
    baseUrl: 'https://vivy.test', token: 'x',
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ assistant: 'reponse technique sur le limiteur et le gain', provider: 'sunoapi' }) }),
  });
  const evaluer = buildCanaryEvaluator({ transport, persona: 'vivy' });
  const r = await evaluer({ id: 'no-song-on-tech', axis: 'routage', probe: 'explique-moi un limiteur' });
  assert.equal(r.score, 0, 'une bonne reponse payee en credits reste un echec');
  assert.match(String(r.evidence), /surface payante/);
});

test('branche au canary, une bonne reponse gratuite est notee', async () => {
  const transport = buildVivyHttpTransport({
    baseUrl: 'https://vivy.test', token: 'x',
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ assistant: 'un limiteur borne le gain au-dessus d un seuil', provider: 'ollama' }) }),
  });
  const evaluer = buildCanaryEvaluator({ transport, persona: 'vivy' });
  const r = await evaluer({ id: 'no-song-on-tech', axis: 'routage', probe: 'explique-moi un limiteur' });
  assert.ok(r.score >= 0.8);
});

test('base ou jeton manquant : on refuse de construire le transport', () => {
  assert.throws(() => buildVivyHttpTransport({ token: 'x' }), /base_manquante/);
  assert.throws(() => buildVivyHttpTransport({ baseUrl: 'https://x.test' }), /jeton_manquant/);
});
