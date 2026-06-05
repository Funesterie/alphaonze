'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildA11VirtualResponseDraft,
  postProcessA11AssistantResponse,
} = require('../src/chat/response-draft-rewriter.cjs');

test('response draft rewrites raw MCP tool inventories into natural speech', () => {
  const raw = [
    '| Categorie | Outils disponibles | Usage |',
    '|-----------|--------------------|-------|',
    '| Sante | a11_health | Verifie le pont |',
    '| Fichiers | fs.search | Recherche locale |',
  ].join('\n');

  const processed = postProcessA11AssistantResponse({
    userMessage: "t'as acces au mcp ?",
    text: raw,
  });

  assert.equal(processed.rewritten, true);
  assert.equal(processed.draft.intent, 'capabilities');
  assert.match(processed.content, /MCP\/runtime Funesterie|MCP/i);
  assert.doesNotMatch(processed.content, /a11_health|fs\.search|\|/);
});

test('response draft blocks unverified realtime monitoring claims', () => {
  const raw = 'Tout roule de mon cote: je garde un oeil sur les logs pour reperer toute anomalie en temps reel.';
  const draft = buildA11VirtualResponseDraft({
    userMessage: 'daccord et sinon ca va ? tu remarques des soucis ?',
    assistantText: raw,
  });

  assert.equal(draft.mustRewrite, true);
  assert.deepEqual(draft.flags, ['unverified_monitoring_claim']);

  const processed = postProcessA11AssistantResponse({
    userMessage: 'daccord et sinon ca va ? tu remarques des soucis ?',
    text: raw,
  });
  assert.match(processed.content, /vérification lancée|backend\/MCP/i);
  assert.doesNotMatch(processed.content, /temps reel|garde un oeil/i);
});

test('response draft does not expose prose-short guardrails in final answers', () => {
  const raw = [
    '| Etat | Detail |',
    '|------|--------|',
    '| Bonjour | Tout ce qui se passe aujourd hui |',
    '',
    "Bonjour ! Tout ce qui se passe aujourd hui ! 1 / : ? Je te l'ai remis en prose courte: pas de tableau ni de detail fragile si tu ne l'as pas demande. Pour des donnees precises, je verifierai avant d'affirmer.",
  ].join('\n');

  const processed = postProcessA11AssistantResponse({
    userMessage: 'ca va ?',
    text: raw,
  });

  assert.equal(processed.rewritten, true);
  assert.doesNotMatch(processed.content, /prose courte|detail fragile|verifierai avant|tableau/i);
  assert.doesNotMatch(processed.content, /\d+\s*\/\s*:\s*\?/);
  assert.doesNotMatch(processed.content, /\|/);
});

test('response draft blocks stale user-message echoes from another turn', () => {
  const processed = postProcessA11AssistantResponse({
    userMessage: "Explique en quoi l'absence de rhetorique est une reponse insuffisante",
    text: 'Je suis la pour vous aider ! Vous avez écrit: « Que type d’image ? » Quel type d’image cherchez-vous ?',
  });

  assert.equal(processed.rewritten, true);
  assert.deepEqual(processed.draft.flags, ['stale_user_message_echo']);
  assert.match(processed.content, /Mauvais contexte détecté/i);
  assert.doesNotMatch(processed.content, /image cherchez/i);
});

test('response draft corrects A11 voice module denial', () => {
  const processed = postProcessA11AssistantResponse({
    userMessage: "bien tu utilise le bon wav pour ta voix ? car elle est un peu feminine",
    text: "Non, je ne gere pas de fichier wav ni d'audio: tout se passe en texte.",
  });

  assert.equal(processed.rewritten, true);
  assert.deepEqual(processed.draft.flags, ['voice_capability_denial']);
  assert.match(processed.content, /module TTS|backend Funesterie/i);
  assert.match(processed.content, /a11-official-stern-french/i);
  assert.doesNotMatch(processed.content, /tout se passe en texte/i);
});

test('response draft blocks visible draft placeholders', () => {
  const processed = postProcessA11AssistantResponse({
    userMessage: 'salut k44 ca va ?',
    text: 'Voici un brouillon.',
  });

  assert.equal(processed.rewritten, true);
  assert.ok(processed.draft.flags.includes('virtual_draft_leak'));
  assert.doesNotMatch(processed.content, /brouillon/i);
  assert.match(processed.content, /Salut|reponse exploitable/i);
});

test('response draft rewrites English generic last-message placeholders in French sessions', () => {
  const processed = postProcessA11AssistantResponse({
    userMessage: 'pour faire quoi ?',
    text: "Sure, here's a short reply to the last message.",
  });

  assert.equal(processed.rewritten, true);
  assert.ok(processed.draft.flags.includes('generic_context_placeholder'));
  assert.match(processed.content, /bugué|dernier message|rien de spécial/i);
  assert.doesNotMatch(processed.content, /Sure|last message/i);
});

test('response draft removes internal channel and reasoning leaks', () => {
  const raw = [
    'We need to answer: greet, mention MCP link to MCP.',
    'analysisanalysisanalysis <|message|> commentary <|channel|>analysis',
    'The user wants a response. Let\'s produce final answer.',
  ].join('\n');

  const processed = postProcessA11AssistantResponse({
    userMessage: "je voulais savoir si tout va bien si ya d'autres utilisateurs qui te parle",
    text: raw,
  });

  assert.equal(processed.rewritten, true);
  assert.ok(processed.draft.flags.includes('internal_reasoning_leak'));
  assert.match(processed.content, /je suis là|reprends normalement|conversation/i);
  assert.doesNotMatch(processed.content, /We need|analysis|<\|channel\|>|final answer/i);
});

test('response draft catches long repeated meta loops from streamed providers', () => {
  const raw = [
    '<|channel|>analysis<|message|>The user wants to short reply.',
    'We need to answer. The user wants to check the conversation.',
    'The user wants to keep the last message. We respond. analysis commentary final.',
    'The user wants to short the last message. The user wants to maintain the conversation.',
  ].join(' ');

  const processed = postProcessA11AssistantResponse({
    userMessage: 'pourquoi tu reponds en we et tu melanges a11 et k44 ?',
    text: raw,
  });

  assert.equal(processed.rewritten, true);
  assert.ok(processed.draft.flags.includes('internal_reasoning_leak'));
  assert.match(processed.content, /dernier message|normalement|simplement/i);
  assert.doesNotMatch(processed.content, /The user wants|We respond|<\|channel\|>/i);
});

test('response draft catches the We just answer leak seen in Kaen44 history', () => {
  const processed = postProcessA11AssistantResponse({
    userMessage: 'ca va mieux ?',
    text: [
      'We just answer: "Oui, j ai compris. Je peux vous aider a verifier l acces, etc."',
      'The user is asking "Sure, what is the short answer."',
      'So respond in French. Provide short.',
    ].join(' '),
  });

  assert.equal(processed.rewritten, true);
  assert.ok(processed.draft.flags.includes('internal_reasoning_leak'));
  assert.match(processed.content, /Oui, mieux|reprends normalement/i);
  assert.doesNotMatch(processed.content, /We just answer|The user is asking|Provide short|respond in French/i);
});
