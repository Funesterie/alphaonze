const VALID_IMG2IMG_STRENGTH_PROFILES = Object.freeze([
  'preserve',
  'balanced',
  'restyle',
  'motion_continuity',
]);
const VALID_IMG2IMG_STRENGTH_COMPONENTS = Object.freeze([
  'identity',
  'anatomy',
  'outfit',
  'background',
  'effects',
  'props',
]);

function normalizeModelProfile(value = '', env = process.env) {
  const explicit = String(value || '').trim().toLowerCase();
  if (explicit) return explicit;
  return String(env.SD_MODEL_PROFILE || '').trim().toLowerCase();
}

function isTurboModel(modelProfile = '', env = process.env) {
  const profile = normalizeModelProfile(modelProfile, env);
  return profile.includes('turbo');
}

function resolveStrengthProfileRanges({ modelProfile = '', env = process.env } = {}) {
  return isTurboModel(modelProfile, env)
    ? {
        preserve: { min: 0.30, max: 0.50 },
        balanced: { min: 0.62, max: 0.78 },
        restyle: { min: 0.72, max: 0.88 },
        motion_continuity: { min: 0.58, max: 0.75 },
      }
    : {
        preserve: { min: 0.22, max: 0.38 },
        balanced: { min: 0.48, max: 0.68 },
        restyle: { min: 0.60, max: 0.78 },
        motion_continuity: { min: 0.42, max: 0.62 },
      };
}

const IMG2IMG_STRENGTH_PROFILE_RANGES = Object.freeze({
  preserve: Object.freeze({ min: 0.22, max: 0.38 }),
  balanced: Object.freeze({ min: 0.48, max: 0.68 }),
  restyle: Object.freeze({ min: 0.60, max: 0.78 }),
  motion_continuity: Object.freeze({ min: 0.42, max: 0.62 }),
});

function normalizeText(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, ' ')
    .replace(/[_-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, numeric));
}

function clampUnitInterval(value, fallback = 0.5) {
  return clampNumber(value, 0, 1, fallback);
}

function hasExplicitStrongStylization(prompt = '') {
  return /\b(stylisation forte|fortement stylise|fortement stylisee|tres stylise|tres stylisee|reinterpretation forte|reimagine radicalement|strong stylization|heavily stylized|radical restyle)\b/i.test(String(prompt || ''));
}

function hasStylizedReferenceTransformationSignal(prompt = '') {
  return /\b(dragon ?ball(?: ?z)?|dbz|one piece|naruto|bleach|ghibli|anime|manga|comic book|comic-book|bande dessinee|bande-dessinee|cel shading|cel-shading|toon shading|toon-shading|pixar|disney)\b/i.test(String(prompt || ''));
}

function hasJokerStyleTransformationSignal(prompt = '') {
  return /\b(joker(?:[ -]?style|[ -]?themed)?|joker-inspired|joker inspired|character inspired by the joker|personnage inspire du joker|transform(?:ed|ing)? .* joker|joker-style transformation|joker style transformation)\b/i.test(String(prompt || ''));
}

function hasAccessoryEditSignal(prompt = '') {
  return /\b(accessoire|accessory|chapeau|hat|lunettes|glasses|cape|cigarette|bijou|jewel|sword|epee|arc|bow|sac|bag|collier|necklace|bracelet|earring|boucles d oreilles|gants|gloves|weapon|firearm|gun|pistol|revolver|rifle|shotgun|silenced pistol|silencer|suppressor|pistolet|arme a feu|fusil|silencieux)\b/i.test(String(prompt || ''));
}

function hasSceneRewriteSignal(prompt = '') {
  return /\b(background|backdrop|decor|décor|set design|set piece|setting|universe|univers|world of|movie intro(?:duction)?|film intro(?:duction)?|opening credits|gun barrel|cinematic|spy thriller|espionage|james bond|007|fond)\b/i.test(String(prompt || ''));
}

