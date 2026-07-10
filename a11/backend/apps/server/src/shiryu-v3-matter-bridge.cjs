'use strict';

/**
 * Shiryu V3 Matter Bridge — Mille-Fleurs GPU terrain.
 *
 * The older path is deliberately abstract:
 *   zen -> cube -> atoms -> [cuda]
 *
 * This bridge adds the missing creative/graphics step:
 *   zen -> cube -> atoms -> matter-field -> Blender / Unreal / GPU renderer
 *
 * It is still safe-by-default. No Blender/Unreal process is launched here, and
 * no destructive GPU kernel runs. The module emits deterministic particles,
 * material channels and small adapter hints that downstream render workers can
 * consume.
 */

const { prepareCubeCuda } = require('./cube-to-cuda.cjs');
const crypto = require('node:crypto');

const SCHEMA = 'nossen.shiryu.v3_matter_field.v1';
const SOURCE_CELL_SCHEMA = 'nossen.zen_source_matter_cell.v1';
const COSMIC_SCHEMA = 'nossen.shiryu.v3_cosmic_relations.v1';
const DEFAULT_MAX_PARTICLES = 1024;
const SUPPORTED_ENGINES = Object.freeze(['blender', 'unreal', 'gltf', 'raw']);
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const J2000_EPOCH_MS = Date.parse('2000-01-01T12:00:00.000Z');
const GREGORIAN_YEAR_DAYS = 365.2425;
const TROPICAL_YEAR_DAYS = 365.2421897;
const EARTH_SIDEREAL_ORBIT_DAYS = 365.256363004;
const CIVIL_DAY_DAYS = 1;
const SIDEREAL_DAY_HOURS = 23.9344696;
const SIDEREAL_DAY_DAYS = SIDEREAL_DAY_HOURS / 24;
const LUNAR_SYNODIC_MONTH_DAYS = 29.530588853;
const LUNAR_SIDEREAL_MONTH_DAYS = 27.321661;
const LUNAR_ANOMALISTIC_MONTH_DAYS = 27.55455;
const DEFAULT_GRAVITY_BASE = 9.80665;
const DEFAULT_GRAVITY_PEAK = 9.88;
const LUNAR_TIDE_DAMPING_DIVISOR = 3;
const LUNAR_TIDE_MIN = 0.09;
const LUNAR_TIDE_MAX = 0.1;
const TIDE_DRIFT_TARGET = 1.1;
const LIGHT_VACUUM_FREQUENCY = 0.0005;
const LIGHT_VACUUM_VIBRATION_ENABLED = true;
const PHYSICAL_ELECTROLYSIS_DEFAULT = true;
const STABLE_STATE_CODENAME = 'mewtwo';
const TRIFORCE_BALANCE_DIVISOR = 3;
const TRIFORCE_BALANCE_WEIGHT = 1 / TRIFORCE_BALANCE_DIVISOR;
const TRIFORCE_BALANCE_INVERTED = true;
const LIGHT_VACUUM_INVERTED_DEFAULT = false;
const EMOTION_LIGHT_VACUUM_BALANCE_ENABLED = true;
const EMOTION_LIGHT_VACUUM_BALANCE_STRENGTH = 0.1;
const PEACE_LOVE_STABILITY = 0.1;
const V9_ELECTROLYSIS_MIN_HZ = 40.26;
const V9_ELECTROLYSIS_MAX_HZ = 40.62;
const V9_ELECTROLYSIS_CENTER_HZ = (V9_ELECTROLYSIS_MIN_HZ + V9_ELECTROLYSIS_MAX_HZ) / 2;
const COSMIC_PERIODS = Object.freeze({
  civilDay: { periodDays: CIVIL_DAY_DAYS, role: 'rotation/public clock' },
  siderealDay: { periodDays: SIDEREAL_DAY_DAYS, role: 'star-facing rotation' },
  gregorianYear: { periodDays: GREGORIAN_YEAR_DAYS, role: 'calendar/leap-day phase' },
  tropicalYear: { periodDays: TROPICAL_YEAR_DAYS, role: 'seasonal solar phase' },
  earthSiderealOrbit: { periodDays: EARTH_SIDEREAL_ORBIT_DAYS, role: 'orbit against fixed stars' },
  lunarSynodic: { periodDays: LUNAR_SYNODIC_MONTH_DAYS, role: 'moon light/visible phase' },
  lunarSidereal: { periodDays: LUNAR_SIDEREAL_MONTH_DAYS, role: 'moon background orbit' },
  lunarAnomalistic: { periodDays: LUNAR_ANOMALISTIC_MONTH_DAYS, role: 'moon distance/perigee pulse' },
  mercuryOrbit: { periodDays: 87.9691, role: 'fast metallic shimmer' },
  venusOrbit: { periodDays: 224.701, role: 'warm mirror/beauty drift' },
  marsOrbit: { periodDays: 686.980, role: 'red attack/drive drift' },
  jupiterOrbit: { periodDays: 4332.589, role: 'large chorus/gravity choir' },
  saturnOrbit: { periodDays: 10759.22, role: 'slow ring/boundary drift' },
  uranusOrbit: { periodDays: 30688.5, role: 'tilted blue mirror drift' },
  neptuneOrbit: { periodDays: 60182, role: 'deep vacuum/ocean drift' },
});
const PLANETARY_CHOIR_KEYS = Object.freeze([
  'mercuryOrbit',
  'venusOrbit',
  'marsOrbit',
  'jupiterOrbit',
  'saturnOrbit',
  'uranusOrbit',
  'neptuneOrbit',
]);
const EMOTION_LIGHT_VACUUM_PAIRS = Object.freeze([
  {
    id: 'anger_peace',
    light: 'peace',
    vacuum: 'anger',
    lightWords: ['paix', 'calme', 'apaisement', 'apaise', 'apaisé', 'serein', 'douceur', 'respire', 'souffle'],
    vacuumWords: ['colere', 'colère', 'rage', 'furie', 'hurle', 'attaque', 'brutal', 'nerf'],
  },
  {
    id: 'hate_jealousy',
    axis: 'opposed-vacuum-emotions',
    light: 'jealousy',
    vacuum: 'hate',
    lightWords: ['jalousie', 'jaloux', 'jalouse', 'envie', 'possessif', 'possessive', 'aigreur'],
    vacuumWords: ['haine', 'deteste', 'déteste', 'mepris', 'mépris', 'venin', 'rancune', 'crache'],
  },
  {
    id: 'courage_fear',
    light: 'courage',
    vacuum: 'fear',
    lightWords: ['courage', 'brave', 'front', 'tenir', 'avance', 'fonce'],
    vacuumWords: ['peur', 'angoisse', 'panique', 'tremble', 'fuite'],
  },
]);
const EMOTION_LIGHT_VACUUM_COMPOSITES = Object.freeze([
  {
    id: 'black_light',
    label: 'lumiere-noire',
    words: ['lumiere noire', 'lumière noire', 'black light', 'soleil noir', 'black sun'],
    rawSignal: 0,
    lightBias: 0.5,
    vacuumBias: 0.5,
    polarity: 'coincident-light-vacuum',
    sameTextureAs: 'white_light',
    colorInvertedFrom: 'white_light',
    note: 'Black light uses the same texture as white light with inverted color, not an inverted light/vacuum axis.',
  },
  {
    id: 'divine_anger',
    label: 'colere-divine',
    words: ['colere divine', 'colère divine', 'rage divine', 'courroux divin', 'divine anger'],
    requiresAll: [
      ['colere', 'colère', 'rage', 'courroux'],
      ['divin', 'divine', 'sacre', 'sacré'],
    ],
    rawSignal: 0.18,
    lightBias: 0.58,
    vacuumBias: 0.42,
    polarity: 'sacred-storm-purification',
    note: 'Anger carried as justice/sacred storm, not as raw destructive anger.',
  },
]);

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function round(value, digits = 4) {
  const scale = 10 ** digits;
  return Math.round(Number(value || 0) * scale) / scale;
}

