'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  assessTurn,
  fallenTiles,
  isHollow,
  isInternalInstructionLine,
  lastLoadBearingTurn,
  recordTile,
  resetPath,
  stripInternalInstructions,
} = require(path.join(__dirname, '../src/chat/load-bearing-turn.cjs'));

// Les quatre chaînes effectivement vues fuiter dans Suno en production.
const FUITES_PROD = [
  'Distribution vocale choisie: Solo Vivy.',
  'Ne mets pas le mot Banger dans les paroles.',
  'Banger dans les paroles.',
  'Matière à transformer en chanson:',
];

test('les quatre fuites constatées en prod sont reconnues comme consignes internes', () => {
  for (const ligne of FUITES_PROD) {
    assert.equal(isInternalInstructionLine(ligne), true, `non attrapée : ${ligne}`);
  }
});

test('une consigne SANS tiret initial est attrapée (le trou du filtre frontend)', () => {
  // App.tsx exige ^-\s*Libellé: — une consigne nue passait à travers.
  assert.equal(isInternalInstructionLine('Distribution vocale: Duo'), true);
  assert.equal(isInternalInstructionLine('- Distribution vocale: Duo'), true);
  assert.equal(isInternalInstructionLine('Casting vocal: Trio'), true);
});

test('les accents et la casse ne permettent pas de contourner le filtre', () => {
  assert.equal(isInternalInstructionLine('MATIÈRE À TRANSFORMER EN CHANSON:'), true);
  assert.equal(isInternalInstructionLine('Matiere a transformer en chanson:'), true);
  assert.equal(isInternalInstructionLine('Distribution Vocale Choisie: Solo'), true);
  assert.equal(isInternalInstructionLine('Référence: X'), true);
  assert.equal(isInternalInstructionLine('Reference: X'), true, 'la version sans accent doit rester attrapée');
  // Un accent mal placé ne doit PAS servir de porte de sortie : pour un filtre,
  // l'insensibilité aux accents est une protection, pas une approximation.
  assert.equal(isInternalInstructionLine('Réfèrence: X'), true, 'un accent déplacé ne doit pas contourner le filtre');
  assert.equal(isInternalInstructionLine('Clé Suno: abc'), true);
  assert.equal(isInternalInstructionLine('Cle Suno: abc'), true);
});

test('de vraies paroles ne sont jamais prises pour des consignes', () => {
  const paroles = [
    'Je marche seul dans la ville qui dort',
    'Et le vent me répond sans un mot',
    'Refrain : on repart demain',
    'Mon rôle ici est de tenir debout',
    'La matière du monde me glisse entre les doigts',
  ];
  for (const ligne of paroles) {
    assert.equal(isInternalInstructionLine(ligne), false, `faux positif : ${ligne}`);
  }
});

test('le bloc paroles propre est isolé avant Suno', () => {
  const brut = [
    'Distribution vocale choisie: Solo Vivy.',
    'Ne mets pas le mot Banger dans les paroles.',
    'Matière à transformer en chanson:',
    '',
    'Je marche seul dans la ville qui dort',
    'Et le vent me répond sans un mot',
  ].join('\n');

  const propre = stripInternalInstructions(brut);

  assert.equal(propre, 'Je marche seul dans la ville qui dort\nEt le vent me répond sans un mot');
  assert.doesNotMatch(propre, /Distribution vocale|Ne mets pas le mot|Matière à transformer/i);
});

test('un texte entièrement fait de consignes ne porte pas, et échoue fermé', () => {
  const verdict = assessTurn({ text: FUITES_PROD.join('\n') });
  assert.equal(verdict.holds, false);
  assert.equal(verdict.reason, 'internal_instruction_only');
  assert.equal(verdict.cleanedText, '', 'aucune parole ne doit être inventée à partir de consignes');
});

test('la phrase générique du planificateur ne porte pas', () => {
  // request-planner.cjs ligne 144 : choisie d'après la forme du message entrant,
  // sans jamais consulter l'historique.
  const verdict = assessTurn({ text: 'Oui, je suis là. Je reprends simplement.' });
  assert.equal(verdict.holds, false);
  assert.equal(verdict.reason, 'canned_phrase');
});

test('la phrase générique est reconnue même écrite sans accents', () => {
  const verdict = assessTurn({ text: 'Oui, je suis la. Je reprends simplement.' });
  assert.equal(verdict.holds, false, 'le repliage doit neutraliser la variante sans accent');
  assert.equal(verdict.reason, 'canned_phrase');
});

test('une réponse salie porte quand même, mais nettoyée', () => {
  const verdict = assessTurn({
    text: 'Distribution vocale: Duo\nVoici le couplet que tu demandais, il tient en deux lignes.',
  });
  assert.equal(verdict.holds, true);
  assert.equal(verdict.reason, 'held_after_cleaning');
  assert.equal(verdict.cleanedText, 'Voici le couplet que tu demandais, il tient en deux lignes.');
});

