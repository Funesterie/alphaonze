const { callStructuredLlmJson } = require('../mask/resolve-text-to-wazaa.cjs');

const REQUEST_TEXT_SMOOTHER_SYSTEM_PROMPT = `Je suis un lisseur de requêtes utilisateur pour A11.
Je reçois :
- le texte original
- une version déjà lissée localement

Ma mission :
1. corriger seulement le bruit de surface évident
2. conserver exactement les mêmes sujets, actions, accessoires, décors, styles et contraintes
3. ne jamais traduire
4. ne jamais reformuler librement

Je réponds UNIQUEMENT en JSON strict :
{
  "corrected_text": "texte corrigé fidèle en français"
}`;

const REQUEST_LEXICON = {
  index: new Map(),
  byInitial: new Map(),
};

function normalizeText(value = '') {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractWordTokens(text = '') {
  return String(text || '').match(/[A-Za-zÀ-ÿ0-9]+(?:['’-][A-Za-zÀ-ÿ0-9]+)?/g) || [];
}

function applyFrenchContractions(text = '') {
  return String(text || '')
    .replace(/\bd\s+un\b/gi, "d'un")
    .replace(/\bd\s+une\b/gi, "d'une")
    .replace(/\bd\s+images?\b/gi, (match) => `d'${match.trim().slice(2)}`)
    .replace(/\bl\s+image\b/gi, "l'image")
    .replace(/\bc\s+est\b/gi, "c'est")
    .replace(/\bj\s+ai\b/gi, "j'ai")
    .replace(/\bj\s+aimerais\b/gi, "j'aimerais")
    .replace(/\bqu\s+il\b/gi, "qu'il")
    .replace(/\bqu\s+elle\b/gi, "qu'elle");
}

function normalizeFramingTypos(text = '') {
  return String(text || '')
    .replace(/\bplant\s+am[eé]ricain\b/gi, 'plan americain');
}

function normalizeSurfaceSpacing(text = '') {
  return applyFrenchContractions(
    normalizeFramingTypos(String(text || ''))
      .replace(/[’]/g, '\'')
      .replace(/\s+([,.;!?])/g, '$1')
      .replace(/([(\[{])\s+/g, '$1')
      .replace(/\s+([)\]}])/g, '$1')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

function detectMechanicalCorrections(originalText = '', normalizedText = '') {
  const corrections = [];
  const source = String(originalText || '');
  const normalized = String(normalizedText || '');

  if (/\bplant\s+am[eé]ricain\b/i.test(source) && /\bplan americain\b/i.test(normalized)) {
    corrections.push({ from: 'plant americain', to: 'plan americain' });
  }

  if (/[’]/.test(source) && !/[’]/.test(normalized)) {
    corrections.push({ from: '’', to: '\'' });
  }

  if (/\bd\s+un\b/i.test(source) && /\bd'un\b/i.test(normalized)) {
    corrections.push({ from: 'd un', to: "d'un" });
  }

  if (/\bd\s+une\b/i.test(source) && /\bd'une\b/i.test(normalized)) {
    corrections.push({ from: 'd une', to: "d'une" });
  }

  return corrections;
}

function getSuspiciousTokens() {
  return [];
}

function findBestLocalCorrection() {
  return null;
}

function normalizeSmootherResult(result = {}, fallbackText = '') {
  const originalText = normalizeText(result.originalText || fallbackText || '');
  const text = normalizeSurfaceSpacing(String(result.text || originalText || '').trim());
  const localCorrections = Array.isArray(result.localCorrections) ? result.localCorrections : [];
  const suspiciousTokens = Array.isArray(result.suspiciousTokens) ? result.suspiciousTokens : [];
  const noiseScore = Number.isFinite(Number(result.noiseScore)) ? Number(result.noiseScore) : 0;
  const changed = result.changed === true || (text && text !== originalText);
  return {
    originalText,
    text: text || originalText,
    changed,
    usedLlm: result.usedLlm === true,
    localCorrections,
    suspiciousTokens,
    noiseScore,
  };
}

function smoothRequestTextSync(text = '', _opts = {}) {
  const originalText = normalizeText(String(text || ''));
  if (!originalText) {
    return normalizeSmootherResult({
      originalText: '',
      text: '',
      changed: false,
      localCorrections: [],
      suspiciousTokens: [],
      noiseScore: 0,
    }, '');
  }

  const smoothedText = normalizeSurfaceSpacing(originalText);
  const localCorrections = detectMechanicalCorrections(originalText, smoothedText);
  const changed = smoothedText !== originalText;

  return normalizeSmootherResult({
    originalText,
    text: smoothedText,
    changed,
    usedLlm: false,
    localCorrections,
    suspiciousTokens: [],
    noiseScore: changed ? 1 : 0,
  }, originalText);
}

function shouldUseRequestTextSmootherLlm(_localResult = {}, opts = {}) {
  if (typeof opts.callStructuredLlmJson !== 'function') return false;
  if (opts.forceLlm === true) return true;
  if (opts.enableLlm === false) return false;

  const explicit = process.env.A11_REQUEST_TEXT_SMOOTHER_LLM;
  if (explicit === undefined || explicit === '') return false;
  return ['1', 'true', 'yes', 'on'].includes(String(explicit).trim().toLowerCase());
}

function looksSafeLlmCorrection(baseText = '', correctedText = '') {
  const base = normalizeSurfaceSpacing(baseText);
  const corrected = normalizeSurfaceSpacing(correctedText);
  if (!base || !corrected) return false;
  if (corrected.length > (base.length * 1.8) + 30) return false;
  if (/https?:\/\//i.test(corrected)) return false;

  const baseWords = extractWordTokens(base)
    .map((entry) => normalizeText(entry).toLowerCase())
    .filter((entry) => entry.length >= 3);
  const correctedWords = extractWordTokens(corrected)
    .map((entry) => normalizeText(entry).toLowerCase())
    .filter((entry) => entry.length >= 3);
  if (!correctedWords.length) return false;

  const baseSet = new Set(baseWords);
  const shared = correctedWords.filter((entry) => baseSet.has(entry)).length;
  return shared >= Math.max(1, Math.floor(correctedWords.length * 0.4));
}

function extractLlmCorrectedText(payload = null) {
  if (!payload || typeof payload !== 'object') return '';
  return normalizeSurfaceSpacing(String(payload.corrected_text || payload.correctedText || '').trim());
}

async function smoothRequestText(text = '', opts = {}) {
  const localResult = smoothRequestTextSync(text, opts);
  const callStructuredLlmJsonImpl = opts.callStructuredLlmJson || callStructuredLlmJson;

  if (!shouldUseRequestTextSmootherLlm(localResult, {
    ...opts,
    callStructuredLlmJson: callStructuredLlmJsonImpl,
  })) {
    return localResult;
  }

  try {
    const llmPayload = await callStructuredLlmJsonImpl({
      text: [
        `Texte original : ${localResult.originalText}`,
        `Version locale : ${localResult.text}`,
      ].join('\n'),
      systemPrompt: REQUEST_TEXT_SMOOTHER_SYSTEM_PROMPT,
      temperature: 0,
      maxTokens: 180,
      timeoutMs: Number(process.env.A11_REQUEST_TEXT_SMOOTHER_TIMEOUT_MS || 5000),
    });
    const correctedText = extractLlmCorrectedText(llmPayload);
    if (!correctedText) return localResult;
    if (!looksSafeLlmCorrection(localResult.text, correctedText)) return localResult;

    return normalizeSmootherResult({
      ...localResult,
      text: correctedText,
      changed: correctedText !== localResult.originalText,
      usedLlm: true,
      suspiciousTokens: getSuspiciousTokens(correctedText),
    }, localResult.originalText);
  } catch {
    return localResult;
  }
}

function attachRequestTextSmootherMeta(target = null, smootherResult = null) {
  if (!target || typeof target !== 'object') return target;
  const normalized = normalizeSmootherResult(smootherResult || {}, target?.meta?.sourceText || '');
  return {
    ...target,
    meta: {
      ...(target?.meta && typeof target.meta === 'object' ? target.meta : {}),
      sourceText: normalized.text || target?.meta?.sourceText || '',
      originalSourceText: normalized.originalText || target?.meta?.originalSourceText || '',
      requestTextSmoother: {
        applied: normalized.changed,
        usedLlm: normalized.usedLlm,
        smoothedText: normalized.text,
        correctionCount: normalized.localCorrections.length,
        localCorrections: normalized.localCorrections.slice(0, 8),
        suspiciousTokens: normalized.suspiciousTokens.slice(0, 6),
        noiseScore: normalized.noiseScore,
      },
    },
  };
}

module.exports = {
  REQUEST_LEXICON,
  REQUEST_TEXT_SMOOTHER_SYSTEM_PROMPT,
  attachRequestTextSmootherMeta,
  findBestLocalCorrection,
  normalizeSmootherResult,
  shouldUseRequestTextSmootherLlm,
  smoothRequestText,
  smoothRequestTextSync,
};
