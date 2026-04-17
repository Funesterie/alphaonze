const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parsePdfEmailIntent,
  parseSimpleEmailIntent,
  parseSimplePdfIntent,
  extractIllustratedPdfTopic,
  normalizeGeneratedImagePrompt,
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

test('parsePdfEmailIntent strips trailing mail wording from the PDF topic', () => {
  const intent = parsePdfEmailIntent('genere un pdf sur les tortues ninja et envois le par mail à cellaurojeffrey@gmail.com');

  assert.ok(intent);
  assert.equal(intent.topic, 'les tortues ninja');
  assert.equal(intent.title, 'Les tortues ninja');
  assert.match(intent.emailSubject, /PDF Les tortues ninja/i);
});

test('parseSimpleEmailIntent extracts recipients and plain text mail body', () => {
  const intent = parseSimpleEmailIntent('envois un mail a cellaurojeffrey@gmail.com en disant salut bg');

  assert.ok(intent);
  assert.deepEqual(intent.recipients, ['cellaurojeffrey@gmail.com']);
  assert.equal(intent.subject, 'A11');
  assert.equal(intent.message, 'salut bg');
});

test('parseSimplePdfIntent extracts a plain pdf creation request', () => {
  const intent = parseSimplePdfIntent('genere un pdf sur les fourmis');

  assert.ok(intent);
  assert.equal(intent.topic, 'les fourmis');
  assert.equal(intent.title, 'Les fourmis');
  assert.equal(Array.isArray(intent.sections), true);
  assert.match(intent.filename, /\.pdf$/i);
});

test('parseSimplePdfIntent prepares a richer DBZ document plan with manual sections and uppercase title', () => {
  const intent = parseSimplePdfIntent('genere un pdf sur le theme dbz');

  assert.ok(intent);
  assert.equal(intent.topic, 'dbz');
  assert.equal(intent.title, 'DBZ');
  assert.equal(Array.isArray(intent.sections), true);
  assert.equal(intent.sections.length >= 5, true);
  assert.equal(intent.sections[0].heading, 'Introduction');
  assert.match(String(intent.sections[0].illustrationPrompt || ''), /dragon ball z|visuel epique/i);
  assert.equal(intent.sections.some((section) => String(section.heading || '').trim() === 'Impact culturel'), true);
});

test('parsePdfEmailIntent prepares a richer tortues ninja document plan with illustration prompts', () => {
  const intent = parsePdfEmailIntent('genere un pdf sur les tortues ninja et envois le par mail à cellaurojeffrey@gmail.com');

  assert.ok(intent);
  assert.equal(intent.topic, 'les tortues ninja');
  assert.equal(Array.isArray(intent.sections), true);
  assert.equal(intent.sections.length >= 4, true);
  assert.match(String(intent.sections[0].illustrationPrompt || ''), /tortues ninja/i);
  assert.equal(intent.sections.some((section) => String(section.heading || '').trim() === 'Themes'), true);
});

test('extractIllustratedPdfTopic strips image wording around an illustrated pdf request', () => {
  const topic = extractIllustratedPdfTopic('genere un pdf de dbz avec des images');
  assert.equal(topic, 'dbz');
});

test('normalizeGeneratedImagePrompt strips mail wording from chained image requests', () => {
  const prompt = normalizeGeneratedImagePrompt('envoie une image de son goku super saiyan 6 et envois la par mail à cellaurojeffrey@gmail.com');
  assert.equal(prompt, 'genere une image de son goku super saiyan 6');
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