function wrap01(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return ((n % 1) + 1) % 1;
}

function resolveNowMs(value) {
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : Date.now();
  }
  if (value != null && value !== '') {
    const parsed = Date.parse(String(value));
    if (Number.isFinite(parsed)) return parsed;
  }
  return Date.now();
}

function buildPhase(elapsedDays, meta = {}) {
  const periodDays = Math.max(0.000001, Number(meta.periodDays || 1));
  const cycle = wrap01(elapsedDays / periodDays + Number(meta.offset || 0));
  const angle = cycle * Math.PI * 2;
  return {
    periodDays: round(periodDays, 9),
    role: meta.role || 'cycle',
    cycle: round(cycle, 9),
    angleRad: round(angle, 12),
    anglePi: round(angle / Math.PI, 12),
    sin: round(Math.sin(angle), 9),
    cos: round(Math.cos(angle), 9),
  };
}

function boolish(value) {
  if (value === true) return true;
  const raw = String(value || '').trim().toLowerCase();
  return ['1', 'true', 'yes', 'oui', 'on', 'enabled'].includes(raw);
}

function foldText(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function hasFoldedWord(text = '', word = '') {
  const foldedWord = foldText(word).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!foldedWord) return false;
  return new RegExp(`\\b${foldedWord}\\b`, 'i').test(text);
}

function resolveEmotionLightVacuumBalance(options = {}, lightVacuumFrequency = LIGHT_VACUUM_FREQUENCY, vacuumLight = 0) {
  const enabled = options.emotionBalanceEnabled == null
    ? EMOTION_LIGHT_VACUUM_BALANCE_ENABLED
    : boolish(options.emotionBalanceEnabled);
  const inverted = options.emotionBalanceInverted == null
    ? LIGHT_VACUUM_INVERTED_DEFAULT
    : boolish(options.emotionBalanceInverted);
  const polarity = inverted ? -1 : 1;
  const strength = Number.isFinite(Number(options.emotionBalanceStrength ?? options.emotionStrength))
    ? clamp(Number(options.emotionBalanceStrength ?? options.emotionStrength), 0, 1)
    : EMOTION_LIGHT_VACUUM_BALANCE_STRENGTH;
  const explicit = Number(options.emotionSignal ?? options.emotionalSignal ?? options.emotionBalance);
  const sourceText = String(
    options.emotionSource
    || options.emotions
    || options.emotion
    || options.emotionalTone
    || ''
  ).trim();
  const folded = foldText(sourceText);
  const matched = [];
  const pairs = [];
  const composites = [];
  let score = 0;
  let count = 0;
  if (Number.isFinite(explicit)) {
    score = clamp(explicit, -1, 1);
    count = 1;
    matched.push('explicit');
  } else if (enabled && folded) {
    for (const composite of EMOTION_LIGHT_VACUUM_COMPOSITES) {
      const hits = composite.words.filter((word) => foldText(word) && folded.includes(foldText(word)));
      if (!hits.length) continue;
      score += Number(composite.rawSignal || 0);
      count += 1;
      matched.push(composite.id);
      composites.push({
        id: composite.id,
        label: composite.label,
        hits,
        rawSignal: round(composite.rawSignal, 9),
        invertedSignal: round(-Number(composite.rawSignal || 0), 9),
        lightBias: composite.lightBias,
        vacuumBias: composite.vacuumBias,
        polarity: composite.polarity,
        note: composite.note,
      });
    }
    for (const pair of EMOTION_LIGHT_VACUUM_PAIRS) {
      const compositeText = composites.map((composite) => composite.hits.join(' ')).join(' ');
      const lightHits = pair.lightWords.filter((word) => hasFoldedWord(folded, word));
      const vacuumHits = pair.vacuumWords.filter((word) => hasFoldedWord(folded, word) && !hasFoldedWord(compositeText, word));
      if (!lightHits.length && !vacuumHits.length) continue;
      const pairSignal = clamp((lightHits.length - vacuumHits.length) / Math.max(1, lightHits.length + vacuumHits.length), -1, 1);
      score += pairSignal;
      count += 1;
      matched.push(pair.id);
      pairs.push({
        id: pair.id,
        light: pair.light,
        vacuum: pair.vacuum,
        lightHits,
        vacuumHits,
        rawSignal: round(pairSignal, 9),
        invertedSignal: round(-pairSignal, 9),
      });
    }
  }
  const signal = enabled && count > 0 ? clamp(score / count, -1, 1) : 0;
  const effectiveSignal = signal * polarity;
  const compositeLightBias = composites.length
    ? composites.reduce((sum, item) => sum + Number(item.lightBias || 0.5), 0) / composites.length
    : null;
  const lightBiasBase = compositeLightBias == null
    ? 0.5
    : (0.5 + (compositeLightBias - 0.5) * strength);
  const lightBias = round(clamp(lightBiasBase + effectiveSignal * strength + Math.max(0, Number(vacuumLight) || 0) * 0.03, 0, 1), 9);
  const vacuumBias = round(1 - lightBias, 9);
  const coupling = enabled ? effectiveSignal * lightVacuumFrequency * TRIFORCE_BALANCE_WEIGHT * strength : 0;
  return {
    enabled,
    mode: 'emotion-balances-light-vacuum',
    balanceInverted: inverted,
    polarity,
    source: sourceText ? 'semantic-emotion-source' : 'neutral',
    matched,
    composites,
    pairs,
    signal: round(signal, 9),
    effectiveSignal: round(effectiveSignal, 9),
    strength: round(strength, 9),
    weight: round(TRIFORCE_BALANCE_WEIGHT, 12),
    lightBias,
    vacuumBias,
    coupling: round(coupling, 12),
    note: 'Emotion balances the light/vacuum axis only; it is a render/audio modulator, not a hardware command.',
  };
}

