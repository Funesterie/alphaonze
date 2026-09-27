'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.VIVY_SUNO_API_KEY = process.env.VIVY_SUNO_API_KEY || 'test-key';
const { buildVivySunoPayload } = require('../src/routes/vivy-studio.cjs');

const paroles = '[Verse 1]\nJe roule seul sous la pluie\nLa ville dort sans un bruit\n[Chorus]\nOn tient debout\nOn tient le coup';
const styleDe = (songMood) => buildVivySunoPayload({ songTitle: 'T', songArtists: ['djeff'], songMood, prompt: songMood, cleanLyrics: paroles }).style;

// 27/09/2026 : l'album opening anime de Jeffrey partait avec « rap vocals, no melodic pop singing ».
test('Djeff chante quand la couleur demande du chant', () => {
  const style = styleDe('Japanese anime theme song style, J-rock, heroic anthemic soaring chorus, melodic sung vocals');
  assert.doesNotMatch(style, /rap vocals|no melodic pop singing|nervous controlled technical flow/);
  assert.match(style, /melodic chorus, sung vocals/);
});

test('Djeff rappe par défaut, et « no melodic chorus » garde le rap', () => {
  assert.match(styleDe('French hardcore rap, dark aggressive beat, no pop, no melodic chorus'), /rap vocals, no melodic pop singing/);
  assert.match(styleDe('boom bap sombre'), /rap vocals, no melodic pop singing/);
});
