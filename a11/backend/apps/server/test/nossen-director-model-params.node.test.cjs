'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { usesCompletionTokenBudget } = require('../src/clips/clip-vivy-director.cjs');

// Constate par appel reel le 09/09/2026 sur la cle de prod:
//   gpt-6-astra + max_tokens       -> 400 "Use 'max_completion_tokens' instead"
//   gpt-6-astra + temperature: 0.7 -> 400 "does not support 0.7 with this model"
// Les deux erreurs arrivent AVANT toute video, et faisaient echouer le clip sur
// « Scenarisation impossible » des qu'on basculait NOSSEN_SEQUENCE_MODEL.
test('les modeles gpt-5 et au-dela reclament max_completion_tokens', () => {
  for (const model of ['gpt-5.4', 'gpt-5.5', 'gpt-5.6-sol', 'gpt-5.6-luna', 'gpt-6-astra', 'gpt-10-quelquechose']) {
    assert.equal(usesCompletionTokenBudget(model), true, model);
  }
});

test('les anciens modeles gardent max_tokens et leur temperature', () => {
  for (const model of ['gpt-4o', 'gpt-4o-mini', 'chatgpt-4o-latest', 'x-ai/grok-4.3', 'openai/gpt-4o']) {
    assert.equal(usesCompletionTokenBudget(model), false, model);
  }
});

test('la forme OpenRouter designe le meme modele et porte la meme contrainte', () => {
  assert.equal(usesCompletionTokenBudget('openai/gpt-5.6-sol'), true);
  assert.equal(usesCompletionTokenBudget('gpt-5.6-sol'), true);
});

test('une valeur vide ou absente ne bascule rien', () => {
  for (const model of ['', null, undefined, 'grok-4.3']) {
    assert.equal(usesCompletionTokenBudget(model), false, String(model));
  }
});
