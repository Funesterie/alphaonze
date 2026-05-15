const analyzeSemanticIntentDefault = require('../mask/semantic/analyze-semantic-intent.cjs');
const {
  detectImageIntent: defaultDetectImageIntent,
  detectWebImageIntent: defaultDetectWebImageIntent,
  extractWebImageSubject: defaultExtractWebImageSubject,
} = require('../../lib/intent-detection.cjs');
const { duckduckgoImageSearch: defaultDuckduckgoImageSearch } = require('../../lib/image-search.cjs');
const {
  buildPromptSeed,
  mergeUniqueStrings,
  looksLikeShowRequest,
} = require('./prompt-builder.cjs');
const {
  executeGenerateImagePlan,
  executeWebImageSearchPlan,
} = require('./generate.cjs');
const {
  applyImageKnowledgeModules,
} = require('../knowledge/a11-knowledge-operator.cjs');
const {
  smoothRequestTextSync,
} = require('../knowledge/request-text-smoother.cjs');
const textToWazaa = require('../mask/text-to-wazaa.cjs');

const PACKS = [
  require('./packs/base-literal-image.pack.json'),
  require('./packs/cartoon-render.pack.json'),
  require('./packs/anime-render.pack.json'),
  require('./packs/retro-game-character.pack.json'),
];

function clamp01(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(1, numeric));
}

