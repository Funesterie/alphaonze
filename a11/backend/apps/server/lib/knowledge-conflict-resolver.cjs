/**
 * knowledge-conflict-resolver.cjs
 *
 * Phase 3 du WORKFLOW_IMPROVEMENTS — Knowledge Conflict Resolver (KCR)
 *
 * Résout les conflits entre sources de connaissances :
 *   - Episodic Memory  (subjectif, personnel)
 *   - Knowledge Graph  (vérifié, structuré)
 *   - RAG              (indexé, documentaire)
 *   - Web Search       (temps réel, non vérifié)
 *
 * Algorithme : vote pondéré avec critères de résolution.
 * S'exécute AVANT la phase de génération du contenu final.
 */

// ============================================================================
// POIDS PAR SOURCE
// ============================================================================

const SOURCE_WEIGHTS = {
  kg:       { base: 0.90, label: 'Knowledge Graph' },
  rag:      { base: 0.75, label: 'RAG (documents indexés)' },
  web:      { base: 0.70, label: 'Web Search (temps réel)' },
  episodic: { base: 0.55, label: 'Mémoire épisodique' },
  user:     { base: 1.00, label: 'Référence utilisateur' },
};

// ============================================================================
// FRESHNESS BONUS
// ============================================================================

/**
 * Bonus de fraîcheur : plus la source est récente, plus elle est valorisée.
 * Décroissance exponentielle sur 30 jours.
 */
function freshnessBonus(timestamp) {
  if (!timestamp) return 0;
  const ageMs = Date.now() - new Date(timestamp).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  // Bonus max 0.15, décroît à 0 après 30 jours
  return Math.max(0, 0.15 * Math.exp(-ageDays / 30));
}

// ============================================================================
// QUERY TYPE MODIFIERS
// ============================================================================

/**
 * Pour les questions factuelles, on favorise KG et Web.
 * Pour les questions subjectives, on favorise Episodic et User.
 */
function queryTypeModifier(sourceType, queryType) {
  if (queryType === 'factual') {
    if (sourceType === 'kg')  return 0.10;
    if (sourceType === 'web') return 0.08;
    if (sourceType === 'rag') return 0.05;
    return -0.10; // pénalise episodic et user sur factuel
  }
  if (queryType === 'subjective') {
    if (sourceType === 'user')     return 0.15;
    if (sourceType === 'episodic') return 0.20; // boost fort pour subjectif
    if (sourceType === 'kg')       return -0.20; // pénalise KG sur subjectif
    if (sourceType === 'rag')      return -0.10;
    return 0;
  }
  return 0;
}

// ============================================================================
// USER PREFERENCE MODIFIERS
// ============================================================================

function userPreferenceModifier(sourceType, userPreference) {
  if (userPreference === 'recent') {
    if (sourceType === 'web') return 0.10;
    return 0;
  }
  if (userPreference === 'reliable') {
    if (sourceType === 'kg')  return 0.10;
    if (sourceType === 'rag') return 0.05;
    return 0;
  }
  return 0;
}

// ============================================================================
// SCORE CALCULATION
// ============================================================================

function scoreSource(source, queryType, userPreference) {
  const { type, confidence, timestamp } = source;
  const baseWeight = SOURCE_WEIGHTS[type]?.base ?? 0.50;
  const conf = typeof confidence === 'number' ? Math.min(1, Math.max(0, confidence)) : 0.5;

  const score =
    baseWeight * conf
    + freshnessBonus(timestamp)
    + queryTypeModifier(type, queryType)
    + userPreferenceModifier(type, userPreference);

  return Math.min(1, Math.max(0, score));
}

// ============================================================================
// CONFLICT DETECTION
// ============================================================================

/**
 * Détecte si deux faits sont en conflit (heuristique simple).
 * Peut être étendu avec un LLM pour une détection sémantique.
 */
function factsConflict(factA, factB) {
  if (!factA || !factB) return false;
  const a = String(factA).toLowerCase().trim();
  const b = String(factB).toLowerCase().trim();
  if (a === b) return false;

  // Négation directe
  const negationPatterns = [
    [/\bne\s+pas\b/, /(?<!ne\s)(?<!pas\s)/],
    [/\bfaux\b/, /\bvrai\b/],
    [/\bincorrect\b/, /\bcorrect\b/],
  ];
  for (const [patA, patB] of negationPatterns) {
    if (patA.test(a) && patB.test(b)) return true;
    if (patA.test(b) && patB.test(a)) return true;
  }

  // Chiffres différents sur le même sujet (heuristique)
  const numsA = a.match(/\d+/g) || [];
  const numsB = b.match(/\d+/g) || [];
  if (numsA.length > 0 && numsB.length > 0) {
    const setA = new Set(numsA);
    const setB = new Set(numsB);
    const intersection = [...setA].filter(n => setB.has(n));
    if (intersection.length === 0 && numsA.length === numsB.length) return true;
  }

  return false;
}

