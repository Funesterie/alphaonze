const {
  mergeUniqueStrings,
  normalizeText,
} = require('../image/prompt-builder.cjs');

const MODULES = [
  require('./modules/linguistics.fr.semantic.module.json'),
  require('./modules/image.composition.core.module.json'),
  require('./modules/image.reference.characters.module.json'),
  require('./modules/python.core.module.json'),
  require('./modules/filesystem.ops.module.json'),
  require('./modules/security.auth.module.json'),
  require('./modules/networking.basics.module.json'),
  require('./modules/language.numa.symbolic.module.json'),
  require('./modules/format.zen.container.module.json'),
];

function inferLanguage(text = '') {
  const normalized = normalizeText(text);
  if (!normalized) return 'unknown';

  const frenchSignal = /\b(je|tu|il|elle|nous|vous|est|quel|quelle|quels|quelles|genere|génère|fais|montre|image|avec|dans|bonjour|salut|stp|sujet|nombres|numeros|numéros|archive|conteneur|chiffre|chiffré|chiffree|chiffrée|cle|clé)\b/.test(normalized);
  if (frenchSignal) return 'fr';
  return 'unknown';
}

function listTopIntentTypes(semanticAnalysis = null) {
  return Array.isArray(semanticAnalysis?.topIntents)
    ? semanticAnalysis.topIntents.slice(0, 4).map((entry) => String(entry?.type || '').trim()).filter(Boolean)
    : [];
}

function listTopIntentTypesFromRawScores(rawScores = {}) {
  return Object.entries(rawScores)
    .sort((left, right) => Number(right[1] || 0) - Number(left[1] || 0))
    .slice(0, 4)
    .map(([intentType]) => String(intentType || '').trim())
    .filter(Boolean);
}

function normalizeKeywords(values = []) {
  return (Array.isArray(values) ? values : [values])
    .map((value) => normalizeText(value))
    .filter(Boolean);
}

