const crypto = require('node:crypto');
const {
  buildCanonicalImageMaskFromText,
} = require('./resolve-image-mask-from-text.cjs');
const {
  compileMaskImageGenerate,
  generateImageFromMask,
  resolveGeneratedImageUrl,
  toImageChatProxyPayload,
} = require('./image-chat-runtime.cjs');

function toUniqueStrings(values = []) {
  return [...new Set(
    (Array.isArray(values) ? values : [values])
      .map((entry) => String(entry || '').trim())
      .filter(Boolean)
  )];
}

function deepClone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function normalizePositiveHints(values = []) {
  return toUniqueStrings(values);
}

function normalizeAtelierOptions(options = {}) {
  const rawMaxRounds = Number(options?.max_rounds ?? options?.maxRounds ?? 3);
  const maxRounds = Number.isFinite(rawMaxRounds)
    ? Math.min(6, Math.max(1, Math.floor(rawMaxRounds)))
    : 3;
  const returnTrace = options?.return_trace !== undefined
    ? options.return_trace !== false
    : options?.returnTrace !== false;

  return {
    maxRounds,
    returnTrace,
  };
}

function ensureArrayField(target, field) {
  if (!target[field] || !Array.isArray(target[field])) {
    target[field] = [];
  }
  return target[field];
}

function getProfileType(mask = {}) {
  return String(mask?.meta?.subjectProfile?.type || '').trim() || 'generic_subject';
}

function getProfileRefinementPack(profileType = '') {
  switch (String(profileType || '').trim()) {
    case 'simple_food_object':
    case 'container_object':
      return {
        composition: ['objet unique isolé', 'objet centré', 'plan simple de nature morte'],
        environment: ['fond neutre simple'],
        style: [],
      };
    case 'reference_character':
      return {
        composition: ['un seul personnage complet', 'visage unique bien lisible', 'pose claire et lisible', 'silhouette reconnaissable'],
        environment: ['fond simple cohérent avec le personnage'],
        style: ['illustration nette'],
      };
    case 'single_animal':
      return {
        composition: ['un seul animal complet', 'corps complet bien visible', 'posture claire', 'silhouette lisible'],
        environment: ['décor naturel simple'],
        style: [],
      };
    case 'mythic_creature':
      return {
        composition: ['créature unique complète', 'silhouette lisible', 'forme complète visible'],
        environment: ['décor simple cohérent avec le sujet'],
        style: [],
      };
    default:
      return {
        composition: ['sujet unique bien cadré', 'silhouette lisible', 'forme complète visible'],
        environment: ['décor simple et cohérent avec le sujet'],
        style: [],
      };
  }
}

function parseVerificationNotes(notes = '') {
  const raw = String(notes || '').trim();
  const fgRatioMatch = raw.match(/\bfg_ratio=([0-9.]+)/i);
  const componentsMatch = raw.match(/\bcomponents=(\d+)/i);
  const peaksMatch = raw.match(/\bpeaks=(\d+)/i);
  return {
    raw,
    foregroundRatio: fgRatioMatch ? Number(fgRatioMatch[1]) : null,
    components: componentsMatch ? Number(componentsMatch[1]) : null,
    peaks: peaksMatch ? Number(peaksMatch[1]) : null,
    busyFullFrameScene: /\bbusy_full_frame_scene=1\b/i.test(raw),
  };
}

function inferSubjectCropping(components = []) {
  const largest = Array.isArray(components) && components.length > 0 ? components[0] : null;
  if (!largest || typeof largest !== 'object') return false;
  const touchesLeft = Number(largest.minX) <= 1;
  const touchesTop = Number(largest.minY) <= 1;
  const touchesRight = Number(largest.maxX) >= 194;
  const touchesBottom = Number(largest.maxY) >= 194;
  const touchedEdges = [touchesLeft, touchesTop, touchesRight, touchesBottom].filter(Boolean).length;
  return touchedEdges >= 2;
}