function hasIdentityPreservationSignal(prompt = '') {
  const text = normalizeText(prompt);
  return /\b(same face|same person|same identity|same hairstyle|same hair|same facial structure|same face shape|same body type|exact same face|exact same person|exact same identity|recognizable face|faithful face|face faithful|keep the same face|keep the same identity|keep the same person|maintain the same face|maintain the same identity|maintain the recognizable face|maintain facial identity|maintain facial structure|maintain the same facial structure|preserve facial identity|preserve the same face|preserve the same identity|strictly maintained|replicated exactly from the provided reference image|replicated exactly from the reference image|meme visage|meme personne|meme identite|meme coiffure|meme coupe|meme structure faciale|visage reconnaissable|visage fidele|garder le meme visage|garder la meme identite|garder la meme personne|garder la meme structure faciale|conserver le meme visage|conserver la meme identite|conserver la meme personne|conserver la meme structure faciale|maintenir l identite|maintenir la meme identite|maintenir la meme structure faciale|maintenir les traits du visage)\b/i.test(text);
}

function hasExactReferenceLockSignal(prompt = '') {
  const text = normalizeText(prompt);
  return /\b(exact same person|exact same face|exact same identity|exact identity|exact pose|exact framing|exact pose and framing|preserve exact pose|preserve exact framing|preserve laterality|preserve hand laterality|preserve body angle|preserve arm placement|same side bandaged hand|same side wrapped hand|bandaged hand on the same side|wrapped hand on the same side|same side as in the reference image|main bandee du meme cote|main bandee du meme côté|main enveloppee du meme cote|main enveloppee du meme côté|meme cote que l image de reference|meme côté que l image de reference|preserver la lateralite|preserver la latéralité|preserver l angle du corps|preserver le placement des bras|preserver la pose exacte|preserver le cadrage exact)\b/i.test(text);
}

function hasOutfitPreservationSignal(prompt = '') {
  return /\b(same outfit|same costume|same clothes|same clothing|keep the same outfit|keep the same costume|maintain the same outfit|meme tenue|meme outfit|meme costume|memes vetements|meme vetement|garder la meme tenue|garder le meme costume)\b/i.test(String(prompt || ''));
}

function hasOutfitRewriteSignal(prompt = '') {
  return /\b(armor|armour|armored|armoured|suit|uniform|jacket|coat|robe|dress|kimono|poncho|western wear|western outfit|cowboy|cowgirl|veste|manteau|robe longue|kimono|poncho|armure|costume sombre|dark suit|tenue western|tenue de cowboy|uniforme)\b/i.test(String(prompt || ''));
}

function hasBackgroundPreservationSignal(prompt = '') {
  return /\b(same background|same backdrop|same decor|same setting|same location|same scene|meme fond|meme decor|meme lieu|meme scene|meme arriere plan)\b/i.test(String(prompt || ''));
}

function hasEffectsSignal(prompt = '') {
  return /\b(aura|glow|glowing|halo|spark|sparks|smoke|fog|mist|fire|flame|flames|lightning|electric|energy|magic|magical|explosion|particles|particle fx|particle effect|lens flare|volumetric|neon|backlight|backlit|bokeh|fumee|brouillard|brume|feu|flammes|eclairs|éclairs|energie|energie lumineuse|magie|explosion|effets lumineux)\b/i.test(String(prompt || ''));
}

function isReferenceSourceMode(value = '') {
  const normalizedSourceMode = normalizeText(value).replace(/\s+/g, '_');
  return (
    normalizedSourceMode.includes('reference')
    || normalizedSourceMode.includes('web')
    || normalizedSourceMode.includes('init_image')
    || [
      'image_url',
      'image_path',
      'image_data_url',
      'uploaded_image',
      'upload',
      'init_image',
    ].includes(normalizedSourceMode)
  );
}

