const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const {
  resolveImageDimensionConfig,
} = require('../mask/normalize-mask-image-generate.cjs');
const {
  resolveImg2ImgStrengthPlan,
} = require('./img2img-strength.cjs');

let sharpLib;

function defaultFetch(...args) {
  if (typeof globalThis.fetch === 'function') {
    return globalThis.fetch(...args);
  }
  return import('node-fetch').then((mod) => mod.default(...args));
}

function getSharp() {
  if (sharpLib !== undefined) return sharpLib;
  try {
    sharpLib = require('sharp');
  } catch {
    sharpLib = null;
  }
  return sharpLib;
}

function resolvePreparedImg2ImgSourceRoot() {
  if (String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production') {
    return path.join(os.tmpdir(), 'a11-prepared-img2img-sources');
  }
  return path.resolve(__dirname, '..', '..', 'tmp', 'generated', 'prepared-img2img-sources');
}

function resolvePreparedImageExtension({ contentType = '', format = '' } = {}) {
  const normalizedContentType = String(contentType || '').trim().toLowerCase();
  const normalizedFormat = String(format || '').trim().toLowerCase();
  if (normalizedContentType.includes('jpeg') || normalizedFormat === 'jpeg' || normalizedFormat === 'jpg') {
    return { extension: 'jpg', format: 'jpeg' };
  }
  if (normalizedContentType.includes('webp') || normalizedFormat === 'webp') {
    return { extension: 'webp', format: 'webp' };
  }
  return { extension: 'png', format: 'png' };
}

function computeLuma(data, offset) {
  const r = Number(data[offset] || 0);
  const g = Number(data[offset + 1] || 0);
  const b = Number(data[offset + 2] || 0);
  return (0.2126 * r) + (0.7152 * g) + (0.0722 * b);
}

function sampleRowDarknessStats({
  data,
  width = 0,
  channels = 4,
  row = 0,
} = {}) {
  const safeWidth = Number(width || 0);
  if (!safeWidth || !data) {
    return {
      meanLuma: 255,
      darkRatio: 0,
      brightRatio: 0,
    };
  }

  const samplingStep = safeWidth > 1600 ? 2 : 1;
  let sampleCount = 0;
  let lumaSum = 0;
  let darkCount = 0;
  let brightCount = 0;

  for (let column = 0; column < safeWidth; column += samplingStep) {
    const offset = ((row * safeWidth) + column) * channels;
    const luma = computeLuma(data, offset);
    lumaSum += luma;
    sampleCount += 1;
    if (luma <= 30) darkCount += 1;
    if (luma >= 180) brightCount += 1;
  }

  const safeSampleCount = Math.max(sampleCount, 1);
  return {
    meanLuma: lumaSum / safeSampleCount,
    darkRatio: darkCount / safeSampleCount,
    brightRatio: brightCount / safeSampleCount,
  };
}

function scanDarkEdgeBand({
  data,
  width = 0,
  height = 0,
  channels = 4,
  edge = 'top',
} = {}) {
  const safeHeight = Number(height || 0);
  if (!safeHeight || !data) return 0;

  const minBandRows = Math.max(24, Math.round(safeHeight * 0.04));
  const maxBandRows = Math.min(Math.round(safeHeight * 0.3), 720);
  let matchedRows = 0;

  for (let index = 0; index < maxBandRows; index += 1) {
    const row = edge === 'bottom'
      ? (safeHeight - 1 - index)
      : index;
    const stats = sampleRowDarknessStats({
      data,
      width,
      channels,
      row,
    });
    const looksLikeDarkBand = (
      stats.darkRatio >= 0.76
      && stats.meanLuma <= 40
      && stats.brightRatio <= 0.24
    );
    if (!looksLikeDarkBand) break;
    matchedRows += 1;
  }

  return matchedRows >= minBandRows ? matchedRows : 0;
}