function judgeImageAtelierRound({ mask = {}, result = {}, round = 1, maxRounds = 3 } = {}) {
  const profileType = getProfileType(mask);
  const verification = result?.imageGuard?.verification && typeof result.imageGuard.verification === 'object'
    ? result.imageGuard.verification
    : null;
  const observed = verification?.observed && typeof verification.observed === 'object'
    ? verification.observed
    : {};
  const expected = verification?.expected && typeof verification.expected === 'object'
    ? verification.expected
    : {};
  const notes = parseVerificationNotes(verification?.decision?.notes || verification?.raw?.notes || '');
  const components = Array.isArray(verification?.raw?.components) ? verification.raw.components : [];
  const observedCount = Number(observed?.subject_count || 0);
  const expectedCount = Number(expected?.subject_count || 0);
  const reasons = [];
  const hasMultiplicityIssue = (
    verification?.decision?.retry === true
    || observed?.duplicate_subjects === true
    || observed?.fusion_detected === true
    || (expectedCount > 0 && observedCount > expectedCount)
  );

  if (hasMultiplicityIssue) {
    if (profileType === 'reference_character') {
      reasons.push('character_not_unique');
    } else if (profileType === 'simple_food_object' || profileType === 'container_object') {
      reasons.push('object_not_isolated');
    } else {
      reasons.push('duplicate_subject');
    }
  }

  if (notes.busyFullFrameScene) {
    reasons.push(profileType === 'simple_food_object' || profileType === 'container_object'
      ? 'object_not_isolated'
      : 'scene_too_busy');
  }

  if (inferSubjectCropping(components)) {
    reasons.push('subject_not_fully_visible');
  }

  if (
    reasons.length === 0
    && verification?.ok === true
    && (observed?.subject_match === false || Number(observed?.confidence || 0) < 0.4)
  ) {
    reasons.push('profile_not_satisfied');
  }

  const uniqueReasons = toUniqueStrings(reasons);
  const accepted = uniqueReasons.length === 0;

  return {
    accepted,
    round,
    max_rounds: maxRounds,
    profile_type: profileType,
    reasons: uniqueReasons,
    primary_reason: uniqueReasons[0] || 'ok',
    observed_subject_count: observedCount,
    expected_subject_count: expectedCount,
    confidence: Number(observed?.confidence || 0),
    guard_retry_count: Array.isArray(result?.imageGuard?.retries) ? result.imageGuard.retries.length : 0,
    verification_reason: String(verification?.decision?.reason || verification?.reason || 'ok').trim() || 'ok',
    notes: notes.raw,
  };
}

function pushAddedValues(target, field, values, refinementsApplied) {
  const additions = normalizePositiveHints(values);
  if (!additions.length) return;
  const existing = ensureArrayField(target, field);
  const before = new Set(existing.map((entry) => String(entry || '').trim()).filter(Boolean));
  const added = additions.filter((entry) => !before.has(entry));
  if (!added.length) return;
  target[field] = [...existing, ...added];
  refinementsApplied.push({ field: `inputs.${field}`, values: added });
}

function setNumericOption(target, field, value, refinementsApplied) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return;
  const current = Number(target[field]);
  if (Number.isFinite(current) && current === numeric) return;
  target[field] = numeric;
  refinementsApplied.push({ field: `options.${field}`, value: numeric });
}

