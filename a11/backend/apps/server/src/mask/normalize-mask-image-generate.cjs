// normalize-mask-image-generate.cjs
// Remplit les valeurs par défaut et corrige les types pour MASK image.generate

const {
  compileCharacterCountConstraints,
  isMultiSubjectSceneRequest,
} = require('./build-sd-prompt-bundle.cjs');

function isTruthy(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, numeric));
}

function roundDimensionToMultiple(value, multiple = 64) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return Math.max(multiple, Math.round(numeric / multiple) * multiple);
}

function isLocalImageRuntime(env = process.env) {
  return isTruthy(env?.A11_LOCAL_MODE)
    || String(env?.A11_RUNTIME_PROFILE || '').trim().toLowerCase() === 'local';
}

function resolveImageDimensionConfig(env = process.env) {
  const localRuntime = isLocalImageRuntime(env);
  const maxRenderSide = clampNumber(env.A11_IMAGE_MAX_RENDER_SIDE, 256, 4096, 2048);
  const defaultRenderSide = localRuntime ? maxRenderSide : 768;
  const hasExplicitDefaultWidth = Number.isFinite(Number(env.A11_IMAGE_DEFAULT_WIDTH)) && Number(env.A11_IMAGE_DEFAULT_WIDTH) > 0;
  const hasExplicitDefaultHeight = Number.isFinite(Number(env.A11_IMAGE_DEFAULT_HEIGHT)) && Number(env.A11_IMAGE_DEFAULT_HEIGHT) > 0;
  const defaultWidth = roundDimensionToMultiple(
    clampNumber(env.A11_IMAGE_DEFAULT_WIDTH, 64, maxRenderSide, defaultRenderSide)
  ) || defaultRenderSide;
  const defaultHeight = roundDimensionToMultiple(
    clampNumber(env.A11_IMAGE_DEFAULT_HEIGHT, 64, maxRenderSide, defaultRenderSide)
  ) || defaultRenderSide;

  return {
    localRuntime,
    maxRenderSide,
    defaultWidth,
    defaultHeight,
    hasExplicitDefaultWidth,
    hasExplicitDefaultHeight,
    hasExplicitDefaultCanvas: hasExplicitDefaultWidth || hasExplicitDefaultHeight,
  };
}

function hasExplicitDimension(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0;
}

function collectSizingText(rawMask = {}, prompt = '') {
  const values = [
    prompt,
    rawMask?.raw,
    ...(Array.isArray(rawMask?.inputs?.subject) ? rawMask.inputs.subject : []),
    ...(Array.isArray(rawMask?.inputs?.environment) ? rawMask.inputs.environment : []),
    ...(Array.isArray(rawMask?.inputs?.composition) ? rawMask.inputs.composition : []),
    ...(Array.isArray(rawMask?.inputs?.style) ? rawMask.inputs.style : []),
  ];
  return values
    .map((entry) => String(entry || '').trim())
    .filter(Boolean)
    .join(' ');
}

function fitCanvasToMaxSide(width, height, maxRenderSide) {
  const safeWidth = roundDimensionToMultiple(width, 64);
  const safeHeight = roundDimensionToMultiple(height, 64);
  const largestSide = Math.max(safeWidth, safeHeight, 1);
  if (largestSide <= maxRenderSide) {
    return { width: safeWidth, height: safeHeight };
  }
  const ratio = maxRenderSide / largestSide;
  return {
    width: roundDimensionToMultiple(Math.max(64, Math.floor(safeWidth * ratio)), 64),
    height: roundDimensionToMultiple(Math.max(64, Math.floor(safeHeight * ratio)), 64),
  };
}