async function detectEdgeBandCrop({
  buffer = null,
  width = 0,
  height = 0,
} = {}) {
  const sharp = getSharp();
  const safeWidth = Number(width || 0);
  const safeHeight = Number(height || 0);
  if (!sharp || !buffer || !safeWidth || !safeHeight) {
    return {
      applied: false,
      top: 0,
      bottom: 0,
      areaGain: 0,
    };
  }

  const raw = await sharp(buffer, { failOn: 'none' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const channels = Number(raw?.info?.channels || 4) || 4;
  const top = scanDarkEdgeBand({
    data: raw?.data,
    width: safeWidth,
    height: safeHeight,
    channels,
    edge: 'top',
  });
  const bottom = scanDarkEdgeBand({
    data: raw?.data,
    width: safeWidth,
    height: safeHeight,
    channels,
    edge: 'bottom',
  });
  const croppedHeight = safeHeight - top - bottom;
  const areaGain = safeWidth > 0 && safeHeight > 0
    ? 1 - ((safeWidth * Math.max(croppedHeight, 1)) / Math.max(safeWidth * safeHeight, 1))
    : 0;
  const applied = croppedHeight >= 128 && areaGain >= 0.05 && (top > 0 || bottom > 0);

  return {
    applied,
    top: applied ? top : 0,
    bottom: applied ? bottom : 0,
    areaGain: applied ? areaGain : 0,
  };
}

async function materializeEffectiveImg2ImgSource({
  imageUrl = '',
  imagePath = '',
  sourceMeta = {},
  fetch = defaultFetch,
} = {}) {
  const sharp = getSharp();
  if (!sharp) return null;

  const cropLeft = Math.max(0, Number(sourceMeta?.effectiveOffsetLeft || 0) || 0);
  const cropTop = Math.max(0, Number(sourceMeta?.effectiveOffsetTop || 0) || 0);
  const cropRight = Math.max(0, Number(sourceMeta?.effectiveOffsetRight || 0) || 0);
  const cropBottom = Math.max(0, Number(sourceMeta?.effectiveOffsetBottom || 0) || 0);
  const cropApplied = cropLeft > 0 || cropTop > 0 || cropRight > 0 || cropBottom > 0;
  if (!cropApplied) return null;

  const loaded = await readImageBuffer({ imageUrl, imagePath, fetch });
  const metadata = await sharp(loaded.buffer, { failOn: 'none' }).metadata();
  const width = Number(sourceMeta?.width || metadata?.width || 0);
  const height = Number(sourceMeta?.height || metadata?.height || 0);
  const extractWidth = Math.max(1, width - cropLeft - cropRight);
  const extractHeight = Math.max(1, height - cropTop - cropBottom);
  if (!width || !height || extractWidth < 64 || extractHeight < 64) return null;

  const outputRoot = resolvePreparedImg2ImgSourceRoot();
  await fsp.mkdir(outputRoot, { recursive: true });

  const outputFormat = resolvePreparedImageExtension({
    contentType: loaded.contentType,
    format: metadata?.format,
  });
  const outputPath = path.join(
    outputRoot,
    `img2img_src_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.${outputFormat.extension}`
  );

  await sharp(loaded.buffer, { failOn: 'none' })
    .extract({
      left: cropLeft,
      top: cropTop,
      width: extractWidth,
      height: extractHeight,
    })
    .toFormat(outputFormat.format)
    .toFile(outputPath);

  return {
    initImagePath: outputPath,
    initImageUrl: '',
    preparedApplied: true,
    preparedReason: String(sourceMeta?.cropReason || 'effective_source_crop').trim() || 'effective_source_crop',
    originalSourceUsed: String(sourceMeta?.sourceUsed || loaded.sourceUsed || imagePath || imageUrl).trim() || null,
    effectiveSourceUsed: outputPath,
  };
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

function roundDimensionToMultiple(value, multiple = 64) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return Math.max(multiple, Math.round(numeric / multiple) * multiple);
}

function clampDimension(value, min = 64, max = 2048, fallback = 1024) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return roundDimensionToMultiple(fallback, 64);
  }
  return Math.max(min, Math.min(max, roundDimensionToMultiple(numeric, 64)));
}

