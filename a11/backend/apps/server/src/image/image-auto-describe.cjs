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

  // URL distante
  if (isRemoteUrl(raw)) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
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
    resolved = path.join(runtimeRoot, relative);
  } else if (raw.startsWith('/files/') && runtimeRoot) {
    // /files/runtime/files/uploads/... → essayer depuis runtimeRoot
    const relative = raw.replace(/^\/files\//, '');
    const candidate = path.join(runtimeRoot, relative);
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
} = {}) {
  const locator = String(imageLocator || '').trim();
  if (!locator) {
    return { description: '', provider: 'none', skipped: true, reason: 'no_locator' };
  }

  // Vérifier si Janus est disponible
  const provider = resolveVisionProvider();
  if (provider === 'none') {
    console.log('[A11][auto-describe] Janus unavailable (provider=none), skipping image analysis');
    return { description: '', provider: 'none', skipped: true, reason: 'janus_unavailable' };
  }

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

  try {
    const result = await callJanusVisionText({
      imageBuffer,
      contentType,
      prompt: AUTO_DESCRIBE_PROMPT,
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
    return { description: '', provider, skipped: true, reason: String(janusErr?.message || 'janus_failed') };
  }
}

/**
 * Construit le message utilisateur synthétique quand l'image est analysée sans texte.
 * Retourne une phrase naturelle qui déclenche le bon intent dans le pipeline.
 */
function buildAutoDescribeUserMessage(description = '') {
  const desc = String(description || '').trim();
  if (!desc) return '';
  // Formulation qui déclenche image.generate avec la description comme base
  return `Génère une image : ${desc}`;
}

module.exports = {
  autoDescribeImage,
  buildAutoDescribeUserMessage,
  AUTO_DESCRIBE_PROMPT,
};
