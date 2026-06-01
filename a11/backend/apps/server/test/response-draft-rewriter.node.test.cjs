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