function resolveAutoImageCanvas({ rawMask = {}, prompt = '', imageConfig = resolveImageDimensionConfig(process.env) } = {}) {
  const profileType = String(rawMask?.meta?.subjectProfile?.type || '').trim().toLowerCase();
  const sizingText = collectSizingText(rawMask, prompt);
  const pair = compileCharacterCountConstraints(String(prompt || rawMask?.raw || '').trim());
  const multiSubjectScene = Boolean(pair?.count >= 2) || isMultiSubjectSceneRequest(sizingText);
  const portraitRequested = (
    !multiSubjectScene
    && (
      /\b(portrait|visage|buste|headshot|close[- ]?up)\b/i.test(sizingText)
      || ['reference_character', 'single_human_figure'].includes(profileType)
    )
  );
  const landscapeRequested = multiSubjectScene
    || /\b(scene|combat|battle|panorama|panoramique|landscape|fresque|duel|avec|ensemble)\b/i.test(sizingText);
  const ambitiousRequested = (
    landscapeRequested
    || /\b(4k|8k|ultra|epic|cin[eé]mat|d[eé]taill|wallpaper|poster|affiche|haute d[eé]finition)\b/i.test(sizingText)
  );

  let canvas = ambitiousRequested
    ? { width: 1344, height: 1344 }
    : { width: 1024, height: 1024 };
  let reason = ambitiousRequested ? 'high_detail_square_scene' : 'single_subject_square';

  if (landscapeRequested) {
    canvas = ambitiousRequested
      ? { width: 1536, height: 896 }
      : { width: 1344, height: 768 };
    reason = multiSubjectScene ? 'multi_subject_scene' : 'wide_scene';
  } else if (portraitRequested) {
    canvas = ambitiousRequested
      ? { width: 1024, height: 1536 }
      : { width: 896, height: 1344 };
    reason = 'portrait_subject';
  }

  const fitted = fitCanvasToMaxSide(canvas.width, canvas.height, imageConfig.maxRenderSide);
  return {
    source: 'auto_scene',
    reason,
    requestedWidth: null,
    requestedHeight: null,
    width: fitted.width,
    height: fitted.height,
  };
}

function resolveImageCanvasPlan({ rawMask = {}, prompt = '', width, height, env = process.env } = {}) {
  const imageConfig = resolveImageDimensionConfig(env);
  const explicitWidth = hasExplicitDimension(width);
  const explicitHeight = hasExplicitDimension(height);

  if (explicitWidth || explicitHeight) {
    return {
      source: explicitWidth && explicitHeight ? 'request_explicit' : 'request_partial',
      reason: explicitWidth && explicitHeight ? 'explicit_dimensions' : 'partial_explicit_dimensions',
      requestedWidth: explicitWidth ? Number(width) : null,
      requestedHeight: explicitHeight ? Number(height) : null,
      width: explicitWidth ? Number(width) : imageConfig.defaultWidth,
      height: explicitHeight ? Number(height) : imageConfig.defaultHeight,
    };
  }

  if (imageConfig.hasExplicitDefaultCanvas) {
    return {
      source: 'env_default',
      reason: 'configured_default_dimensions',
      requestedWidth: null,
      requestedHeight: null,
      width: imageConfig.defaultWidth,
      height: imageConfig.defaultHeight,
    };
  }

  return resolveAutoImageCanvas({ rawMask, prompt, imageConfig });
}

function buildDefaults(env = process.env) {
  const imageConfig = resolveImageDimensionConfig(env);
  return {
    version: 'mask-1',
    intent: 'image.generate',
    task: { domain: 'image', action: 'generate' },
    compiler: { target: 'image-prompt-fr', version: '1.0' },
    inputs: {
      subject: [],
      environment: [],
      style: [],
      composition: [],
      lighting: [],
      palette: []
    },
    options: {
      width: imageConfig.defaultWidth,
      height: imageConfig.defaultHeight,
      steps: 30,
      guidance_scale: 7.5
    },
    constraints: {
      safe_mode: true,
      no_text: true
    },
    ambiguities: [],
    meta: {},
    raw: ''
  };
}

