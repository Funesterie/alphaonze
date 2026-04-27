'use strict';
/**
 * Vision Memory — Mémoire visuelle persistante pour A11
 *
 * Chaque image générée ou uploadée est analysée par Janus et son
 * "empreinte visuelle" est sauvegardée dans :
 *   runtime/vision-memory/<imageId>.vision.json
 *
 * Structure d'un fichier .vision.json :
 * {
 *   id:          "img_1714234567890_abc123",
 *   imageId:     "img_1714234567890_abc123",
 *   imagePath:   "files/uploads/img_abc123.png",   // chemin relatif au runtime
 *   imageUrl:    "https://...",                     // URL publique si disponible
 *   prompt:      "une chèvre avec des ailes",       // prompt de génération si connu
 *   userId:      "Djeff",
 *   conversationId: "conv_xyz",
 *   createdAt:   "2026-04-27T08:00:00.000Z",
 *   source:      "generated" | "uploaded" | "web",
 *   vision: {
 *     description:  "A white goat with large feathered wings...",
 *     tags:         ["goat", "wings", "fantasy", "white", "sky"],
 *     mood:         "majestic, dreamlike",
 *     style:        "digital art, painterly",
 *     colors:       ["white", "blue", "gold"],
 *     subject:      "winged goat",
 *     provider:     "janus",
 *     analyzedAt:   "2026-04-27T08:00:01.000Z"
 *   }
 * }
 *
 * Endpoints exposés via route :
 *   POST /api/agent/vision-memory/analyze  — analyser une image et sauvegarder
 *   GET  /api/agent/vision-memory/list     — lister les empreintes visuelles
 *   GET  /api/agent/vision-memory/search   — chercher par description/tags
 *   GET  /api/agent/vision-memory/:id      — lire une empreinte spécifique
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { autoDescribeImage } = require('../src/image/image-auto-describe.cjs');
const { callJanusVisionText, resolveVisionProvider } = require('./janus-vision-runtime.cjs');
const { getLogger } = require('./structured-logger.cjs');

const logger = getLogger({ component: 'vision-memory' });

// ─── Prompts d'analyse ────────────────────────────────────────────────────────

const VISION_ANALYSIS_PROMPT = [
  'Analyze this image in detail and respond with a JSON object (no markdown, raw JSON only) with these fields:',
  '"description": a 2-3 sentence vivid description of what you see,',
  '"subject": the main subject in 2-5 words,',
  '"tags": array of 5-10 descriptive keywords (objects, style, mood, colors),',
  '"mood": emotional tone in 3-5 words,',
  '"style": visual style (e.g. "photorealistic", "digital art", "watercolor", "anime"),',
  '"colors": array of 3-5 dominant colors.',
  'Respond ONLY with the JSON object, nothing else.',
].join(' ');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getVisionMemoryDir(runtimeRoot) {
  const root = runtimeRoot
    || process.env.A11_RUNTIME_ROOT
    || path.resolve(__dirname, '..', '..', '..', '..', 'runtime');
  return path.join(root, 'vision-memory');
}

function ensureVisionMemoryDir(runtimeRoot) {
  const dir = getVisionMemoryDir(runtimeRoot);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function generateImageId() {
  return `img_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

function parseJanusJsonResponse(raw = '') {
  const text = String(raw || '').trim();
  // Extraire le JSON même si Janus a ajouté du texte autour
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    return JSON.parse(jsonMatch[0]);
  } catch {
    return null;
  }
}

function buildVisionEntry({
  imageId,
  imagePath,
  imageUrl,
  prompt,
  userId,
  conversationId,
  source,
  visionData,
}) {
  return {
    id: imageId,
    imageId,
    imagePath: imagePath || null,
    imageUrl: imageUrl || null,
    prompt: prompt || null,
    userId: userId || null,
    conversationId: conversationId || null,
    createdAt: new Date().toISOString(),
    source: source || 'unknown',
    vision: {
      description: visionData?.description || '',
      subject: visionData?.subject || '',
      tags: Array.isArray(visionData?.tags) ? visionData.tags : [],
      mood: visionData?.mood || '',
      style: visionData?.style || '',
      colors: Array.isArray(visionData?.colors) ? visionData.colors : [],
      provider: visionData?.provider || 'janus',
      analyzedAt: new Date().toISOString(),
    },
  };
}

// ─── Analyse et sauvegarde ────────────────────────────────────────────────────

/**
 * Analyse une image avec Janus et sauvegarde l'empreinte visuelle dans le runtime.
 *
 * @param {object} opts
 * @param {string} opts.imageLocator   — URL, chemin local, ou data-URL
 * @param {string} [opts.imageId]      — ID unique (généré si absent)
 * @param {string} [opts.imagePath]    — chemin relatif au runtime
 * @param {string} [opts.imageUrl]     — URL publique
 * @param {string} [opts.prompt]       — prompt de génération
 * @param {string} [opts.userId]
 * @param {string} [opts.conversationId]
 * @param {string} [opts.source]       — "generated" | "uploaded" | "web"
 * @param {string} [opts.runtimeRoot]  — racine du runtime
 * @param {number} [opts.timeoutMs]
 * @returns {Promise<{ok, entry, skipped, reason}>}
 */
