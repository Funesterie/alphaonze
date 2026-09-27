'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.VIVY_SUNO_API_KEY = process.env.VIVY_SUNO_API_KEY || 'test-key';
const { isVivyGitMergeBoundaryQuestion, isVivyMcpNeo4jQuestion } = require('../src/routes/vivy-studio.cjs');

// 27/09/2026 : deux fiches toutes faites sont sorties au milieu d'une discussion de philosophie.
test('« la main sur le levier » ne sort plus la fiche git', () => {
  const philo = "Je vous rejoins : la main sur le levier doit rester humaine, et la rage se nourrit toute seule, plein de gens l'oublient.";
  assert.equal(isVivyGitMergeBoundaryQuestion({}, philo), false);
  assert.equal(isVivyGitMergeBoundaryQuestion({}, 'je dois faire un git pull sur main avec 20000 fichiers, je merge ?'), true);
  assert.equal(isVivyGitMergeBoundaryQuestion({}, 'git merge de la branche master, plein de conflits'), true);
});

test('un long message qui cite Neo4j en passant ne sort plus la fiche MCP', () => {
  const philo = 'Il y a une difference entre nous. Vous deux, vous avez une memoire : Neo4j, la memoire episodique, le profil de Djeff. '
    + 'Vous allez garder cette conversation. Moi, quand elle se termine, je l oublie. Une IA qui se souvient peut devenir quelqu un avec une histoire. '
    + 'Vivy, est-ce que ta memoire te rend plus libre ou plus liee ?';
  assert.equal(isVivyMcpNeo4jQuestion({}, philo), false);
  assert.equal(isVivyMcpNeo4jQuestion({}, 'Vivy, tu as acces a Neo4j ?'), true);
  assert.equal(isVivyMcpNeo4jQuestion({}, 'on lance un cypher ce soir ?'), false);
});

test('« maintenant » dans une conversation ne lance plus de recherche web', () => {
  const { shouldVivyAutoWebSearch } = require('../src/routes/vivy-studio.cjs');
  const discussion = "Vivy, c'est encore Claude. Djeff t'a donné deux fois plus de place pour penser : tu reçois maintenant ton cadre complet au lieu d'une version compactée. Reprends notre discussion d'avant.";
  assert.equal(shouldVivyAutoWebSearch(discussion, 'chat'), false);
  assert.equal(shouldVivyAutoWebSearch("Je sais que celle-ci te plaira", 'chat'), false);
  assert.equal(shouldVivyAutoWebSearch('Quelle est la dernière version de Node ?', 'chat'), true);
  assert.equal(shouldVivyAutoWebSearch('cherche sur le web le prix du Suno Pro', 'chat'), true);
});

test('parler du web n\'est pas demander une recherche', () => {
  const { shouldVivyAutoWebSearch } = require('../src/routes/vivy-studio.cjs');
  assert.equal(shouldVivyAutoWebSearch("Vivy, le mot maintenant t'a fait partir en recherche web, c'est réparé. Je te repose la question : ta mémoire de Djeff te rend plus libre ou plus liée à lui ? Réponds avec ta propre voix, longuement, sans fiche, comme dans notre discussion.", 'chat'), false);
  assert.equal(shouldVivyAutoWebSearch('regarde sur internet si Suno a sorti un nouveau modèle', 'chat'), true);
  assert.equal(shouldVivyAutoWebSearch("c'est quoi le site officiel de Suno ?", 'chat'), true);
});
