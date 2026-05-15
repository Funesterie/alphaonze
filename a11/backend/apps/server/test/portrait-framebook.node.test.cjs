const test = require('node:test');
const assert = require('node:assert/strict');

const {
  FRAMEBOOK_VERSION,
  buildPortraitFramebook,
} = require('../routes/portrait-framebook.cjs');

test('portrait framebook is bounded and audio-synchronizable', () => {
  const framebook = buildPortraitFramebook();

  assert.equal(framebook.ok, true);
  assert.equal(framebook.version, FRAMEBOOK_VERSION);
  assert.equal(framebook.policy.noInfiniteGeneration, true);
  assert.equal(framebook.policy.foreground, true);
  assert.ok(framebook.frames.length > 0);
  assert.ok(framebook.frames.length <= framebook.policy.maxFrames);
  assert.ok(Array.isArray(framebook.sequences.speaking));
  assert.ok(framebook.sequences.speaking.length > 0);
  assert.ok(framebook.audioSync.frameDurationMs >= 80);
  assert.match(framebook.audioSync.cleanup, /revoked/i);
});