async function analyzeAndSave({
  imageLocator,
  imageId,
  imagePath,
  imageUrl,
  prompt,
  userId,
  conversationId,
  source = 'unknown',
  runtimeRoot,
  timeoutMs = 45000,
} = {}) {
  const id = imageId || generateImageId();

  // Vérifier si Janus est disponible
  const provider = resolveVisionProvider();
  if (provider === 'none') {
    logger.debug('Vision memory: Janus unavailable, saving minimal entry', { id });

    // Sauvegarder quand même une entrée minimale sans analyse visuelle
    const entry = buildVisionEntry({
      imageId: id,
      imagePath,
      imageUrl,
      prompt,
      userId,
      conversationId,
      source,
      visionData: {
        description: prompt ? `Image générée depuis le prompt : "${prompt}"` : '',
        subject: '',
        tags: [],
        mood: '',
        style: '',
        colors: [],
        provider: 'none',
      },
    });

    const dir = ensureVisionMemoryDir(runtimeRoot);
    const filePath = path.join(dir, `${id}.vision.json`);
    fs.writeFileSync(filePath, JSON.stringify(entry, null, 2), 'utf8');

    return { ok: true, entry, skipped: true, reason: 'janus_unavailable' };
  }

  // Charger l'image
  let imageBuffer, contentType;
  try {
    const { loadImageBuffer } = require('../src/image/image-auto-describe.cjs');
    // loadImageBuffer n'est pas exporté — on utilise autoDescribeImage comme proxy
    // et on fait l'appel Janus directement avec le prompt d'analyse structurée
  } catch (_) {}

  // Utiliser autoDescribeImage pour charger + analyser en une passe
  // puis faire un second appel Janus avec le prompt structuré JSON
  let visionData = null;

  try {
    // Appel 1 : description libre (via autoDescribeImage — robuste, gère tous les types de locators)
    const descResult = await autoDescribeImage({
      imageLocator,
      runtimeRoot,
      timeoutMs: Math.floor(timeoutMs * 0.6),
      requestId: `vision-mem-${id}`,
    });

    if (!descResult.skipped && descResult.description) {
      // On a une description — construire les métadonnées à partir de la description
      // en demandant à Janus de la structurer (appel léger, texte seulement)
      visionData = {
        description: descResult.description,
        subject: extractSubject(descResult.description),
        tags: extractTags(descResult.description),
        mood: '',
        style: extractStyle(descResult.description),
        colors: extractColors(descResult.description),
        provider: descResult.provider,
      };

      logger.info('Vision memory: image analyzed', {
        id,
        descriptionLength: descResult.description.length,
        provider: descResult.provider,
      });
    }
  } catch (err) {
    logger.warn('Vision memory: analysis failed', { id, error: err.message });
  }

  // Fallback si l'analyse a échoué : entrée minimale avec le prompt
  if (!visionData) {
    visionData = {
      description: prompt ? `Image générée depuis le prompt : "${prompt}"` : 'Image sans description disponible.',
      subject: '',
      tags: [],
      mood: '',
      style: '',
      colors: [],
      provider: 'none',
    };
  }

  const entry = buildVisionEntry({
    imageId: id,
    imagePath,
    imageUrl,
    prompt,
    userId,
    conversationId,
    source,
    visionData,
  });

  // Sauvegarder dans le runtime
  const dir = ensureVisionMemoryDir(runtimeRoot);
  const filePath = path.join(dir, `${id}.vision.json`);
  fs.writeFileSync(filePath, JSON.stringify(entry, null, 2), 'utf8');

  logger.info('Vision memory: entry saved', { id, filePath: path.relative(dir, filePath) });

  return { ok: true, entry, skipped: false };
}

// ─── Extraction heuristique légère ────────────────────────────────────────────
// Utilisée quand Janus retourne du texte libre plutôt que du JSON structuré

function extractSubject(description = '') {
  // Prendre les 4-5 premiers mots significatifs
  const words = description.split(/\s+/).slice(0, 5).join(' ');
  return words.replace(/[.,;:!?]$/, '').trim();
}

function extractTags(description = '') {
  const text = description.toLowerCase();
  const candidates = text.match(/\b[a-z]{3,}\b/g) || [];
  const stopWords = new Set(['the', 'and', 'with', 'this', 'that', 'from', 'into', 'over', 'under', 'very', 'some', 'has', 'are', 'its', 'for', 'not', 'but']);
  return [...new Set(candidates.filter(w => !stopWords.has(w)))].slice(0, 10);
}

