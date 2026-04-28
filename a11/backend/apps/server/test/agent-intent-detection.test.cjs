'use strict';

/**
 * Test simple pour vérifier la détection d'intent agent
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { detectAgentIntent } = require('../lib/intent-detection.cjs');

test('detectAgentIntent détecte "A11, fais X"', () => {
  const result = detectAgentIntent('A11, fais une recherche web sur les pandas');
  assert.ok(result, 'devrait détecter l\'intent agent');
  assert.equal(result.goal, 'une recherche web sur les pandas');
  assert.ok(result.confidence >= 0.9, 'confiance devrait être élevée');
});

test('detectAgentIntent détecte "A11, peux-tu X"', () => {
  const result = detectAgentIntent('A11, peux-tu créer un fichier test.txt');
  assert.ok(result, 'devrait détecter l\'intent agent');
  assert.equal(result.goal, 'créer un fichier test.txt');
});

test('detectAgentIntent détecte "A11, lance X"', () => {
  const result = detectAgentIntent('A11, lance une analyse du code');
  assert.ok(result, 'devrait détecter l\'intent agent');
  assert.equal(result.goal, 'une analyse du code');
});

test('detectAgentIntent ne détecte pas les messages normaux', () => {
  const result = detectAgentIntent('Bonjour A11, comment vas-tu ?');
  assert.equal(result, null, 'ne devrait pas détecter d\'intent agent');
});

test('detectAgentIntent ne détecte pas les questions', () => {
  const result = detectAgentIntent('A11, qu\'est-ce qu\'un panda ?');
  assert.equal(result, null, 'ne devrait pas détecter d\'intent agent');
});

test('detectAgentIntent gère les variations de ponctuation', () => {
  const result1 = detectAgentIntent('A11 fais une recherche');
  const result2 = detectAgentIntent('A11, fais une recherche');
  
  assert.ok(result1, 'devrait détecter sans virgule');
  assert.ok(result2, 'devrait détecter avec virgule');
  assert.equal(result1.goal, result2.goal);
});