function resolveComponentEntryProfile(component = '', {
  prompt = '',
  scene = {},
  globalProfile = 'balanced',
  initSourceMode = '',
} = {}) {
  const referenceSourceMode = isReferenceSourceMode(initSourceMode);
  const sameIdentity = hasIdentityPreservationSignal(prompt);
  const exactReferenceLock = hasExactReferenceLockSignal(prompt);
  const sameOutfit = hasOutfitPreservationSignal(prompt);
  const outfitRewrite = hasOutfitRewriteSignal(prompt);
  const backgroundPreserve = hasBackgroundPreservationSignal(prompt);
  const sceneRewrite = hasSceneRewriteSignal(prompt);
  const accessoryEdit = hasAccessoryEditSignal(prompt);
  const effectsSignal = hasEffectsSignal(prompt);
  const strongStylization = (
    hasExplicitStrongStylization(prompt)
    || hasStylizedReferenceTransformationSignal(prompt)
    || hasJokerStyleTransformationSignal(prompt)
  );
  const normalizedGlobalProfile = VALID_IMG2IMG_STRENGTH_PROFILES.includes(globalProfile)
    ? globalProfile
    : 'balanced';

  switch (component) {
    case 'identity':
      if (exactReferenceLock) return { profile: 'preserve', reason: 'exact_reference_identity_lock' };
      if (sameIdentity) return { profile: 'preserve', reason: 'same_identity_preservation' };
      if (scene?.sceneKey === 'solo_face') return { profile: 'preserve', reason: 'solo_face_identity_preservation' };
      if (referenceSourceMode) return { profile: 'preserve', reason: 'reference_identity_preservation' };
      if (normalizedGlobalProfile === 'restyle') return { profile: 'balanced', reason: 'restyle_identity_guard' };
      if (normalizedGlobalProfile === 'motion_continuity') return { profile: 'preserve', reason: 'motion_identity_preservation' };
      return { profile: normalizedGlobalProfile, reason: 'inherit_global_identity' };
    case 'anatomy':
      if (exactReferenceLock) return { profile: 'preserve', reason: 'exact_reference_pose_lock' };
      if (scene?.sceneKey === 'solo_face') return { profile: 'preserve', reason: 'solo_face_anatomy_preservation' };
      if (normalizedGlobalProfile === 'motion_continuity') return { profile: 'balanced', reason: 'motion_anatomy_stability' };
      if (referenceSourceMode) {
        return {
          profile: scene?.sceneKey === 'solo_subject' ? 'balanced' : 'preserve',
          reason: scene?.sceneKey === 'solo_subject'
            ? 'reference_subject_anatomy_balance'
            : 'reference_anatomy_preservation',
        };
      }
      if (normalizedGlobalProfile === 'restyle') return { profile: 'balanced', reason: 'restyle_anatomy_guard' };
      return { profile: normalizedGlobalProfile, reason: 'inherit_global_anatomy' };
    case 'outfit':
      if (sameOutfit) return { profile: 'preserve', reason: 'same_outfit_preservation' };
      if (normalizedGlobalProfile === 'motion_continuity') return { profile: 'motion_continuity', reason: 'motion_outfit_stability' };
      if (outfitRewrite) {
        return {
          profile: referenceSourceMode ? 'balanced' : 'restyle',
          reason: 'explicit_outfit_restyle',
        };
      }
      if (strongStylization) {
        return {
          profile: referenceSourceMode ? 'balanced' : 'restyle',
          reason: 'stylized_outfit_refresh',
        };
      }
      if (referenceSourceMode) return { profile: 'preserve', reason: 'reference_outfit_preservation' };
      return { profile: normalizedGlobalProfile, reason: 'inherit_global_outfit' };
    case 'background':
      if (backgroundPreserve) return { profile: 'preserve', reason: 'same_background_preservation' };
      if (sceneRewrite) return { profile: 'restyle', reason: 'scene_rewrite_background_restyle' };
      if (strongStylization) return { profile: 'restyle', reason: 'stylized_background_restyle' };
      if (normalizedGlobalProfile === 'motion_continuity') return { profile: 'motion_continuity', reason: 'motion_background_continuity' };
      if (referenceSourceMode) return { profile: 'preserve', reason: 'reference_background_preservation' };
      return { profile: normalizedGlobalProfile, reason: 'inherit_global_background' };
    case 'effects':
      if (effectsSignal) return { profile: 'restyle', reason: 'explicit_effects_restyle' };
      if (sceneRewrite || strongStylization) return { profile: 'balanced', reason: 'scene_rewrite_effect_refresh' };
      if (normalizedGlobalProfile === 'motion_continuity') return { profile: 'motion_continuity', reason: 'motion_effect_continuity' };
      if (referenceSourceMode && normalizedGlobalProfile === 'preserve') {
        return { profile: 'preserve', reason: 'reference_effects_preservation' };
      }
      return {
        profile: normalizedGlobalProfile === 'preserve' ? 'balanced' : normalizedGlobalProfile,
        reason: 'inherit_global_effects',
      };
    case 'props':
      if (accessoryEdit) {
        return {
          profile: scene?.sceneKey === 'solo_face' ? 'balanced' : 'restyle',
          reason: 'explicit_props_restyle',
        };
      }
      if (normalizedGlobalProfile === 'motion_continuity') return { profile: 'motion_continuity', reason: 'motion_props_stability' };
      if (referenceSourceMode) return { profile: 'preserve', reason: 'reference_props_preservation' };
      return {
        profile: normalizedGlobalProfile === 'preserve' ? 'balanced' : normalizedGlobalProfile,
        reason: 'inherit_global_props',
      };
    default:
      return { profile: normalizedGlobalProfile, reason: 'inherit_global_component' };
  }
}

