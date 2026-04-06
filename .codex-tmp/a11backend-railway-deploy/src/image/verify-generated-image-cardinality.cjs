const {
  compileCharacterCountConstraints,
  compileSingleSubjectConstraints,
  translateImagePromptToEnglish,
} = require('../mask/build-sd-prompt-bundle.cjs');

function defaultFetch(...args) {
  if (typeof globalThis.fetch === 'function') {
    return globalThis.fetch(...args);
  }
  return import('node-fetch').then((mod) => mod.default(...args));
}

function normalizeText(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

const ANIMAL_SUBJECT_PATTERN = /\b(rabbit|bunny|hare|fox|sheep|ram|ewe|lamb|bear|cow|bull|dog|cat|wolf|tiger|lion|horse|pony|donkey|pig|boar|monkey|gorilla|panda|deer|bird|owl|eagle|duck|goose|chicken|hen|rooster|goat|camel|elephant|giraffe|zebra|whale|dolphin|shark|frog|turtle|snake|lizard)\b/;

function extractJsonObject(raw = '') {
  const text = String(raw || '').trim();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {}

  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace < 0 || lastBrace <= firstBrace) return null;

  try {
    return JSON.parse(text.slice(firstBrace, lastBrace + 1));
  } catch {
    return null;
  }
}

function clamp01(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(1, numeric));
}

function inferExpectedImageContract({ mask, compiledState } = {}) {
  const rawPrompt = String(mask?.raw || compiledState?.mask?.raw || '').trim();
  if (!rawPrompt) {
    return {
      enabled: false,
      reason: 'missing_raw_prompt',
    };
  }

  const pair = compileCharacterCountConstraints(rawPrompt);
  if (pair?.count === 2) {
    return {
      enabled: true,
      subjectCount: 2,
      subjectType: pair.kind === 'characters' ? 'character' : 'subject',
      subjectLabel: pair.subjects?.join(' and ') || '',
      allowGroup: false,
      mode: 'pair',
      reason: 'paired_subject_prompt',
    };
  }

  const single = compileSingleSubjectConstraints(rawPrompt, String(compiledState?.sdBody?.prompt || '').trim());
  if (single?.count === 1) {
    return {
      enabled: true,
      subjectCount: 1,
      subjectType: String(single.subject || '').trim() || 'subject',
      subjectLabel: String(single.subject || '').trim() || '',
      allowGroup: false,
      mode: 'single',
      reason: 'single_subject_prompt',
    };
  }

  return {
    enabled: false,
    reason: 'no_clear_cardinality',
  };
}

function resolveVisionConfig(overrides = {}) {
  const explicitBaseUrl = String(
    overrides.baseUrl ||
    process.env.A11_VISION_BASE_URL ||
    process.env.XAI_BASE_URL ||
    process.env.A11_OPENAI_BASE_URL ||
    process.env.OPENAI_BASE_URL ||
    ''
  ).trim();
  const apiKey = String(
    overrides.apiKey ||
    process.env.A11_VISION_API_KEY ||
    process.env.XAI_API_KEY ||
    process.env.OPENAI_API_KEY ||
    ''
  ).trim();
  const baseUrl = explicitBaseUrl || (
    String(process.env.XAI_API_KEY || '').trim()
      ? 'https://api.x.ai/v1'
      : (apiKey ? 'https://api.openai.com/v1' : '')
  );
  const defaultModel = /api\.x\.ai/i.test(baseUrl) ? 'grok-4' : 'gpt-4o-mini';
  const model = String(
    overrides.model ||
    process.env.A11_VISION_MODEL ||
    process.env.XAI_VISION_MODEL ||
    process.env.XAI_MODEL ||
    process.env.OPENAI_VISION_MODEL ||
    process.env.OPENAI_MODEL ||
    defaultModel
  ).trim();

  return {
    apiKey,
    baseUrl,
    model,
    available: Boolean(apiKey && baseUrl),
  };
}

