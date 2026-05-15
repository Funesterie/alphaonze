'use strict';

const {
  buildSemanticWeightsFromScene,
  buildWeightedImagePromptFragments,
  buildWeightedNegativePromptFragments,
} = require('./semantic-weight-engine.cjs');

const FROM_RELATION_LABELS = {
  fr: 'sort de',
  en: 'emerges from',
};

function normalizeText(value = '') {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeLookup(value = '') {
  return normalizeText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, ' ')
    .replace(/[-_/]/g, ' ')
    .toLowerCase();
}

function stripRequestPrefix(value = '') {
  let text = normalizeText(value);
  let previous = '';

  while (text && text !== previous) {
    previous = text;
    text = text
      .replace(/^(?:salut|bonjour|bonsoir|hey|hello|ok|okay|bon|alors)\s+/i, '')
      .replace(/^(?:tu peux|peux[- ]?tu|tu pourrais|pourrais[- ]?tu|stp|svp|please)\s+/i, '')
      .replace(/^(?:je veux|je voudrais|j aimerais|j'aimerais|i want|i would like)\s+/i, '')
      .replace(/^que\s+tu\s+/i, '')
      .replace(/^(?:genere|g[eé]n[eéè]r(?:e|er|é|ée)|generate|create|cree|cr[eé]e(?:r|é|ée)?|dessine|draw|fabrique|produis|prepare|montre|show|affiche|make|fais)\s+(?:moi\s+|me\s+)?/i, '')
      .replace(/^(?:une?\s+|an?\s+)?(?:image|illustration|dessin|photo|visuel|portrait|picture)\s+(?:de|du|de la|de l['’]?|d['’]?|of\s+)?/i, '')
      .trim();
  }

  return text;
}

function stripLeadingArticle(value = '') {
  return normalizeText(value)
    .replace(/^(?:un|une|des|du|de la|de l['’]?|d['’]?|le|la|les|a|an|the)\s+/i, '')
    .trim();
}

function stripTrailingPunctuation(value = '') {
  return normalizeText(value).replace(/[,.!?;:]+$/g, '').trim();
}

function detectLanguage(value = '') {
  const text = normalizeText(value);
  if (/[\u3040-\u30ff]/.test(text)) return 'ja';
  if (/[\u4e00-\u9fff]/.test(text)) return 'zh';
  const lookup = normalizeLookup(text);
  if (/\b(?:un|une|des|du|de la|de l|sort|sortant|surgit|chapeau|magicien|dans|sur|avec)\b/.test(lookup)) {
    return 'fr';
  }
  if (/\b(?:a|an|the|from|emerges|coming|comes|rabbit|hat|wizard|magician)\b/.test(lookup)) {
    return 'en';
  }
  return 'unknown';
}

function buildSceneGraph({
  language = 'unknown',
  subject = '',
  action = '',
  relation = '',
  object = '',
  literal = '',
} = {}) {
  const cleanSubject = stripLeadingArticle(subject);
  const cleanObject = stripLeadingArticle(object);
  if (!cleanSubject || !cleanObject || !relation) return null;

  return {
    schema: 'a11.scene-graph.v1',
    language,
    literal: stripTrailingPunctuation(literal),
    entities: [
      {
        id: 'subject:main',
        role: 'subject',
        text: cleanSubject,
      },
      {
        id: 'object:origin',
        role: 'origin',
        text: cleanObject,
      },
    ],
    actions: [
      {
        id: 'action:main',
        text: normalizeText(action),
        relation,
      },
    ],
    relations: [
      {
        from: 'subject:main',
        type: relation,
        to: 'object:origin',
      },
    ],
    constraints: [
      'preserve_literal_subject',
      'preserve_spatial_relation',
      'single_main_subject',
    ],
  };
}

function parseFrenchScene(body = '') {
  const text = stripTrailingPunctuation(body);
  const match = text.match(
    /^(.+?)\s+(sort(?:ant|i|ie|ir|e|ent)?|surgit|emerge|apparait|appara[iî]t)\s+(?:de|du|des|de la|de l['’]?|d['’]\s*(?:un|une|des)?|hors de)\s+(.+)$/i
  );
  if (!match) return null;

  return buildSceneGraph({
    language: 'fr',
    subject: match[1],
    action: match[2],
    relation: 'emerges_from',
    object: match[3],
    literal: text,
  });
}

function parseEnglishScene(body = '') {
  const text = stripTrailingPunctuation(body);
  const match = text.match(
    /^(.+?)\s+(emerges?|comes out|coming out|rises?|jumps out|appears?)\s+(?:from|out of|inside)\s+(.+)$/i
  );
  if (!match) return null;

  return buildSceneGraph({
    language: 'en',
    subject: match[1],
    action: match[2],
    relation: 'emerges_from',
    object: match[3],
    literal: text,
  });
}

function parseJapaneseScene(body = '') {
  const text = stripTrailingPunctuation(body);
  const match = text.match(/^(.+?)(?:が|は)(.+?)(?:から|より)(?:出てくる|出る|現れる)$/u);
  if (!match) return null;

  return buildSceneGraph({
    language: 'ja',
    subject: match[1],
    action: '出てくる',
    relation: 'emerges_from',
    object: match[2],
    literal: text,
  });
}

function parseChineseScene(body = '') {
  const text = stripTrailingPunctuation(body);
  const match = text.match(/^(.+?)从(.+?)(?:里|中)?(?:出来|出现)$/u);
  if (!match) return null;

  return buildSceneGraph({
    language: 'zh',
    subject: match[1],
    action: '出来',
    relation: 'emerges_from',
    object: match[2],
    literal: text,
  });
}

function parseLinguisticScene(input = '') {
  const raw = normalizeText(input);
  const body = stripRequestPrefix(raw);
  const language = detectLanguage(body || raw);
  const parsers = language === 'fr'
    ? [parseFrenchScene, parseEnglishScene]
    : language === 'en'
      ? [parseEnglishScene, parseFrenchScene]
      : language === 'ja'
        ? [parseJapaneseScene]
        : language === 'zh'
          ? [parseChineseScene]
          : [parseFrenchScene, parseEnglishScene, parseJapaneseScene, parseChineseScene];

  for (const parser of parsers) {
    const graph = parser(body);
    if (graph) {
      return {
        ok: true,
        raw,
        body,
        language: graph.language || language,
        graph,
      };
    }
  }

  return {
    ok: false,
    raw,
    body,
    language,
    graph: null,
  };
}

function includesSemanticFragment(haystack = '', needle = '') {
  const normalizedHaystack = normalizeLookup(haystack);
  const normalizedNeedle = normalizeLookup(needle);
  return Boolean(normalizedHaystack && normalizedNeedle && normalizedHaystack.includes(normalizedNeedle));
}

function buildImagePromptHintsFromScene(sceneResult = null, context = {}) {
  const graph = sceneResult?.graph;
  if (!graph) {
    return {
      promptHints: [],
      negativeHints: [],
      graph: null,
      weights: null,
    };
  }

  const subject = graph.entities.find((entry) => entry.role === 'subject')?.text || '';
  const object = graph.entities.find((entry) => entry.role === 'origin')?.text || '';
  const language = graph.language || sceneResult.language || 'unknown';
  const relationLabel = FROM_RELATION_LABELS[language] || FROM_RELATION_LABELS.en;
  const literal = graph.literal || `${subject} ${relationLabel} ${object}`;
  const weights = buildSemanticWeightsFromScene(graph, context);
  const weightedPromptHints = buildWeightedImagePromptFragments(weights);
  const weightedNegativeHints = buildWeightedNegativePromptFragments(weights);

  const promptHints = language === 'fr'
    ? [
        ...weightedPromptHints,
        `scene litterale: ${literal}`,
        `${subject} ${relationLabel} ${object}`,
        'un seul sujet principal',
      ]
    : [
        ...weightedPromptHints,
        `literal scene: ${literal}`,
        `${subject} ${relationLabel} ${object}`,
        'single clearly visible main subject',
      ];

  const negativeHints = language === 'fr'
    ? [...weightedNegativeHints, 'plusieurs sujets', 'doublon du sujet']
    : [...weightedNegativeHints, 'multiple subjects', 'duplicate subject'];

  return {
    promptHints: [...new Set(promptHints.map((entry) => normalizeText(entry)).filter(Boolean))],
    negativeHints: [...new Set(negativeHints.map((entry) => normalizeText(entry)).filter(Boolean))],
    graph,
    weights,
  };
}

function joinPromptFragments(values = []) {
  return [...new Set(
    values
      .map((entry) => normalizeText(entry))
      .filter(Boolean)
  )].join(', ');
}

function enrichImagePromptWithLinguisticScene({
  rawPrompt = '',
  prompt = '',
  negativePrompt = '',
  enabled = true,
  context = {},
} = {}) {
  const basePrompt = normalizeText(prompt);
  const baseNegativePrompt = normalizeText(negativePrompt);
  if (!enabled || !rawPrompt || !basePrompt) {
    return {
      prompt: basePrompt,
      negativePrompt: baseNegativePrompt,
      scene: null,
      applied: false,
    };
  }

  const scene = parseLinguisticScene(rawPrompt);
  if (!scene.ok || !scene.graph) {
    return {
      prompt: basePrompt,
      negativePrompt: baseNegativePrompt,
      scene,
      applied: false,
    };
  }

  const hints = buildImagePromptHintsFromScene(scene, context);
  const missingPromptHints = hints.promptHints.filter((hint) => !includesSemanticFragment(basePrompt, hint));
  const missingNegativeHints = hints.negativeHints.filter((hint) => !includesSemanticFragment(baseNegativePrompt, hint));

  return {
    prompt: joinPromptFragments([...missingPromptHints, basePrompt]),
    negativePrompt: joinPromptFragments([baseNegativePrompt, ...missingNegativeHints]),
    scene: hints.graph,
    weights: hints.weights,
    applied: missingPromptHints.length > 0 || missingNegativeHints.length > 0,
  };
}

module.exports = {
  buildImagePromptHintsFromScene,
  enrichImagePromptWithLinguisticScene,
  parseLinguisticScene,
};