function resolveComponentBias(component = '', profile = 'balanced', {
  prompt = '',
  scene = {},
  initSourceMode = '',
} = {}) {
  const referenceSourceMode = isReferenceSourceMode(initSourceMode);
  const sameIdentity = hasIdentityPreservationSignal(prompt);
  const exactReferenceLock = hasExactReferenceLockSignal(prompt);
  const sameOutfit = hasOutfitPreservationSignal(prompt);
  const sceneRewrite = hasSceneRewriteSignal(prompt);
  const accessoryEdit = hasAccessoryEditSignal(prompt);
  const effectsSignal = hasEffectsSignal(prompt);
  const strongStylization = (
    hasExplicitStrongStylization(prompt)
    || hasStylizedReferenceTransformationSignal(prompt)
    || hasJokerStyleTransformationSignal(prompt)
  );
  const baseBias = ({
    identity: { preserve: 0.14, balanced: 0.36, restyle: 0.42, motion_continuity: 0.24 },
    anatomy: { preserve: 0.20, balanced: 0.42, restyle: 0.48, motion_continuity: 0.28 },
    outfit: { preserve: 0.24, balanced: 0.54, restyle: 0.66, motion_continuity: 0.36 },
    background: { preserve: 0.22, balanced: 0.58, restyle: 0.76, motion_continuity: 0.42 },
    effects: { preserve: 0.22, balanced: 0.62, restyle: 0.78, motion_continuity: 0.46 },
    props: { preserve: 0.24, balanced: 0.60, restyle: 0.72, motion_continuity: 0.42 },
  }[component] || { preserve: 0.22, balanced: 0.50, restyle: 0.66, motion_continuity: 0.40 })[profile] ?? 0.5;

  let resolvedBias = baseBias;
  if (component === 'identity' && (exactReferenceLock || sameIdentity || scene?.sceneKey === 'solo_face')) {
    resolvedBias = Math.min(resolvedBias, 0.12);
  }
  if (component === 'anatomy' && (exactReferenceLock || scene?.sceneKey === 'solo_face')) {
    resolvedBias = Math.min(resolvedBias, exactReferenceLock ? 0.12 : 0.16);
  }
  if (component === 'outfit' && sameOutfit) {
    resolvedBias = Math.min(resolvedBias, 0.18);
  }
  if (component === 'background' && sceneRewrite) {
    resolvedBias = Math.max(resolvedBias, 0.74);
  }
  if (component === 'effects' && effectsSignal) {
    resolvedBias = Math.max(resolvedBias, 0.76);
  }
  if (component === 'props' && accessoryEdit) {
    resolvedBias = Math.max(resolvedBias, scene?.sceneKey === 'solo_face' ? 0.64 : 0.72);
  }
  if (strongStylization && ['background', 'effects'].includes(component)) {
    resolvedBias = Math.max(resolvedBias, 0.68);
  }
  if (
    referenceSourceMode
    && ['identity', 'anatomy', 'outfit'].includes(component)
    && profile === 'preserve'
  ) {
    resolvedBias = Math.min(resolvedBias, component === 'identity' ? 0.16 : 0.22);
  }

  return clampUnitInterval(resolvedBias, 0.5);
}

