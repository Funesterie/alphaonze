const test = require('node:test');
const assert = require('node:assert/strict');

const buildTtsReadableText = require('../src/tts/build-tts-readable-text.cjs');

test('buildTtsReadableText removes raw links, ids and file paths while keeping readable labels', () => {
  const input = 'Voici [ouvrir la source](https://example.com/path/abc123def456) puis D:\\\\Users\\\\cella\\\\Desktop\\\\abc123def456 et https://foo.bar/x9Y8Z7A6B5. Merci.';
  const result = buildTtsReadableText(input);

  assert.match(result, /ouvrir la source/i);
  assert.match(result, /chemin de fichier/i);
  assert.doesNotMatch(result, /https?:\/\//i);
  assert.doesNotMatch(result, /abc123def456/i);
});

test('buildTtsReadableText normalizes bad execution pronunciations and expands common acronyms', () => {
  const input = 'La tâche est executi. Voir l API JSON et le PNG via URL.';
  const result = buildTtsReadableText(input);

  assert.match(result, /exécutée/i);
  assert.match(result, /A P I/i);
  assert.match(result, /J S O N/i);
  assert.match(result, /P N G/i);
  assert.match(result, /U R L/i);
});
