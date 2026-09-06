'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  extractVivySonicDirection,
  buildVivySongcraftSystemPrompt,
} = require(path.join(__dirname, '../src/music/vivy-songcraft.cjs'));

const studio = require(path.join(__dirname, '../src/routes/vivy-studio.cjs'));

function styleFor(texte, extra = {}) {
  const input = {
    songTitle: 'Test',
    songText: texte,
    songArtists: ['djeff', 'vivy'],
    cleanLyrics: texte,
    ...extra,
  };
  const fourni = studio.buildVivyProviderSongInput
    ? studio.buildVivyProviderSongInput(input, { cleanLyrics: texte, lyrics: texte, songText: texte })
    : input;
  return studio.buildVivySunoPayload(fourni);
}

// Constat de Djeff, 02/08/2026 : vingt chansons d'affilee avec du piano et le meme
// style generique. Cause : sans couleur imposee, le champ style partait en
// "production adaptative faconnee autour de <titre>, refrain dynamique, mix moderne"
// -- aucun genre, aucun tempo, aucun instrument. Suno appliquait son style maison.

test('Vivy est invitee a choisir sa couleur quand rien n\'est impose', () => {
  const prompt = buildVivySongcraftSystemPrompt('song', { artists: [] });
  assert.match(prompt, /choisis-la toi-meme/, 'elle doit etre invitee a decider');
  assert.match(prompt, /Direction sonore:/, 'le format attendu doit etre donne');
  assert.match(prompt, /piano-ballade/, 'le reflexe par defaut doit etre nomme pour etre evite');
});

test('une couleur imposee reste une consigne, sans invitation concurrente', () => {
  const prompt = buildVivySongcraftSystemPrompt('song', { artists: [], songMood: 'boom bap 90s' });
  assert.match(prompt, /Direction sonore imposee: boom bap 90s/);
  assert.doesNotMatch(prompt, /choisis-la toi-meme/, 'deux consignes contradictoires seraient pires que rien');
});

test('la direction choisie est extraite, et retiree des paroles', () => {
  const r = extractVivySonicDirection('Direction sonore: boom bap 90s, sample soul, 88 bpm\n[Intro]\nSous les neons');
  assert.equal(r.mood, 'boom bap 90s, sample soul, 88 bpm');
  assert.equal(r.lyrics, '[Intro]\nSous les neons');
});

test('la forme exacte de la ligne n\'est pas garantie: puce et accents tolerees', () => {
  const r = extractVivySonicDirection('- Direction sonore : drum and bass, 174 bpm\n[Chorus]\nJe cours');
  assert.equal(r.mood, 'drum and bass, 174 bpm');
  assert.equal(r.lyrics, '[Chorus]\nJe cours');
});

test('un rappel de consigne imposee n\'est pas pris pour son choix', () => {
  const r = extractVivySonicDirection('Direction sonore imposee: truc\n[Chorus]\nUne ligne');
  assert.equal(r.mood, '', 'une consigne qu\'on lui a donnee n\'est pas une decision d\'elle');
});

test('sans ligne de direction, les paroles ressortent intactes', () => {
  const texte = '[Chorus]\nUne ligne de refrain\nUne autre';
  const r = extractVivySonicDirection(texte);
  assert.equal(r.mood, '');
  assert.equal(r.lyrics, texte);
});

test('la couleur de Vivy arrive en tete du style envoye a Suno', () => {
  const p = styleFor('Direction sonore: boom bap 90s, sample soul poussiereux, 88 bpm\n[Intro]\nSous les neons');
  assert.match(String(p.style), /^boom bap 90s/, 'sa couleur doit occuper la position la plus forte');
});

test('deux couleurs differentes produisent deux styles differents', () => {
  // Le coeur de la plainte : une berceuse et une fete electro recevaient la meme
  // direction musicale.
  const a = styleFor('Direction sonore: berceuse acoustique, guitare seche, tres lent\n[Intro]\nDors');
  const b = styleFor('Direction sonore: techno industrielle, kick sature, 140 bpm\n[Intro]\nOn danse');
  assert.notEqual(a.style, b.style);
  assert.match(String(a.style), /berceuse acoustique/);
  assert.match(String(b.style), /techno industrielle/);
});

test('la ligne de direction ne part jamais dans les paroles', () => {
  for (const couleur of ['boom bap 90s, sample soul', 'techno industrielle, kick sature']) {
    const p = styleFor(`Direction sonore: ${couleur}\n[Intro]\nSous les neons`);
    assert.doesNotMatch(String(p.prompt || ''), /Direction sonore/i, `fuite avec: ${couleur}`);
  }
});

test('une couleur explicite de Djeff garde la priorite sur celle de Vivy', () => {
  const p = styleFor('Direction sonore: berceuse acoustique\n[Intro]\nDors', { songMood: 'drum and bass 174 bpm' });
  assert.match(String(p.style), /^drum and bass 174 bpm/, 'la demande humaine passe avant');
  assert.doesNotMatch(String(p.style), /berceuse acoustique/);
});

test('sans direction du tout, le comportement historique est preserve', () => {
  const p = styleFor('[Chorus]\nUne ligne de refrain');
  assert.match(String(p.style), /French original vocal production/, 'pas de regression sur le repli');
});