function normalizeTimeBasis(value = '', options = {}) {
  if (
    boolish(options.instantShift)
    || boolish(options.decorFirst)
    || boolish(options.bypassForeground)
  ) {
    return 'instant-decor';
  }
  const raw = String(value || options.timeBasis || options.basis || options.cosmicBasis || '').trim().toLowerCase();
  if (/\b(?:instant|decor|décor|sidereal|sidéral|space|goku|teleport|tp|bypass)\b/.test(raw)) return 'instant-decor';
  if (/\b(?:solar|soleil|tropical|season|saison)\b/.test(raw)) return 'solar';
  return 'gregorian';
}

function resolvePrimaryYearPhase(phases = {}, timeBasis = 'gregorian') {
  if (timeBasis === 'instant-decor') {
    return {
      name: 'earthSiderealOrbit',
      phase: phases.earthSiderealOrbit,
      visualLayer: 'sidereal-decor',
      driver: 'earthSiderealOrbit.sin',
    };
  }
  if (timeBasis === 'solar') {
    return {
      name: 'tropicalYear',
      phase: phases.tropicalYear,
      visualLayer: 'solar-season-light',
      driver: 'tropicalYear.sin',
    };
  }
  return {
    name: 'gregorianYear',
    phase: phases.gregorianYear,
    visualLayer: 'calendar-foreground',
    driver: 'gregorianYear.sin',
  };
}

