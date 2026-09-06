'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { buildPromptADN } = require('../src/persona/prompt-adn.cjs');
const { buildPersonaSystemPrompt } = require('../src/persona/persona-engine.cjs');
const { buildGeminiSystemPrompt } = require('../src/persona/gemini-bridge.cjs');
const { buildVivySongcraftSystemPrompt } = require('../src/music/vivy-songcraft.cjs');

test('le persona Vivy ne fixe aucune couleur sonore de chanson', () => {
  const prompts = [
    buildPromptADN('vivy'),
    buildPersonaSystemPrompt('vivy', {}),
    buildGeminiSystemPrompt('vivy'),
  ];
  for (const prompt of prompts) {
    assert.ok(prompt.length > 0, 'le repli canonique Vivy ne doit jamais etre vide');
    assert.doesNotMatch(prompt, /sombre[ -]?n[eé]on/i);
  }
  assert.match(prompts[1], /demande technique appelle une réponse technique directe/i);
  assert.match(prompts[1], /couleur sonore reste séparée du persona/i);
});

test('le canevas sans couleur laisse explicitement Vivy choisir', () => {
  const prompt = buildVivySongcraftSystemPrompt('song', { songMood: '' });
  assert.match(prompt, /Aucune couleur sonore n.est imposee/i);
  assert.match(prompt, /choisis-la toi-meme/i);
});