async function verifyGeneratedImageCardinality({
  imageUrl,
  expected,
  requestId = '',
  prompt = '',
  seed,
  fetch = defaultFetch,
  apiKey,
  baseUrl,
  model,
} = {}) {
  const normalizedImageUrl = String(imageUrl || '').trim();
  if (!normalizedImageUrl) {
    return {
      ok: false,
      skipped: true,
      reason: 'missing_image_url',
    };
  }

  if (!expected?.enabled || !Number.isFinite(Number(expected.subjectCount)) || Number(expected.subjectCount) < 1) {
    return {
      ok: false,
      skipped: true,
      reason: 'no_expected_cardinality',
    };
  }

  const config = resolveVisionConfig({ apiKey, baseUrl, model });
  if (!config.available) {
    return {
      ok: false,
      skipped: true,
      reason: 'vision_unavailable',
    };
  }

  const normalizedBase = config.baseUrl.replace(/\/+$/, '');
  const url = normalizedBase.endsWith('/v1')
    ? `${normalizedBase}/chat/completions`
    : `${normalizedBase}/v1/chat/completions`;

  const expectedLabel = String(expected.subjectLabel || expected.subjectType || 'subject').trim();
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        {
          role: 'system',
          content: 'Tu verifies une image pour A11. Reponds uniquement en JSON valide, sans markdown, sans texte hors JSON.',
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: [
                `request_id=${String(requestId || 'unknown').trim() || 'unknown'}`,
                `expected_subject_count=${Number(expected.subjectCount)}`,
                `expected_subject_label=${expectedLabel || 'subject'}`,
                `allow_group=${expected.allowGroup === true ? 'true' : 'false'}`,
                `seed=${seed !== undefined ? String(seed) : 'unknown'}`,
                `prompt=${String(prompt || '').trim()}`,
                'Analyse l image et renvoie uniquement ce JSON:',
                '{"observed_subject_count":0,"observed_subject_label":"","duplicate_subjects":false,"fusion_detected":false,"subject_match":false,"confidence":0.0,"retry":false,"reason":"","notes":""}',
                'retry=true seulement si plusieurs sujets visibles, doublons, clones, fusion de corps/visages, ou non-respect clair de la cardinalite attendue.',
              ].join('\n'),
            },
            { type: 'image_url', image_url: { url: normalizedImageUrl } },
          ],
        },
      ],
      max_tokens: 260,
      temperature: 0,
      response_format: { type: 'json_object' },
      stream: false,
    }),
  });

  const rawText = await response.text();
  if (!response.ok) {
    const error = new Error(`vision_verify_failed:${response.status}:${rawText.slice(0, 240)}`);
    error.statusCode = response.status;
    throw error;
  }

  let parsed = null;
  try {
    const json = JSON.parse(rawText);
    parsed = extractJsonObject(
      json?.choices?.[0]?.message?.content
      || json?.output_text
      || rawText
    );
  } catch {
    parsed = extractJsonObject(rawText);
  }

  if (!parsed || typeof parsed !== 'object') {
    return {
      ok: false,
      skipped: true,
      reason: 'vision_parse_failed',
      raw: rawText.slice(0, 400),
    };
  }

  const observedSubjectCount = Math.max(0, Number(parsed.observed_subject_count || parsed.subject_count || 0) || 0);
  const duplicateSubjects = parsed.duplicate_subjects === true;
  const fusionDetected = parsed.fusion_detected === true;
  const subjectMatch = parsed.subject_match !== false;
  const confidence = Number(clamp01(parsed.confidence));
  const normalizedReason = String(parsed.reason || '').trim() || (
    fusionDetected ? 'fusion_detected' : (
      observedSubjectCount > Number(expected.subjectCount || 0)
        ? 'multiple_subjects_detected'
        : 'ok'
    )
  );

  const shouldRetry = expected.subjectCount === 1
    && confidence >= 0.55
    && (
      observedSubjectCount > 1
      || duplicateSubjects
      || fusionDetected
    );

  return {
    ok: true,
    expected: {
      subject_count: Number(expected.subjectCount || 0),
      subject_type: String(expected.subjectType || '').trim() || 'subject',
      subject_label: expectedLabel,
      allow_group: expected.allowGroup === true,
    },
    observed: {
      subject_count: observedSubjectCount,
      subject_label: String(parsed.observed_subject_label || parsed.subject_label || '').trim(),
      duplicate_subjects: duplicateSubjects,
      fusion_detected: fusionDetected,
      subject_match: subjectMatch,
      confidence,
    },
    decision: {
      retry: shouldRetry,
      reason: normalizedReason,
      notes: String(parsed.notes || '').trim(),
    },
    raw: parsed,
  };
}

function buildRetrySdBody(sdBody = {}, verification = {}, options = {}) {
  const expected = verification?.expected || {};
  const subjectLabel = String(expected.subject_label || expected.subject_type || 'subject').trim() || 'subject';
  const retryPromptHints = [
    `exactly one ${subjectLabel}`,
    `one ${subjectLabel} only`,
    'single isolated subject',
    'solo composition',
    'centered solo subject',
    'no second subject',
    'no duplicate body',
    'no duplicate face',
    'no twins',
    'no crowd',
  ];
  const retryNegativeHints = [
    `multiple ${subjectLabel}`,
    `extra ${subjectLabel}`,
    `duplicate ${subjectLabel}`,
    'second animal',
    'second object',
    'duplicate body',
    'duplicate face',
    'merged face',
    'fused body',
    'twins',
    'clones',
    'crowd',
    'group shot',
  ];

  const mergedPrompt = [
    String(sdBody.prompt || '').trim(),
    retryPromptHints.join(', '),
  ].filter(Boolean).join('. ').trim();

  const mergedNegativePrompt = [
    String(sdBody.negative_prompt || '').trim(),
    retryNegativeHints.join(', '),
  ].filter(Boolean).join(', ').trim();

  const currentSeed = Number(sdBody.seed);
  const retrySeedBase = Number.isFinite(currentSeed) ? currentSeed : Number(options.seed || Date.now());

  return {
    ...sdBody,
    prompt: mergedPrompt,
    negative_prompt: mergedNegativePrompt,
    prompt_prebuilt: true,
    negative_prompt_prebuilt: true,
    seed: retrySeedBase + 97,
  };
}

module.exports = {
  ANIMAL_SUBJECT_PATTERN,
  normalizeText,
  inferExpectedImageContract,
  resolveVisionConfig,
  verifyGeneratedImageCardinality,
  buildRetrySdBody,
};
