const {
  compileCharacterCountConstraints,
  compileSingleSubjectConstraints,
} = require('../mask/build-sd-prompt-bundle.cjs');

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

function normalizeText(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
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

  const single = compileSingleSubjectConstraints(rawPrompt);
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
  const mode = String(
    overrides.mode
    || process.env.A11_IMAGE_CARDINALITY_CLASSIFIER
    || process.env.A11_VISION_MODE
    || 'local_heuristic'
  ).trim().toLowerCase();
  const sharp = getSharp();

  return {
    mode,
    provider: 'local',
    classifier: 'local_heuristic',
    available: mode !== 'disabled' && Boolean(sharp),
    reason: sharp ? 'local_classifier_ready' : 'sharp_unavailable',
  };
}

function shouldLogVerificationDebug(result = {}) {
  const expectedCount = Number(result?.expected?.subject_count || 0);
  const observedCount = Number(result?.observed?.subject_count || 0);
  const confidence = Number(result?.observed?.confidence || 0);
  return (
    result?.decision?.retry === true
    || result?.observed?.duplicate_subjects === true
    || result?.observed?.fusion_detected === true
    || (expectedCount > 0 && observedCount !== expectedCount)
    || confidence < 0.45
    || String(process.env.A11_IMAGE_CARDINALITY_DEBUG || '').trim().toLowerCase() === 'true'
  );
}

function buildVerificationDebugMeta(result = {}) {
  const raw = result?.raw && typeof result.raw === 'object' ? result.raw : {};
  return {
    expected_subject_count: Number(result?.expected?.subject_count || 0),
    observed_subject_count: Number(result?.observed?.subject_count || 0),
    duplicate_subjects: result?.observed?.duplicate_subjects === true,
    fusion_detected: result?.observed?.fusion_detected === true,
    subject_match: result?.observed?.subject_match !== false,
    confidence: Number(result?.observed?.confidence || 0),
    reason: String(result?.decision?.reason || '').trim() || 'unknown',
    notes: String(result?.decision?.notes || raw?.notes || '').trim(),
    components: Array.isArray(raw?.components) ? raw.components : [],
  };
}