test('une dalle qui tombe est marquée, pas jetée', () => {
  const session = 'session-tombeau';
  resetPath(session);

  recordTile(session, { text: 'Oui, je suis là. Je reprends simplement.', lastUserMessage: 'et le refrain ?' });
  recordTile(session, { text: 'Le refrain reprend la montée du couplet deux.', lastUserMessage: 'et le refrain ?' });
  recordTile(session, { text: 'Distribution vocale choisie: Trio.', lastUserMessage: 'et le pont ?' });

  const tombées = fallenTiles(session);
  assert.equal(tombées.length, 2, 'les deux dalles tombées doivent rester marquées');
  assert.deepEqual(tombées.map((d) => d.reason), ['canned_phrase', 'internal_instruction_only']);

  resetPath(session);
});

test('le repli lit la dernière dalle qui a porté, pas le dernier tour', () => {
  const session = 'session-repli';
  resetPath(session);

  recordTile(session, { text: 'Le refrain reprend la montée du couplet deux.', lastUserMessage: 'et le refrain ?' });
  // Le grand modèle lâche : le tour suivant est une phrase générique.
  recordTile(session, { text: 'Oui, je suis là. Je reprends simplement.', lastUserMessage: 'et le pont ?' });

  const dalle = lastLoadBearingTurn(session);
  assert.ok(dalle, 'une dalle porteuse doit rester disponible pour le repli');
  assert.equal(dalle.text, 'Le refrain reprend la montée du couplet deux.');
  assert.notEqual(dalle.text, 'Oui, je suis là. Je reprends simplement.');

  resetPath(session);
});

test('sans aucune dalle porteuse, le repli ne fabrique rien', () => {
  const session = 'session-vide';
  resetPath(session);
  recordTile(session, { text: '' });
  assert.equal(lastLoadBearingTurn(session), null, 'mieux vaut rien qu\'une réponse inventée');
  resetPath(session);
});

test('les chemins sont cloisonnés par session', () => {
  resetPath('session-a');
  resetPath('session-b');

  recordTile('session-a', { text: 'Le pont monte d\'un demi-ton avant le dernier refrain.' });
  assert.equal(lastLoadBearingTurn('session-b'), null, 'une session ne doit pas lire le chemin d\'une autre');

  resetPath('session-a');
  resetPath('session-b');
});

test('isHollow couvre le vide, le générique et la consigne pure', () => {
  assert.equal(isHollow(''), true);
  assert.equal(isHollow('   '), true);
  assert.equal(isHollow('Oui, je suis là. Je reprends simplement.'), true);
  assert.equal(isHollow('Distribution vocale choisie: Solo Vivy.'), true);
  assert.equal(isHollow('Le refrain reprend la montée du couplet deux.'), false);
});

// --- Câblage sur le repli réel du chat (response-draft-rewriter) ---

const {
  postProcessA11AssistantResponse,
} = require(path.join(__dirname, '../src/chat/response-draft-rewriter.cjs'));

test('sans sessionId, le repli garde exactement son comportement historique', () => {
  const avant = postProcessA11AssistantResponse({
    text: 'Analyse interne: intention utilisateur = salutation. Contexte fiable: aucun.',
    userMessage: 'allo ?',
  });
  assert.equal(typeof avant.content, 'string');
  assert.doesNotMatch(avant.content, /là où ça tenait/, 'aucune reprise ne doit apparaitre sans sessionId');
});

test('avec sessionId, le repli reprend la dalle porteuse au lieu de la phrase générique', () => {
  const session = 'session-cablage';
  resetPath(session);

  // Un tour qui porte : il entre dans le chemin.
  postProcessA11AssistantResponse({
    text: 'Le pont monte d\'un demi-ton avant le dernier refrain.',
    userMessage: 'et le pont ?',
    sessionId: session,
  });

  // Le grand modèle lâche et laisse fuir du texte interne.
  const apres = postProcessA11AssistantResponse({
    text: 'Analyse interne: intention utilisateur = relance. Contexte fiable: aucun.',
    userMessage: 'allo ?',
    sessionId: session,
  });

  assert.match(apres.content, /là où ça tenait/, 'le repli doit repartir du chemin');
  assert.match(apres.content, /demi-ton avant le dernier refrain/, 'il doit porter le contenu réel');

  resetPath(session);
});

test('la fuite de consignes laisse un tombstone et ne nourrit jamais un repli futur', () => {
  const session = 'session-fuite';
  resetPath(session);

  postProcessA11AssistantResponse({
    text: 'Distribution vocale choisie: Solo Vivy.\nNe mets pas le mot Banger dans les paroles.',
    userMessage: 'fais la chanson',
    sessionId: session,
  });

  assert.equal(lastLoadBearingTurn(session), null, 'une consigne interne ne doit jamais devenir une dalle porteuse');
  assert.equal(fallenTiles(session).length, 1);
  assert.equal(fallenTiles(session)[0].reason, 'internal_instruction_only');

  resetPath(session);
});
