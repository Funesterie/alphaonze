const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const {
  callJanusVisionText,
  resolveJanusVisionConfig,
  resolveVisionProvider,
} = require('../../lib/janus-vision-runtime.cjs');

const ALLOWED_REASONS = new Set([
  'ok',
  'duplicate_subject',
  'scene_too_busy',
  'object_not_isolated',
  'character_not_unique',
  'subject_not_fully_visible',
  'profile_not_satisfied',
  'subject_mismatch',
  'uncertain',
]);

const IMAGE_LLM_JUDGE_SYSTEM_PROMPT = `You are a strict vision judge for A11.
You look at a generated image and verify if it matches the main subject and provided hints.

Respond only in strict JSON:
{
  "subject_ok": true,
  "composition_ok": true,
  "reason": "ok",
  "confidence": 0.0,
  "working_hints": ["..."],
  "failing_hints": ["..."],
  "observation": "..."
}

Strict rules:
- English only
- "reason" must be one of: ok, duplicate_subject, scene_too_busy, object_not_isolated, character_not_unique, subject_not_fully_visible, profile_not_satisfied, subject_mismatch, uncertain
- "working_hints" and "failing_hints" must reuse only formulations already present in candidate hints
- maximum 3 entries per array
- no invention, no added negation, no new subject`;

function normalizeText(value = '') {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function toUniqueStrings(values = []) {
  return [...new Set(
    (Array.isArray(values) ? values : [values])
      .map((entry) => normalizeText(entry))
      .filter(Boolean)
  )];
}

function clamp01(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(1, numeric));
}

function normalizeLookup(value = '') {
  return normalizeText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, ' ')
    .toLowerCase();
}

function buildOpenAiCompatibleUrl(baseUrl = '') {
  const normalizedBase = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!normalizedBase) return '';
  return normalizedBase.endsWith('/v1')
    ? `${normalizedBase}/chat/completions`
    : `${normalizedBase}/v1/chat/completions`;
}

function resolveExplicitRemoteVisionConfig(overrides = {}) {
  const baseUrl = String(
    overrides.baseUrl
    || process.env.A11_VISION_BASE_URL
    || ''
  ).trim();
  const apiKey = String(
    overrides.apiKey
    || process.env.A11_VISION_API_KEY
    || ''
  ).trim();
  const model = String(
    overrides.model
    || process.env.A11_VISION_MODEL
    || process.env.OPENAI_VISION_MODEL
    || 'gpt-4o-mini'
  ).trim();
  return {
    baseUrl,
    apiKey,
    model,
  };
}

function resolveVisionJudgeConfig(overrides = {}) {
  const provider = resolveVisionProvider({ provider: overrides.provider });
  const remote = resolveExplicitRemoteVisionConfig(overrides);

  return {
    provider,
    baseUrl: remote.baseUrl,
    url: (remote.baseUrl && remote.apiKey) ? buildOpenAiCompatibleUrl(remote.baseUrl) : '',
    apiKey: remote.apiKey,
    model: remote.model,
    janus: resolveJanusVisionConfig({
      modelRef: overrides.janusModelRef,
      device: overrides.janusDevice,
      torchDtype: overrides.janusTorchDtype,
      timeoutMs: overrides.timeoutMs,
      maxNewTokens: overrides.maxTokens,
    }),
    timeoutMs: Math.max(1000, Number(overrides.timeoutMs || process.env.A11_IMAGE_LLM_JUDGE_TIMEOUT_MS || 9000) || 9000),
    maxTokens: Math.max(160, Number(overrides.maxTokens || process.env.A11_IMAGE_LLM_JUDGE_MAX_TOKENS || 320) || 320),
  };
}

function isImageLlmJudgeEnabled(explicitValue) {
  if (typeof explicitValue === 'boolean') return explicitValue;
  const envValue = process.env.A11_IMAGE_LLM_JUDGE;
  if (envValue !== undefined && envValue !== '') {
    return ['1', 'true', 'yes', 'on'].includes(String(envValue).trim().toLowerCase());
  }
  return true;
}

function resolveImageLlmJudgeSampleRate(env = process.env) {
  const raw = Number(env.A11_IMAGE_LLM_JUDGE_SAMPLE_RATE);
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  return Math.min(1, raw);
}

function shouldSampleImageLlmJudge(env = process.env) {
  const rate = resolveImageLlmJudgeSampleRate(env);
  return rate >= 1 || Math.random() < rate;
}

