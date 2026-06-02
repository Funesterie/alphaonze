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
  assert.match(processed.content, /pas faire semblant/i);
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
  assert.match(processed.content, /mauvais contexte/i);
  assert.doesNotMatch(processed.content, /image cherchez/i);
});
