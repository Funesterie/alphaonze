'use strict';

/**
 * Memoire du graphe injectee dans la conversation ordinaire.
 *
 * L'invariant qui compte n'est pas « le graphe est interroge » mais « une memoire
 * absente ou lente ne casse jamais une reponse ». Vivy doit repondre sans memoire
 * plutot que faire attendre ou echouer.
 *
 * Le second invariant est le CADRAGE: en chanson on interdit de citer la matiere,
 * en conversation citer est le service rendu. Les deux blocs ne doivent pas
 * converger par inadvertance.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  buildChatGraphContext,
  buildChatSearchQuery,
} = require('../src/music/songcraft-graph-context.cjs');

// --- construction de la requete ---------------------------------------------

test('les mots trop courts et la ponctuation sont ecartes', () => {
  // Un index plein texte repond au bruit par du bruit: « on a dit un truc ? »
  // ramenerait n'importe quoi.
  const q = buildChatSearchQuery("on a dit un truc sur les paroles de NOSSEN, non ?");
  assert.equal(q.includes('on'), false, 'mot de 2 lettres conserve');
  assert.equal(q.includes('?'), false, 'ponctuation conservee');
  assert.match(q, /paroles/);
  assert.match(q, /NOSSEN/);
});

test('les accents et les apostrophes survivent', () => {
  // Sans \p{L}, « éclairé » deviendrait « clair » et changerait le sens.
  const q = buildChatSearchQuery("l'éclairage était vraiment réussi hier");
  assert.match(q, /éclairage/);
  assert.match(q, /était/);
});

test('la requete est plafonnee: on cherche, on ne ratisse pas', () => {
  const long = Array.from({ length: 40 }, (_, i) => `terme${i}`).join(' ');
  const q = buildChatSearchQuery(long);
  assert.equal(q.split(' ').length, 12);
  assert.ok(q.length <= 300);
});

test('une entree vide ou absurde ne produit rien d exploitable', () => {
  for (const entree of ['', null, undefined, '?!...', 'a b c']) {
    const q = buildChatSearchQuery(entree);
    assert.equal(q.split(' ').filter(Boolean).length < 3, true, `aurait du rester maigre: ${entree}`);
  }
});

// --- garde-fous de la fonction de contexte -----------------------------------

test('desactivee par variable, elle ne cherche pas', async () => {
  const r = await buildChatGraphContext('une question bien fournie en termes utiles', {
    A11_CHAT_GRAPH_CONTEXT: '0',
  });
  assert.equal(r, '');
});

test('sous trois termes utiles, aucune recherche', async () => {
  // Deux mots ne discriminent rien: chercher couterait une latence pour du bruit.
  const r = await buildChatGraphContext('salut toi', {});
  assert.equal(r, '');
});

test('un graphe injoignable rend une chaine vide, jamais une exception', async () => {
  // C'est l'invariant principal: la conversation continue sans memoire.
  const r = await buildChatGraphContext(
    'question avec suffisamment de termes utiles pour declencher',
    { A11_CHAT_GRAPH_SOURCE: 'source-inexistante-pour-le-test' }
  );
  assert.equal(typeof r, 'string');
});

// --- le cadrage, sur la source ------------------------------------------------

const moduleSource = fs.readFileSync(
  path.join(__dirname, '../src/music/songcraft-graph-context.cjs'),
  'utf8'
);

test('la conversation AUTORISE la citation, la chanson l INTERDIT', () => {
  const chat = moduleSource.slice(moduleSource.indexOf('async function buildChatGraphContext'));
  assert.match(chat, /Tu PEUX t'y referer explicitement et citer/);

  const chanson = moduleSource.slice(
    moduleSource.indexOf('async function buildSongcraftGraphContext'),
    moduleSource.indexOf('async function buildChatGraphContext')
  );
  assert.match(chanson, /Ne cite jamais ces/);
});

// --- le branchement dans la route ---------------------------------------------

const routeSource = fs.readFileSync(
  path.join(__dirname, '../src/routes/vivy-studio.cjs'),
  'utf8'
);

test('hors chanson, la route consulte bien la memoire', () => {
  // La regression a eviter: revenir a `: ''`, qui rendait Vivy amnesique des
  // qu'on ne composait pas. C'etait l'etat du code avant le 11/08/2026.
  const bloc = routeSource.match(
    /const songcraftGraphContext = mode === 'song'[\s\S]{0,240}?;/
  )?.[0] || '';
  assert.ok(bloc, 'bloc de decision introuvable');
  assert.match(bloc, /buildChatGraphContext/);
  assert.doesNotMatch(bloc, /:\s*''\s*;/, 'la branche hors-chanson est redevenue vide');
});

test('la fonction est bien importee', () => {
  assert.match(routeSource, /buildChatGraphContext\s*}\s*=\s*require\('\.\.\/music\/songcraft-graph-context\.cjs'\)/);
});