function signedAngleDeltaRad(fromRad, toRad) {
  const from = Number(fromRad) || 0;
  const to = Number(toRad) || 0;
  let delta = ((to - from + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

function resolveSignedTide(rawTide, options = {}) {
  const divisor = Math.max(1, Number(options.tideDampingDivisor || LUNAR_TIDE_DAMPING_DIVISOR));
  const min = clamp(Number(options.tideMin ?? LUNAR_TIDE_MIN), 0, 1);
  const max = clamp(Number(options.tideMax ?? LUNAR_TIDE_MAX), min || 0.000001, 1);
  const damped = Number(rawTide || 0) / divisor;
  const sign = damped < 0 ? -1 : 1;
  const magnitude = clamp(Math.abs(damped), min, max);
  const signed = sign * magnitude;
  const target = Math.max(1, Number(options.tideDriftTarget || TIDE_DRIFT_TARGET));
  const drift = clamp(1 + magnitude, 1 + min, target);
  return {
    raw: rawTide,
    damped,
    signed,
    magnitude,
    divisor,
    min,
    max,
    driftTarget: target,
    drift,
  };
}

function buildCosmicRelations(options = {}) {
  const nowMs = resolveNowMs(options.now || options.time || options.timestamp);
  const elapsedDays = (nowMs - J2000_EPOCH_MS) / MS_PER_DAY;
  const phases = {};
  for (const [name, meta] of Object.entries(COSMIC_PERIODS)) {
    phases[name] = buildPhase(elapsedDays, meta);
  }

  const timeBasis = normalizeTimeBasis(options.timeBasis || options.basis || options.cosmicBasis, options);
  const primaryYear = resolvePrimaryYearPhase(phases, timeBasis);
  const annual = primaryYear.phase || phases.gregorianYear;
  const civilDay = phases.civilDay;
  const siderealDay = phases.siderealDay;
  const moon = phases.lunarSynodic;
  const moonDistance = phases.lunarAnomalistic;
  const mercury = phases.mercuryOrbit;
  const venus = phases.venusOrbit;
  const mars = phases.marsOrbit;
  const jupiter = phases.jupiterOrbit;
  const saturn = phases.saturnOrbit;
  const uranus = phases.uranusOrbit;
  const neptune = phases.neptuneOrbit;
  const gravityBase = Number.isFinite(Number(options.gravityBase)) ? Number(options.gravityBase) : DEFAULT_GRAVITY_BASE;
  const gravityPeak = Number.isFinite(Number(options.gravityPeak)) ? Number(options.gravityPeak) : DEFAULT_GRAVITY_PEAK;
  const lightVacuumFrequency = Number.isFinite(Number(options.lightVacuumFrequency))
    ? clamp(Number(options.lightVacuumFrequency), 0, 0.01)
    : LIGHT_VACUUM_FREQUENCY;
  const lightVacuumVibration = options.lightVacuumVibration == null
    ? LIGHT_VACUUM_VIBRATION_ENABLED
    : boolish(options.lightVacuumVibration);
  const physicalElectrolysis = options.physicalElectrolysis == null
    ? PHYSICAL_ELECTROLYSIS_DEFAULT
    : boolish(options.physicalElectrolysis);
  const gravityAmplitude = gravityPeak - gravityBase;
  const lunarIllumination = (1 - moon.cos) / 2;
  const rawDailyTide = (moon.sin * 0.62) + (civilDay.sin * 0.24) + (moonDistance.cos * 0.14);
  const tide = resolveSignedTide(rawDailyTide, options);
  const dailyTide = tide.signed;
  const siderealDrift = (siderealDay.sin * 0.55) + (annual.cos * 0.25) + (moon.cos * 0.2);
  const planetSignals = {
    mercury: mercury.sin,
    venus: venus.cos,
    mars: mars.sin,
    jupiter: jupiter.cos,
    saturn: saturn.sin,
    uranus: uranus.cos,
    neptune: neptune.sin,
  };
  const planetChoir = Object.values(planetSignals).reduce((sum, value) => sum + Number(value || 0), 0) / PLANETARY_CHOIR_KEYS.length;
  const vacuumLight = Math.sin(elapsedDays * Math.PI * 2 * lightVacuumFrequency);
  const vacuumCoupling = lightVacuumVibration ? vacuumLight * lightVacuumFrequency : 0;
  const emotionLightVacuum = resolveEmotionLightVacuumBalance(options, lightVacuumFrequency, vacuumLight);
  const balancedLightVacuumCoupling = lightVacuumVibration
    ? vacuumCoupling + emotionLightVacuum.coupling
    : emotionLightVacuum.coupling;
  const v9Span = V9_ELECTROLYSIS_MAX_HZ - V9_ELECTROLYSIS_MIN_HZ;
  const v9Shape = Math.tanh((dailyTide * 0.62) + (siderealDrift * 0.22) + (planetChoir * 0.16) + balancedLightVacuumCoupling);
  const v9FrequencyHz = clamp(
    V9_ELECTROLYSIS_CENTER_HZ + (v9Span / 2) * v9Shape * tide.drift + balancedLightVacuumCoupling,
    V9_ELECTROLYSIS_MIN_HZ,
    V9_ELECTROLYSIS_MAX_HZ
  );
  const gregorianLagRad = signedAngleDeltaRad(phases.gregorianYear.angleRad, annual.angleRad);
  const instantShiftEnabled = timeBasis === 'instant-decor';
  const gravityValue = gravityBase + gravityAmplitude * annual.sin;
  const mirrorAxes = {
    x: round((annual.cos * 0.5) + (moon.sin * 0.5), 9),
    y: round((moon.cos * 0.55) + (siderealDay.sin * 0.45), 9),
    z: round((civilDay.cos * 0.4) + (planetChoir * 0.6), 9),
  };
  const opposedCenterOfGravity = {
    mode: 'opposed-center',
    source: primaryYear.driver,
    value: round(-gravityValue, 12),
    normalized: round(-annual.sin, 9),
    vector: {
      x: round(-mirrorAxes.x, 9),
      y: round(-mirrorAxes.y, 9),
      z: round(-mirrorAxes.z, 9),
    },
    note: 'Counter-weight for visual/matter composition only; does not invert or actuate physical gravity.',
  };
  const triforceBalance = {
    schema: 'nossen.shiryu.v3_triforce_balance.v1',
    mode: 'hardware-electrolysis-light-vacuum',
    divisor: TRIFORCE_BALANCE_DIVISOR,
    unitWeight: round(TRIFORCE_BALANCE_WEIGHT, 12),
    weights: {
      hardware: round(TRIFORCE_BALANCE_WEIGHT, 12),
      electrolysis: round(TRIFORCE_BALANCE_WEIGHT, 12),
      lightVacuum: round(TRIFORCE_BALANCE_WEIGHT, 12),
    },
    hardware: {
      actuatesHardware: false,
      state: 'locked-simulated-render-data-only',
    },
    electrolysis: {
      physicalElectrolysis,
      state: physicalElectrolysis ? 'creative-resonance-enabled' : 'audio-only',
    },
    lightVacuum: {
      vibration: lightVacuumVibration,
      frequency: lightVacuumFrequency,
      rawCoupling: round(vacuumCoupling, 12),
      balancedCoupling: round(balancedLightVacuumCoupling, 12),
      emotion: emotionLightVacuum,
    },
    centerOfGravity: opposedCenterOfGravity,
    note: '1/triforce balance: each axis contributes one third, with hardware kept as a locked/simulated axis.',
  };

  return {
    ok: true,
    schema: COSMIC_SCHEMA,
    mode: 'creative-cosmic-relation-field',
    timeBasis,
    primaryDriver: {
      name: primaryYear.name,
      visualLayer: primaryYear.visualLayer,
      driver: primaryYear.driver,
      periodDays: annual.periodDays,
    },
    anchor: 'J2000 UTC',
    now: new Date(nowMs).toISOString(),
    elapsedDaysSinceJ2000: round(elapsedDays, 9),
    calendar: {
      gregorianYearDays: GREGORIAN_YEAR_DAYS,
      gregorianYearHours: round(GREGORIAN_YEAR_DAYS * 24, 6),
      halfDayAnnualPhaseRad: round(Math.PI / GREGORIAN_YEAR_DAYS, 15),
      halfDayAnnualPhasePi: round(1 / GREGORIAN_YEAR_DAYS, 15),
      leapDayModel: 'Gregorian mean year = 365 + 97/400 days',
      gregorianAsLagLayer: timeBasis !== 'gregorian',
      lagAgainstPrimary: {
        primary: primaryYear.name,
        phaseDeltaRad: round(gregorianLagRad, 12),
        phaseDeltaPi: round(gregorianLagRad / Math.PI, 12),
      },
    },
    instantShift: {
      enabled: instantShiftEnabled,
      codename: 'instant-scenery-shift',
      fromLayer: 'calendar-foreground',
      toLayer: primaryYear.visualLayer,
      bypasses: instantShiftEnabled ? ['gregorian foreground lag', 'subject-first composition'] : [],
      startsWith: instantShiftEnabled ? 'decor' : 'foreground',
      note: instantShiftEnabled
        ? 'Build the scenery/cosmic field first, then project foreground subjects into it.'
        : 'Calendar foreground remains the primary visual layer.',
    },
    phases,
    gravity: {
      base: gravityBase,
      peak: gravityPeak,
      amplitude: round(gravityAmplitude, 9),
      value: round(gravityValue, 12),
      driver: primaryYear.driver,
      opposedCenter: opposedCenterOfGravity,
    },
    moon: {
      synodicMonthDays: LUNAR_SYNODIC_MONTH_DAYS,
      siderealMonthDays: LUNAR_SIDEREAL_MONTH_DAYS,
      anomalisticMonthDays: LUNAR_ANOMALISTIC_MONTH_DAYS,
      illumination: round(lunarIllumination, 9),
      rawTide: round(rawDailyTide, 9),
      dampedTide: round(tide.damped, 9),
      tideDampingDivisor: tide.divisor,
      tideMin: tide.min,
      tideMax: tide.max,
      tideMagnitude: round(tide.magnitude, 9),
      tide: round(dailyTide, 9),
      drift: {
        value: round(tide.drift, 9),
        target: round(tide.driftTarget, 9),
        note: 'Magnitude 0.09..0.10 maps to drift 1.09..1.1 and tends toward 1.1.',
      },
    },
    planets: {
      count: PLANETARY_CHOIR_KEYS.length,
      keys: [...PLANETARY_CHOIR_KEYS],
      signals: Object.fromEntries(Object.entries(planetSignals).map(([key, value]) => [key, round(value, 9)])),
      choir: round(planetChoir, 9),
      note: 'Seven non-Earth planet creative choir: Mercury, Venus, Mars, Jupiter, Saturn, Uranus, Neptune.',
    },
    vacuum: {
      lightFrequency: lightVacuumFrequency,
      vibration: lightVacuumVibration,
      light: round(vacuumLight, 9),
      coupling: round(vacuumCoupling, 12),
      balancedCoupling: round(balancedLightVacuumCoupling, 12),
      emotionBalance: emotionLightVacuum,
      note: 'Creative light/vacuum carrier; tiny modulation only.',
    },
    triforce: triforceBalance,
    modulators: {
      mirrorAxes,
      centerOfGravity: opposedCenterOfGravity,
      camera3d: {
        yawDeg: round(wrap01(annual.cycle + moon.cycle * 0.25) * 360, 6),
        pitchDeg: round(-8 + lunarIllumination * 16, 6),
        rollDeg: round(dailyTide * 7, 6),
        dolly: round(1 + Math.abs(siderealDrift) * 0.18, 6),
        startLayer: instantShiftEnabled ? 'decor' : 'foreground',
        foregroundBypass: instantShiftEnabled,
      },
      rgbaBias: {
        r: round((mars.sin + 1) / 2, 9),
        g: round((venus.cos + 1) / 2, 9),
        b: round((moon.sin + 1) / 2, 9),
        a: round((Math.abs(dailyTide) + lunarIllumination) / 2, 9),
      },
      tide: {
        daily: round(dailyTide, 9),
        rawDaily: round(rawDailyTide, 9),
        dampedDaily: round(tide.damped, 9),
        magnitude: round(tide.magnitude, 9),
        min: tide.min,
        max: tide.max,
        dampingDivisor: tide.divisor,
        drift: round(tide.drift, 9),
        driftTarget: round(tide.driftTarget, 9),
        siderealDrift: round(siderealDrift, 9),
        planetChoir: round(planetChoir, 9),
        lightVacuum: round(balancedLightVacuumCoupling, 12),
        rawLightVacuum: round(vacuumCoupling, 12),
        emotionLightVacuum: emotionLightVacuum,
      },
    },
    audio: {
      mode: 'v9-electrolysis-guitar-audio-only',
      physicalElectrolysis,
      physicalElectrolysisState: physicalElectrolysis ? 'creative-resonance-enabled' : 'audio-only',
      actuatesHardware: false,
      frequencyRangeHz: {
        min: V9_ELECTROLYSIS_MIN_HZ,
        center: round(V9_ELECTROLYSIS_CENTER_HZ, 12),
        max: V9_ELECTROLYSIS_MAX_HZ,
      },
      frequencyHz: round(v9FrequencyHz, 12),
      lightVacuumFrequency,
      lightVacuumVibration,
      lightVacuumBalancedCoupling: round(balancedLightVacuumCoupling, 12),
      emotionLightVacuumBalance: emotionLightVacuum,
      triforce: triforceBalance,
      note: physicalElectrolysis
        ? 'Physical-electrolysis resonance flag is true, but this module emits data only and does not actuate hardware.'
        : 'Creative modulation signal only; not a physical electrolysis instruction.',
    },
    safety: {
      deterministic: true,
      launchesExternalRenderer: false,
      launchesProvider: false,
      actuatesPhysicalHardware: false,
      requiresConfirmedHardwareControllerForRealElectrolysis: true,
    },
  };
}

function normalizeByte(value) {
  return Math.max(0, Math.min(255, Math.round(Number(value) || 0)));
}

function normalizeEngine(value = '') {
  const engine = String(value || '').trim().toLowerCase();
  return SUPPORTED_ENGINES.includes(engine) ? engine : 'blender';
}

function rgbaToHex(rgba = {}) {
  const bytes = [
    normalizeByte(rgba.r),
    normalizeByte(rgba.g),
    normalizeByte(rgba.b),
    normalizeByte(rgba.a == null ? 255 : rgba.a),
  ];
  return `#${bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

function atomAt(atoms = [], index = 0) {
  const offset = index * 4;
  return {
    r: normalizeByte(atoms[offset]),
    g: normalizeByte(atoms[offset + 1]),
    b: normalizeByte(atoms[offset + 2]),
    a: normalizeByte(atoms[offset + 3]),
  };
}

function buildParticleFromAtom(rgba, index, count, options = {}) {
  const safeCount = Math.max(1, count);
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const cosmic = options.cosmicRelations || {};
  const mirrorAxes = cosmic.modulators?.mirrorAxes || {};
  const tide = Number(cosmic.modulators?.tide?.daily || 0);
  const rgbaBias = cosmic.modulators?.rgbaBias || {};
  const density = round(rgba.a / 255, 4);
  const energy = round((rgba.r + rgba.g + rgba.b) / (255 * 3), 4);
  const radiusBase = clamp(options.radius || 1.4, 0.1, 24);
  const verticalSpread = clamp(options.verticalSpread || 1.8, 0.1, 24);
  const displacementScale = clamp(options.displacementScale || 1.0, 0, 12);
  const t = safeCount === 1 ? 0.5 : index / (safeCount - 1);
  const angle = index * goldenAngle + Number(cosmic.phases?.lunarSynodic?.angleRad || 0) * 0.015;
  const spiral = radiusBase * Math.sqrt((index + 0.5) / safeCount);
  const memoryLift = (rgba.r - 128) / 255;
  const toolTwist = (rgba.g - 128) / 255;
  const dataDepth = (rgba.b - 128) / 127;
  const orchestrationPulse = (rgba.a - 128) / 255;
  const cosmicX = Number(mirrorAxes.x || 0) * displacementScale * 0.035;
  const cosmicY = Number(mirrorAxes.y || 0) * displacementScale * 0.035;
  const cosmicZ = (Number(mirrorAxes.z || 0) + tide) * displacementScale * 0.025;
  const x = Math.cos(angle + toolTwist) * spiral + cosmicX;
  const y = Math.sin(angle + toolTwist) * spiral + cosmicY;
  const z = ((t - 0.5) * verticalSpread) + (dataDepth * displacementScale * 0.35) + (memoryLift * 0.2) + cosmicZ;
  const biasPulse = (Number(rgbaBias.a || 0) - 0.5) * 0.018;

  return {
    id: `flower_${String(index).padStart(4, '0')}`,
    index,
    position: [round(x), round(y), round(z)],
    color: [round(rgba.r / 255), round(rgba.g / 255), round(rgba.b / 255), round(rgba.a / 255)],
    rgba,
    hex: rgbaToHex(rgba),
    density,
    energy,
    displacement: round(dataDepth * displacementScale),
    twist: round(toolTwist),
    pulse: round(orchestrationPulse + tide * 0.08),
    radius: round(clamp(0.015 + density * 0.085 + energy * 0.04 + biasPulse, 0.01, 0.2)),
  };
}

function summarizeParticles(particles = []) {
  if (!particles.length) {
    return {
      count: 0,
      averageColor: [0, 0, 0, 0],
      averageDensity: 0,
      averageEnergy: 0,
      bounds: { min: [0, 0, 0], max: [0, 0, 0] },
    };
  }
  const totals = { r: 0, g: 0, b: 0, a: 0, density: 0, energy: 0 };
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const particle of particles) {
    totals.r += particle.color[0];
    totals.g += particle.color[1];
    totals.b += particle.color[2];
    totals.a += particle.color[3];
    totals.density += particle.density;
    totals.energy += particle.energy;
    for (let i = 0; i < 3; i += 1) {
      min[i] = Math.min(min[i], particle.position[i]);
      max[i] = Math.max(max[i], particle.position[i]);
    }
  }
  const count = particles.length;
  return {
    count,
    averageColor: [round(totals.r / count), round(totals.g / count), round(totals.b / count), round(totals.a / count)],
    averageDensity: round(totals.density / count),
    averageEnergy: round(totals.energy / count),
    bounds: {
      min: min.map((value) => round(value)),
      max: max.map((value) => round(value)),
    },
  };
}

function buildBlenderAdapter(field, options = {}) {
  const name = String(options.name || 'Shiryu_Mille_Fleurs').replace(/[^a-z0-9_ -]+/gi, '_').slice(0, 64);
  const materialName = `${name}_Matter`;
  const pointsJson = JSON.stringify(field.particles.map((particle) => ({
    id: particle.id,
    position: particle.position,
    color: particle.color,
    radius: particle.radius,
  })));
  const python = [
    'import bpy',
    'from mathutils import Vector',
    `points = ${pointsJson}`,
    `mat = bpy.data.materials.new(${JSON.stringify(materialName)})`,
    'mat.use_nodes = True',
    'nodes = mat.node_tree.nodes',
    'bsdf = nodes.get("Principled BSDF")',
    'if bsdf:',
    `    bsdf.inputs["Base Color"].default_value = ${JSON.stringify(field.material.baseColor)}`,
    `    bsdf.inputs["Alpha"].default_value = ${round(field.material.alpha)}`,
    `    bsdf.inputs["Roughness"].default_value = ${round(field.material.roughness)}`,
    'for point in points:',
    '    bpy.ops.mesh.primitive_uv_sphere_add(segments=12, ring_count=6, radius=point["radius"], location=point["position"])',
    '    obj = bpy.context.object',
    '    obj.name = point["id"]',
    '    obj.data.materials.append(mat)',
    '# Option: replace spheres with Geometry Nodes instancing for heavy fields.',
  ].join('\n');
  return {
    engine: 'blender',
    materialName,
    geometry: 'point-cloud-spheres',
    python,
    geometryNodesHint: 'Use particles[].position/color/radius as instance points; color attribute drives Base Color + Emission.',
  };
}

function buildUnrealAdapter(field, options = {}) {
  const name = String(options.name || 'Shiryu_Mille_Fleurs').replace(/[^a-z0-9_ -]+/gi, '_').slice(0, 64);
  return {
    engine: 'unreal',
    assetPrefix: name,
    niagaraData: {
      type: 'point-cloud',
      attributes: ['position', 'color', 'radius', 'density', 'energy', 'displacement'],
      particleCount: field.particles.length,
    },
    materialGraph: {
      BaseColor: 'Particle.Color.rgb',
      Opacity: 'Particle.Color.a',
      EmissiveColor: `Particle.Color.rgb * ${round(field.material.emissionStrength)}`,
      Roughness: round(field.material.roughness),
      WorldPositionOffset: `Normal * Particle.Displacement * ${round(field.material.displacementStrength)}`,
    },
    blueprintHint: 'Feed particles into Niagara; use density as spawn weight and energy as emissive pulse.',
  };
}

function buildGltfAdapter(field, options = {}) {
  const name = String(options.name || 'Shiryu_Mille_Fleurs').replace(/[^a-z0-9_ -]+/gi, '_').slice(0, 64);
  return {
    engine: 'gltf',
    sceneName: name,
    primitive: 'POINTS',
    extensions: ['KHR_materials_emissive_strength'],
    attributes: {
      POSITION: 'particles[].position',
      COLOR_0: 'particles[].color',
      _RADIUS: 'particles[].radius',
    },
    material: {
      baseColorFactor: field.material.baseColor,
      emissiveFactor: field.material.emissiveColor.slice(0, 3),
      alphaMode: 'BLEND',
    },
  };
}

function buildAdapters(field, options = {}) {
  return {
    blender: buildBlenderAdapter(field, options),
    unreal: buildUnrealAdapter(field, options),
    gltf: buildGltfAdapter(field, options),
  };
}

function buildZenSourceMatterCell({ input = {}, cuda = {}, material = {}, summary = {}, particles = [], cosmicRelations = null } = {}, options = {}) {
  const inputHash = sha256Hex(stableStringify(input));
  const atomHash = sha256Hex(stableStringify({
    atomCount: cuda.atomCount,
    op: cuda.op,
    atomsIn: Array.isArray(cuda.atomsIn) ? cuda.atomsIn : undefined,
    atomsOut: Array.isArray(cuda.atomsOut) ? cuda.atomsOut : undefined,
  }));
  const matterHash = sha256Hex(stableStringify({
    material,
    summary,
    cosmicRelations,
    particles: particles.map((particle) => ({
      id: particle.id,
      position: particle.position,
      color: particle.color,
      density: particle.density,
      displacement: particle.displacement,
    })),
  }));
  const cellHash = sha256Hex(`${inputHash}:${atomHash}:${matterHash}:${options.version || 'v1'}`);
  return {
    ok: true,
    schema: SOURCE_CELL_SCHEMA,
    id: `zcell_${cellHash.slice(0, 20)}`,
    codec: 'zen-json + rgba-atoms + matter-field',
    purpose: 'source-cell-not-render-output',
    retention: 'keeps semantic source, color/matter mapping and deterministic provenance before Blender/Unreal rendering',
    hashes: {
      cell: cellHash,
      input: inputHash,
      atoms: atomHash,
      matter: matterHash,
    },
    payload: {
      atomCount: cuda.atomCount || 0,
      particleCount: particles.length,
      materialName: material.name || '',
      averageColor: summary.averageColor || [0, 0, 0, 0],
      bounds: summary.bounds || null,
      cosmic: cosmicRelations ? {
        schema: cosmicRelations.schema,
        timeBasis: cosmicRelations.timeBasis,
        instantShift: cosmicRelations.instantShift,
        now: cosmicRelations.now,
        gravity: cosmicRelations.gravity,
        moon: cosmicRelations.moon,
        triforce: cosmicRelations.triforce,
        audio: cosmicRelations.audio,
        camera3d: cosmicRelations.modulators?.camera3d,
        centerOfGravity: cosmicRelations.modulators?.centerOfGravity,
      } : null,
    },
    channels: {
      R: 'semantic memory/source lift',
      G: 'tool/dispatch twist',
      B: 'data/body/depth material',
      A: 'priority/density/pulse',
      T: 'calendar/rotation/lunar timing phase',
      M: 'mirror axes/camera matter relation',
    },
    safeToRender: true,
    executable: false,
    createdAt: String(options.now || new Date().toISOString()),
  };
}

function prepareShiryuV3MatterField(input = {}, options = {}) {
  const maxParticles = Math.max(1, Math.min(4096, Number(options.maxParticles || DEFAULT_MAX_PARTICLES)));
  const targetEngine = normalizeEngine(options.engine || options.targetEngine);
  const cosmicRelations = buildCosmicRelations({
    now: options.now || options.time || options.timestamp,
    timeBasis: options.timeBasis || options.basis || options.cosmicBasis,
    instantShift: options.instantShift,
    decorFirst: options.decorFirst,
    bypassForeground: options.bypassForeground,
    gravityBase: options.gravityBase,
    gravityPeak: options.gravityPeak,
    tideMin: options.tideMin,
    tideMax: options.tideMax,
    tideDampingDivisor: options.tideDampingDivisor,
    tideDriftTarget: options.tideDriftTarget,
    physicalElectrolysis: options.physicalElectrolysis,
    lightVacuumFrequency: options.lightVacuumFrequency,
    lightVacuumVibration: options.lightVacuumVibration,
    emotionSource: options.emotionSource || options.emotions || options.emotion || stableStringify(input),
    emotionSignal: options.emotionSignal ?? options.emotionalSignal,
    emotionBalance: options.emotionBalance,
    emotionBalanceEnabled: options.emotionBalanceEnabled,
    emotionBalanceInverted: options.emotionBalanceInverted,
    balanceInverted: options.balanceInverted,
    emotionBalanceStrength: options.emotionBalanceStrength,
    emotionStrength: options.emotionStrength,
  });
  const cuda = prepareCubeCuda(input, {
    op: options.op || 'sculpt',
    threshold: options.threshold,
    threadsPerBlock: options.threadsPerBlock,
    includeAtoms: true,
    autoDetectGpu: options.autoDetectGpu === true || options.gpu === true,
    env: options.env || process.env,
    now: options.now,
  });
  const atomSource = Array.isArray(cuda.atomsOut) ? cuda.atomsOut : cuda.atomsIn;
  const atomCount = Math.floor((atomSource || []).length / 4);
  const particleCount = Math.min(atomCount, maxParticles);
  const particles = [];
  for (let i = 0; i < particleCount; i += 1) {
    particles.push(buildParticleFromAtom(atomAt(atomSource, i), i, particleCount, {
      ...options,
      cosmicRelations,
    }));
  }
  const summary = summarizeParticles(particles);
  const lunarIllumination = Number(cosmicRelations.moon?.illumination || 0);
  const tide = Math.abs(Number(cosmicRelations.moon?.tide || 0));
  const material = {
    name: String(options.materialName || 'shiryu_blood_rain_mille_fleurs'),
    baseColor: summary.averageColor,
    alpha: summary.averageColor[3] || 1,
    density: summary.averageDensity,
    roughness: round(clamp(0.88 - summary.averageDensity * 0.42, 0.08, 0.95)),
    metallic: round(clamp(summary.averageEnergy * 0.12, 0, 0.35)),
    emissiveColor: [summary.averageColor[0], summary.averageColor[1], summary.averageColor[2], 1],
    emissionStrength: round(clamp(0.5 + summary.averageEnergy * 3.5 + lunarIllumination * 0.45 + tide * 0.22, 0, 8)),
    displacementStrength: round(clamp(0.05 + summary.averageDensity * 0.45 + tide * 0.08, 0, 2)),
    cosmicDriver: {
      timeBasis: cosmicRelations.timeBasis,
      primaryDriver: cosmicRelations.primaryDriver,
      instantShift: cosmicRelations.instantShift.enabled,
      gravity: cosmicRelations.gravity.value,
      lunarIllumination: round(lunarIllumination, 9),
      tide: round(tide, 9),
      v9FrequencyHz: cosmicRelations.audio.frequencyHz,
    },
  };
  const field = {
    ok: true,
    schema: SCHEMA,
    mode: 'mille-fleurs-matter-field',
    blade: 'blood-rain',
    pipeline: 'zen -> cube -> atoms(morphing 4B) -> matter-field -> blender/unreal/gpu',
    targetEngine,
    safeMode: true,
    executedOn: cuda.executedOn,
    cudaAvailable: cuda.cudaAvailable,
    gpuStatus: cuda.gpuStatus,
    source: {
      schema: cuda.schema,
      op: cuda.op,
      atomCount: cuda.atomCount,
      kernel: cuda.kernel,
    },
    channels: {
      R: 'memory/current signal -> lift/base red',
      G: 'tools/dispatch signal -> twist/green',
      B: 'json/data material -> depth/displacement',
      A: 'orchestration/priority -> density/alpha/pulse',
    },
    material,
    summary,
    cosmicRelations,
    sourceCell: buildZenSourceMatterCell({ input, cuda, material, summary, particles, cosmicRelations }, options),
    particles,
    adapters: {},
    createdAt: String(options.now || new Date().toISOString()),
  };
  field.adapters = buildAdapters(field, options);
  if (options.includeAtoms === true) {
    field.atoms = atomSource.slice(0, particleCount * 4);
  }
  if (options.includeScripts === false) {
    delete field.adapters.blender.python;
  }
  return field;
}

function getShiryuV3MatterSpec(env = process.env, options = {}) {
  const status = prepareCubeCuda({}, {
    op: 'identity',
    includeAtoms: false,
    autoDetectGpu: options.autoDetectGpu === true,
    env,
  }).gpuStatus;
  return {
    ok: true,
    schema: 'nossen.shiryu.v3_matter_bridge.status.v1',
    bridge: SCHEMA,
    mode: 'mille-fleurs-gpu-matter',
    supportedEngines: [...SUPPORTED_ENGINES],
    defaults: {
      maxParticles: DEFAULT_MAX_PARTICLES,
    },
    cosmicBridge: {
      schema: COSMIC_SCHEMA,
      calendar: {
        gregorianYearDays: GREGORIAN_YEAR_DAYS,
        halfDayAnnualPhaseRad: round(Math.PI / GREGORIAN_YEAR_DAYS, 15),
      },
      moon: {
        synodicMonthDays: LUNAR_SYNODIC_MONTH_DAYS,
        siderealMonthDays: LUNAR_SIDEREAL_MONTH_DAYS,
        anomalisticMonthDays: LUNAR_ANOMALISTIC_MONTH_DAYS,
      },
      audio: {
        mode: 'v9-electrolysis-guitar-audio-only',
        frequencyRangeHz: [V9_ELECTROLYSIS_MIN_HZ, V9_ELECTROLYSIS_MAX_HZ],
        physicalElectrolysis: PHYSICAL_ELECTROLYSIS_DEFAULT,
        lightVacuumVibration: LIGHT_VACUUM_VIBRATION_ENABLED,
        triforceBalance: {
          divisor: TRIFORCE_BALANCE_DIVISOR,
          unitWeight: round(TRIFORCE_BALANCE_WEIGHT, 12),
          actuatesHardware: false,
        },
        emotionLightVacuumBalance: {
          enabled: EMOTION_LIGHT_VACUUM_BALANCE_ENABLED,
          defaultStrength: EMOTION_LIGHT_VACUUM_BALANCE_STRENGTH,
        },
      },
    },
    pipeline: 'zen -> cube -> atoms -> matter-field -> Blender/Unreal',
    gpuStatus: status,
    endpoints: {
      status: 'GET /api/qflush/shiryu/v3/matter/status',
      prepare: 'POST /api/qflush/shiryu/v3/matter/prepare',
      milleFleursPrepare: 'POST /api/qflush/mille-fleurs/gpu/prepare',
    },
    note: 'Safe prepare only: emits material/particle adapters, does not launch Blender/Unreal.',
  };
}

module.exports = {
  SCHEMA,
  SOURCE_CELL_SCHEMA,
  COSMIC_SCHEMA,
  SUPPORTED_ENGINES,
  buildCosmicRelations,
  buildZenSourceMatterCell,
  buildParticleFromAtom,
  COSMIC_PERIODS,
  GREGORIAN_YEAR_DAYS,
  LIGHT_VACUUM_FREQUENCY,
  LIGHT_VACUUM_VIBRATION_ENABLED,
  EMOTION_LIGHT_VACUUM_BALANCE_ENABLED,
  EMOTION_LIGHT_VACUUM_BALANCE_STRENGTH,
  LUNAR_SYNODIC_MONTH_DAYS,
  LUNAR_TIDE_DAMPING_DIVISOR,
  LUNAR_TIDE_MAX,
  LUNAR_TIDE_MIN,
  PLANETARY_CHOIR_KEYS,
  PHYSICAL_ELECTROLYSIS_DEFAULT,
  TIDE_DRIFT_TARGET,
  TRIFORCE_BALANCE_DIVISOR,
  TRIFORCE_BALANCE_WEIGHT,
  getShiryuV3MatterSpec,
  normalizeEngine,
  prepareShiryuV3MatterField,
  rgbaToHex,
  summarizeParticles,
};