function resolveImg2ImgComponentStrengthPlan({
  explicitStrength,
  prompt = '',
  scene = {},
  taskType = '',
  initSourceMode = '',
  motionProfile = '',
  profileHint = '',
  modelProfile = '',
  bias,
  globalProfile = '',
} = {}) {
  const directive = resolveStrengthDirective(explicitStrength, { defaultMode: 'auto' });
  if (directive.mode === 'manual') {
    const strength = resolveManualStrength(directive.numericValue);
    return Object.fromEntries(
      VALID_IMG2IMG_STRENGTH_COMPONENTS.map((component) => [
        component,
        {
          profile: 'manual',
          reason: 'manual_global_strength',
          strength,
          retryStrength: Math.round(Math.max(0.12, strength - 0.06) * 100) / 100,
          bias: null,
        },
      ])
    );
  }

  const inheritedGlobalProfile = VALID_IMG2IMG_STRENGTH_PROFILES.includes(String(globalProfile || '').trim())
    ? String(globalProfile || '').trim()
    : resolveAutoStrengthProfile({
      prompt,
      scene,
      taskType,
      initSourceMode,
      motionProfile,
      profileHint,
    }).profile;

  return Object.fromEntries(
    VALID_IMG2IMG_STRENGTH_COMPONENTS.map((component) => {
      const { profile, reason } = resolveComponentEntryProfile(component, {
        prompt,
        scene,
        globalProfile: inheritedGlobalProfile,
        initSourceMode,
      });
      const componentBias = resolveComponentBias(component, profile, {
        prompt,
        scene,
        initSourceMode,
      });
      const strength = resolveStrengthFromProfile(profile, {
        bias: Number.isFinite(Number(bias)) ? Number(bias) : componentBias,
        modelProfile,
      });
      return [
        component,
        {
          profile,
          reason,
          strength,
          retryStrength: resolveRetryStrength(profile, strength, { modelProfile }),
          bias: Number.isFinite(Number(bias)) ? clampUnitInterval(Number(bias), componentBias) : componentBias,
        },
      ];
    })
  );
}

function resolveStrengthDirective(value, { defaultMode = 'auto' } = {}) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return {
      mode: defaultMode === 'auto' ? 'auto' : 'unset',
      numericValue: null,
      rawValue: value,
    };
  }

  const raw = String(value).trim();
  if (!raw) {
    return {
      mode: defaultMode === 'auto' ? 'auto' : 'unset',
      numericValue: null,
      rawValue: value,
    };
  }

  if (normalizeText(raw) === 'auto') {
    return {
      mode: 'auto',
      numericValue: null,
      rawValue: value,
    };
  }

  const numericValue = Number(raw);
  if (Number.isFinite(numericValue)) {
    return {
      mode: 'manual',
      numericValue,
      rawValue: value,
    };
  }

  return {
    mode: defaultMode === 'auto' ? 'auto' : 'unset',
    numericValue: null,
    rawValue: value,
  };
}

