const test = require('node:test');
const assert = require('node:assert/strict');

const {
  resolveKnowledgeConflict,
  resolveMultipleConflicts,
  scoreSource,
  factsConflict,
  freshnessBonus,
  SOURCE_WEIGHTS,
} = require('../lib/knowledge-conflict-resolver.cjs');

// ============================================================================
// scoreSource
// ============================================================================

test('scoreSource returns higher score for kg than episodic on factual query', () => {
  const kgScore = scoreSource({ type: 'kg', confidence: 0.9 }, 'factual', null);
  const episodicScore = scoreSource({ type: 'episodic', confidence: 0.9 }, 'factual', null);
  assert.ok(kgScore > episodicScore, `kg (${kgScore}) should beat episodic (${episodicScore}) on factual`);
});

test('scoreSource returns higher score for episodic than kg on subjective query', () => {
  const episodicScore = scoreSource({ type: 'episodic', confidence: 0.9 }, 'subjective', null);
  const kgScore = scoreSource({ type: 'kg', confidence: 0.9 }, 'subjective', null);
  assert.ok(episodicScore > kgScore, `episodic (${episodicScore}) should beat kg (${kgScore}) on subjective`);
});

test('scoreSource applies freshness bonus for recent timestamps', () => {
  const recentTs = new Date(Date.now() - 1000 * 60 * 60).toISOString(); // 1h ago
  const oldTs = new Date(Date.now() - 1000 * 60 * 60 * 24 * 60).toISOString(); // 60 days ago
  const recentScore = scoreSource({ type: 'rag', confidence: 0.8, timestamp: recentTs }, 'mixed', null);
  const oldScore = scoreSource({ type: 'rag', confidence: 0.8, timestamp: oldTs }, 'mixed', null);
  assert.ok(recentScore > oldScore, `recent (${recentScore}) should beat old (${oldScore})`);
});

test('scoreSource applies recent preference bonus for web source', () => {
  const baseScore = scoreSource({ type: 'web', confidence: 0.7 }, 'mixed', null);
  const recentScore = scoreSource({ type: 'web', confidence: 0.7 }, 'mixed', 'recent');
  assert.ok(recentScore > baseScore);
});

// ============================================================================
// factsConflict
// ============================================================================

test('factsConflict returns false for identical facts', () => {
  assert.equal(factsConflict('La terre est ronde', 'La terre est ronde'), false);
});

test('factsConflict returns false for empty facts', () => {
  assert.equal(factsConflict('', 'quelque chose'), false);
  assert.equal(factsConflict(null, 'quelque chose'), false);
});

test('factsConflict detects conflicting numbers', () => {
  const result = factsConflict('Il y a 42 espèces', 'Il y a 99 espèces');
  assert.equal(result, true);
});

// ============================================================================
// resolveKnowledgeConflict
// ============================================================================

test('resolveKnowledgeConflict returns error for empty sources', () => {
  const result = resolveKnowledgeConflict({ sources: [] });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'no_sources');
});

test('resolveKnowledgeConflict picks kg over episodic on factual query', () => {
  const result = resolveKnowledgeConflict({
    sources: [
      { type: 'episodic', fact: 'La capitale est Lyon', confidence: 0.9 },
      { type: 'kg', fact: 'La capitale est Paris', confidence: 0.9 },
    ],
    queryType: 'factual',
  });
  assert.equal(result.ok, true);
  assert.equal(result.winner.type, 'kg');
  assert.equal(result.winner.fact, 'La capitale est Paris');
});

test('resolveKnowledgeConflict picks user over kg on subjective query', () => {
  const result = resolveKnowledgeConflict({
    sources: [
      { type: 'kg', fact: 'Le meilleur film est Citizen Kane', confidence: 0.95 },
      { type: 'user', fact: 'Mon film préféré est Akira', confidence: 0.99 },
    ],
    queryType: 'subjective',
  });
  assert.equal(result.ok, true);
  assert.equal(result.winner.type, 'user');
});

test('resolveKnowledgeConflict detects conflicts between sources', () => {
  const result = resolveKnowledgeConflict({
    sources: [
      { type: 'kg', fact: 'Il y a 42 espèces connues', confidence: 0.9 },
      { type: 'web', fact: 'Il y a 99 espèces connues', confidence: 0.85 },
    ],
    queryType: 'factual',
  });
  assert.equal(result.ok, true);
  assert.equal(result.hasConflicts, true);
  assert.equal(result.conflictCount, 1);
});

test('resolveKnowledgeConflict includes justification string', () => {
  const result = resolveKnowledgeConflict({
    sources: [
      { type: 'rag', fact: 'Fait A', confidence: 0.8 },
      { type: 'episodic', fact: 'Fait B', confidence: 0.7 },
    ],
    queryType: 'factual',
    userPreference: 'reliable',
  });
  assert.equal(result.ok, true);
  assert.equal(typeof result.justification, 'string');
  assert.ok(result.justification.length > 0);
});

test('resolveKnowledgeConflict returns all scores sorted descending', () => {
  const result = resolveKnowledgeConflict({
    sources: [
      { type: 'episodic', fact: 'A', confidence: 0.5 },
      { type: 'kg', fact: 'B', confidence: 0.9 },
      { type: 'rag', fact: 'C', confidence: 0.7 },
    ],
    queryType: 'factual',
  });
  assert.equal(result.ok, true);
  assert.equal(result.scores.length, 3);
  // Vérifier que les scores sont triés décroissants
  for (let i = 0; i < result.scores.length - 1; i++) {
    assert.ok(result.scores[i].score >= result.scores[i + 1].score);
  }
});

// ============================================================================
// resolveMultipleConflicts
// ============================================================================

test('resolveMultipleConflicts handles multiple groups', () => {
  const results = resolveMultipleConflicts([
    {
      topic: 'géographie',
      sources: [
        { type: 'kg', fact: 'Paris est en France', confidence: 0.99 },
        { type: 'episodic', fact: 'Paris est en Belgique', confidence: 0.3 },
      ],
      queryType: 'factual',
    },
    {
      topic: 'préférence',
      sources: [
        { type: 'user', fact: 'J aime le jazz', confidence: 0.95 },
        { type: 'rag', fact: 'La musique classique est populaire', confidence: 0.7 },
      ],
      queryType: 'subjective',
    },
  ]);

  assert.equal(results.length, 2);
  assert.equal(results[0].topic, 'géographie');
  assert.equal(results[0].result.winner.type, 'kg');
  assert.equal(results[1].topic, 'préférence');
  assert.equal(results[1].result.winner.type, 'user');
});

// ============================================================================
// SOURCE_WEIGHTS
// ============================================================================

test('SOURCE_WEIGHTS contains all expected source types', () => {
  const expectedTypes = ['kg', 'rag', 'web', 'episodic', 'user'];
  for (const type of expectedTypes) {
    assert.ok(SOURCE_WEIGHTS[type], `Missing source type: ${type}`);
    assert.ok(typeof SOURCE_WEIGHTS[type].base === 'number');
    assert.ok(SOURCE_WEIGHTS[type].base > 0 && SOURCE_WEIGHTS[type].base <= 1);
  }
});

test('user source has highest base weight', () => {
  const userWeight = SOURCE_WEIGHTS.user.base;
  for (const [type, meta] of Object.entries(SOURCE_WEIGHTS)) {
    if (type !== 'user') {
      assert.ok(userWeight >= meta.base, `user (${userWeight}) should be >= ${type} (${meta.base})`);
    }
  }
});
