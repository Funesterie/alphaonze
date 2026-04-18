const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

let sharpLib;

function getSharp() {
  if (sharpLib !== undefined) return sharpLib;
  try {
    sharpLib = require('sharp');
  } catch {
    sharpLib = null;
  }
  return sharpLib;
}

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
    .replace(/[-/]/g, ' ')
    .toLowerCase();
}

function isTruthy(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function isRemoteImage(value = '') {
  const text = String(value || '').trim().toLowerCase();
  return text.startsWith('http://') || text.startsWith('https://');
}

function isCompositeRiskyReference(entry = {}) {
  const haystack = normalizeLookup([
    entry?.title,
    entry?.sourceDomain,
    entry?.sourceUrl,
    entry?.label,
  ].filter(Boolean).join(' '));
  if (!haystack) return false;

  return /\b(?:poster|wallpaper|cover|lineup|line up|collage|mosaic|sheet|sprite\s*sheet|compilation|collection|group|crew|characters|personnages|ensemble|all\s+characters|manga\s*page|comic\s*page|page|panel|silhouette|sticker|logo|emblem|plaque)\b/i.test(haystack);
}

function hasAcceptableCompositeScore(entry = {}, { minScore = 0 } = {}) {
  const numericScore = Number(entry?.selectionScore || 0) || 0;
  if (numericScore <= 0) return true;
  return numericScore >= minScore;
}

function isUsableCompositeReference(entry = {}, { subject = false } = {}) {
  if (!normalizeText(entry?.imageUrl || '')) return false;
  if (isCompositeRiskyReference(entry)) return false;
  if (!hasAcceptableCompositeScore(entry, { minScore: subject ? 7 : 5 })) return false;

  const width = Number(entry?.width || 0) || 0;
  const height = Number(entry?.height || 0) || 0;
  if ((width > 0 && width < 192) || (height > 0 && height < 192)) return false;

  return true;
}

function isImageReferenceCompositeEnabled(explicitValue) {
  if (typeof explicitValue === 'boolean') return explicitValue;
  const envValue = process.env.A11_IMAGE_REFERENCE_COMPOSITE;
  if (envValue === undefined || envValue === '') return true;
  return isTruthy(envValue);
}

function shouldBuildImageReferenceComposite({
  mask = {},
  referencePack = null,
  enabled,
} = {}) {
  if (!isImageReferenceCompositeEnabled(enabled)) return false;
  if (!referencePack || typeof referencePack !== 'object') return false;
  const refs = Array.isArray(referencePack.references) ? referencePack.references : [];
  if (refs.length < 2) return false;
  if (String(mask?.intent || '').trim() !== 'image.generate') return false;

  const accessoryRefs = refs.filter((entry) => String(entry?.role || '').trim() === 'accessory');
  const bodyAnchorRefs = refs.filter((entry) => String(entry?.role || '').trim() === 'body_anchor');
  return accessoryRefs.length > 0 || bodyAnchorRefs.length > 0;
}

async function defaultFetch(...args) {
  if (typeof globalThis.fetch === 'function') {
    return globalThis.fetch(...args);
  }
  const mod = await import('node-fetch');
  return mod.default(...args);
}

async function readImageBuffer(source = '', fetchImpl = defaultFetch) {
  const raw = String(source || '').trim();
  if (!raw) throw new Error('missing_image_source');

  if (isRemoteImage(raw)) {
    const response = await fetchImpl(raw, {
      headers: {
        Accept: 'image/*,*/*;q=0.8',
        'User-Agent': 'A11-ImageReferenceComposite/1.0',
      },
    });
    if (!response?.ok) {
      throw new Error(`image_fetch_failed:${response?.status || 'unknown'}`);
    }
    return Buffer.from(await response.arrayBuffer());
  }

  return fs.promises.readFile(raw);
}

function resolveCompositeOutputDir(customDir = '') {
  const explicit = normalizeText(customDir || process.env.A11_IMAGE_REFERENCE_COMPOSITE_DIR || '');
  if (explicit) return path.resolve(explicit);

  if (String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production') {
    return path.join(os.tmpdir(), 'a11-image-reference-composites');
  }

  return path.resolve(__dirname, '..', '..', 'tmp', 'generated', 'reference-composites');
}

function clampDimension(value, max = 2048) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  const rounded = Math.max(64, Math.round(numeric / 64) * 64);
  return Math.min(max, rounded);
}

function resolveCanvasSize(referencePack = {}, env = process.env) {
  const refs = Array.isArray(referencePack.references) ? referencePack.references : [];
  const subjectRef = refs.find((entry) => String(entry?.role || '').trim() === 'subject') || refs[0] || {};
  const sourceWidth = Number(subjectRef?.width || 0) || 1024;
  const sourceHeight = Number(subjectRef?.height || 0) || 1024;
  const maxRenderSide = Number(env.A11_IMAGE_MAX_SIZE || 2048) || 2048;
  const preferredLongest = Number(env.A11_IMAGE_REFERENCE_COMPOSITE_TARGET_SIDE || 1344) || 1344;
  const sourceLongest = Math.max(sourceWidth, sourceHeight, 1);
  const targetLongest = Math.min(maxRenderSide, Math.max(sourceLongest, preferredLongest));
  const scale = targetLongest / sourceLongest;

  return {
    width: clampDimension(Math.floor(sourceWidth * scale), maxRenderSide),
    height: clampDimension(Math.floor(sourceHeight * scale), maxRenderSide),
    sourceWidth,
    sourceHeight,
  };
}

