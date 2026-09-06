'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildVivyProviderSongInput,
  buildVivySunoPayload,
} = require('../src/routes/vivy-studio.cjs');

const CLEAN_LYRICS = [
  '[Verse 1]',
  'Neon rain is running down the glass',
  'White lines disappear beneath us fast',
  'Your name keeps glowing on the dashboard light',
  'We leave the old ghosts sleeping for the night',
  '',
  '[Chorus]',
  'On this neon interstate we come alive',
  'Past the city limits, hearts in overdrive',
  'No signal in the dark can tell us where to go',
  'We own the midnight and the radio',
  '',
  '[Verse 2]',
  'Truck-stop coffee, thunder in the west',
  'Every mile is beating in my chest',
  'The rear-view mirror cannot make us stay',
  'We turn the static into our escape',
  '',
  '[Chorus]',
  'On this neon interstate we come alive',
  'Past the city limits, hearts in overdrive',
  'No faded warning takes away the glow',
  'We own the midnight and the radio',
].join('\n');

test('le handoff fournisseur separe les paroles finales du canevas et des panneaux UI', () => {
  const input = {
    songTitle: 'Neon Interstate',
    songText: [
      'Matière créative',
      'Créer une chanson complète avec Suno',
      'Couleur sonore',
      'Clé Suno personnelle',
      'Auto-DJ — routage automatique',
      'American highway song with Vivy.',
    ].join('\n'),
    prompt: 'V10 Boom. Afficher le panneau aide et le tutoriel.',
    songMood: 'American synth-rock, female lead, night drive',
    americanMode: true,
    songArtists: ['vivy'],
    cleanLyrics: CLEAN_LYRICS,
  };

  const providerInput = buildVivyProviderSongInput(input, {
    publicLyrics: '[Chorus]\nWrong deterministic presentation text',
    vocalLyrics: '[Chorus]\nWrong deterministic presentation text',
    cleanLyrics: '[Chorus]\nWrong deterministic presentation text',
    lyrics: '[Chorus]\nWrong deterministic presentation text',
    songText: 'Wrong deterministic presentation text',
  });
  const payload = buildVivySunoPayload(providerInput);

  assert.match(providerInput.cleanLyrics, /Neon rain is running down the glass/);
  assert.match(payload.prompt, /Neon rain is running down the glass/);
  assert.match(payload.prompt, /On this neon interstate we come alive/);
  assert.doesNotMatch(
    payload.prompt,
    /Matière créative|Créer une chanson complète avec Suno|Couleur sonore|Clé Suno personnelle|Auto-DJ|V10 Boom|panneau aide|tutoriel/i
  );
});