function resolveMaskTechniquePrompt(mask = {}) {
  return String(
    mask?.meta?.techniqueAnalysisPrompt
    || mask?.meta?.promptSeedText
    || mask?.raw
    || ''
  ).trim();
}

function buildSourceAnalysisText({ prompt = '', draft = {}, sourceMeta = {} } = {}) {
  return [
    prompt,
    draft?.title,
    draft?.query,
    draft?.reason,
  ].filter(Boolean).join(' ');
}

function resolveTrimThreshold(env = process.env) {
  const numeric = Number(env?.A11_IMAGE_SOURCE_TRIM_THRESHOLD);
  if (!Number.isFinite(numeric)) return 18;
  return Math.max(0, Math.min(255, numeric));
}

function resolveTrimBorderRatioThreshold(env = process.env) {
  const numeric = Number(env?.A11_IMAGE_SOURCE_TRIM_MIN_BORDER_RATIO);
  if (!Number.isFinite(numeric)) return 0.08;
  return Math.max(0.02, Math.min(0.45, numeric));
}

function resolveTrimAreaGainThreshold(env = process.env) {
  const numeric = Number(env?.A11_IMAGE_SOURCE_TRIM_MIN_AREA_GAIN);
  if (!Number.isFinite(numeric)) return 0.18;
  return Math.max(0.05, Math.min(0.8, numeric));
}

async function readImageBuffer({ imageUrl = '', imagePath = '', fetch = defaultFetch } = {}) {
  const normalizedUrl = String(imageUrl || '').trim();
  const normalizedPath = String(imagePath || '').trim();

  if (normalizedUrl) {
    if (/^data:/i.test(normalizedUrl)) {
      const match = normalizedUrl.match(/^data:([^;,]+)?(?:;base64)?,(.*)$/i);
      const contentType = String(match?.[1] || 'image/png').trim() || 'image/png';
      const payload = String(match?.[2] || '').trim();
      if (!payload) {
        throw new Error('img2img_source_invalid_data_url');
      }
      return {
        buffer: Buffer.from(payload, 'base64'),
        contentType,
        sourceUsed: normalizedUrl,
        sourceKind: 'data_url',
      };
    }

    const response = await fetch(normalizedUrl);
    if (!response.ok) {
      throw new Error(`img2img_source_fetch_failed:${response.status}`);
    }
    const headerContentType = response?.headers && typeof response.headers.get === 'function'
      ? response.headers.get('content-type')
      : '';
    return {
      buffer: Buffer.from(await response.arrayBuffer()),
      contentType: String(headerContentType || 'image/png').split(';')[0].trim() || 'image/png',
      sourceUsed: normalizedUrl,
      sourceKind: 'url',
    };
  }

  if (normalizedPath) {
    const resolvedPath = normalizedPath;
    if (!fs.existsSync(resolvedPath)) {
      throw new Error('img2img_source_file_missing');
    }
    return {
      buffer: await fsp.readFile(resolvedPath),
      contentType: '',
      sourceUsed: resolvedPath,
      sourceKind: 'file',
    };
  }

  throw new Error('img2img_source_missing');
}