function resolveAutoStrengthProfile({
  prompt = '',
  scene = {},
  taskType = '',
  initSourceMode = '',
  motionProfile = '',
  profileHint = '',
} = {}) {
  const normalizedTaskType = normalizeText(taskType).replace(/\s+/g, '_');
  const normalizedSourceMode = normalizeText(initSourceMode).replace(/\s+/g, '_');
  const normalizedMotionProfile = normalizeText(motionProfile).replace(/\s+/g, '_');
  const requestedProfile = String(profileHint || '').trim();
  const referenceSourceMode = isReferenceSourceMode(initSourceMode);
  const sameIdentity = hasIdentityPreservationSignal(prompt);
  const exactReferenceLock = hasExactReferenceLockSignal(prompt);
  const sceneRewriteSignal = hasSceneRewriteSignal(prompt);
  const accessoryEditSignal = hasAccessoryEditSignal(prompt);
  const jokerTransformationSignal = hasJokerStyleTransformationSignal(prompt);

  if (VALID_IMG2IMG_STRENGTH_PROFILES.includes(requestedProfile)) {
    return {
      profile: requestedProfile,
      reason: `profile_hint:${requestedProfile}`,
    };
  }

  if (
    normalizedTaskType.includes('video')
    && normalizedSourceMode === 'web_reference_subject'
  ) {
    return {
      profile: 'balanced',
      reason: 'video_subject_reference_scene_rewrite',
    };
  }

  if (
    normalizedTaskType.includes('video')
    || ['previous_frame', 'checkpoint_chain', 'segment_anchor'].includes(normalizedSourceMode)
    || normalizedMotionProfile === 'motion_continuity'
  ) {
    return {
      profile: 'motion_continuity',
      reason: 'video_frame_to_frame_continuity',
    };
  }

  if (['reference_reanchor', 'reference_anchor'].includes(normalizedSourceMode)) {
    return {
      profile: 'preserve',
      reason: `video_anchor_${normalizedSourceMode}`,
    };
  }

  if (hasExplicitStrongStylization(prompt)) {
    return {
      profile: 'restyle',
      reason: 'explicit_strong_stylization',
    };
  }

  if (referenceSourceMode && exactReferenceLock) {
    return {
      profile: 'preserve',
      reason: 'reference_subject_exact_lock',
    };
  }

  if (referenceSourceMode && sameIdentity && jokerTransformationSignal) {
    return {
      profile: 'balanced',
      reason: 'reference_subject_joker_transformation',
    };
  }

  if (referenceSourceMode && sameIdentity) {
    return {
      profile: 'preserve',
      reason: 'reference_subject_identity_lock',
    };
  }

  if (referenceSourceMode && sceneRewriteSignal) {
    return {
      profile: 'balanced',
      reason: 'reference_subject_scene_rewrite',
    };
  }

  if (accessoryEditSignal) {
    return {
      profile: 'balanced',
      reason: referenceSourceMode
        ? 'reference_subject_prop_edit'
        : 'accessory_or_local_edit',
    };
  }

  if (scene?.compositeRisk === true || scene?.sceneKey === 'duo_group') {
    return {
      profile: 'preserve',
      reason: 'multi_subject_reference_preservation',
    };
  }

  if (scene?.sceneKey === 'solo_face') {
    return {
      profile: 'preserve',
      reason: 'solo_face_identity_preservation',
    };
  }

  if (scene?.sceneKey === 'solo_subject') {
    return {
      profile: 'balanced',
      reason: 'solo_subject_balanced_rewrite',
    };
  }

  if (referenceSourceMode) {
    return {
      profile: 'preserve',
      reason: 'reference_source_preservation',
    };
  }

  return {
    profile: 'balanced',
    reason: 'default_balanced_rewrite',
  };
}