function guessContentTypeFromPath(filePath = '') {
  switch (path.extname(String(filePath || '')).toLowerCase()) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    case '.bmp':
      return 'image/bmp';
    case '.svg':
      return 'image/svg+xml';
    case '.png':
    default:
      return 'image/png';
  }
}

async function loadImageAsDataUrl(imageRef = '') {
  const loaded = await loadImageSource(imageRef);
  return loaded?.dataUrl || null;
}

async function loadImageSource(imageRef = '') {
  const source = String(imageRef || '').trim();
  if (!source) return null;
  if (/^data:/i.test(source)) {
    const match = source.match(/^data:([^;,]+)?(?:;base64)?,(.*)$/i);
    const contentType = String(match?.[1] || 'image/png').trim() || 'image/png';
    const encoded = String(match?.[2] || '').trim();
    if (!encoded) return null;
    return {
      buffer: Buffer.from(encoded, 'base64'),
      contentType,
      dataUrl: source,
    };
  }

  if (/^https?:\/\//i.test(source)) {
    const response = await fetch(source);
    if (!response.ok) {
      throw new Error(`vision_image_fetch_failed:${response.status}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    const contentType = String(response.headers.get('content-type') || 'image/png').split(';')[0].trim() || 'image/png';
    return {
      buffer,
      contentType,
      dataUrl: `data:${contentType};base64,${buffer.toString('base64')}`,
    };
  }

  const resolvedPath = path.resolve(source);
  const buffer = await fsp.readFile(resolvedPath);
  const contentType = guessContentTypeFromPath(resolvedPath);
  return {
    buffer,
    contentType,
    dataUrl: `data:${contentType};base64,${buffer.toString('base64')}`,
  };
}

function buildCandidateHintBundle(mask = {}) {
  return {
    composition_hints: toUniqueStrings(mask?.inputs?.composition || []).slice(0, 6),
    environment_hints: toUniqueStrings(mask?.inputs?.environment || []).slice(0, 6),
    style_hints: toUniqueStrings(mask?.inputs?.style || []).slice(0, 6),
    prompt_instructions: toUniqueStrings(mask?.meta?.promptInstructions || []).slice(0, 6),
  };
}

function buildVisionJudgePayload({
  imageUrl = '',
  mask = {},
  prompt = '',
  requestId = '',
  seed,
} = {}) {
  const subject = toUniqueStrings(mask?.inputs?.subject || []).slice(0, 3);
  const profileType = normalizeText(mask?.meta?.subjectProfile?.type || '');
  const semantic = mask?.meta?.semantic && typeof mask.meta.semantic === 'object'
    ? mask.meta.semantic
    : {};

  return {
    request_id: normalizeText(requestId),
    image_url: normalizeText(imageUrl),
    demande: normalizeText(mask?.raw || ''),
    prompt_final: normalizeText(prompt),
    seed: seed ?? null,
    sujet_principal: subject,
    profil_sujet: profileType,
    semantic_families: {
      accessories: toUniqueStrings((semantic?.accessories || []).map((entry) => entry?.label || entry?.key || entry)).slice(0, 5),
      elements: toUniqueStrings((semantic?.elements || []).map((entry) => entry?.label || entry?.key || entry)).slice(0, 5),
      metiers: toUniqueStrings((semantic?.metiers || []).map((entry) => entry?.label || entry?.key || entry)).slice(0, 5),
      scenes: toUniqueStrings((semantic?.scenes || []).map((entry) => entry?.label || entry?.key || entry)).slice(0, 5),
    },
    hints_candidats: buildCandidateHintBundle(mask),
  };
}

function extractJsonString(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const fenced = raw.match(/```(?:json)?\s*([\s\S]+?)\s*```/i);
  return fenced ? String(fenced[1] || '').trim() : raw;
}

function buildJanusJudgePrompt(systemPrompt = IMAGE_LLM_JUDGE_SYSTEM_PROMPT, payload = {}) {
  return [
    String(systemPrompt || IMAGE_LLM_JUDGE_SYSTEM_PROMPT).trim(),
    'Contexte JSON a juger :',
    JSON.stringify(payload, null, 2),
    'Reponds uniquement avec le JSON final, sans phrase autour.',
  ].join('\n\n').trim();
}

async function callStructuredVisionJudgeJson({
  imageUrl = '',
  payload = {},
  systemPrompt = IMAGE_LLM_JUDGE_SYSTEM_PROMPT,
  baseUrl,
  apiKey,
  model,
  timeoutMs,
  maxTokens,
  provider,
  callLocalVisionText,
} = {}) {
  const config = resolveVisionJudgeConfig({
    baseUrl,
    apiKey,
    model,
    timeoutMs,
    maxTokens,
    provider,
  });
  const loadedImage = await loadImageSource(imageUrl);
  if (!loadedImage?.buffer?.length) return null;

  if (config.provider === 'janus') {
    try {
      const rawLocal = typeof callLocalVisionText === 'function'
        ? await callLocalVisionText({
          imageBuffer: loadedImage.buffer,
          contentType: loadedImage.contentType,
          prompt: buildJanusJudgePrompt(systemPrompt, payload),
          maxNewTokens: config.janus.maxNewTokens,
          timeoutMs: config.janus.timeoutMs,
        })
        : await callJanusVisionText({
          imageBuffer: loadedImage.buffer,
          contentType: loadedImage.contentType,
          prompt: buildJanusJudgePrompt(systemPrompt, payload),
          maxNewTokens: config.janus.maxNewTokens,
          timeoutMs: config.janus.timeoutMs,
          modelRef: config.janus.modelRef,
          device: config.janus.device,
          torchDtype: config.janus.torchDtype,
        });
      const localText = typeof rawLocal === 'string'
        ? rawLocal
        : String(rawLocal?.text || '').trim();
      const jsonText = extractJsonString(localText);
      if (jsonText) {
        return JSON.parse(jsonText);
      }
      if (!config.url) return null;
    } catch (error_) {
      if (!config.url) throw error_;
    }
  }

  // Provider ollama multimodal (gemma4, llava, etc.)
  if (config.provider === 'ollama' || (!config.provider && !config.url)) {
    const ollamaBase = String(process.env.OLLAMA_BASE || 'http://127.0.0.1:11434').trim();
    const ollamaModel = String(process.env.A11_OLLAMA_PRIMARY_MODEL || 'gemma4:e4b').trim();
    const imageBase64 = loadedImage.buffer.toString('base64');
    try {
      const resp = await fetch(`${ollamaBase}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: ollamaModel,
          stream: false,
          messages: [
            { role: 'system', content: systemPrompt },
            {
              role: 'user',
              content: JSON.stringify(payload, null, 2),
              images: [imageBase64],
            },
          ],
        }),
        signal: AbortSignal.timeout(config.timeoutMs),
      });
      if (!resp.ok) return null;
      const data = await resp.json();
      const text = String(data?.message?.content || '').trim();
      const jsonText = extractJsonString(text);
      if (jsonText) return JSON.parse(jsonText);
    } catch {
      return null;
    }
    return null;
  }

  if (!config.url || !config.model) return null;

  const dataUrl = loadedImage.dataUrl || await loadImageAsDataUrl(imageUrl);
  if (!dataUrl) return null;

  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timeout = controller ? setTimeout(() => controller.abort(), config.timeoutMs) : null;

  const headers = {
    'Content-Type': 'application/json',
  };
  if (config.apiKey) {
    headers.Authorization = `Bearer ${config.apiKey}`;
  }

  try {
    const response = await fetch(config.url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: config.model,
        temperature: 0,
        max_tokens: config.maxTokens,
        stream: false,
        messages: [
          {
            role: 'system',
            content: systemPrompt,
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: JSON.stringify(payload, null, 2) },
              { type: 'image_url', image_url: { url: dataUrl } },
            ],
          },
        ],
      }),
      ...(controller ? { signal: controller.signal } : {}),
    });

    const rawText = await response.text();
    if (!response.ok) {
      throw new Error(`vision_llm_http_${response.status}:${rawText.slice(0, 220)}`);
    }

    let parsed = null;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      parsed = null;
    }
    const content = parsed?.choices?.[0]?.message?.content || parsed?.output_text || rawText;
    const jsonText = extractJsonString(content);
    if (!jsonText) return null;
    return JSON.parse(jsonText);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function normalizeCandidateHintList(values = [], allowedLookup = new Map()) {
  const accepted = [];
  for (const entry of (Array.isArray(values) ? values : [values])) {
    const lookup = normalizeLookup(entry);
    if (!lookup || !allowedLookup.has(lookup)) continue;
    accepted.push(allowedLookup.get(lookup));
  }
  return toUniqueStrings(accepted).slice(0, 3);
}

