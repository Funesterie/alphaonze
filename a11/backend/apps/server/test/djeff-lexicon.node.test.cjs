'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { parserLexique, entreesPour, blocLexique, lireLexique } = require('../src/knowledge/djeff-lexicon.cjs');
const { buildChatGraphContext, buildSongcraftGraphContext } = require('../src/music/songcraft-graph-context.cjs');
const { buildVivyGraphSourceManifest, markStaleVivyGraphFiles } = require('../src/knowledge/vivy-graph-access.cjs');

test('une synchro depuis le conteneur ne desactive pas la doctrine absente de ce disque', async () => {
  // La prod n'embarque pas a11/docs : ces fichiers sont listes mais introuvables.
  const appels = [];
  const session = { run: async (requete, params) => { appels.push(params); } };
  await markStaleVivyGraphFiles(session, {
    id: 'pack',
    generatedAt: '2026-09-13T00:00:00Z',
    files: [{ id: 'vivy-file:lexique' }],
    manifest: { files: [
      { id: 'vivy-file:lexique', exists: true },
      { id: 'vivy-file:doc-absente-ici', exists: false },
    ] },
  });
  assert.deepEqual(appels[0].activeFileIds.sort(), ['vivy-file:doc-absente-ici', 'vivy-file:lexique']);
});

// Aucun graphe ni historique joignable : le lexique doit tenir seul.
const SANS_MEMOIRE = {
  A11_CHAT_GRAPH_SOURCE: 'source-inexistante-pour-le-test',
  A11_SONGCRAFT_GRAPH_SOURCE: 'source-inexistante-pour-le-test',
  A11_CHATGPT_KEYWORD_INDEX: '/chemin/inexistant/index.json',
};

test('Double Excalibur veut dire les deux 92FS, jamais deux epees (13/09/2026)', () => {
  const entrees = lireLexique();
  const excalibur = entrees.find((e) => e.terme === 'Double Excalibur');
  assert.ok(excalibur, 'le terme est dans djeff-lexique.md');
  assert.match(excalibur.definition, /Beretta 92FS/);
  assert.match(excalibur.definition, /Revy/);
  assert.match(excalibur.definition, /Jamais deux épées/);
});

test('le terme est reconnu sous ses formes, accents et casse compris, en mot entier', () => {
  assert.equal(entreesPour('fais un son sur ma DOUBLE EXCALIBUR').length, 1);
  assert.equal(entreesPour('mes excalibur brillent').length, 1);
  assert.equal(entreesPour("la formule excalibur des nombres premiers").length, 0, 'excalibur seul reste le sens mathematique');
  assert.equal(entreesPour('rien a voir').length, 0);
  assert.equal(blocLexique(''), '');
});

test('le format du fichier : titre, alias, definition', () => {
  const [e] = parserLexique('## Terme Test\nalias: tt, té té\nSa définition.\n\n## Vide\nalias: x\n');
  assert.deepEqual(e.alias, ['terme test', 'tt', 'te te']);
  assert.equal(e.definition, 'Sa définition.');
  assert.equal(parserLexique('## Vide\nalias: x\n').length, 0, 'une entree sans definition est ignoree');
});

test('en conversation, le lexique arrive meme sans graphe ni historique', async () => {
  const bloc = await buildChatGraphContext('Vivy tu te souviens de ma double excalibur ?', SANS_MEMOIRE);
  assert.match(bloc, /LEXIQUE DE DJEFF/);
  assert.match(bloc, /Beretta 92FS/);
  assert.equal(await buildChatGraphContext('salut toi', SANS_MEMOIRE), '', 'rien a injecter sans terme du lexique');
});

test('en ecriture, le message de la personne suffit a declencher le lexique', async () => {
  const bloc = await buildSongcraftGraphContext({ message: 'ecris un banger sur la Double Excalibur', title: 'X' }, SANS_MEMOIRE);
  assert.match(bloc, /Beretta 92FS/);
});

test('le lexique fait partie du corpus synchronise dans Neo4j', () => {
  const manifest = buildVivyGraphSourceManifest();
  const fichier = manifest.files.find((f) => /djeff-lexique\.md$/.test(f.path));
  assert.ok(fichier, 'djeff-lexique.md est dans la liste des sources du graphe');
  assert.equal(fichier.exists, true);
});