function resolveProfileBias({
  profile = 'balanced',
  scene = {},
  taskType = '',
  initSourceMode = '',
  motionProfile = '',
  prompt = '',
  bias,
} = {}) {
  if (Number.isFinite(Number(bias))) {
    return clampUnitInterval(Number(bias), 0.5);
  }

  const normalizedTaskType = normalizeText(taskType).replace(/\s+/g, '_');
  const normalizedSourceMode = normalizeText(initSourceMode).replace(/\s+/g, '_');
  const normalizedMotionProfile = normalizeText(motionProfile).replace(/\s+/g, '_');
  const referenceSourceMode = isReferenceSourceMode(initSourceMode);
  const sameIdentity = hasIdentityPreservationSignal(prompt);
  const exactReferenceLock = hasExactReferenceLockSignal(prompt);
  const sceneRewriteSignal = hasSceneRewriteSignal(prompt);
  const accessoryEditSignal = hasAccessoryEditSignal(prompt);
  const jokerTransformationSignal = hasJokerStyleTransformationSignal(prompt);
  const highMotion = [
    'run_cycle',
    'power_up_loop',
    'transformation_rise',
    'mounted_archery',
    'archery_shot',
    'action_burst',
  ].includes(normalizedMotionProfile);

  let resolvedBias = 0.5;
  switch (profile) {
    case 'motion_continuity':
      resolvedBias = ['checkpoint_chain', 'segment_anchor'].includes(normalizedSourceMode) ? 0.5 : 0.25;
      break;
    case 'preserve':
      resolvedBias = scene?.sceneKey === 'solo_face' ? 0.18 : 0.28;
      break;
    case 'restyle':
      resolvedBias = scene?.sceneKey === 'solo_subject' ? 0.72 : 0.6;
      break;
    case 'balanced':
    default:
      resolvedBias = scene?.sceneKey === 'solo_subject' ? 0.58 : 0.44;
      break;
  }

  if (highMotion && ['motion_continuity', 'balanced'].includes(profile)) {
    resolvedBias += 0.08;
  }
  if (profile === 'preserve' && referenceSourceMode && exactReferenceLock) {
    resolvedBias = scene?.sceneKey === 'solo_face' ? 0.06 : 0.1;
  }
  if (profile === 'balanced' && referenceSourceMode && (sceneRewriteSignal || accessoryEditSignal)) {
    if (sameIdentity) {
      resolvedBias = Math.min(resolvedBias, scene?.sceneKey === 'solo_face' ? 0.24 : 0.32);
    } else {
      resolvedBias = Math.max(resolvedBias, scene?.sceneKey === 'solo_face' ? 0.64 : 0.58);
    }
  }
  if (profile === 'balanced' && referenceSourceMode && sameIdentity && jokerTransformationSignal) {
    resolvedBias = Math.min(resolvedBias, scene?.sceneKey === 'solo_face' ? 0.02 : 0.06);
  }
  if (normalizedTaskType.includes('accessory')) {
    resolvedBias = Math.min(resolvedBias, 0.38);
  }
  if (
    profile === 'preserve'
    && hasStylizedReferenceTransformationSignal(prompt)
  ) {
    resolvedBias = Math.max(resolvedBias, scene?.sceneKey === 'solo_face' ? 0.36 : 0.52);
  }

  return clampUnitInterval(resolvedBias, 0.5);
}

function resolveStrengthFromProfile(profile = 'balanced', {
  bias = 0.5,
  modelProfile = '',
} = {}) {
  const ranges = resolveStrengthProfileRanges({ modelProfile });
  const range = ranges[profile] || ranges.balanced;
  const normalizedBias = clampUnitInterval(bias, 0.5);
  const strength = range.min + ((range.max - range.min) * normalizedBias);
  return Math.round(strength * 100) / 100;
}

function resolveRetryStrength(profile = 'balanced', strength = 0.34, {
  modelProfile = '',
} = {}) {
  const ranges = resolveStrengthProfileRanges({ modelProfile });
  const range = ranges[profile] || ranges.balanced;
  const offset = {
    preserve: 0.06,
    balanced: 0.06,
    restyle: 0.08,
    motion_continuity: 0.04,
  }[profile] || 0.06;
  return Math.round(clampNumber(Number(strength) - offset, range.min, range.max, range.min) * 100) / 100;
}