function placementToGravity(placement = '') {
  switch (String(placement || '').trim().toLowerCase()) {
    case 'mouth':
    case 'face':
      return 'northeast';
    case 'head':
    case 'head_or_body':
      return 'north';
    case 'hand':
      return 'southeast';
    case 'background':
      return 'southwest';
    default:
      return 'east';
  }
}

async function createInsetCard(sharp, inputBuffer, width, height) {
  const border = 8;
  const insetWidth = Math.max(128, width);
  const insetHeight = Math.max(128, height);
  const contentWidth = Math.max(64, insetWidth - border * 2);
  const contentHeight = Math.max(64, insetHeight - border * 2);
  const content = await sharp(inputBuffer)
    .resize(contentWidth, contentHeight, { fit: 'cover', position: 'attention' })
    .png()
    .toBuffer();

  return sharp({
    create: {
      width: insetWidth,
      height: insetHeight,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 0.96 },
    },
  })
    .composite([{ input: content, left: border, top: border }])
    .png()
    .toBuffer();
}

async function buildImageReferenceComposite({
  mask = {},
  referencePack = null,
  fetch = defaultFetch,
  outDir,
  enabled,
} = {}) {
  if (!shouldBuildImageReferenceComposite({ mask, referencePack, enabled })) {
    return null;
  }

  const sharp = getSharp();
  if (!sharp) return null;

  const refs = (Array.isArray(referencePack?.references) ? referencePack.references : [])
    .filter((entry) => normalizeText(entry?.imageUrl || ''))
    .slice(0, Number(process.env.A11_IMAGE_REFERENCE_COMPOSITE_MAX_REFS || 4) || 4);
  if (refs.length < 2) return null;

  const subjectRef = refs.find((entry) => (
    String(entry?.role || '').trim() === 'subject'
    && isUsableCompositeReference(entry, { subject: true })
  )) || null;
  if (!subjectRef?.imageUrl) return null;

  const usableRefs = refs.filter((entry) => (
    entry === subjectRef
      || isUsableCompositeReference(entry, { subject: false })
  ));
  if (usableRefs.length < 2) return null;

  const canvas = resolveCanvasSize(referencePack, process.env);
  const outputDir = resolveCompositeOutputDir(outDir);
  await fs.promises.mkdir(outputDir, { recursive: true });

  const subjectBuffer = await readImageBuffer(subjectRef.imageUrl, fetch);
  const base = sharp(subjectBuffer)
    .resize(canvas.width, canvas.height, { fit: 'cover', position: 'attention' })
    .modulate({ saturation: 1.02, brightness: 1.0 });

  const overlays = [];
  const insetWidth = Math.max(192, Math.round(canvas.width * 0.24));
  const insetHeight = Math.max(192, Math.round(canvas.height * 0.24));
  const margin = Math.max(24, Math.round(Math.min(canvas.width, canvas.height) * 0.03));
  const placementOffsets = new Map();

  for (const entry of usableRefs.filter((item) => item !== subjectRef).slice(0, 3)) {
    try {
      const buffer = await readImageBuffer(entry.imageUrl, fetch);
      const card = await createInsetCard(sharp, buffer, insetWidth, insetHeight);
      const gravity = placementToGravity(entry.placement);
      const currentOffset = placementOffsets.get(gravity) || 0;
      const offsetStep = Math.round(insetHeight * 0.82);
      placementOffsets.set(gravity, currentOffset + 1);

      const position = (() => {
        switch (gravity) {
          case 'north':
            return {
              left: Math.max(margin, Math.round((canvas.width - insetWidth) / 2)),
              top: margin + currentOffset * Math.round(insetHeight * 0.32),
            };
          case 'northeast':
            return {
              left: Math.max(margin, canvas.width - insetWidth - margin),
              top: margin + currentOffset * Math.round(insetHeight * 0.32),
            };
          case 'southeast':
            return {
              left: Math.max(margin, canvas.width - insetWidth - margin),
              top: Math.max(margin, canvas.height - insetHeight - margin - currentOffset * offsetStep),
            };
          case 'southwest':
            return {
              left: margin,
              top: Math.max(margin, canvas.height - insetHeight - margin - currentOffset * offsetStep),
            };
          default:
            return {
              left: Math.max(margin, canvas.width - insetWidth - margin),
              top: Math.max(margin, Math.round((canvas.height - insetHeight) / 2) + currentOffset * Math.round(insetHeight * 0.24)),
            };
        }
      })();

      overlays.push({
        input: card,
        left: position.left,
        top: position.top,
      });
    } catch {
      continue;
    }
  }

  if (!overlays.length) return null;

  const compositeBuffer = await base
    .composite(overlays)
    .png()
    .toBuffer();

  const filename = `refcomp_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.png`;
  const outputPath = path.join(outputDir, filename);
  await fs.promises.writeFile(outputPath, compositeBuffer);

  return {
    mode: 'web-reference-composite',
    reason: 'reference_pack_composite',
    initImagePath: outputPath,
    initImageUrl: outputPath,
    strength: Number(process.env.A11_IMAGE_REFERENCE_COMPOSITE_STRENGTH || 0.28) || 0.28,
    width: canvas.width,
    height: canvas.height,
    sourceWidth: canvas.sourceWidth,
    sourceHeight: canvas.sourceHeight,
    referencesUsed: refs.length,
  };
}

module.exports = {
  buildImageReferenceComposite,
  isImageReferenceCompositeEnabled,
  resolveCanvasSize,
  shouldBuildImageReferenceComposite,
};