function refineImageAtelierMask(mask = {}, judgement = {}, context = {}) {
  const nextMask = deepClone(mask) || {};
  nextMask.inputs = nextMask.inputs && typeof nextMask.inputs === 'object' ? nextMask.inputs : {};
  nextMask.options = nextMask.options && typeof nextMask.options === 'object' ? nextMask.options : {};

  const refinementsApplied = [];
  const profileType = judgement?.profile_type || getProfileType(nextMask);
  const profilePack = getProfileRefinementPack(profileType);
  const reasons = toUniqueStrings(judgement?.reasons || []);

  if (reasons.includes('duplicate_subject')) {
    pushAddedValues(nextMask.inputs, 'composition', [
      ...profilePack.composition,
      'un seul sujet principal',
      'sujet bien détaché',
      'lecture simple et claire',
    ], refinementsApplied);
    pushAddedValues(nextMask.inputs, 'environment', profilePack.environment, refinementsApplied);
  }

  if (reasons.includes('object_not_isolated')) {
    pushAddedValues(nextMask.inputs, 'composition', [
      ...profilePack.composition,
      'espace vide autour de l objet',
      'fond propre et simple',
    ], refinementsApplied);
    pushAddedValues(nextMask.inputs, 'environment', [
      ...profilePack.environment,
      'fond neutre simple',
    ], refinementsApplied);
  }

  if (reasons.includes('character_not_unique')) {
    pushAddedValues(nextMask.inputs, 'composition', [
      ...profilePack.composition,
      'focus sur un seul visage',
      'personnage principal seul dans l image',
    ], refinementsApplied);
    pushAddedValues(nextMask.inputs, 'environment', profilePack.environment, refinementsApplied);
    pushAddedValues(nextMask.inputs, 'style', profilePack.style, refinementsApplied);
  }

  if (reasons.includes('scene_too_busy')) {
    pushAddedValues(nextMask.inputs, 'composition', [
      'espace visuel équilibré',
      'composition simple autour du sujet',
    ], refinementsApplied);
    pushAddedValues(nextMask.inputs, 'environment', [
      'décor simple et lisible',
    ], refinementsApplied);
  }

  if (reasons.includes('subject_not_fully_visible')) {
    pushAddedValues(nextMask.inputs, 'composition', [
      'forme complète visible',
      'corps entier bien visible',
      'marge autour du sujet',
    ], refinementsApplied);
  }

  if (reasons.includes('profile_not_satisfied')) {
    pushAddedValues(nextMask.inputs, 'composition', profilePack.composition, refinementsApplied);
    pushAddedValues(nextMask.inputs, 'environment', profilePack.environment, refinementsApplied);
    pushAddedValues(nextMask.inputs, 'style', profilePack.style, refinementsApplied);
  }

  if (!refinementsApplied.length) {
    pushAddedValues(nextMask.inputs, 'composition', profilePack.composition, refinementsApplied);
    pushAddedValues(nextMask.inputs, 'environment', profilePack.environment, refinementsApplied);
    pushAddedValues(nextMask.inputs, 'style', profilePack.style, refinementsApplied);
  }

  const round = Number(context?.round || 1);
  const currentSteps = Number(nextMask.options.steps || 40);
  const currentGuidance = Number(nextMask.options.guidance_scale || 8);
  setNumericOption(nextMask.options, 'steps', Math.min(60, Math.max(currentSteps, 40) + 4), refinementsApplied);
  setNumericOption(nextMask.options, 'guidance_scale', Math.min(10, Math.max(currentGuidance, 8) + 0.3), refinementsApplied);
  const currentSeed = Number(nextMask.options.seed);
  const nextSeed = Number.isFinite(currentSeed)
    ? currentSeed + 97
    : (1000 + (round * 97));
  setNumericOption(nextMask.options, 'seed', nextSeed, refinementsApplied);

  return {
    mask: nextMask,
    refinements_applied: refinementsApplied,
  };
}

async function resolveAtelierSourceMask({
  message = '',
  rawMask = null,
  buildMaskFromText = buildCanonicalImageMaskFromText,
} = {}) {
  if (rawMask && typeof rawMask === 'object') {
    return deepClone(rawMask);
  }

  const normalizedMessage = String(message || '').trim();
  if (!normalizedMessage) {
    const error = new Error('missing_image_input');
    error.statusCode = 400;
    error.payload = {
      ok: false,
      error: 'missing_image_input',
      message: 'Fournis soit "message", soit "mask" pour lancer l atelier image.',
    };
    throw error;
  }

  const resolution = await buildMaskFromText(normalizedMessage, {
    allowCompatFallback: true,
  });
  return deepClone(resolution?.rawMask || null);
}

