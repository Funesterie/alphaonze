'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const chatRouter = require('../src/routes/chat.cjs');

test('/api/chat system prompt always carries A11 NOSSEN identity', () => {
  const prompt = chatRouter.buildA11ChatSystemPrompt('Je suis A-11.');

  assert.match(prompt, /\bA-11\b/);
  assert.match(prompt, /\bNOSSEN\b/);
  assert.match(prompt, /\bFunesterie\b/);
  assert.match(prompt, /assistant local/i);
  assert.match(prompt, /QFlush/i);
  assert.match(prompt, /Cerbere/i);
  assert.match(prompt, /Vivy/i);
});

test('/api/llm/chat empty system prompt still receives active identity context', () => {
  const prompt = chatRouter.buildA11ChatSystemPrompt('');

  assert.match(prompt, /\bNOSSEN\b/);
  assert.match(prompt, /Funesterie is Jeffrey Cellauro's workspace/i);
  assert.match(prompt, /client-facing persona is Kaen44/i);
});

test('/api/chat Ollama fallback injects the active identity before the user message', () => {
  const messages = chatRouter.buildOllamaMessages('et NOSSEN ?');

  assert.equal(messages[0].role, 'system');
  assert.match(messages[0].content, /\bNOSSEN\b/);
  assert.match(messages[0].content, /Funesterie is Jeffrey Cellauro's workspace/i);
  assert.deepEqual(messages[1], { role: 'user', content: 'et NOSSEN ?' });
});

test('/api/chat prompt does not duplicate the identity block when already present', () => {
  const base = 'Je suis A-11, assistant local NOSSEN de Funesterie workspace.';
  const prompt = chatRouter.buildA11ChatSystemPrompt(base);

  assert.equal(prompt, base);
});
