'use strict';

/**
 * Le style ne doit pas diriger le timbre quand une voix premium chante.
 *
 * Le cast reste "vivy" meme lorsqu'on ne coche qu'une voix du catalogue. Suno recevait
 * donc la persona demandee ET "clear female vocal": la consigne de timbre l'emportait.
 * Djeff premium ressortait avec une voix de femme, Ilyana noyee sous le timbre de Vivy.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  stripCastTimbreForCatalogVoice,
  buildCatalogVoiceNegativeTags,
  retagLyricsForCatalogVoice,
} = require('../src/routes/vivy-studio.cjs');

const STYLE_VIVY = 'French cyber pop, cinematic synthwave, clear female vocal, structured rhymed lyrics, melodic chorus, polished web mix, no spoken narration';
const STYLE_DUO = 'French technical rap duet, male rap verses for Djeff, clear female melodic hook for Vivy, cinematic bass, structured rhymed lyrics, no spoken narration';

test('la direction de timbre du cast officiel disparait', () => {
  const style = stripCastTimbreForCatalogVoice(STYLE_VIVY, 'Djeff', 'homme');
  assert.doesNotMatch(style, /clear female vocal/i, 'la voix feminine de Vivy ne doit plus etre commandee');
  assert.doesNotMatch(style, /\bvivy\b/i);
  assert.match(style, /authorized custom voice direction Djeff/);
  assert.match(style, /male lead vocal/);
});

test('le genre musical est conserve, seule la voix est retiree', () => {
  const style = stripCastTimbreForCatalogVoice(STYLE_VIVY, 'Ilyana', 'femme');
  assert.match(style, /French cyber pop/, 'le genre ne doit pas partir avec le timbre');
  assert.match(style, /cinematic synthwave/);
  assert.match(style, /structured rhymed lyrics/);
  assert.match(style, /female lead vocal/);
});

test('les fragments nommant plusieurs interpretes partent tous', () => {
  const style = stripCastTimbreForCatalogVoice(STYLE_DUO, 'Ilyana', 'femme');
  assert.doesNotMatch(style, /\bDjeff\b/);
  assert.doesNotMatch(style, /\bVivy\b/);
  assert.match(style, /French technical rap duet/, 'le style rap reste');
  assert.match(style, /cinematic bass/);
});

test('les tags negatifs repoussent le timbre oppose', () => {
  // Le garde-fou n'existait que pour le cast djeff: une voix premium masculine sur un
  // cast vivy n'avait rien pour repousser la voix feminine.
  assert.match(buildCatalogVoiceNegativeTags('homme'), /female vocals/);
  assert.match(buildCatalogVoiceNegativeTags('femme'), /male vocals/);
});

test('une voix premium chante seule, refrains compris', () => {
  // Djeff: « ya Vivy qui chante alors qu'il y a juste une voix premium, elle fait les
  // refrains ». Retirer la direction de timbre ne suffisait pas: Suno ajoutait quand
  // meme une seconde voix. Cette contrainte ne depend pas du genre.
  for (const genre of ['homme', 'femme', '']) {
    const tags = buildCatalogVoiceNegativeTags(genre);
    assert.match(tags, /second vocalist/, `genre "${genre}"`);
    assert.match(tags, /different singer on the chorus/, `genre "${genre}"`);
  }
  const style = stripCastTimbreForCatalogVoice(STYLE_VIVY, 'Ilyana', 'femme');
  assert.match(style, /one single lead vocalist for the entire song/);
  assert.match(style, /same voice on every verse and every chorus/);
});

test('les etiquettes composees nommant un interprete sont reecrites', () => {
  // La premiere version ne traitait que la forme exacte [Vivy]: « [Refrain - Vivy] »
  // survivait, et Suno confiait la section a une autre voix.
  const paroles = ['[Intro]', 'texte', '[Vivy]', 'ligne', '[Refrain - Vivy]', 'ligne',
    '[Final Chorus - Djeff]', 'ligne', '[Couplet 2 (Vivy)]', 'ligne', '[Chorus]', 'ligne'].join('\n');
  const sortie = retagLyricsForCatalogVoice(paroles, 'Ilyana');
  assert.doesNotMatch(sortie, /\bVivy\b/, 'aucun interprete officiel ne doit rester');
  assert.doesNotMatch(sortie, /\bDjeff\b/);
  assert.match(sortie, /\[Refrain - Ilyana\]/);
  assert.match(sortie, /\[Couplet 2 \(Ilyana\)\]/);
  assert.match(sortie, /\[Intro\]/, 'une section sans interprete reste intacte');
  assert.match(sortie, /\[Chorus\]/);
});

test('un style sans direction de voix reste intact, hors ajout catalogue', () => {
  const neutre = 'French cyber pop, cinematic synthwave, structured rhymed lyrics';
  const style = stripCastTimbreForCatalogVoice(neutre, 'Ilyana', 'femme');
  assert.match(style, /^French cyber pop, cinematic synthwave, structured rhymed lyrics/);
});
