// image-auto-describe.cjs
// Quand l'utilisateur envoie une image sans texte, Janus l'analyse
// et produit une description qui sert de message utilisateur pour
// le reste du pipeline (intent detection + génération).

'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { callJanusVisionText, resolveVisionProvider } = require('../../lib/janus-vision-runtime.cjs');

// ─── Prompt de description libre ─────────────────────────────────────────────
// On demande à Janus de décrire l'image de façon concise et visuelle,
// comme si on voulait la recréer ou la transformer.
const AUTO_DESCRIBE_PROMPT = [
  'Describe this image in two to four concise English sentences for use as a visual generation prompt.',
  'Cover ALL of the following in order:',
  '1. SUBJECT — who or what is the main subject, their approximate position in frame (center/left/right/foreground/background), and rough proportions.',
  '2. COLORS — dominant colors and color palette (be precise: "deep burgundy", "muted olive green", not just "red" or "green").',
  '3. SPATIAL LAYOUT — where objects/people are positioned relative to each other (left of, above, behind, overlapping).',
  '4. KEY DETAILS — materials, textures, finishes of important props or clothing ("polished gold metal", "rough linen fabric", "glossy acrylic").',
  '5. LIGHTING & MOOD — light direction, quality, and emotional tone.',
  '6. STYLE — visual rendering style (photorealistic, painterly, anime, etc.).',
  'Be specific and physical. Do not say "the image shows" — describe directly as if guiding an artist.',
  'Example: "A young woman occupying the center two-thirds of the frame, long deep-auburn hair falling past her shoulders. She wears a matte black leather jacket with silver zipper pulls on the left chest. Soft diffused golden light from the upper-left. Misty forest background, blurred. Painterly, slightly desaturated."',
].join(' ');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isRemoteUrl(value = '') {
  return /^https?:\/\//i.test(String(value || '').trim());
}

function isDataUrl(value = '') {
  return /^data:/i.test(String(value || '').trim());
}

function guessContentType(locator = '') {
  const low = String(locator || '').trim().toLowerCase();
  if (low.endsWith('.jpg') || low.endsWith('.jpeg')) return 'image/jpeg';
  if (low.endsWith('.webp')) return 'image/webp';
  if (low.endsWith('.gif')) return 'image/gif';
  if (low.endsWith('.bmp')) return 'image/bmp';
  return 'image/png';
}

function decodeUrlPathname(pathname = '') {
  try {
    return decodeURIComponent(String(pathname || '').trim());
  } catch (_) {
    return String(pathname || '').trim();
  }
}

function safeResolveUnder(root = '', ...parts) {
  const normalizedRoot = path.resolve(String(root || '').trim());
  const resolved = path.resolve(normalizedRoot, ...parts.filter(Boolean));
  if (resolved === normalizedRoot || resolved.startsWith(`${normalizedRoot}${path.sep}`)) {
    return resolved;
  }
  return '';
}

function isKnownPublicAssetHost(hostname = '') {
  const host = String(hostname || '').trim().toLowerCase();
  if (!host) return false;
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true;
  if (host === 'funesterie.me' || host.endsWith('.funesterie.me')) return true;

  const configuredOrigins = [
    process.env.PUBLIC_API_BASE_URL,
    process.env.A11_PUBLIC_API_BASE_URL,
    process.env.A11_PUBLIC_ORIGIN,
    process.env.PUBLIC_ORIGIN,
    process.env.A11_BASE_URL,
  ];
  for (const origin of configuredOrigins) {
    try {
      const configuredHost = new URL(String(origin || '').trim()).hostname.toLowerCase();
      if (configuredHost && host === configuredHost) return true;
    } catch (_) {
      // ignore non-URL env values
    }
  }
  return false;
}