function resolveManualStrength(value) {
  const numericValue = Number(value);
  return Math.round(clampNumber(numericValue, 0.12, 0.72, 0.34) * 100) / 100;
}

function resolveImg2ImgStrengthPlan({
  explicitStrength,
  prompt = '',
  scene = {},
  taskType = '',
  initSourceMode = '',
  motionProfile = '',
  profileHint = '',
  modelProfile = '',
  bias,
  defaultMode = 'auto',
} = {}) {
  const directive = resolveStrengthDirective(explicitStrength, { defaultMode });
  if (directive.mode === 'manual') {
    const strength = resolveManualStrength(directive.numericValue);
    const components = resolveImg2ImgComponentStrengthPlan({
      explicitStrength,
      prompt,
      scene,
      taskType,
      initSourceMode,
      motionProfile,
      profileHint,
      modelProfile,
      bias,
      globalProfile: 'manual',
    });
    return {
      mode: 'manual',
      profile: 'manual',
      reason: 'explicit_numeric_strength',
      strength,
      retryStrength: Math.round(Math.max(0.12, strength - 0.06) * 100) / 100,
      components,
      componentStrengths: Object.fromEntries(Object.entries(components).map(([key, value]) => [key, value.strength])),
      componentProfiles: Object.fromEntries(Object.entries(components).map(([key, value]) => [key, value.profile])),
      componentReasons: Object.fromEntries(Object.entries(components).map(([key, value]) => [key, value.reason])),
    };
  }

  const { profile, reason } = resolveAutoStrengthProfile({
    prompt,
    scene,
    taskType,
    initSourceMode,
    motionProfile,
    profileHint,
  });
  const resolvedBias = resolveProfileBias({
    profile,
    scene,
    taskType,
    initSourceMode,
    motionProfile,
    prompt,
    bias,
  });
  const strength = resolveStrengthFromProfile(profile, {
    bias: resolvedBias,
    modelProfile,
  });
  const components = resolveImg2ImgComponentStrengthPlan({
    explicitStrength,
    prompt,
    scene,
    taskType,
    initSourceMode,
    motionProfile,
    profileHint,
    modelProfile,
    bias,
    globalProfile: profile,
  });
  return {
    mode: 'auto',
    profile,
    reason,
    strength,
    retryStrength: resolveRetryStrength(profile, strength, { modelProfile }),
    bias: resolvedBias,
    components,
    componentStrengths: Object.fromEntries(Object.entries(components).map(([key, value]) => [key, value.strength])),
    componentProfiles: Object.fromEntries(Object.entries(components).map(([key, value]) => [key, value.profile])),
    componentReasons: Object.fromEntries(Object.entries(components).map(([key, value]) => [key, value.reason])),
  };
}

module.exports = {
  IMG2IMG_STRENGTH_PROFILE_RANGES,
  VALID_IMG2IMG_STRENGTH_COMPONENTS,
  VALID_IMG2IMG_STRENGTH_PROFILES,
  hasAccessoryEditSignal,
  hasExplicitStrongStylization,
  hasExactReferenceLockSignal,
  hasEffectsSignal,
  hasIdentityPreservationSignal,
  hasJokerStyleTransformationSignal,
  hasOutfitPreservationSignal,
  hasOutfitRewriteSignal,
  hasBackgroundPreservationSignal,
  hasSceneRewriteSignal,
  hasStylizedReferenceTransformationSignal,
  isReferenceSourceMode,
  resolveAutoStrengthProfile,
  resolveImg2ImgComponentStrengthPlan,
  resolveImg2ImgStrengthPlan,
  resolveManualStrength,
  resolveComponentBias,
  resolveProfileBias,
  resolveRetryStrength,
  resolveStrengthDirective,
  resolveStrengthFromProfile,
};