async function probeImg2ImgSource({
  imageUrl = '',
  imagePath = '',
  fetch = defaultFetch,
} = {}) {
  const sharp = getSharp();
  if (!sharp) {
    return {
      ok: false,
      reason: 'sharp_unavailable',
    };
  }

  const loaded = await readImageBuffer({ imageUrl, imagePath, fetch });
  const metadata = await sharp(loaded.buffer, { failOn: 'none' }).metadata();
  const width = Number(metadata?.width || 0);
  const height = Number(metadata?.height || 0);
  const ratio = width > 0 && height > 0 ? width / height : 0;

  if (!width || !height) {
    return {
      ok: false,
      reason: 'invalid_source_dimensions',
      sourceUsed: loaded.sourceUsed,
      sourceKind: loaded.sourceKind,
    };
  }

  let effectiveWidth = width;
  let effectiveHeight = height;
  let trimApplied = false;
  let trimOffsetLeft = 0;
  let trimOffsetTop = 0;
  let trimBorderRatioX = 0;
  let trimBorderRatioY = 0;
  let trimAreaGain = 0;
  let edgeBandCropApplied = false;
  let edgeBandCropTop = 0;
  let edgeBandCropBottom = 0;
  let edgeBandCropAreaGain = 0;

  try {
    const trimmed = await sharp(loaded.buffer, { failOn: 'none' })
      .trim({ threshold: resolveTrimThreshold(process.env) })
      .toBuffer({ resolveWithObject: true });
    const trimmedWidth = Number(trimmed?.info?.width || 0);
    const trimmedHeight = Number(trimmed?.info?.height || 0);
    const nextOffsetLeft = Number(trimmed?.info?.trimOffsetLeft || 0);
    const nextOffsetTop = Number(trimmed?.info?.trimOffsetTop || 0);

    if (trimmedWidth > 0 && trimmedHeight > 0 && trimmedWidth <= width && trimmedHeight <= height) {
      const nextBorderRatioX = width > 0 ? (width - trimmedWidth) / width : 0;
      const nextBorderRatioY = height > 0 ? (height - trimmedHeight) / height : 0;
      const nextAreaGain = 1 - ((trimmedWidth * trimmedHeight) / Math.max(width * height, 1));
      const shouldUseTrimmedBounds = (
        (nextBorderRatioX >= resolveTrimBorderRatioThreshold(process.env) || nextBorderRatioY >= resolveTrimBorderRatioThreshold(process.env))
        && nextAreaGain >= resolveTrimAreaGainThreshold(process.env)
      );

      if (shouldUseTrimmedBounds) {
        effectiveWidth = trimmedWidth;
        effectiveHeight = trimmedHeight;
        trimApplied = true;
        trimOffsetLeft = nextOffsetLeft;
        trimOffsetTop = nextOffsetTop;
        trimBorderRatioX = nextBorderRatioX;
        trimBorderRatioY = nextBorderRatioY;
        trimAreaGain = nextAreaGain;
      }
    }
  } catch {
    // keep original bounds when trim probing fails
  }

  try {
    const edgeBandCrop = await detectEdgeBandCrop({
      buffer: loaded.buffer,
      width,
      height,
    });
    if (edgeBandCrop?.applied) {
      edgeBandCropApplied = true;
      edgeBandCropTop = Number(edgeBandCrop.top || 0) || 0;
      edgeBandCropBottom = Number(edgeBandCrop.bottom || 0) || 0;
      edgeBandCropAreaGain = Number(edgeBandCrop.areaGain || 0) || 0;
    }
  } catch {
    // keep original bounds when dark band probing fails
  }

  const trimOffsetRight = trimApplied
    ? Math.max(0, width - (trimOffsetLeft + effectiveWidth))
    : 0;
  const trimOffsetBottom = trimApplied
    ? Math.max(0, height - (trimOffsetTop + effectiveHeight))
    : 0;
  const effectiveOffsetLeft = trimApplied ? trimOffsetLeft : 0;
  const effectiveOffsetRight = trimApplied ? trimOffsetRight : 0;
  const effectiveOffsetTop = Math.max(trimApplied ? trimOffsetTop : 0, edgeBandCropTop);
  const effectiveOffsetBottom = Math.max(trimApplied ? trimOffsetBottom : 0, edgeBandCropBottom);
  effectiveWidth = Math.max(1, width - effectiveOffsetLeft - effectiveOffsetRight);
  effectiveHeight = Math.max(1, height - effectiveOffsetTop - effectiveOffsetBottom);
  const cropApplied = effectiveOffsetLeft > 0 || effectiveOffsetTop > 0 || effectiveOffsetRight > 0 || effectiveOffsetBottom > 0;
  const cropReason = edgeBandCropApplied
    ? 'edge_band_crop'
    : (trimApplied ? 'trimmed_bounds' : 'original_bounds');
  const effectiveAreaGain = width > 0 && height > 0
    ? 1 - ((effectiveWidth * effectiveHeight) / Math.max(width * height, 1))
    : 0;

  return {
    ok: true,
    width,
    height,
    ratio,
    aspectRatio: ratio,
    effectiveWidth,
    effectiveHeight,
    effectiveRatio: effectiveWidth > 0 && effectiveHeight > 0 ? effectiveWidth / effectiveHeight : ratio,
    trimApplied,
    trimOffsetLeft,
    trimOffsetTop,
    trimBorderRatioX,
    trimBorderRatioY,
    trimAreaGain,
    effectiveOffsetLeft,
    effectiveOffsetTop,
    effectiveOffsetRight,
    effectiveOffsetBottom,
    cropApplied,
    cropReason,
    effectiveAreaGain,
    edgeBandCropApplied,
    edgeBandCropTop,
    edgeBandCropBottom,
    edgeBandCropAreaGain,
    contentType: loaded.contentType || String(metadata?.format || '').trim() || 'image/unknown',
    sourceUsed: loaded.sourceUsed,
    sourceKind: loaded.sourceKind,
  };
}