function resolveRuntimeImagePathFromLocator(locator = '', runtimeRoot = '') {
  const root = String(runtimeRoot || '').trim();
  if (!root) return '';

  const raw = String(locator || '').trim();
  let pathname = raw;
  if (isRemoteUrl(raw)) {
    try {
      const parsed = new URL(raw);
      if (!isKnownPublicAssetHost(parsed.hostname)) return '';
      pathname = parsed.pathname;
    } catch (_) {
      return '';
    }
  }

  const cleanPathname = decodeUrlPathname(String(pathname || '').split('?')[0].split('#')[0]);
  if (cleanPathname.startsWith('/files/runtime/')) {
    const relative = cleanPathname.replace(/^\/files\/runtime\//, '');
    return safeResolveUnder(root, relative);
  }
  if (cleanPathname.startsWith('/files/uploads/')) {
    const relativeUpload = cleanPathname.replace(/^\/files\/uploads\//, '');
    return safeResolveUnder(root, 'files', 'uploads', relativeUpload);
  }
  return '';
}

function buildImageMetadataSentence(analysis = {}) {
  const details = [];
  if (analysis.width && analysis.height) details.push(`${analysis.width}x${analysis.height}px`);
  if (analysis.format) details.push(`format ${analysis.format}`);
  if (analysis.originalBytes) details.push(`${Math.round(Number(analysis.originalBytes) / 1024)} Ko`);
  return details.length ? details.join(', ') : 'image recue';
}

function buildLocalVisionFallbackText({ metadata = '', preview = '', reason = '' } = {}) {
  const parts = [
    `Vision avancee indisponible; lecture locale de secours uniquement: ${String(metadata || 'image recue').trim()}.`,
  ];
  const ocr = String(preview || '').trim();
  if (ocr) {
    parts.push(`OCR texte lisible: ${ocr}`);
  } else {
    parts.push(`Aucune description visuelle fiable n'a ete produite (${String(reason || 'vision_indisponible')}).`);
  }
  parts.push("Ne deduis pas le sujet visuel de ce fallback.");
  return parts.join(' ');
}

function resolveRemoteVisionConfig(options = {}, env = process.env) {
  return resolveRemoteVisionConfigs(options, env)[0] || {
    baseUrl: '',
    apiKey: '',
    model: '',
    timeoutMs: Math.max(3_000, Math.min(60_000, Number(options.timeoutMs || env.A11_REMOTE_VISION_TIMEOUT_MS || 25_000) || 25_000)),
    available: false,
    label: 'remote-vision',
  };
}

function makeRemoteVisionCandidate({
  label = 'remote-vision',
  baseUrl = '',
  apiKey = '',
  model = '',
  timeoutMs = 25_000,
} = {}) {
  return {
    label: String(label || 'remote-vision').trim() || 'remote-vision',
    baseUrl: String(baseUrl || '').trim(),
    apiKey: String(apiKey || '').trim(),
    model: String(model || '').trim(),
    timeoutMs: Math.max(3_000, Math.min(60_000, Number(timeoutMs) || 25_000)),
    available: Boolean(apiKey && baseUrl && model),
  };
}

function resolveRemoteVisionConfigs(options = {}, env = process.env) {
  const timeoutMs = Math.max(
    3_000,
    Math.min(60_000, Number(options.timeoutMs || env.A11_REMOTE_VISION_TIMEOUT_MS || 25_000) || 25_000)
  );
  const candidates = [];

  const explicitBaseUrl = String(options.baseUrl || env.A11_VISION_BASE_URL || '').trim();
  const explicitModel = String(options.model || env.A11_VISION_MODEL || '').trim();
  const explicitApiKey = String(options.apiKey || env.A11_VISION_API_KEY || '').trim();
  if (explicitBaseUrl || explicitModel || explicitApiKey) {
    const baseUrl = explicitBaseUrl || 'https://api.openai.com/v1';
    const baseLower = baseUrl.toLowerCase();
    candidates.push(makeRemoteVisionCandidate({
      label: 'remote-vision',
      baseUrl,
      apiKey: explicitApiKey
        || (baseLower.includes('groq') ? env.GROQ_API_KEY : '')
        || (baseLower.includes('openrouter') ? env.OPENROUTER_API_KEY : '')
        || env.VIVY_OPENAI_API_KEY
        || env.A11_OPENAI_API_KEY
        || env.OPENAI_API_KEY
        || env.GEMINI_API_KEY
        || '',
      model: explicitModel
        || (baseLower.includes('groq') ? (env.GROQ_VISION_MODEL || 'meta-llama/llama-4-scout-17b-16e-instruct') : '')
        || (baseLower.includes('openrouter') ? (env.OPENROUTER_VISION_MODEL || 'google/gemini-2.5-flash') : '')
        || (baseLower.includes('googleapis') ? (env.GEMINI_VISION_MODEL || 'gemini-2.5-flash') : '')
        || env.OPENAI_VISION_MODEL
        || 'gpt-4o-mini',
      timeoutMs,
    }));
  }

  if (env.GROQ_API_KEY) {
    candidates.push(makeRemoteVisionCandidate({
      label: 'groq-vision',
      baseUrl: 'https://api.groq.com/openai/v1',
      apiKey: env.GROQ_API_KEY,
      model: env.GROQ_VISION_MODEL || 'meta-llama/llama-4-scout-17b-16e-instruct',
      timeoutMs,
    }));
  }

  if (env.VIVY_OPENAI_API_KEY || env.A11_OPENAI_API_KEY || env.OPENAI_API_KEY) {
    candidates.push(makeRemoteVisionCandidate({
      label: 'openai-vision',
      baseUrl: env.VIVY_OPENAI_BASE_URL || env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
      apiKey: env.VIVY_OPENAI_API_KEY || env.A11_OPENAI_API_KEY || env.OPENAI_API_KEY,
      model: env.VIVY_VISION_MODEL || env.OPENAI_VISION_MODEL || 'gpt-4o-mini',
      timeoutMs,
    }));
  }

  if (env.GEMINI_API_KEY) {
    candidates.push(makeRemoteVisionCandidate({
      label: 'gemini-vision',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      apiKey: env.GEMINI_API_KEY,
      model: env.GEMINI_VISION_MODEL || 'gemini-2.5-flash',
      timeoutMs,
    }));
  }

  if (env.OPENROUTER_API_KEY) {
    candidates.push(makeRemoteVisionCandidate({
      label: 'openrouter-vision',
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: env.OPENROUTER_API_KEY,
      model: env.OPENROUTER_VISION_MODEL || 'google/gemini-2.5-flash',
      timeoutMs,
    }));
  }

  const seen = new Set();
  return candidates.filter((candidate) => {
    if (!candidate.available) return false;
    const key = `${candidate.label}\n${candidate.baseUrl}\n${candidate.model}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function remoteVisionProviderLabel(config = {}) {
  const label = String(config.label || 'remote-vision').trim() || 'remote-vision';
  const model = String(config.model || '').trim();
  if (label === 'remote-vision') return `remote-vision:${model}`;
  return `${label}:${model}`;
}

async function fetchRemoteVisionDescription({
  buffer,
  contentType = 'image/png',
  prompt = AUTO_DESCRIBE_PROMPT,
  config,
} = {}) {
  if (!Buffer.isBuffer(buffer) || !buffer.length || !config?.available) return null;
  const url = buildRemoteVisionUrl(config.baseUrl);
  if (!url) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          {
            role: 'system',
            content: "Tu es le module vision d'A11. Réponds en français, décris seulement ce qui est visible, sans détails techniques internes.",
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: String(prompt || AUTO_DESCRIBE_PROMPT).trim() || AUTO_DESCRIBE_PROMPT },
              {
                type: 'image_url',
                image_url: {
                  url: `data:${String(contentType || 'image/png').trim() || 'image/png'};base64,${buffer.toString('base64')}`,
                },
              },
            ],
          },
        ],
        temperature: 0.2,
        max_tokens: 500,
        stream: false,
      }),
    });

    const rawText = await response.text();
    if (!response.ok) {
      throw new Error(`remote_vision_failed:${response.status}`);
    }

    let parsed = null;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      parsed = null;
    }
    const text = parsed
      ? extractRemoteVisionText(parsed?.choices?.[0]?.message?.content || parsed?.output_text || parsed?.text)
      : rawText.trim();
    if (!text) return null;
    return {
      description: text,
      provider: remoteVisionProviderLabel(config),
      skipped: false,
      fallback: false,
      visualReliable: true,
    };
  } finally {
    clearTimeout(timer);
  }
}

function buildRemoteVisionUrl(baseUrl = '') {
  const normalizedBase = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!normalizedBase) return '';
  return normalizedBase.endsWith('/v1')
    ? `${normalizedBase}/chat/completions`
    : `${normalizedBase}/v1/chat/completions`;
}

function extractRemoteVisionText(value) {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) {
    return value.map(extractRemoteVisionText).filter(Boolean).join('\n').trim();
  }
  if (value && typeof value === 'object') {
    return String(
      value.text
      || value.content
      || value.output_text
      || ''
    ).trim();
  }
  return '';
}

async function describeImageWithRemoteVision({
  buffer,
  contentType = 'image/png',
  prompt = AUTO_DESCRIBE_PROMPT,
  timeoutMs,
  config = null,
  configs = null,
} = {}) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) return null;
  const candidates = Array.isArray(configs) && configs.length
    ? configs
    : (config ? [config] : resolveRemoteVisionConfigs({ timeoutMs }));
  let lastError = null;
  for (const candidate of candidates) {
    if (!candidate?.available) continue;
    try {
      const result = await fetchRemoteVisionDescription({
        buffer,
        contentType,
        prompt,
        config: candidate,
      });
      if (result?.description) return result;
    } catch (error) {
      lastError = error;
      console.warn(`[A11][auto-describe] ${candidate.label || 'remote-vision'} failed: ${String(error?.message || error)}`);
    }
  }
  if (lastError) throw lastError;
  return null;
}

async function buildLocalImageFallbackDescription({ buffer, contentType, reason }) {
  try {
    const { analyzeUploadedResource } = require('../../lib/resource-reader.cjs');
    const analysis = await analyzeUploadedResource({
      filename: `image-${Date.now()}.${String(contentType || '').includes('jpeg') ? 'jpg' : 'png'}`,
      contentType: contentType || 'image/png',
      buffer,
    });
    const metadata = buildImageMetadataSentence(analysis);
    const preview = String(analysis?.preview || '').trim();
    return {
      description: buildLocalVisionFallbackText({ metadata, preview, reason }),
      analysis,
    };
  } catch (fallbackError) {
    return {
      description: buildLocalVisionFallbackText({
        metadata: 'image recue',
        reason: String(reason || fallbackError?.message || 'vision_indisponible'),
      }),
      analysis: null,
    };
  }
}

/**
 * Charge le buffer d'une image depuis une URL locale, distante ou data-URL.
 * Timeout court (3 s) pour ne pas bloquer le pipeline.
 */
async function loadImageBuffer(locator = '', runtimeRoot = '') {
  const raw = String(locator || '').trim();
  if (!raw) throw new Error('auto_describe_missing_locator');

  // data-URL
  if (isDataUrl(raw)) {
    const match = raw.match(/^data:([^;,]+)?;base64,(.+)$/i);
    if (!match) throw new Error('auto_describe_invalid_data_url');
    return {
      buffer: Buffer.from(match[2], 'base64'),
      contentType: String(match[1] || 'image/png').trim() || 'image/png',
    };
  }

  const runtimeImagePath = resolveRuntimeImagePathFromLocator(raw, runtimeRoot);
  if (runtimeImagePath) {
    if (!fs.existsSync(runtimeImagePath)) {
      throw new Error(`auto_describe_file_not_found:${runtimeImagePath}`);
    }
    return {
      buffer: fs.readFileSync(runtimeImagePath),
      contentType: guessContentType(runtimeImagePath),
    };
  }

  // URL distante
  if (isRemoteUrl(raw)) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const res = await fetch(raw, { signal: controller.signal, headers: { Accept: 'image/*' } });
      if (!res.ok) throw new Error(`auto_describe_fetch_failed:${res.status}`);
      return {
        buffer: Buffer.from(await res.arrayBuffer()),
        contentType: String(res.headers.get('content-type') || guessContentType(raw)).trim() || guessContentType(raw),
      };
    } finally {
      clearTimeout(timer);
    }
  }

  // Chemin local — peut être relatif à runtimeRoot ou absolu
  let resolved = raw;
  if (!path.isAbsolute(raw) && runtimeRoot) {
    resolved = path.join(runtimeRoot, raw);
  }

  // Chemin de la forme /files/runtime/... → résoudre depuis runtimeRoot
  if (raw.startsWith('/files/runtime/') && runtimeRoot) {
    const relative = raw.replace(/^\/files\/runtime\//, '');
    resolved = safeResolveUnder(runtimeRoot, relative) || resolved;
  } else if (raw.startsWith('/files/uploads/') && runtimeRoot) {
    const relative = raw.replace(/^\/files\/uploads\//, '');
    resolved = safeResolveUnder(runtimeRoot, 'files', 'uploads', relative) || resolved;
  } else if (raw.startsWith('/files/') && runtimeRoot) {
    const relative = raw.replace(/^\/files\//, '');
    const candidate = safeResolveUnder(runtimeRoot, relative);
    if (fs.existsSync(candidate)) resolved = candidate;
  }

  if (!fs.existsSync(resolved)) {
    throw new Error(`auto_describe_file_not_found:${resolved}`);
  }

  return {
    buffer: fs.readFileSync(resolved),
    contentType: guessContentType(resolved),
  };
}

// ─── Fonction principale ──────────────────────────────────────────────────────

/**
 * Analyse une image avec Janus et retourne une description textuelle.
 *
 * @param {object} opts
 * @param {string} opts.imageLocator  URL, chemin local, ou data-URL de l'image
 * @param {string} [opts.runtimeRoot] Racine du runtime pour résoudre les chemins locaux
 * @param {number} [opts.timeoutMs]   Timeout Janus (défaut 30 s)
 * @param {string} [opts.requestId]   ID de trace
 * @returns {Promise<{ description: string; provider: string; skipped: boolean; reason?: string }>}
 */
async function autoDescribeImage({
  imageLocator = '',
  runtimeRoot = '',
  timeoutMs = 30000,
  requestId = '',
  prompt = AUTO_DESCRIBE_PROMPT,
  maxNewTokens = Number(process.env.A11_IMAGE_REFERENCE_JANUS_MAX_TOKENS || process.env.A11_JANUS_MAX_NEW_TOKENS || 640),
  visionProvider = '',
  preferRemoteVision = false,
} = {}) {
  const locator = String(imageLocator || '').trim();
  if (!locator) {
    return { description: '', provider: 'none', skipped: true, fallback: false, visualReliable: false, reason: 'no_locator' };
  }

  const provider = resolveVisionProvider({ provider: visionProvider });
  let imageBuffer;
  let contentType;
  try {
    const loaded = await loadImageBuffer(locator, runtimeRoot);
    imageBuffer = loaded.buffer;
    contentType = loaded.contentType;
  } catch (loadErr) {
    console.warn(`[A11][auto-describe] Failed to load image: ${String(loadErr?.message || loadErr)}`);
    return { description: '', provider, skipped: true, reason: String(loadErr?.message || 'load_failed') };
  }

  const remoteConfigs = resolveRemoteVisionConfigs({ timeoutMs });
  const remoteConfig = remoteConfigs[0] || resolveRemoteVisionConfig({ timeoutMs });
  const shouldTryRemoteFirst = Boolean(preferRemoteVision)
    || provider === 'remote'
    || (provider === 'ollama' && remoteConfig.available);
  let remoteTried = false;

  async function tryRemoteVision(reason = '') {
    if (remoteTried || !remoteConfig.available) return null;
    remoteTried = true;
    try {
      const remote = await describeImageWithRemoteVision({
        buffer: imageBuffer,
        contentType,
        prompt,
        timeoutMs,
        configs: remoteConfigs,
      });
      if (remote?.description) return remote;
    } catch (remoteError) {
      console.warn(`[A11][auto-describe] Remote vision failed${reason ? ` after ${reason}` : ''}: ${String(remoteError?.message || remoteError)}`);
    }
    return null;
  }

  if (shouldTryRemoteFirst) {
    const remote = await tryRemoteVision('preferred');
    if (remote?.description) return remote;
  }

  if (provider === 'remote') {
    const fallback = await buildLocalImageFallbackDescription({
      buffer: imageBuffer,
      contentType,
      reason: remoteConfig.available ? 'remote_vision_unavailable' : 'remote_vision_not_configured',
    });
    return {
      description: fallback.description,
      provider: 'remote-vision+local-image-fallback',
      skipped: false,
      fallback: true,
      visualReliable: false,
      reason: remoteConfig.available ? 'remote_vision_unavailable' : 'remote_vision_not_configured',
      analysis: fallback.analysis || null,
    };
  }

  // Vérifier si Janus est disponible après chargement pour garder un fallback local.
  if (provider === 'none') {
    console.log('[A11][auto-describe] Janus unavailable (provider=none), using local image fallback');
    const fallback = await buildLocalImageFallbackDescription({
      buffer: imageBuffer,
      contentType,
      reason: 'janus_unavailable',
    });
    return {
      description: fallback.description,
      provider: 'local-image-fallback',
      skipped: false,
      fallback: true,
      visualReliable: false,
      reason: 'janus_unavailable',
      analysis: fallback.analysis || null,
    };
  }

  try {
    const result = await callJanusVisionText({
      imageBuffer,
      contentType,
      prompt: String(prompt || AUTO_DESCRIBE_PROMPT).trim() || AUTO_DESCRIBE_PROMPT,
      requestId: requestId || `auto-describe-${Date.now()}`,
      maxNewTokens: Math.max(160, Number(maxNewTokens) || 640),
      timeoutMs: Math.max(5000, Number(timeoutMs) || 30000),
    });

    const raw = String(result?.text || result?.content || result?.response || result || '').trim();
    const description = raw.replace(/^(the image shows?|this image shows?|i see|i can see)\s*/i, '').trim();

    if (!description) {
      return { description: '', provider, skipped: true, fallback: false, visualReliable: false, reason: 'empty_description' };
    }

    console.log(`[A11][auto-describe] Janus described image: "${description.slice(0, 120)}${description.length > 120 ? '…' : ''}"`);
    return { description, provider, skipped: false, fallback: false, visualReliable: true };
  } catch (janusErr) {
    console.warn(`[A11][auto-describe] Janus vision failed: ${String(janusErr?.message || janusErr)}`);
    const reason = String(janusErr?.message || 'janus_failed');
    const remote = await tryRemoteVision(reason);
    if (remote?.description) return remote;

    const fallback = await buildLocalImageFallbackDescription({
      buffer: imageBuffer,
      contentType,
      reason,
    });
    return {
      description: fallback.description,
      provider: `${provider}+local-image-fallback`,
      skipped: false,
      fallback: true,
      visualReliable: false,
      reason,
      analysis: fallback.analysis || null,
    };
  }
}

/**
 * Construit le message utilisateur synthétique quand l'image est analysée sans texte.
 * On retourne la description brute — c'est l'intent detection LLM qui décide
 * ce qu'il faut faire (générer une variante, décrire, analyser...).
 * On ne force plus "Génère une image" ici.
 */
function buildAutoDescribeUserMessage(description = '') {
  return String(description || '').trim();
}

module.exports = {
  autoDescribeImage,
  describeImageWithRemoteVision,
  resolveRemoteVisionConfig,
  resolveRemoteVisionConfigs,
  buildAutoDescribeUserMessage,
  buildLocalImageFallbackDescription,
  buildLocalVisionFallbackText,
  loadImageBuffer,
  resolveRuntimeImagePathFromLocator,
  AUTO_DESCRIBE_PROMPT,
};
