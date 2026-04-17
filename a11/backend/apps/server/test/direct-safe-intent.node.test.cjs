const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parsePdfEmailIntent,
  extractImplicitImageGenerationPrompt,
  detectCapabilityDiagnosticIntent,
} = require('../lib/direct-safe-intent.cjs');
const { detectImageIntent } = require('../lib/intent-detection.cjs');

test('parsePdfEmailIntent extracts recipients and builds a rabbit PDF plan', () => {
  const intent = parsePdfEmailIntent('Envois un pdf de lapins par mail à cellaurojeffrey@gmail.com');

  assert.ok(intent);
  assert.deepEqual(intent.recipients, ['cellaurojeffrey@gmail.com']);
  assert.equal(intent.topic, 'lapins');
  assert.equal(intent.title, 'Lapins');
  assert.match(intent.emailSubject, /PDF Lapins/);
  assert.equal(Array.isArray(intent.sections), true);
  assert.equal(intent.sections.length >= 2, true);
  assert.match(intent.sections[0].text, /lapins/i);
});

test('extractImplicitImageGenerationPrompt recovers a concrete image request after an assistant refusal', () => {
  const prompt = extractImplicitImageGenerationPrompt({
    latestUserMessage: 'Presque mais je voulais voire ussen bolt en train de courir avec seulement ses chaussures en feu',
    messages: [
      { role: 'user', content: 'génère-moi une image' },
      { role: 'assistant', content: "Je ne peux pas générer d'images." },
    ],
    detectImageIntent,
  });

  assert.equal(
    prompt,
    'genere une image de ussen bolt en train de courir avec seulement ses chaussures en feu'
  );
});

test('detectCapabilityDiagnosticIntent catches blocker questions after a capability refusal', () => {
  const intent = detectCapabilityDiagnosticIntent({
    latestUserMessage: 'Bon explique moi ce qui bloque',
    messages: [
      { role: 'assistant', content: "Je suis un assistant texte et je ne dispose pas d'outils pour envoyer des e-mails ou des fichiers." },
    ],
  });

  assert.equal(intent, 'diagnostiquer les capacites A11');
});

test('extractImplicitImageGenerationPrompt stays quiet on plain troubleshooting prompts', () => {
  const prompt = extractImplicitImageGenerationPrompt({
    latestUserMessage: "Explique le probleme avec le generateur d'image",
    messages: [],
    detectImageIntent,
  });

  assert.equal(prompt, '');
});