function classifyImg2ImgSource({
  prompt = '',
  draft = {},
  sourceMeta = {},
} = {}) {
  const originalWidth = Number(sourceMeta?.width || draft?.originalSourceWidth || draft?.sourceWidth || draft?.width || 0);
  const originalHeight = Number(sourceMeta?.height || draft?.originalSourceHeight || draft?.sourceHeight || draft?.height || 0);
  const width = Number(
    sourceMeta?.effectiveWidth
    || draft?.effectiveSourceWidth
    || draft?.sourceWidth
    || draft?.width
    || originalWidth
    || 0
  );
  const height = Number(
    sourceMeta?.effectiveHeight
    || draft?.effectiveSourceHeight
    || draft?.sourceHeight
    || draft?.height
    || originalHeight
    || 0
  );
  const longestSide = Math.max(width, height, 1);
  const shortestSide = Math.max(1, Math.min(width || 1, height || 1));
  const aspectRatio = longestSide / shortestSide;
  const normalized = normalizeText(buildSourceAnalysisText({ prompt, draft, sourceMeta }));
  const portraitCanvas = height > width;
  const landscapeCanvas = width >= height;
  const groupKeywordMatch = (
    /\b(duo|pair|couple|group|groupe|crew|team|ensemble|cast|family|versus|vs\b|face off|faceoff|lineup|line up)\b/.test(normalized)
    || /\b(?:two|2|deux|three|3|trois|multiple|several)\s+(?:characters?|personnages?|people|persons?|subjects?)\b/.test(normalized)
  );
  const faceKeywordMatch = /\b(face|visage|portrait|headshot|close up|close-up|bust|buste)\b/.test(normalized);
  const fullBodyKeywordMatch = /\b(full body|full-body|plein pied|en pied|personnage entier|corps entier|character art|official art)\b/.test(normalized);
  const soloKeywordMatch = /\b(solo|single subject|sujet unique|personnage seul|full body|full-body|plein pied|en pied|character art|official art)\b/.test(normalized);
  const wideLandscapeScene = landscapeCanvas && aspectRatio >= 1.8;

  const compositeRisk = (
    draft?.compositeRisk === true
    || /\b(collage|diptyque|diptych|mosaic|mosaique|panel|sprite ?sheet|sheet|lineup|poster|wallpaper|cover)\b/.test(normalized)
    || aspectRatio >= 2.25
  );
  const duoOrGroup = (
    !compositeRisk
    && (
      groupKeywordMatch
      || wideLandscapeScene
    )
  );
  const faceSolo = (
    !compositeRisk
    && !duoOrGroup
    && !fullBodyKeywordMatch
    && (
      faceKeywordMatch
      || (portraitCanvas && aspectRatio <= 1.75)
    )
  );
  const soloSubject = (
    !compositeRisk
    && !duoOrGroup
    && !faceSolo
    && (
      soloKeywordMatch
      || portraitCanvas
    )
  );
  const sceneComplex = !compositeRisk && !duoOrGroup && !faceSolo && !soloSubject;

  const sceneKey = compositeRisk
    ? 'composite'
    : (duoOrGroup ? 'duo_group' : (faceSolo ? 'solo_face' : (soloSubject ? 'solo_subject' : 'complex_scene')));
  const sceneType = compositeRisk
    ? 'composite / diptyque / collage'
    : (duoOrGroup ? 'duo/groupe' : (faceSolo ? 'visage solo' : (soloSubject ? 'sujet solo' : 'scene complexe')));
  const canvasType = landscapeCanvas
    ? (aspectRatio >= 1.85 ? 'large' : 'landscape')
    : 'portrait';

  return {
    sceneKey,
    sceneType,
    canvasType,
    compositeRisk,
    disableMonoSubjectHeuristics: compositeRisk || duoOrGroup,
    minimumSubjectCount: compositeRisk || duoOrGroup ? 2 : 1,
    rejectCleanImg2Img: compositeRisk && draft?.explicitReferenceAnchor !== true && String(draft?.mode || '').trim() === 'web-image-draft',
    rejectionReason: compositeRisk && draft?.explicitReferenceAnchor !== true && String(draft?.mode || '').trim() === 'web-image-draft'
      ? 'source_composite_not_safe_for_clean_img2img'
      : '',
    width,
    height,
    originalWidth,
    originalHeight,
    effectiveWidth: width,
    effectiveHeight: height,
    sourceRatio: width > 0 && height > 0 ? width / height : 0,
    originalSourceRatio: originalWidth > 0 && originalHeight > 0 ? originalWidth / originalHeight : 0,
    trimApplied: sourceMeta?.trimApplied === true || draft?.sourceTrimApplied === true,
    sceneComplex,
  };
}