function normalizeVisionJudgeResult(rawResult = {}, candidateHints = {}) {
  const allCandidates = [
    ...(candidateHints?.composition_hints || []),
    ...(candidateHints?.environment_hints || []),
    ...(candidateHints?.style_hints || []),
    ...(candidateHints?.prompt_instructions || []),
  ];
  const allowedLookup = new Map(
    allCandidates.map((entry) => [normalizeLookup(entry), normalizeText(entry)])
  );

  const reason = normalizeText(rawResult?.reason || '').toLowerCase();
  const normalizedReason = ALLOWED_REASONS.has(reason) ? reason : 'uncertain';
  const subjectOk = rawResult?.subject_ok === true;
  const compositionOk = rawResult?.composition_ok === true;

  return {
    subject_ok: subjectOk,
    composition_ok: compositionOk,
    reason: normalizedReason,
    confidence: clamp01(rawResult?.confidence),
    working_hints: normalizeCandidateHintList(rawResult?.working_hints || rawResult?.workingHints || [], allowedLookup),
    failing_hints: normalizeCandidateHintList(rawResult?.failing_hints || rawResult?.failingHints || [], allowedLookup),
    observation: normalizeText(rawResult?.observation || ''),
  };
}

async function verifyGeneratedImageWithLlmJudge({
  imageUrl = '',
  mask = {},
  requestId = '',
  prompt = '',
  seed,
  enabled,
  callStructuredVisionJson,
  callLocalVisionText,
  visionProvider,
} = {}) {
  if (!isImageLlmJudgeEnabled(enabled)) {
    return { ok: false, skipped: true, reason: 'vision_llm_disabled' };
  }

  if (!shouldSampleImageLlmJudge()) {
    return { ok: false, skipped: true, reason: 'vision_llm_sampled_out' };
  }

  const normalizedImageUrl = normalizeText(imageUrl);
  if (!normalizedImageUrl) {
    return {
      ok: false,
      skipped: true,
      reason: 'missing_image_url',
    };
  }

  const candidateHints = buildCandidateHintBundle(mask);
  const payload = buildVisionJudgePayload({
    imageUrl: normalizedImageUrl,
    mask,
    prompt,
    requestId,
    seed,
  });

  let rawResult = null;
  try {
    rawResult = typeof callStructuredVisionJson === 'function'
      ? await callStructuredVisionJson({
        imageUrl: normalizedImageUrl,
        payload,
        systemPrompt: IMAGE_LLM_JUDGE_SYSTEM_PROMPT,
      })
      : await callStructuredVisionJudgeJson({
        imageUrl: normalizedImageUrl,
        payload,
        callLocalVisionText,
        provider: visionProvider,
      });
  } catch (error_) {
    return {
      ok: false,
      skipped: true,
      reason: 'vision_llm_failed',
      message: String(error_?.message || error_),
    };
  }

  if (!rawResult || typeof rawResult !== 'object') {
    return {
      ok: false,
      skipped: true,
      reason: 'vision_llm_unavailable',
    };
  }

  const normalized = normalizeVisionJudgeResult(rawResult, candidateHints);
  return {
    ok: true,
    available: true,
    candidateHints,
    decision: {
      accepted: normalized.subject_ok === true && normalized.composition_ok === true,
      subject_ok: normalized.subject_ok,
      composition_ok: normalized.composition_ok,
      reason: normalized.reason,
      confidence: normalized.confidence,
      observation: normalized.observation,
    },
    workingHints: {
      composition_hints: normalized.working_hints.filter((entry) => candidateHints.composition_hints.includes(entry)),
      environment_hints: normalized.working_hints.filter((entry) => candidateHints.environment_hints.includes(entry)),
      style_hints: normalized.working_hints.filter((entry) => candidateHints.style_hints.includes(entry)),
      prompt_instructions: normalized.working_hints.filter((entry) => candidateHints.prompt_instructions.includes(entry)),
    },
    failingHints: {
      composition_hints: normalized.failing_hints.filter((entry) => candidateHints.composition_hints.includes(entry)),
      environment_hints: normalized.failing_hints.filter((entry) => candidateHints.environment_hints.includes(entry)),
      style_hints: normalized.failing_hints.filter((entry) => candidateHints.style_hints.includes(entry)),
      prompt_instructions: normalized.failing_hints.filter((entry) => candidateHints.prompt_instructions.includes(entry)),
    },
    observation: normalized.observation,
  };
}

module.exports = {
  IMAGE_LLM_JUDGE_SYSTEM_PROMPT,
  buildCandidateHintBundle,
  buildJanusJudgePrompt,
  buildVisionJudgePayload,
  callStructuredVisionJudgeJson,
  isImageLlmJudgeEnabled,
  resolveImageLlmJudgeSampleRate,
  shouldSampleImageLlmJudge,
  normalizeVisionJudgeResult,
  resolveVisionJudgeConfig,
  verifyGeneratedImageWithLlmJudge,
};