function isTruthy(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function createClarificationPayload(decision = {}) {
  return {
    question: String(decision?.question || '').trim(),
    options: Array.isArray(decision?.options) ? decision.options : [],
    recommendedIntentType: String(decision?.recommendedIntentType || '').trim(),
    recommendationLine: String(decision?.recommendationLine || '').trim(),
  };
}

function buildClarificationMessage(decision = {}) {
  const optionLines = Array.isArray(decision?.options)
    ? decision.options.map((entry) => String(entry?.promptLine || entry?.label || '').trim()).filter(Boolean)
    : [];
  return [
    String(decision?.question || '').trim(),
    String(decision?.recommendationLine || '').trim(),
    ...optionLines,
    optionLines.length ? 'Tu peux repondre juste par 1, 2, dire "vas-y", ou reformuler clairement.' : '',
  ].filter(Boolean).join('\n');
}

function matchPack(pack = {}, context = {}) {
  const match = pack.match || {};
  if (Array.isArray(match.actions) && match.actions.length > 0) {
    if (!match.actions.includes(String(context.action || '').trim())) return false;
  }
  if (Array.isArray(match.renderHintsAny) && match.renderHintsAny.length > 0) {
    const renderHints = Array.isArray(context.renderHints) ? context.renderHints : [];
    if (!match.renderHintsAny.some((entry) => renderHints.includes(entry))) return false;
  }
  if (Array.isArray(match.referenceHintsAny) && match.referenceHintsAny.length > 0) {
    const referenceHints = Array.isArray(context.referenceHints) ? context.referenceHints : [];
    if (!match.referenceHintsAny.some((entry) => referenceHints.includes(entry))) return false;
  }
  return true;
}

function applyPackToIntent(intent, pack, trace) {
  if (!pack || !pack.apply) return intent;

  intent.style = intent.style || {};
  intent.constraints = intent.constraints || {};
  intent.subject = intent.subject || {};
  intent.scene = intent.scene || {};
  intent.composition = mergeUniqueStrings([
    ...(Array.isArray(intent.composition) ? intent.composition : []),
    ...(Array.isArray(pack.apply.composition) ? pack.apply.composition : []),
  ]);

  if (pack.apply.style) {
    if (pack.apply.style.render && !intent.style.render) {
      intent.style.render = String(pack.apply.style.render).trim();
    }
    intent.style.modifiers = mergeUniqueStrings([
      ...(Array.isArray(intent.style.modifiers) ? intent.style.modifiers : []),
      ...(Array.isArray(pack.apply.style.modifiers) ? pack.apply.style.modifiers : []),
    ]);
  }

  if (pack.apply.constraints && typeof pack.apply.constraints === 'object') {
    intent.constraints = {
      ...intent.constraints,
      ...pack.apply.constraints,
    };
  }

  if (!Array.isArray(intent.appliedPacks)) intent.appliedPacks = [];
  intent.appliedPacks.push(pack.id);
  trace.push(`pack:${pack.id}`);
  return intent;
}

function selectImageMode({
  explicitImageIntent,
  explicitWebImageIntent,
  selectedIntentType,
  semanticConfidence,
  promptSeed,
}) {
  if (explicitWebImageIntent) {
    return { mode: 'web_search', reason: 'explicit_web_image_intent' };
  }
  if (selectedIntentType === 'web.image.search' && semanticConfidence >= 0.58) {
    return { mode: 'web_search', reason: 'semantic_web_image_search' };
  }

  const showRequest = Boolean(promptSeed?.showIntent || looksLikeShowRequest(promptSeed?.normalizedText));
  const hasVisualSubject = Boolean(
    promptSeed?.subjectEntity
    || (Array.isArray(promptSeed?.referenceHints) && promptSeed.referenceHints.length > 0)
  );
  if (showRequest && hasVisualSubject && !explicitImageIntent) {
    return { mode: 'web_search', reason: 'show_request_with_subject' };
  }

  const looksLikeVisualCreation = Boolean(
    promptSeed?.subjectEntity
    && (
      explicitImageIntent
      || (Array.isArray(promptSeed?.renderHints) && promptSeed.renderHints.length > 0)
      || (Array.isArray(promptSeed?.referenceHints) && promptSeed.referenceHints.length > 0)
      || (Array.isArray(promptSeed?.palette) && promptSeed.palette.length > 0)
    )
  );

  if (explicitImageIntent) return { mode: 'generate', reason: 'explicit_image_intent' };
  if (selectedIntentType === 'image.generate') return { mode: 'generate', reason: 'semantic_image_generate' };
  if (looksLikeVisualCreation && semanticConfidence >= 0.34) {
    return { mode: 'generate', reason: 'visual_subject_and_style_signals' };
  }
  return { mode: 'none', reason: 'no_image_signal' };
}

function buildGenerateIntent({ text, promptSeed, semanticAnalysis, semanticConfidence }) {
  const subjectAttributes = (promptSeed.palette || []).map((value) => ({
    type: 'color',
    value,
    confidence: 0.88,
  }));

  return {
    version: 'a11-image-intent-1',
    sourceText: String(text || '').trim(),
    normalizedText: String(promptSeed?.normalizedText || '').trim(),
    task: { domain: 'image', action: 'generate' },
    subject: {
      entity: String(promptSeed?.subjectEntity || semanticAnalysis?.subject || '').trim(),
      display: String(promptSeed?.subjectEntity || semanticAnalysis?.subject || '').trim(),
      prompt: String(promptSeed?.promptDetails?.subjectText || text || '').trim(),
      references: mergeUniqueStrings(promptSeed?.referenceHints || []),
      attributes: subjectAttributes,
    },
    scene: {
      description: String(promptSeed?.sceneDescription || '').trim(),
    },
    style: {
      render: '',
      modifiers: mergeUniqueStrings(promptSeed?.styleHints || []),
      references: mergeUniqueStrings(promptSeed?.referenceHints || []),
      renderHints: mergeUniqueStrings(promptSeed?.renderHints || []),
      palette: mergeUniqueStrings(promptSeed?.palette || []),
    },
    composition: mergeUniqueStrings(promptSeed?.compositionHints || []),
    lighting: [],
    constraints: {
      safeMode: true,
      noText: true,
      literalInterpretation: true,
    },
    ambiguities: Array.isArray(semanticAnalysis?.ambiguities) ? semanticAnalysis.ambiguities : [],
    execution: {
      mode: 'generate',
      target: 'image-prompt-en',
      width: 768,
      height: 768,
      steps: 40,
      guidanceScale: 8,
      confidence: Number(clamp01(semanticConfidence).toFixed(4)),
    },
    appliedPacks: [],
  };
}

function buildWazaaHint(text, semanticAnalysis) {
  try {
    if (typeof textToWazaa.sync !== 'function') return null;
    return textToWazaa.sync(text, {
      analysis: semanticAnalysis,
      source: 'image-brain',
    });
  } catch {
    return null;
  }
}

function buildWebSearchIntent({ text, promptSeed, semanticAnalysis, extractWebImageSubject, semanticConfidence }) {
  const explicitQuery = typeof extractWebImageSubject === 'function'
    ? extractWebImageSubject(text)
    : '';
  const searchQuery = String(
    explicitQuery
    || promptSeed?.subjectEntity
    || semanticAnalysis?.subject
    || promptSeed?.promptDetails?.subjectText
    || text
  ).trim();

  return {
    version: 'a11-image-intent-1',
    sourceText: String(text || '').trim(),
    normalizedText: String(promptSeed?.normalizedText || '').trim(),
    task: { domain: 'image', action: 'search_web' },
    subject: {
      entity: searchQuery,
      display: searchQuery,
      searchQuery,
      references: mergeUniqueStrings(promptSeed?.referenceHints || []),
      attributes: [],
    },
    scene: {},
    style: {
      render: '',
      modifiers: [],
      references: mergeUniqueStrings(promptSeed?.referenceHints || []),
      renderHints: mergeUniqueStrings(promptSeed?.renderHints || []),
      palette: [],
    },
    composition: [],
    lighting: [],
    constraints: {
      safeMode: true,
    },
    ambiguities: [],
    execution: {
      mode: 'web_search',
      target: 'web-image-search',
      confidence: Number(clamp01(semanticConfidence).toFixed(4)),
    },
    appliedPacks: [],
  };
}

function logBrainDecision(decision) {
  if (!decision || !decision.handled) return;
  const packs = Array.isArray(decision.canonicalIntent?.appliedPacks)
    ? decision.canonicalIntent.appliedPacks.join(',')
    : '';
  const modules = Array.isArray(decision.knowledge?.activeModules)
    ? decision.knowledge.activeModules.map((entry) => entry.id).join(',')
    : '';
  const subject = String(
    decision.canonicalIntent?.subject?.display
    || decision.canonicalIntent?.subject?.entity
    || ''
  ).trim();
  console.log(
    `[A11][image-brain] mode=${decision.mode} confidence=${decision.confidence} subject=${subject || 'unknown'} packs=${packs || 'none'} modules=${modules || 'none'} reasons=${(decision.debug?.trace || []).join(' | ')}`
  );
}

function summarizeDecision(decision = {}) {
  return {
    mode: String(decision?.mode || '').trim(),
    confidence: Number(decision?.confidence || 0),
    pipelineRole: String(decision?.pipelineRole || '').trim(),
    subject: String(
      decision?.canonicalIntent?.subject?.display
      || decision?.canonicalIntent?.subject?.entity
      || decision?.canonicalIntent?.subject?.searchQuery
      || ''
    ).trim(),
    packs: Array.isArray(decision?.canonicalIntent?.appliedPacks)
      ? decision.canonicalIntent.appliedPacks
      : [],
    trace: Array.isArray(decision?.debug?.trace) ? decision.debug.trace : [],
    semanticTopIntents: Array.isArray(decision?.debug?.semanticTopIntents)
      ? decision.debug.semanticTopIntents
      : [],
    wazaaHint: decision?.wazaaHint
      ? {
          intentType: String(decision.wazaaHint?.intent?.type || '').trim(),
          entityCount: Array.isArray(decision.wazaaHint?.entities) ? decision.wazaaHint.entities.length : 0,
        }
      : null,
    knowledge: {
      activeModules: Array.isArray(decision?.knowledge?.activeModules)
        ? decision.knowledge.activeModules.map((entry) => ({
          id: entry.id,
          discipline: entry.discipline,
          activationReasons: entry.activationReasons,
        }))
        : [],
      impacts: Array.isArray(decision?.knowledge?.impacts) ? decision.knowledge.impacts : [],
    },
  };
}

function createA11ImageBrain(overrides = {}) {
  const analyzeSemanticIntent = overrides.analyzeSemanticIntent || analyzeSemanticIntentDefault;
  const detectImageIntent = overrides.detectImageIntent || defaultDetectImageIntent;
  const detectWebImageIntent = overrides.detectWebImageIntent || defaultDetectWebImageIntent;
  const extractWebImageSubject = overrides.extractWebImageSubject || defaultExtractWebImageSubject;
  const duckduckgoImageSearch = overrides.duckduckgoImageSearch || defaultDuckduckgoImageSearch;
  const generateSd = overrides.generateSd;

  function planRequest(text = '') {
    const sourceText = String(text || '').trim();
    if (!sourceText) {
      return {
        handled: false,
        mode: 'none',
      };
    }
    const requestTextSmootherResult = smoothRequestTextSync(sourceText, {
      source: 'image-brain',
      enableLlm: false,
    });
    const effectiveSourceText = String(requestTextSmootherResult?.text || sourceText).trim();

    const semanticAnalysis = analyzeSemanticIntent(effectiveSourceText, {
      detectImageIntent,
      detectWebImageIntent,
    });
    const semanticDecision = semanticAnalysis?.decision || {};
    const semanticConfidence = Number(semanticAnalysis?.summary?.confidence || 0);
    const selectedIntentType = String(
      semanticDecision.selectedIntentType
      || semanticAnalysis?.summary?.selectedIntentType
      || semanticAnalysis?.topIntents?.[0]?.type
      || ''
    ).trim();
    const promptSeed = buildPromptSeed(effectiveSourceText, semanticAnalysis);
    const explicitImageIntent = typeof detectImageIntent === 'function' && detectImageIntent(effectiveSourceText);
    const explicitWebImageIntent = typeof detectWebImageIntent === 'function' && detectWebImageIntent(effectiveSourceText);
    const trace = [
      `selected=${selectedIntentType || 'none'}`,
      `semantic_confidence=${semanticConfidence.toFixed(3)}`,
      explicitImageIntent ? 'explicit=image.generate' : '',
      explicitWebImageIntent ? 'explicit=web.image.search' : '',
    ].filter(Boolean);

    const modeDecision = selectImageMode({
      explicitImageIntent,
      explicitWebImageIntent,
      selectedIntentType,
      semanticConfidence,
      promptSeed,
    });
    const mode = modeDecision.mode;
    const hasDirectSemanticGenerate = (
      selectedIntentType === 'image.generate'
      && Boolean(promptSeed?.subjectEntity || semanticAnalysis?.subject)
    );
    trace.push(`mode_reason=${modeDecision.reason}`);

    if (mode === 'none') {
      return {
        handled: false,
        mode,
        confidence: semanticConfidence,
        debug: {
          trace,
          semanticTopIntents: Array.isArray(semanticAnalysis?.topIntents) ? semanticAnalysis.topIntents.slice(0, 3) : [],
        },
      };
    }

    if (semanticDecision.shouldClarify && mode === 'generate' && !explicitImageIntent && !hasDirectSemanticGenerate) {
      const clarification = {
        handled: true,
        mode: 'clarify',
        pipelineRole: 'enrichment-only',
        confidence: semanticConfidence,
        clarification: createClarificationPayload(semanticDecision),
        assistant: buildClarificationMessage(semanticDecision),
        semantic: {
          topIntents: Array.isArray(semanticAnalysis?.topIntents) ? semanticAnalysis.topIntents.slice(0, 3) : [],
          confidence: semanticConfidence,
        },
        debug: {
          trace: [...trace, 'mode=clarify'],
          semanticTopIntents: Array.isArray(semanticAnalysis?.topIntents) ? semanticAnalysis.topIntents.slice(0, 3) : [],
        },
      };
      logBrainDecision({
        handled: true,
        mode: clarification.mode,
        confidence: clarification.confidence,
        canonicalIntent: null,
        debug: clarification.debug,
      });
      return clarification;
    }

    const canonicalIntent = mode === 'web_search'
      ? buildWebSearchIntent({
          text: effectiveSourceText,
          promptSeed,
          semanticAnalysis,
          extractWebImageSubject,
          semanticConfidence,
        })
      : buildGenerateIntent({
          text: effectiveSourceText,
          promptSeed,
          semanticAnalysis,
          semanticConfidence,
        });
    const wazaaHint = buildWazaaHint(effectiveSourceText, semanticAnalysis);
    canonicalIntent.meta = {
      ...(canonicalIntent.meta && typeof canonicalIntent.meta === 'object' ? canonicalIntent.meta : {}),
      pipelineRole: 'enrichment-only',
      canonicalMaskProducer: 'text-to-wazaa -> wazaa-to-mask',
      compatMaskWrappers: ['text-to-mask-image-generate', 'image/mask-first'],
      wazaaIntentType: String(wazaaHint?.intent?.type || '').trim() || selectedIntentType || '',
      originalSourceText: sourceText,
      requestTextSmoother: {
        applied: requestTextSmootherResult?.changed === true,
        usedLlm: false,
        smoothedText: effectiveSourceText,
      },
    };

    for (const pack of PACKS) {
      if (!matchPack(pack, {
        action: mode === 'web_search' ? 'search_web' : 'generate',
        renderHints: canonicalIntent.style?.renderHints || [],
        referenceHints: canonicalIntent.subject?.references || [],
      })) {
        continue;
      }
      applyPackToIntent(canonicalIntent, pack, trace);
    }

    const decision = {
      handled: true,
      mode,
      pipelineRole: 'enrichment-only',
      confidence: semanticConfidence,
      canonicalIntent,
      wazaaHint,
      semantic: {
        topIntents: Array.isArray(semanticAnalysis?.topIntents) ? semanticAnalysis.topIntents.slice(0, 3) : [],
        confidence: semanticConfidence,
      },
      debug: {
        trace: [...trace, `mode=${mode}`],
        semanticTopIntents: Array.isArray(semanticAnalysis?.topIntents) ? semanticAnalysis.topIntents.slice(0, 3) : [],
      },
    };
    applyImageKnowledgeModules({
      decision,
      semanticAnalysis,
      promptSeed,
    });
    logBrainDecision(decision);
    return decision;
  }

  async function executePlan({ req, decision }) {
    if (!decision?.handled) return { ok: false, error: 'not_handled' };

    if (decision.mode === 'web_search') {
      const payload = await executeWebImageSearchPlan({
        canonicalIntent: decision.canonicalIntent,
        duckduckgoImageSearch,
      });
      return {
        ok: true,
        mode: 'web_search',
        subject: payload.subject,
        result: payload.result,
      };
    }

    if (decision.mode === 'generate') {
      const payload = await executeGenerateImagePlan({
        req,
        canonicalIntent: decision.canonicalIntent,
        generateSd,
      });
      return {
        ok: true,
        mode: 'generate',
        ...payload,
      };
    }

    return {
      ok: true,
      mode: decision.mode,
    };
  }

  return {
    planRequest,
    executePlan,
  };
}

module.exports = {
  createA11ImageBrain,
  buildClarificationMessage,
  summarizeDecision,
};