function resolveImg2ImgCanvasPlan({
  sourceWidth = 0,
  sourceHeight = 0,
  scene = {},
  currentWidth = 0,
  currentHeight = 0,
  env = process.env,
} = {}) {
  const width = Number(sourceWidth || 0);
  const height = Number(sourceHeight || 0);
  if (!width || !height) return null;

  const imageConfig = resolveImageDimensionConfig(env);
  const maxRenderSide = Number(imageConfig?.maxRenderSide || 2048) || 2048;
  const sourceLongestSide = Math.max(width, height, 1);
  const currentLongestSide = Math.max(Number(currentWidth || 0), Number(currentHeight || 0), 0);
  const preferredLongestSide = scene?.canvasType === 'large'
    ? 1536
    : (scene?.canvasType === 'landscape' ? 1472 : 1344);
  const targetLongestSide = Math.min(
    maxRenderSide,
    Math.max(sourceLongestSide, currentLongestSide, preferredLongestSide)
  );
  const scale = targetLongestSide / sourceLongestSide;

  return {
    source: 'web_init_image',
    reason: scene?.canvasType === 'large'
      ? 'preserve_init_image_ratio_large_scene'
      : 'preserve_init_image_ratio',
    requestedWidth: width,
    requestedHeight: height,
    width: clampDimension(Math.max(64, Math.floor(width * scale)), 64, maxRenderSide, targetLongestSide),
    height: clampDimension(Math.max(64, Math.floor(height * scale)), 64, maxRenderSide, targetLongestSide),
    maxRenderSide,
    canvasType: scene?.canvasType || '',
  };
}

function resolveImg2ImgStrength({
  scene = {},
  prompt = '',
  explicitStrength,
  taskType = 'image_reference_variation',
  initSourceMode = '',
  motionProfile = '',
  profileHint = '',
  modelProfile = '',
  bias,
} = {}) {
  const plan = resolveImg2ImgStrengthPlan({
    explicitStrength,
    prompt,
    scene,
    taskType,
    initSourceMode,
    motionProfile,
    profileHint,
    modelProfile,
    bias,
  });
  return {
    ...plan,
    rationale: plan.reason,
  };
}