// ============================================================================
// MAIN RESOLVER
// ============================================================================

/**
 * Résout les conflits entre sources de connaissances.
 *
 * @param {Object} options
 * @param {Array}  options.sources        - Liste de sources { type, fact, confidence, timestamp }
 * @param {string} options.queryType      - 'factual' | 'subjective' | 'mixed'
 * @param {string} options.userPreference - 'recent' | 'reliable' | null
 * @returns {Object} Résultat avec source gagnante, score, justification, conflits détectés
 */
function resolveKnowledgeConflict({ sources = [], queryType = 'mixed', userPreference = null } = {}) {
  if (!Array.isArray(sources) || sources.length === 0) {
    return {
      ok: false,
      error: 'no_sources',
      winner: null,
      conflicts: [],
      scores: [],
    };
  }

  // Calculer les scores
  const scored = sources.map((source, idx) => ({
    ...source,
    _idx: idx,
    _score: scoreSource(source, queryType, userPreference),
    _label: SOURCE_WEIGHTS[source.type]?.label || source.type,
  }));

  // Trier par score décroissant
  scored.sort((a, b) => b._score - a._score);

  // Détecter les conflits entre les sources
  const conflicts = [];
  for (let i = 0; i < scored.length; i++) {
    for (let j = i + 1; j < scored.length; j++) {
      if (factsConflict(scored[i].fact, scored[j].fact)) {
        conflicts.push({
          sourceA: { type: scored[i].type, label: scored[i]._label, score: scored[i]._score },
          sourceB: { type: scored[j].type, label: scored[j]._label, score: scored[j]._score },
          factA: scored[i].fact,
          factB: scored[j].fact,
        });
      }
    }
  }

  const winner = scored[0];
  const runnerUp = scored[1] || null;

  // Justification
  const justification = buildJustification(winner, runnerUp, conflicts, queryType, userPreference);

  return {
    ok: true,
    winner: {
      type: winner.type,
      label: winner._label,
      fact: winner.fact,
      score: Number(winner._score.toFixed(4)),
      confidence: winner.confidence,
      timestamp: winner.timestamp,
    },
    runnerUp: runnerUp ? {
      type: runnerUp.type,
      label: runnerUp._label,
      fact: runnerUp.fact,
      score: Number(runnerUp._score.toFixed(4)),
    } : null,
    conflicts,
    scores: scored.map(s => ({
      type: s.type,
      label: s._label,
      score: Number(s._score.toFixed(4)),
      fact: s.fact,
    })),
    queryType,
    userPreference,
    justification,
    hasConflicts: conflicts.length > 0,
    conflictCount: conflicts.length,
  };
}

function buildJustification(winner, runnerUp, conflicts, queryType, userPreference) {
  const parts = [];

  parts.push(`Source retenue : ${winner._label} (score ${winner._score.toFixed(3)}).`);

  if (queryType === 'factual') {
    parts.push('Question factuelle : priorité aux sources vérifiées (KG, Web).');
  } else if (queryType === 'subjective') {
    parts.push('Question subjective : priorité aux références utilisateur et mémoire épisodique.');
  }

  if (userPreference === 'recent') {
    parts.push('Préférence utilisateur : sources récentes favorisées.');
  } else if (userPreference === 'reliable') {
    parts.push('Préférence utilisateur : sources fiables favorisées.');
  }

  if (runnerUp) {
    const margin = winner._score - runnerUp._score;
    if (margin < 0.05) {
      parts.push(`Attention : marge faible avec ${runnerUp._label} (Δ${margin.toFixed(3)}) — résultat incertain.`);
    }
  }

  if (conflicts.length > 0) {
    parts.push(`${conflicts.length} conflit(s) détecté(s) entre sources. La source gagnante a été retenue malgré les contradictions.`);
  }

  return parts.join(' ');
}

// ============================================================================
// BATCH RESOLVER
// ============================================================================

/**
 * Résout plusieurs conflits en batch (pour les pipelines multi-sources).
 */
function resolveMultipleConflicts(conflictGroups, globalOptions = {}) {
  return conflictGroups.map((group, idx) => ({
    groupIndex: idx,
    topic: group.topic || `group_${idx}`,
    result: resolveKnowledgeConflict({
      sources: group.sources,
      queryType: group.queryType || globalOptions.queryType || 'mixed',
      userPreference: group.userPreference || globalOptions.userPreference || null,
    }),
  }));
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  resolveKnowledgeConflict,
  resolveMultipleConflicts,
  scoreSource,
  factsConflict,
  freshnessBonus,
  SOURCE_WEIGHTS,
};
