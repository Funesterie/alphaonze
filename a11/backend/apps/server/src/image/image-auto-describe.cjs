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
  'Describe this image in one or two concise English sentences.',
  'Focus on: main subject, visual style, colors, mood, and any distinctive details.',
  'Be specific and visual. Do not say "the image shows" — just describe directly.',
  'Example: "A young woman with long red hair standing in a misty forest, soft golden light, painterly style."',
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
    if (preview) {
      return {
        description: `Analyse locale de secours: ${metadata}. Texte lisible detecte: ${preview}`,
        analysis,
      };
    }
    return {
      description: `Analyse locale de secours: ${metadata}. Le moteur vision n'a pas donne de description visuelle complete (${String(reason || 'vision_indisponible')}).`,
      analysis,
    };
  } catch (fallbackError) {
    return {
      description: `Image recue, mais l'analyse visuelle complete n'a pas abouti (${String(reason || fallbackError?.message || 'vision_indisponible')}).`,
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
} = {}) {
  const locator = String(imageLocator || '').trim();
  if (!locator) {
    return { description: '', provider: 'none', skipped: true, reason: 'no_locator' };
  }

  const provider = resolveVisionProvider();
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
      maxNewTokens: 120,
      timeoutMs: Math.max(5000, Number(timeoutMs) || 30000),
    });

    const raw = String(result?.text || result?.content || result?.response || result || '').trim();
    const description = raw.replace(/^(the image shows?|this image shows?|i see|i can see)\s*/i, '').trim();

    if (!description) {
      return { description: '', provider, skipped: true, reason: 'empty_description' };
    }

    console.log(`[A11][auto-describe] Janus described image: "${description.slice(0, 120)}${description.length > 120 ? '…' : ''}"`);
    return { description, provider, skipped: false };
  } catch (janusErr) {
    console.warn(`[A11][auto-describe] Janus vision failed: ${String(janusErr?.message || janusErr)}`);
    const reason = String(janusErr?.message || 'janus_failed');
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
  buildAutoDescribeUserMessage,
  buildLocalImageFallbackDescription,
  loadImageBuffer,
  resolveRuntimeImagePathFromLocator,
  AUTO_DESCRIBE_PROMPT,
};
