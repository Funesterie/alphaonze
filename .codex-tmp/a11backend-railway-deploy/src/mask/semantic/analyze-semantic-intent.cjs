const buildSemanticLevels = require('./text-to-semantic-levels.cjs');
const scoreSemanticIntents = require('./score-semantic-intents.cjs');
const decideClarification = require('./decide-clarification.cjs');

function analyzeSemanticIntent(text, options = {}) {
  const levels = buildSemanticLevels(text);
  if (!levels) return null;

  const scoring = scoreSemanticIntents(levels, options);
  const decision = decideClarification(scoring);

  return {
    version: 'semantic-analysis-1',
    sourceText: levels.sourceText,
    normalizedText: levels.normalizedText,
    levels: levels.levels,
    subject: scoring?.subject || '',
    topIntents: scoring?.topIntents || [],
    ambiguities: scoring?.ambiguities || [],
    knowledge: scoring?.knowledge || { activeModules: [], impacts: [] },
    summary: {
      ...(scoring?.summary || {}),
      decision,
    },
    decision,
  };
}

module.exports = analyzeSemanticIntent;