function buildImg2ImgProtectionPrompts({ promptLanguage = 'fr' } = {}) {
  const useFrench = String(promptLanguage || '').trim().toLowerCase() === 'fr';
  return useFrench
    ? {
        positiveHints: [
          'preserver la structure des yeux, du nez et de la bouche',
          'garder l identite et la composition d origine lisibles',
        ],
        negativeHints: [
          'visage fusionne',
          'visages fusionnes',
          'visage duplique',
          'visages dupliques',
          'yeux deformes',
          'bouche deformee',
          'nez deforme',
          'double visage',
          'morphing facial',
        ],
      }
    : {
        positiveHints: [
          'preserve the eyes nose and mouth structure',
          'keep the original identity and composition readable',
        ],
        negativeHints: [
          'fused face',
          'merged faces',
          'duplicate face',
          'duplicate faces',
          'deformed eyes',
          'deformed mouth',
          'deformed nose',
          'double face',
          'facial morphing',
        ],
      };
}

async function enrichImg2ImgDraft({
  webImageDraft = {},
  mask = {},
  fetch = defaultFetch,
} = {}) {
  if (!webImageDraft || typeof webImageDraft !== 'object') return webImageDraft;

  const initImageUrl = String(webImageDraft.initImageUrl || '').trim();
  const initImagePath = String(webImageDraft.initImagePath || '').trim();
  if (!initImageUrl && !initImagePath) return webImageDraft;

  let sourceMeta = {
    ok: false,
    width: Number(webImageDraft.width || 0) || Number(webImageDraft.sourceWidth || 0) || 0,
    height: Number(webImageDraft.height || 0) || Number(webImageDraft.sourceHeight || 0) || 0,
    sourceUsed: initImagePath || initImageUrl,
    sourceKind: initImagePath ? 'file' : 'url',
  };

  try {
    const probed = await probeImg2ImgSource({
      imageUrl: initImageUrl,
      imagePath: initImagePath,
      fetch,
    });
    if (probed?.ok) {
      sourceMeta = probed;
    }
  } catch (error_) {
    sourceMeta = {
      ...sourceMeta,
      ok: false,
      reason: String(error_?.message || error_),
    };
  }

  const techniquePrompt = resolveMaskTechniquePrompt(mask);

  const scene = classifyImg2ImgSource({
    prompt: techniquePrompt,
    draft: webImageDraft,
    sourceMeta,
  });
  const canvasPlan = resolveImg2ImgCanvasPlan({
    sourceWidth: scene.width,
    sourceHeight: scene.height,
    scene,
    currentWidth: mask?.options?.width,
    currentHeight: mask?.options?.height,
    env: process.env,
  });
  const strengthPlan = resolveImg2ImgStrength({
    scene,
    prompt: techniquePrompt,
    explicitStrength: webImageDraft.strength,
    taskType: 'image_reference_variation',
    initSourceMode: String(webImageDraft?.mode || '').trim(),
    motionProfile: String(mask?.meta?.motionProfile || '').trim(),
    profileHint: String(webImageDraft?.strengthProfile || webImageDraft?.strength_profile || '').trim(),
  });
  const protection = buildImg2ImgProtectionPrompts({
    promptLanguage: String(mask?.meta?.promptLanguage || mask?.meta?.language || 'fr').trim() || 'fr',
  });
  let preparedSource = null;
  let preparedSourceError = '';
  try {
    preparedSource = await materializeEffectiveImg2ImgSource({
      imageUrl: initImageUrl,
      imagePath: initImagePath,
      sourceMeta,
      fetch,
    });
  } catch (error_) {
    preparedSourceError = String(error_?.message || error_);
  }
  const effectiveInitImagePath = String(preparedSource?.initImagePath || initImagePath).trim();
  const effectiveInitImageUrl = String(
    preparedSource?.preparedApplied === true
      ? (preparedSource?.initImageUrl || '')
      : (preparedSource?.initImageUrl || initImageUrl)
  ).trim();
  const sourceOriginalUsed = String(sourceMeta?.sourceUsed || initImagePath || initImageUrl).trim() || null;
  const sourceEffectiveUsed = String(
    preparedSource?.effectiveSourceUsed
    || effectiveInitImagePath
    || effectiveInitImageUrl
    || sourceOriginalUsed
    || ''
  ).trim() || null;

  return {
    ...webImageDraft,
    initImagePath: effectiveInitImagePath || '',
    initImageUrl: effectiveInitImageUrl,
    sourceWidth: scene.width || null,
    sourceHeight: scene.height || null,
    originalSourceWidth: scene.originalWidth || Number(sourceMeta?.width || 0) || null,
    originalSourceHeight: scene.originalHeight || Number(sourceMeta?.height || 0) || null,
    effectiveSourceWidth: scene.effectiveWidth || scene.width || null,
    effectiveSourceHeight: scene.effectiveHeight || scene.height || null,
    width: scene.width || Number(webImageDraft.width || 0) || null,
    height: scene.height || Number(webImageDraft.height || 0) || null,
    sourceRatio: scene.sourceRatio || null,
    originalSourceRatio: scene.originalSourceRatio || null,
    sourceTrimApplied: scene.trimApplied === true,
    sourceTrimOffsetLeft: Number(sourceMeta?.trimOffsetLeft || 0) || 0,
    sourceTrimOffsetTop: Number(sourceMeta?.trimOffsetTop || 0) || 0,
    sourceTrimBorderRatioX: Number(sourceMeta?.trimBorderRatioX || 0) || 0,
    sourceTrimBorderRatioY: Number(sourceMeta?.trimBorderRatioY || 0) || 0,
    sourceTrimAreaGain: Number(sourceMeta?.trimAreaGain || 0) || 0,
    sourceCropApplied: sourceMeta?.cropApplied === true,
    sourceCropReason: String(sourceMeta?.cropReason || '').trim() || null,
    sourceCropAreaGain: Number(sourceMeta?.effectiveAreaGain || 0) || 0,
    sourceEdgeBandCropApplied: sourceMeta?.edgeBandCropApplied === true,
    sourceEdgeBandCropTop: Number(sourceMeta?.edgeBandCropTop || 0) || 0,
    sourceEdgeBandCropBottom: Number(sourceMeta?.edgeBandCropBottom || 0) || 0,
    sourceUsed: sourceEffectiveUsed,
    sourceOriginalUsed,
    sourceKind: String(sourceMeta?.sourceKind || '').trim() || null,
    sourcePreparedApplied: preparedSource?.preparedApplied === true,
    sourcePreparedReason: String(preparedSource?.preparedReason || '').trim() || null,
    sourcePreparedPath: String(preparedSource?.initImagePath || '').trim() || null,
    sourcePreparedError: preparedSourceError || null,
    sceneKey: scene.sceneKey,
    sceneType: scene.sceneType,
    canvasType: scene.canvasType,
    disableMonoSubjectHeuristics: scene.disableMonoSubjectHeuristics === true,
    minimumSubjectCount: scene.minimumSubjectCount,
    cleanImg2ImgRejected: scene.rejectCleanImg2Img === true,
    rejectionReason: scene.rejectionReason || '',
    strength: strengthPlan.mode === 'manual' ? strengthPlan.strength : 'auto',
    strengthMode: strengthPlan.mode,
    strengthProfile: strengthPlan.profile,
    strengthReason: strengthPlan.reason,
    strengthValue: strengthPlan.strength,
    retryStrength: strengthPlan.retryStrength,
    strengthRationale: strengthPlan.rationale,
    strengthComponents: strengthPlan.components || null,
    strengthComponentStrengths: strengthPlan.componentStrengths || null,
    strengthComponentProfiles: strengthPlan.componentProfiles || null,
    strengthComponentReasons: strengthPlan.componentReasons || null,
    targetWidth: Number(canvasPlan?.width || 0) || null,
    targetHeight: Number(canvasPlan?.height || 0) || null,
    canvasReason: String(canvasPlan?.reason || 'preserve_init_image_ratio').trim() || 'preserve_init_image_ratio',
    faceProtectionPositiveHints: protection.positiveHints,
    faceProtectionNegativeHints: protection.negativeHints,
  };
}

module.exports = {
  buildImg2ImgProtectionPrompts,
  classifyImg2ImgSource,
  enrichImg2ImgDraft,
  probeImg2ImgSource,
  resolveImg2ImgCanvasPlan,
  resolveImg2ImgStrength,
};