function normalizeMaskImageGenerate(mask) {
  const defaults = buildDefaults(process.env);
  const imageConfig = resolveImageDimensionConfig(process.env);
  const out = JSON.parse(JSON.stringify(defaults));
  if (!mask || typeof mask !== 'object') return out;
  for (const k of Object.keys(defaults)) {
    if (mask[k] !== undefined) out[k] = mask[k];
  }
  // Deep merge for nested objects/arrays
  for (const k of ['inputs','options','constraints']) {
    if (mask[k] && typeof mask[k] === 'object') {
      for (const sub of Object.keys(defaults[k])) {
        if (mask[k][sub] !== undefined) out[k][sub] = mask[k][sub];
      }
    }
  }
  // Force arrays for inputs
  for (const arr of ['subject','environment','style','composition','lighting','palette']) {
    if (!Array.isArray(out.inputs[arr])) out.inputs[arr] = [String(out.inputs[arr]||'')].filter(Boolean);
    out.inputs[arr] = out.inputs[arr].map(x => String(x).trim()).filter(Boolean);
  }
  // Clamp options (aligné sur validate-mask-image-generate.cjs)
  const IMAGE_MIN_SIZE = 64;
  const IMAGE_MAX_SIZE = Number(process.env.A11_IMAGE_MAX_SIZE || imageConfig.maxRenderSide || 2048);
  function clampAndRoundDimension(val, fallback) {
    let n = Number(val);
    if (!Number.isFinite(n)) n = fallback;
    n = Math.round(n);
    // Pair uniquement si > 1
    if (n > 1 && n % 2 !== 0) n = n - 1;
    return Math.max(IMAGE_MIN_SIZE, Math.min(IMAGE_MAX_SIZE, n));
  }
  const existingRenderSizing = mask?.meta?.renderSizing && typeof mask.meta.renderSizing === 'object'
    ? mask.meta.renderSizing
    : null;
  const shouldPreserveExistingRenderSizing = (
    existingRenderSizing?.source === 'web_init_image'
    && !/\b\d{3,4}\s*[xX]\s*\d{3,4}\b/.test(String(out.raw || '').trim())
  );
  const canvasPlan = shouldPreserveExistingRenderSizing
    ? {
        source: String(existingRenderSizing.source || 'web_init_image').trim() || 'web_init_image',
        reason: String(existingRenderSizing.reason || 'preserve_init_image_ratio').trim() || 'preserve_init_image_ratio',
        requestedWidth: Number(existingRenderSizing.requestedWidth || 0) || null,
        requestedHeight: Number(existingRenderSizing.requestedHeight || 0) || null,
        width: Number(existingRenderSizing.resolvedWidth || mask?.options?.width || out.options.width),
        height: Number(existingRenderSizing.resolvedHeight || mask?.options?.height || out.options.height),
      }
    : resolveImageCanvasPlan({
        rawMask: out,
        prompt: out.raw,
        width: mask?.options?.width,
        height: mask?.options?.height,
        env: process.env,
      });
  out.options.width = clampAndRoundDimension(canvasPlan.width, imageConfig.defaultWidth);
  out.options.height = clampAndRoundDimension(canvasPlan.height, imageConfig.defaultHeight);
  out.options.steps = Math.max(1, Math.min(100, Number(out.options.steps)||30));
  out.options.guidance_scale = Math.max(1, Math.min(30, Number(out.options.guidance_scale)||7.5));
  out.meta = out.meta && typeof out.meta === 'object' ? out.meta : {};
  out.meta.renderSizing = {
    source: canvasPlan.source,
    reason: canvasPlan.reason,
    requestedWidth: canvasPlan.requestedWidth,
    requestedHeight: canvasPlan.requestedHeight,
    resolvedWidth: out.options.width,
    resolvedHeight: out.options.height,
    maxRenderSide: imageConfig.maxRenderSide,
  };
  return out;
}

module.exports = normalizeMaskImageGenerate;
module.exports.resolveImageDimensionConfig = resolveImageDimensionConfig;
module.exports.resolveAutoImageCanvas = resolveAutoImageCanvas;
module.exports.resolveImageCanvasPlan = resolveImageCanvasPlan;