async function runImageAtelier({
  req,
  message = '',
  rawMask = null,
  max_rounds,
  maxRounds,
  return_trace,
  returnTrace,
  buildMaskFromText = buildCanonicalImageMaskFromText,
  generateFromMask = generateImageFromMask,
  judgeRound = judgeImageAtelierRound,
  refineMask = refineImageAtelierMask,
  generateImage,
  generateSd,
  verifyImageCardinality,
  inspectGeneratedImageResult,
  imageVerificationEnabled,
  maxVerificationRetries,
} = {}) {
  const atelierOptions = normalizeAtelierOptions({
    max_rounds,
    maxRounds,
    return_trace,
    returnTrace,
  });
  const requestId = `atelier-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  let workingMask = await resolveAtelierSourceMask({
    message,
    rawMask,
    buildMaskFromText,
  });
  let finalResult = null;
  let acceptedRound = null;
  let stopReason = 'max_rounds_reached';
  let pendingRefinements = [];
  const traceRounds = [];

  for (let round = 1; round <= atelierOptions.maxRounds; round += 1) {
    const compiledState = compileMaskImageGenerate(workingMask);
    const roundStart = Date.now();
    const roundResult = await generateFromMask({
      req,
      rawMask: compiledState.mask,
      generateImage,
      generateSd,
      verifyImageCardinality,
      inspectGeneratedImageResult,
      imageVerificationEnabled,
      maxVerificationRetries,
    });
    const judgement = judgeRound({
      mask: compiledState.mask,
      result: roundResult,
      round,
      maxRounds: atelierOptions.maxRounds,
    });
    const durationMs = Date.now() - roundStart;

    traceRounds.push({
      round,
      mask_snapshot: compiledState.mask,
      compiled_prompt: String(compiledState?.sdBody?.prompt || '').trim(),
      sd_body: compiledState.sdBody,
      image_url: resolveGeneratedImageUrl(roundResult.sdResult),
      judgement,
      refinements_applied: pendingRefinements,
      duration_ms: durationMs,
    });

    finalResult = roundResult;

    if (judgement.accepted) {
      acceptedRound = round;
      stopReason = 'accepted';
      break;
    }

    if (round >= atelierOptions.maxRounds) {
      stopReason = 'max_rounds_reached';
      break;
    }

    const refined = refineMask(compiledState.mask, judgement, {
      round,
      maxRounds: atelierOptions.maxRounds,
      result: roundResult,
      requestId,
    });
    pendingRefinements = Array.isArray(refined?.refinements_applied) ? refined.refinements_applied : [];
    if (!pendingRefinements.length || !refined?.mask) {
      stopReason = 'no_refinement_available';
      break;
    }
    workingMask = refined.mask;
  }

  if (!finalResult) {
    const error = new Error('image_atelier_failed');
    error.statusCode = 500;
    error.payload = {
      ok: false,
      error: 'image_atelier_failed',
      message: "L'atelier image n'a produit aucun résultat.",
    };
    throw error;
  }

  const profileType = getProfileType(traceRounds[0]?.mask_snapshot || workingMask || {});
  const summary = {
    accepted_round: acceptedRound,
    stop_reason: stopReason,
    profile_type: profileType,
    round_count: traceRounds.length,
  };

  return {
    ...finalResult,
    atelier: {
      mode: 'assisted',
      request_id: requestId,
      rounds: traceRounds.length,
      final_round: traceRounds.length,
      stop_reason: stopReason,
      summary,
      trace: atelierOptions.returnTrace
        ? { rounds: traceRounds, summary }
        : { summary },
    },
  };
}

function toImageAtelierPayload(result = {}) {
  const payload = toImageChatProxyPayload(result);
  return {
    ...payload,
    atelier: result.atelier || null,
    a11Agent: {
      ...(payload.a11Agent && typeof payload.a11Agent === 'object' ? payload.a11Agent : {}),
      atelier: result.atelier || null,
    },
  };
}

module.exports = {
  normalizeAtelierOptions,
  judgeImageAtelierRound,
  refineImageAtelierMask,
  runImageAtelier,
  toImageAtelierPayload,
};