async function fetchImageBuffer(imageUrl, fetch = defaultFetch) {
  const normalizedImageUrl = String(imageUrl || '').trim();
  if (!normalizedImageUrl) {
    throw new Error('missing_image_url');
  }
  if (/^data:/i.test(normalizedImageUrl)) {
    const match = normalizedImageUrl.match(/^data:([^;,]+)?(?:;charset=[^;,]+)?(;base64)?,(.*)$/i);
    if (!match?.[3]) throw new Error('invalid_data_url');
    const payload = match[3];
    return Buffer.from(payload, match[2] ? 'base64' : 'utf8');
  }

  const response = await fetch(normalizedImageUrl);
  if (!response.ok) {
    throw new Error(`image_fetch_failed:${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

function computeBorderBackgroundColor(raw, width, height, channels) {
  const samples = [];
  const pushPixel = (x, y) => {
    const offset = (y * width + x) * channels;
    const alpha = channels >= 4 ? raw[offset + 3] : 255;
    if (alpha < 24) return;
    samples.push([raw[offset], raw[offset + 1], raw[offset + 2]]);
  };

  for (let x = 0; x < width; x += 1) {
    pushPixel(x, 0);
    if (height > 1) pushPixel(x, height - 1);
  }
  for (let y = 1; y < height - 1; y += 1) {
    pushPixel(0, y);
    if (width > 1) pushPixel(width - 1, y);
  }

  if (samples.length === 0) {
    return { r: 255, g: 255, b: 255 };
  }

  const totals = samples.reduce((acc, sample) => {
    acc.r += sample[0];
    acc.g += sample[1];
    acc.b += sample[2];
    return acc;
  }, { r: 0, g: 0, b: 0 });

  return {
    r: totals.r / samples.length,
    g: totals.g / samples.length,
    b: totals.b / samples.length,
  };
}

function buildForegroundMask(raw, width, height, channels, background) {
  const mask = new Uint8Array(width * height);
  const backgroundLuma = (0.2126 * background.r) + (0.7152 * background.g) + (0.0722 * background.b);

  for (let index = 0; index < width * height; index += 1) {
    const offset = index * channels;
    const r = raw[offset];
    const g = raw[offset + 1];
    const b = raw[offset + 2];
    const alpha = channels >= 4 ? raw[offset + 3] : 255;
    if (alpha < 24) continue;

    const dr = r - background.r;
    const dg = g - background.g;
    const db = b - background.b;
    const colorDistance = Math.sqrt((dr * dr) + (dg * dg) + (db * db));
    const luma = (0.2126 * r) + (0.7152 * g) + (0.0722 * b);
    const lumaDistance = Math.abs(luma - backgroundLuma);
    if (colorDistance >= 42 || lumaDistance >= 28) {
      mask[index] = 1;
    }
  }

  return mask;
}

function dilateMask(mask, width, height) {
  const next = new Uint8Array(mask.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let active = 0;
      for (let dy = -1; dy <= 1 && !active; dy += 1) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          if (mask[ny * width + nx]) {
            active = 1;
            break;
          }
        }
      }
      next[y * width + x] = active;
    }
  }
  return next;
}

function extractConnectedComponents(mask, width, height) {
  const visited = new Uint8Array(mask.length);
  const queueX = new Int32Array(mask.length);
  const queueY = new Int32Array(mask.length);
  const components = [];
  const minArea = Math.max(24, Math.floor(width * height * 0.0035));

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const rootIndex = y * width + x;
      if (!mask[rootIndex] || visited[rootIndex]) continue;

      let head = 0;
      let tail = 0;
      let area = 0;
      let minX = x;
      let minY = y;
      let maxX = x;
      let maxY = y;

      visited[rootIndex] = 1;
      queueX[tail] = x;
      queueY[tail] = y;
      tail += 1;

      while (head < tail) {
        const cx = queueX[head];
        const cy = queueY[head];
        head += 1;
        area += 1;
        if (cx < minX) minX = cx;
        if (cy < minY) minY = cy;
        if (cx > maxX) maxX = cx;
        if (cy > maxY) maxY = cy;

        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            if (dx === 0 && dy === 0) continue;
            const nx = cx + dx;
            const ny = cy + dy;
            if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
            const nextIndex = ny * width + nx;
            if (!mask[nextIndex] || visited[nextIndex]) continue;
            visited[nextIndex] = 1;
            queueX[tail] = nx;
            queueY[tail] = ny;
            tail += 1;
          }
        }
      }

      if (area < minArea) continue;
      components.push({
        area,
        minX,
        minY,
        maxX,
        maxY,
        width: maxX - minX + 1,
        height: maxY - minY + 1,
        centerX: (minX + maxX) / 2,
        centerY: (minY + maxY) / 2,
      });
    }
  }

  return components;
}

function mergeNearbyComponents(components, width, height) {
  if (!Array.isArray(components) || components.length <= 1) return components || [];
  const gap = Math.max(4, Math.floor(Math.min(width, height) * 0.035));
  const merged = [];

  for (const component of [...components].sort((a, b) => b.area - a.area)) {
    const current = { ...component };
    let didMerge = false;

    for (const candidate of merged) {
      const overlapsX = current.minX <= candidate.maxX + gap && current.maxX >= candidate.minX - gap;
      const overlapsY = current.minY <= candidate.maxY + gap && current.maxY >= candidate.minY - gap;
      if (!overlapsX || !overlapsY) continue;

      candidate.minX = Math.min(candidate.minX, current.minX);
      candidate.minY = Math.min(candidate.minY, current.minY);
      candidate.maxX = Math.max(candidate.maxX, current.maxX);
      candidate.maxY = Math.max(candidate.maxY, current.maxY);
      candidate.area += current.area;
      candidate.width = candidate.maxX - candidate.minX + 1;
      candidate.height = candidate.maxY - candidate.minY + 1;
      candidate.centerX = (candidate.minX + candidate.maxX) / 2;
      candidate.centerY = (candidate.minY + candidate.maxY) / 2;
      didMerge = true;
      break;
    }

    if (!didMerge) merged.push(current);
  }

  return merged.sort((a, b) => b.area - a.area);
}

function countForeground(mask) {
  let total = 0;
  for (let index = 0; index < mask.length; index += 1) {
    total += mask[index] ? 1 : 0;
  }
  return total;
}

function countHorizontalPeaks(mask, width, height, box) {
  if (!box) return 0;
  const projection = [];
  for (let x = box.minX; x <= box.maxX; x += 1) {
    let sum = 0;
    for (let y = box.minY; y <= box.maxY; y += 1) {
      sum += mask[y * width + x] ? 1 : 0;
    }
    projection.push(sum);
  }
  if (projection.length < 5) return 0;

  const smooth = projection.map((_, index) => {
    const start = Math.max(0, index - 1);
    const end = Math.min(projection.length - 1, index + 1);
    let total = 0;
    for (let cursor = start; cursor <= end; cursor += 1) total += projection[cursor];
    return total / (end - start + 1);
  });
  const maxValue = Math.max(...smooth, 0);
  if (maxValue <= 0) return 0;
  const threshold = maxValue * 0.34;
  let peaks = 0;

  for (let index = 1; index < smooth.length - 1; index += 1) {
    if (smooth[index] < threshold) continue;
    if (smooth[index] >= smooth[index - 1] && smooth[index] >= smooth[index + 1]) {
      peaks += 1;
      index += 2;
    }
  }

  return peaks;
}

function classifyComponents({ components, expected, mask, width, height, foregroundRatio }) {
  const expectedCount = Number(expected?.subjectCount || 0);
  const topComponents = [...components].sort((a, b) => b.area - a.area).slice(0, 3);
  const observedCount = topComponents.length;
  const largest = topComponents[0] || null;
  const second = topComponents[1] || null;
  const areaRatio = largest && second ? second.area / Math.max(largest.area, 1) : 0;
  const duplicateSubjects = expectedCount === 1
    && observedCount > 1
    && areaRatio >= 0.28;
  const horizontalPeaks = largest ? countHorizontalPeaks(mask, width, height, largest) : 0;
  const fullFrameComponent = Boolean(
    largest
    && largest.width >= Math.floor(width * 0.96)
    && largest.height >= Math.floor(height * 0.96)
  );
  const busyFullFrameScene = expectedCount === 1
    && observedCount === 1
    && fullFrameComponent
    && foregroundRatio >= 0.92
    && horizontalPeaks >= 8;
  const fusionDetected = expectedCount === 1
    && observedCount === 1
    && largest
    && largest.width > largest.height * 1.18
    && horizontalPeaks >= 2;
  const subjectMatch = !busyFullFrameScene && observedCount >= Math.min(expectedCount || 1, 1);
  const confidence = clamp01(
    observedCount === 0
      ? 0.08
      : 0.46 + Math.min(0.38, foregroundRatio * 1.6) + (duplicateSubjects || fusionDetected ? 0.1 : 0.04) - (busyFullFrameScene ? 0.26 : 0)
  );

  return {
    observed_subject_count: observedCount,
    observed_subject_label: subjectMatch
      ? String(expected?.subjectLabel || expected?.subjectType || 'subject').trim()
      : '',
    duplicate_subjects: duplicateSubjects,
    fusion_detected: fusionDetected || busyFullFrameScene,
    subject_match: subjectMatch,
    confidence,
    notes: `local_heuristic fg_ratio=${foregroundRatio.toFixed(3)} components=${observedCount} peaks=${horizontalPeaks}${busyFullFrameScene ? ' busy_full_frame_scene=1' : ''}`,
    components: topComponents.map((component) => ({
      area: component.area,
      width: component.width,
      height: component.height,
      minX: component.minX,
      minY: component.minY,
      maxX: component.maxX,
      maxY: component.maxY,
    })),
  };
}

async function classifyImageCardinalityLocally({ imageUrl, expected, fetch = defaultFetch } = {}) {
  const sharp = getSharp();
  if (!sharp) {
    const error = new Error('sharp_unavailable');
    error.code = 'sharp_unavailable';
    throw error;
  }

  const inputBuffer = await fetchImageBuffer(imageUrl, fetch);
  const prepared = sharp(inputBuffer, { failOn: 'none' })
    .resize({ width: 196, height: 196, fit: 'inside', withoutEnlargement: true })
    .ensureAlpha();
  const { data, info } = await prepared.raw().toBuffer({ resolveWithObject: true });
  const width = Number(info?.width || 0);
  const height = Number(info?.height || 0);
  const channels = Number(info?.channels || 4);
  if (!width || !height) {
    return {
      observed_subject_count: 0,
      observed_subject_label: '',
      duplicate_subjects: false,
      fusion_detected: false,
      subject_match: false,
      confidence: 0,
      notes: 'local_heuristic invalid_dimensions',
      components: [],
    };
  }

  const background = computeBorderBackgroundColor(data, width, height, channels);
  const mask = dilateMask(buildForegroundMask(data, width, height, channels, background), width, height);
  const components = mergeNearbyComponents(extractConnectedComponents(mask, width, height), width, height);
  const foregroundRatio = countForeground(mask) / Math.max(width * height, 1);

  return classifyComponents({
    components,
    expected,
    mask,
    width,
    height,
    foregroundRatio,
  });
}

async function verifyGeneratedImageCardinality({
  imageUrl,
  expected,
  requestId = '',
  prompt = '',
  seed,
  fetch = defaultFetch,
  classifier = classifyImageCardinalityLocally,
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

  const expectedLabel = String(expected.subjectLabel || expected.subjectType || 'subject').trim();
  let parsed = null;
  try {
    parsed = await classifier({
      imageUrl: normalizedImageUrl,
      expected,
      requestId,
      prompt,
      seed,
      fetch,
      config,
    });
  } catch (error_) {
    const error = new Error(`vision_verify_failed:local:${String(error_?.message || error_)}`);
    error.cause = error_;
    throw error;
  }

  if (!parsed || typeof parsed !== 'object') {
    return {
      ok: false,
      skipped: true,
      reason: 'vision_parse_failed',
      raw: null,
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

  const result = {
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

  if (shouldLogVerificationDebug(result)) {
    const debugMeta = buildVerificationDebugMeta(result);
    console.warn(
      `[A11][image-cardinality] requestId=${String(requestId || 'unknown').trim() || 'unknown'}`
      + ` mode=${String(config.mode || 'local').trim() || 'local'}`
      + ` expected=${debugMeta.expected_subject_count}`
      + ` observed=${debugMeta.observed_subject_count}`
      + ` retry=${result.decision.retry === true ? 'yes' : 'no'}`
      + ` confidence=${debugMeta.confidence.toFixed(2)}`
      + ` reason=${debugMeta.reason}`
      + ` duplicate=${debugMeta.duplicate_subjects ? 'yes' : 'no'}`
      + ` fusion=${debugMeta.fusion_detected ? 'yes' : 'no'}`
      + ` components=${debugMeta.components.length}`
      + ` notes=${debugMeta.notes || 'none'}`
    );
  }

  return result;
}

function buildRetrySdBody(sdBody = {}, verification = {}, options = {}) {
  const expected = verification?.expected || {};
  const subjectLabel = String(expected.subject_label || expected.subject_type || 'subject').trim() || 'subject';
  const useFrenchPrompt = String(sdBody?.prompt_language || '').trim().toLowerCase() === 'fr';
  const fusionDetected = verification?.observed?.fusion_detected === true;
  const duplicateSubjects = verification?.observed?.duplicate_subjects === true
    || Number(verification?.observed?.subject_count || 0) > Number(expected?.subject_count || 0);
  const retryPromptHints = useFrenchPrompt
    ? [
        `montrer un seul ${subjectLabel}`,
        'sujet principal seul dans la scène',
        'silhouette claire et lisible',
        'forme complète visible',
        'corps entier bien défini',
        'composition simple autour du sujet',
        'sujet centré et bien détaché',
        ...(duplicateSubjects ? [
          'présenter uniquement le sujet principal',
          'garder la scène épurée autour du sujet',
        ] : []),
        ...(fusionDetected ? [
          'éléments du corps bien séparés et lisibles',
          'formes du sujet nettes et distinctes',
        ] : []),
      ]
    : [
        `show a single ${subjectLabel}`,
        'main subject alone in the scene',
        'clear readable silhouette',
        'full visible form',
        'well defined full body',
        'simple composition around the subject',
        'centered well separated subject',
        ...(duplicateSubjects ? [
          'present only the main subject',
          'keep the scene clean around the subject',
        ] : []),
        ...(fusionDetected ? [
          'body parts clearly separated and readable',
          'clean distinct subject shapes',
        ] : []),
      ];
  // Déduplication des hints : on n'ajoute que ceux qui ne sont pas déjà présents dans le prompt
  const basePrompt = String(sdBody.prompt || '').trim();

  const uniqueRetryPromptHints = retryPromptHints.filter((h) => {
    if (!basePrompt) return true;
    return !basePrompt.toLowerCase().includes(h.toLowerCase());
  });

  const mergedPrompt = [basePrompt, uniqueRetryPromptHints.join(', ')].filter(Boolean).join('. ').trim();

  const currentSeed = Number(sdBody.seed);
  const retrySeedBase = Number.isFinite(currentSeed) ? currentSeed : Number(options.seed || Date.now());

  return {
    ...sdBody,
    prompt: mergedPrompt,
    prompt_prebuilt: true,
    seed: retrySeedBase + 97,
  };
}

module.exports = {
  buildVerificationDebugMeta,
  inferExpectedImageContract,
  resolveVisionConfig,
  classifyImageCardinalityLocally,
  verifyGeneratedImageCardinality,
  buildRetrySdBody,
};