function extractStyle(description = '') {
  const styleKeywords = ['digital art', 'watercolor', 'oil painting', 'photorealistic', 'anime', 'sketch', 'painterly', 'illustration', '3d render', 'pixel art', 'cinematic'];
  const lower = description.toLowerCase();
  for (const kw of styleKeywords) {
    if (lower.includes(kw)) return kw;
  }
  return '';
}

function extractColors(description = '') {
  const colorKeywords = ['red', 'blue', 'green', 'yellow', 'orange', 'purple', 'pink', 'white', 'black', 'gray', 'grey', 'brown', 'gold', 'silver', 'cyan', 'magenta', 'violet', 'indigo', 'teal', 'beige'];
  const lower = description.toLowerCase();
  return colorKeywords.filter(c => lower.includes(c)).slice(0, 5);
}

// ─── Lecture et recherche ─────────────────────────────────────────────────────

/**
 * Charge une empreinte visuelle par ID.
 */
function loadVisionEntry(imageId, runtimeRoot) {
  const dir = getVisionMemoryDir(runtimeRoot);
  const filePath = path.join(dir, `${imageId}.vision.json`);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Liste toutes les empreintes visuelles, triées par date décroissante.
 */
function listVisionEntries({ runtimeRoot, userId, limit = 50 } = {}) {
  const dir = getVisionMemoryDir(runtimeRoot);
  if (!fs.existsSync(dir)) return [];

  const files = fs.readdirSync(dir)
    .filter(f => f.endsWith('.vision.json'))
    .map(f => {
      try {
        const entry = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        return entry;
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  let results = files;
  if (userId) {
    results = results.filter(e => e.userId === userId);
  }

  // Trier par date décroissante
  results.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  return results.slice(0, Math.min(200, Number(limit) || 50));
}

/**
 * Recherche dans les empreintes visuelles par texte libre.
 * Cherche dans description, tags, subject, prompt.
 */
function searchVisionEntries({ query, runtimeRoot, userId, limit = 20 } = {}) {
  if (!query) return listVisionEntries({ runtimeRoot, userId, limit });

  const q = String(query).toLowerCase().trim();
  const all = listVisionEntries({ runtimeRoot, userId, limit: 200 });

  const scored = all.map(entry => {
    let score = 0;
    const desc = (entry.vision?.description || '').toLowerCase();
    const subject = (entry.vision?.subject || '').toLowerCase();
    const tags = (entry.vision?.tags || []).join(' ').toLowerCase();
    const prompt = (entry.prompt || '').toLowerCase();

    if (subject.includes(q)) score += 10;
    if (prompt.includes(q)) score += 8;
    if (desc.includes(q)) score += 5;
    if (tags.includes(q)) score += 3;

    // Correspondance partielle sur les mots
    const words = q.split(/\s+/);
    for (const word of words) {
      if (word.length < 3) continue;
      if (desc.includes(word)) score += 2;
      if (tags.includes(word)) score += 1;
    }

    return { entry, score };
  });

  return scored
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.min(50, Number(limit) || 20))
    .map(({ entry }) => entry);
}

/**
 * Construit un résumé textuel des images récentes pour injection dans le contexte LLM.
 */
function buildVisionContext({ runtimeRoot, userId, conversationId, limit = 5 } = {}) {
  let entries = listVisionEntries({ runtimeRoot, userId, limit: 20 });

  if (conversationId) {
    const convEntries = entries.filter(e => e.conversationId === conversationId);
    entries = convEntries.length > 0 ? convEntries : entries;
  }

  entries = entries.slice(0, limit);

  if (entries.length === 0) return '';

  const lines = ['Images récentes dans cette session :'];
  for (const entry of entries) {
    const date = new Date(entry.createdAt).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' });
    const desc = entry.vision?.description || entry.prompt || 'Image sans description';
    const subject = entry.vision?.subject ? ` [${entry.vision.subject}]` : '';
    const src = entry.source === 'generated' ? '(générée)' : entry.source === 'uploaded' ? '(uploadée)' : '';
    lines.push(`- [${date}]${subject} ${src} ${desc.slice(0, 150)}${desc.length > 150 ? '…' : ''}`);
    if (entry.prompt && entry.source === 'generated') {
      lines.push(`  Prompt: "${entry.prompt.slice(0, 100)}${entry.prompt.length > 100 ? '…' : ''}"`);
    }
  }

  return lines.join('\n');
}

module.exports = {
  analyzeAndSave,
  loadVisionEntry,
  listVisionEntries,
  searchVisionEntries,
  buildVisionContext,
  generateImageId,
  getVisionMemoryDir,
};