function escapeRegex(value = '') {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function textContainsKeyword(normalizedText = '', normalizedKeyword = '') {
  if (!normalizedText || !normalizedKeyword) return false;
  const pattern = new RegExp(`(^|\\b)${escapeRegex(normalizedKeyword).replace(/\s+/g, '\\s+')}(\\b|$)`, 'i');
  return pattern.test(normalizedText);
}

function moduleMatches(moduleDef = {}, context = {}) {
  const activation = moduleDef.activation || {};
  const language = String(context.language || '').trim();
  const domain = String(context.domain || '').trim();
  const mode = String(context.mode || '').trim();
  const renderHints = Array.isArray(context.renderHints) ? context.renderHints : [];
  const referenceHints = Array.isArray(context.referenceHints) ? context.referenceHints : [];
  const topIntentTypes = Array.isArray(context.topIntentTypes) ? context.topIntentTypes : [];
  const normalizedText = normalizeText(context.text || '');

  if (Array.isArray(activation.languagesAny) && activation.languagesAny.length > 0) {
    if (!activation.languagesAny.includes(language)) return false;
  }
  if (Array.isArray(activation.domainsAny) && activation.domainsAny.length > 0) {
    if (!activation.domainsAny.includes(domain)) return false;
  }
  if (Array.isArray(activation.modesAny) && activation.modesAny.length > 0) {
    if (!activation.modesAny.includes(mode)) return false;
  }
  if (Array.isArray(activation.topIntentsAny) && activation.topIntentsAny.length > 0) {
    if (!activation.topIntentsAny.some((entry) => topIntentTypes.includes(entry))) return false;
  }
  if (Array.isArray(activation.renderHintsAny) && activation.renderHintsAny.length > 0) {
    if (!activation.renderHintsAny.some((entry) => renderHints.includes(entry))) return false;
  }
  if (Array.isArray(activation.referenceHintsAny) && activation.referenceHintsAny.length > 0) {
    if (!activation.referenceHintsAny.some((entry) => referenceHints.includes(entry))) return false;
  }
  if (Array.isArray(activation.keywordsAny) && activation.keywordsAny.length > 0) {
    const normalizedKeywords = normalizeKeywords(activation.keywordsAny);
    if (!normalizedKeywords.some((entry) => textContainsKeyword(normalizedText, entry))) return false;
  }
  if (activation.requiresReferenceHint && referenceHints.length === 0) return false;
  return true;
}

function buildActivationReasons(moduleDef = {}, context = {}) {
  const reasons = [];
  const activation = moduleDef.activation || {};
  if (Array.isArray(activation.domainsAny) && activation.domainsAny.includes(context.domain)) {
    reasons.push(`domain:${context.domain}`);
  }
  if (Array.isArray(activation.modesAny) && activation.modesAny.includes(context.mode)) {
    reasons.push(`mode:${context.mode}`);
  }
  if (Array.isArray(activation.languagesAny) && activation.languagesAny.includes(context.language)) {
    reasons.push(`language:${context.language}`);
  }
  if (Array.isArray(activation.renderHintsAny)) {
    for (const entry of activation.renderHintsAny) {
      if ((context.renderHints || []).includes(entry)) reasons.push(`render:${entry}`);
    }
  }
  if (Array.isArray(activation.referenceHintsAny)) {
    for (const entry of activation.referenceHintsAny) {
      if ((context.referenceHints || []).includes(entry)) reasons.push(`reference:${entry}`);
    }
  }
  if (Array.isArray(activation.topIntentsAny)) {
    for (const entry of activation.topIntentsAny) {
      if ((context.topIntentTypes || []).includes(entry)) reasons.push(`intent:${entry}`);
    }
  }
  if (Array.isArray(activation.keywordsAny)) {
    const normalizedText = normalizeText(context.text || '');
    for (const entry of activation.keywordsAny) {
      const normalizedKeyword = normalizeText(entry);
      if (normalizedKeyword && textContainsKeyword(normalizedText, normalizedKeyword)) reasons.push(`keyword:${normalizedKeyword}`);
    }
  }
  return mergeUniqueStrings(reasons);
}

function activateKnowledgeModules({
  text = '',
  semanticAnalysis = null,
  mode = '',
  canonicalIntent = null,
  promptSeed = null,
  domain = '',
} = {}) {
  const context = {
    text,
    language: inferLanguage(text),
    domain: String(domain || canonicalIntent?.task?.domain || '').trim(),
    mode: String(mode || canonicalIntent?.execution?.mode || '').trim(),
    renderHints: canonicalIntent?.style?.renderHints || promptSeed?.renderHints || [],
    referenceHints: canonicalIntent?.subject?.references || promptSeed?.referenceHints || [],
    topIntentTypes: listTopIntentTypes(semanticAnalysis),
  };

  return MODULES
    .filter((moduleDef) => moduleMatches(moduleDef, context))
    .map((moduleDef) => ({
      id: moduleDef.id,
      label: moduleDef.label,
      discipline: moduleDef.discipline,
      knowledge: moduleDef.knowledge || {},
      apply: moduleDef.apply || {},
      impactsByMode: moduleDef.impacts || {},
      activationReasons: buildActivationReasons(moduleDef, context),
    }));
}

function inferDomainFromTopIntents(topIntentTypes = []) {
  const first = String(topIntentTypes[0] || '').trim();
  if (first === 'image.generate' || first === 'web.image.search') return 'image';
  if (first === 'code.python.generate') return 'code';
  if (first === 'web.search') return 'network';
  return '';
}

function applySemanticKnowledgeModules({
  text = '',
  levels = null,
  rawScores = {},
  evidence = {},
  levelBreakdown = {},
} = {}) {
  const topIntentTypes = listTopIntentTypesFromRawScores(rawScores);
  const context = {
    text,
    language: inferLanguage(text),
    domain: inferDomainFromTopIntents(topIntentTypes),
    mode: 'semantic',
    renderHints: [],
    referenceHints: [],
    topIntentTypes,
  };

  const activeModules = MODULES
    .filter((moduleDef) => moduleMatches(moduleDef, context))
    .map((moduleDef) => ({
      id: moduleDef.id,
      label: moduleDef.label,
      discipline: moduleDef.discipline,
      knowledge: moduleDef.knowledge || {},
      semantic: moduleDef.semantic || {},
      impactsByMode: moduleDef.impacts || {},
      activationReasons: buildActivationReasons(moduleDef, context),
    }));

  for (const moduleEntry of activeModules) {
    const scoreAdjustments = moduleEntry.semantic?.scoreAdjustments || {};
    for (const [intentType, delta] of Object.entries(scoreAdjustments)) {
      if (!(intentType in rawScores)) continue;
      const numericDelta = Number(delta || 0);
      if (!Number.isFinite(numericDelta) || numericDelta === 0) continue;
      rawScores[intentType] += numericDelta;
      if (levelBreakdown?.message && typeof levelBreakdown.message === 'object' && intentType in levelBreakdown.message) {
        levelBreakdown.message[intentType] += numericDelta;
      }
      evidence[intentType] = Array.isArray(evidence[intentType]) ? evidence[intentType] : [];
      evidence[intentType].push(`module:${moduleEntry.id}`);
    }
  }

  return {
    activeModules: activeModules.map((entry) => ({
      id: entry.id,
      label: entry.label,
      discipline: entry.discipline,
      activationReasons: entry.activationReasons,
      concepts: Array.isArray(entry.knowledge?.concepts) ? entry.knowledge.concepts : [],
      methods: Array.isArray(entry.knowledge?.methods) ? entry.knowledge.methods : [],
      commonErrors: Array.isArray(entry.knowledge?.commonErrors) ? entry.knowledge.commonErrors : [],
    })),
    impacts: activeModules.flatMap((entry) =>
      Object.entries(entry.impactsByMode || {}).flatMap(([mode, items]) =>
        (Array.isArray(items) ? items : []).map((effect) => ({
          moduleId: entry.id,
          mode,
          effect: String(effect || '').trim(),
        }))
      )
    ),
  };
}

function applyImageKnowledgeModules({
  decision,
  semanticAnalysis = null,
  promptSeed = null,
} = {}) {
  if (!decision?.handled || !decision?.canonicalIntent) return decision;

  const canonicalIntent = decision.canonicalIntent;
  const activeModules = activateKnowledgeModules({
    text: canonicalIntent.sourceText,
    semanticAnalysis,
    mode: decision.mode,
    canonicalIntent,
    promptSeed,
    domain: canonicalIntent.task?.domain,
  });

  const trace = Array.isArray(decision?.debug?.trace) ? decision.debug.trace : [];
  const impacts = [];

  for (const moduleEntry of activeModules) {
    trace.push(`module:${moduleEntry.id}`);

    const apply = moduleEntry.apply || {};

    if (apply.constraints && typeof apply.constraints === 'object') {
      canonicalIntent.constraints = {
        ...(canonicalIntent.constraints || {}),
        ...apply.constraints,
      };
    }

    if (Array.isArray(apply.composition)) {
      canonicalIntent.composition = mergeUniqueStrings([
        ...(Array.isArray(canonicalIntent.composition) ? canonicalIntent.composition : []),
        ...apply.composition,
      ]);
    }

    if (apply.style && typeof apply.style === 'object') {
      canonicalIntent.style = canonicalIntent.style || {};
      if (apply.style.render && !canonicalIntent.style.render) {
        canonicalIntent.style.render = String(apply.style.render).trim();
      }
      if (Array.isArray(apply.style.modifiers)) {
        canonicalIntent.style.modifiers = mergeUniqueStrings([
          ...(Array.isArray(canonicalIntent.style.modifiers) ? canonicalIntent.style.modifiers : []),
          ...apply.style.modifiers,
        ]);
      }
    }

    const moduleImpacts = Array.isArray(moduleEntry.impactsByMode?.[decision.mode])
      ? moduleEntry.impactsByMode[decision.mode]
      : [];
    for (const impact of moduleImpacts) {
      impacts.push({
        moduleId: moduleEntry.id,
        effect: String(impact || '').trim(),
      });
    }
  }

  decision.knowledge = {
    activeModules: activeModules.map((entry) => ({
      id: entry.id,
      label: entry.label,
      discipline: entry.discipline,
      activationReasons: entry.activationReasons,
      concepts: Array.isArray(entry.knowledge?.concepts) ? entry.knowledge.concepts : [],
      methods: Array.isArray(entry.knowledge?.methods) ? entry.knowledge.methods : [],
      commonErrors: Array.isArray(entry.knowledge?.commonErrors) ? entry.knowledge.commonErrors : [],
    })),
    impacts,
  };

  return decision;
}

module.exports = {
  MODULES,
  inferLanguage,
  activateKnowledgeModules,
  applyImageKnowledgeModules,
  applySemanticKnowledgeModules,
};
