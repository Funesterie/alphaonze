'use strict';

const crypto = require('node:crypto');
const {
  normalizeTextNfc,
  normalizeOneLineNfc,
  foldTextForLookup,
} = require('../../lib/language-text.cjs');
const {
  buildVivySongArtistCast,
} = require('../music/vivy-songcraft.cjs');

const SCHEMA = 'funesterie.vivy.prosody-prime-complex.v1';
const DOUBLE_HARMONIC_SCHEMA = 'funesterie.vivy.double-harmonic-sync.v1';
const PRIME_SIGNATURE = Object.freeze([2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47]);
const TWO_PI = Math.PI * 2;
const D9_NAVIGATION_EQUATION = 'n_next=n+k*M*b*(H1+iH2)';
const BRANCH_COMPASS = Object.freeze([
  { id: 'forward', symbol: '1', real: 1, imaginary: 0, label: 'avance reelle' },
  { id: 'lift', symbol: 'i', real: 0, imaginary: 1, label: 'montee imaginaire' },
  { id: 'hold', symbol: '0', real: 0, imaginary: 0, label: 'tenue neutre' },
  { id: 'drop', symbol: '-i', real: 0, imaginary: -1, label: 'descente imaginaire' },
  { id: 'reverse', symbol: '-1', real: -1, imaginary: 0, label: 'retour reel' },
]);

const ROLE_BASE = Object.freeze({
  djeff: { pitch: 0.38, grain: 0.82, pace: 0.78, energy: 0.72, space: 0.38, attack: 'rap-net' },
  vivy: { pitch: 0.68, grain: 0.34, pace: 0.52, energy: 0.58, space: 0.58, attack: 'melodic-clear' },
  a11: { pitch: 0.32, grain: 0.66, pace: 0.45, energy: 0.5, space: 0.64, attack: 'synth-grave' },
  k44: { pitch: 0.48, grain: 0.5, pace: 0.44, energy: 0.46, space: 0.72, attack: 'counter-calm' },
  duo: { pitch: 0.55, grain: 0.52, pace: 0.62, energy: 0.68, space: 0.68, attack: 'duo-handoff' },
  tous: { pitch: 0.58, grain: 0.5, pace: 0.6, energy: 0.74, space: 0.76, attack: 'ensemble' },
});

const SECTION_BASE = Object.freeze({
  intro: { energy: -0.1, pace: -0.12, pitch: 0.02, tension: 0.08, breath: 0.72 },
  verse: { energy: 0.08, pace: 0.14, pitch: -0.02, tension: 0.12, breath: 0.42 },
  pre_chorus: { energy: 0.12, pace: 0.06, pitch: 0.08, tension: 0.18, breath: 0.5 },
  chorus: { energy: 0.2, pace: 0.04, pitch: 0.1, tension: 0.04, breath: 0.58 },
  bridge: { energy: -0.02, pace: -0.16, pitch: -0.04, tension: 0.24, breath: 0.66 },
  outro: { energy: -0.14, pace: -0.18, pitch: -0.06, tension: -0.04, breath: 0.7 },
  free: { energy: 0.04, pace: 0.02, pitch: 0, tension: 0.08, breath: 0.52 },
});

function cleanText(value, max = 2600) {
  return normalizeTextNfc(value, max);
}

function cleanOneLine(value, fallback = '', max = 180) {
  return normalizeOneLineNfc(value, fallback, max);
}

function hashText(value, length = 24) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, length);
}

function hashNumber(value) {
  return Number.parseInt(hashText(value, 12), 16) || 0;
}

function round(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(Number(value || 0) * factor) / factor;
}

function clamp(value, min = 0, max = 1) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return min;
  return Math.max(min, Math.min(max, numeric));
}

function clampUnit(value) {
  return clamp(value, -1, 1);
}

function fold(value = '') {
  return foldTextForLookup(cleanText(value, 2600));
}

function stripLegacySignalTokens(value = '') {
  return cleanText(String(value || '')
    .replace(/\[a4:[^\]]+\]/gi, ' ')
    .replace(/\[numa8:[^\]]+\]/gi, ' '), 2600);
}

function normalizeProsodyMaterial(input = {}) {
  return stripLegacySignalTokens(compactUnique([
    input.lyrics,
    input.songText,
    input.text,
    input.theme,
    input.instruction,
    input.prompt,
    input.message,
    input.voiceInstruction,
    input.songMood,
    input.mood,
    input.style,
  ], 2600));
}

function compactUnique(items = [], max = 2600) {
  const seen = new Set();
  const lines = [];
  for (const item of items) {
    const text = cleanText(item, max);
    if (!text) continue;
    const key = fold(text);
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(text);
  }
  return cleanText(lines.join('\n\n'), max);
}

function inferSectionKind(label = '', index = 0, total = 1) {
  const normalized = fold(label);
  if (/\bintro\b|ouverture|depart|départ/.test(normalized)) return 'intro';
  if (/pre[\s-]*chorus|pre[\s-]*refrain|pré[\s-]*refrain|montee|montée/.test(normalized)) return 'pre_chorus';
  if (/chorus|refrain|hook/.test(normalized)) return 'chorus';
  if (/bridge|pont|break/.test(normalized)) return 'bridge';
  if (/outro|final|fin/.test(normalized)) return 'outro';
  if (/verse|couplet/.test(normalized)) return 'verse';
  if (index === 0) return 'intro';
  if (index === total - 1) return 'outro';
  return index % 3 === 2 ? 'chorus' : 'verse';
}

function roleIdFromText(value = '') {
  const normalized = fold(value);
  if (/\btous\b|\ball\b|ensemble/.test(normalized)) return 'tous';
  if (/\bduo\b/.test(normalized) || (/\bdjeff\b|\bjeff\b|\bfuneste\b/.test(normalized) && /\bvivy\b/.test(normalized))) return 'duo';
  if (/\bdjeff\b|\bjeff\b|\bfuneste\b/.test(normalized)) return 'djeff';
  if (/\bvivy\b/.test(normalized)) return 'vivy';
  if (/\ba11\b|alpha\s*onze|alphaonze/.test(normalized)) return 'a11';
  if (/\bk44\b|kaen44|\bkaen\b/.test(normalized)) return 'k44';
  return '';
}

function roleFromCastAndSection(castIds = [], section = {}, index = 0) {
  const tagged = roleIdFromText(`${section.label || ''} ${section.text || ''}`);
  if (tagged) return tagged;
  if (castIds.includes('djeff') && /verse/.test(section.kind || '') && index % 2 === 0) return 'djeff';
  if (castIds.includes('a11') && section.kind === 'bridge') return 'a11';
  if (castIds.includes('k44') && section.kind === 'bridge') return 'k44';
  if (castIds.includes('vivy') && section.kind === 'chorus') return castIds.length > 1 ? 'duo' : 'vivy';
  if (castIds.length > 1 && section.kind === 'chorus') return 'duo';
  return castIds[index % Math.max(1, castIds.length)] || 'vivy';
}

function splitSections(material = '') {
  const text = cleanText(material, 2600);
  if (!text) {
    return [{ label: '[Intro]', kind: 'intro', text: 'Vivy place le souffle et attend la scene.' }];
  }

  const lines = text.split(/\n+/).map((line) => cleanOneLine(line, '', 260)).filter(Boolean);
  const sections = [];
  let current = null;
  for (const line of lines) {
    const tag = line.match(/^\[([^\]]{2,80})\]\s*(.*)$/);
    if (tag) {
      if (current) sections.push(current);
      current = {
        label: `[${cleanOneLine(tag[1], 'Section', 80)}]`,
        rawLabel: cleanOneLine(tag[1], 'Section', 80),
        text: cleanOneLine(tag[2], '', 260),
      };
      continue;
    }
    if (!current) {
      current = { label: '[Section]', rawLabel: 'Section', text: '' };
    }
    current.text = cleanText([current.text, line].filter(Boolean).join('\n'), 700);
  }
  if (current) sections.push(current);

  const fallbackChunks = text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((chunk) => cleanOneLine(chunk, '', 240))
    .filter(Boolean);
  const base = sections.length ? sections : fallbackChunks.map((chunk, index) => ({
    label: index === 0 ? '[Intro]' : index % 3 === 2 ? '[Chorus]' : `[Verse ${index}]`,
    rawLabel: index === 0 ? 'Intro' : index % 3 === 2 ? 'Chorus' : `Verse ${index}`,
    text: chunk,
  }));

  const total = Math.max(1, base.length);
  return base.slice(0, 9).map((section, index) => ({
    ...section,
    kind: inferSectionKind(`${section.rawLabel || section.label} ${section.text}`, index, total),
    text: cleanText(section.text || section.rawLabel || section.label, 700),
  }));
}

function estimateDensity(text = '') {
  const words = cleanText(text, 700).split(/\s+/).filter(Boolean);
  const commas = (text.match(/[,;:]/g) || []).length;
  const longWords = words.filter((word) => word.length >= 8).length;
  return clamp((words.length / 34) + (commas / 12) + (longWords / 22), 0.16, 1);
}

function themeForces(text = '') {
  const normalized = fold(text);
  return {
    mechanical: /\bmoteur|pignon|couronne|chaine|chaîne|radiateur|huile|essence|pot|booster|scooter|moto|roue|pneu|gomme|cruxi|metra|kit\b/.test(normalized) ? 1 : 0,
    speed: /\bvitesse|course|acceleration|accélération|trace|fonce|roussi|giro|gyro|shmite|wheel|wheeling|slalom\b/.test(normalized) ? 1 : 0,
    light: /\blumiere|lumière|etoile|étoile|phare|neon|néon|clair|soleil\b/.test(normalized) ? 1 : 0,
    memory: /\bmemoire|mémoire|neo4j|graphe|nossen|funesterie|skill tree|zen\b/.test(normalized) ? 1 : 0,
  };
}

function semanticForces(text = '') {
  const normalized = fold(text);
  return {
    ...themeForces(text),
    pursuit: /\bfuite|poursuite|police|shmite|giro|gyro|sirene|sirène|trace|largue|lâche\b/.test(normalized) ? 1 : 0,
    body: /\bcoeur|cœur|sternum|sang|artere|artère|nerf|palpite|respire|souffle\b/.test(normalized) ? 1 : 0,
    craft: /\bdose|millimetre|millimètre|reglage|réglage|calibre|visserie|kit|atelier|geste\b/.test(normalized) ? 1 : 0,
    rupture: /\bmur|porte|clef|clé|casse|retourne|effondre|explose|devoile|dévoile\b/.test(normalized) ? 1 : 0,
  };
}

function topSemanticAnchors(forces = {}, max = 3) {
  const labels = {
    mechanical: 'mécanique',
    speed: 'vitesse',
    light: 'lumière',
    memory: 'mémoire',
    pursuit: 'poursuite',
    body: 'corps',
    craft: 'précision',
    rupture: 'rupture',
  };
  return Object.entries(forces)
    .filter(([, value]) => Number(value) > 0)
    .map(([key]) => labels[key] || key)
    .slice(0, max);
}

function phaseDistance(from, to) {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

function signedTriState(value, threshold = 0.18) {
  if (value > threshold) return '+';
  if (value < -threshold) return '-';
  return '0';
}

function buildSemanticTriState(curve = [], semanticPhase = 0) {
  const signature = curve.map((point) => signedTriState(Math.sin((point.phase || 0) - semanticPhase), 0.2)).join('');
  return signature || '00000';
}

function tempoGridForSegment(segment = {}, roleId = '') {
  const roleBoost = roleId === 'djeff' ? 12 : roleId === 'duo' ? 6 : roleId === 'a11' ? -8 : 0;
  const bpm = Math.round(clamp(
    82 + (Number(segment.pace || 0.5) * 72) + (Number(segment.energy || 0.5) * 18) + roleBoost,
    72,
    178
  ));
  const subdivision = segment.pace >= 0.82
    ? 'triple-16'
    : segment.pace >= 0.66
      ? 'syncopated-8'
      : segment.pace <= 0.42
        ? 'wide-4'
        : 'straight-8';
  return { bpm, subdivision };
}

function findBranchCompass(id = 'hold') {
  return BRANCH_COMPASS.find((branch) => branch.id === id) || BRANCH_COMPASS[2];
}

function chooseD9Branch({ forces = {}, segment = {}, delta = 0, absDelta = 0, semanticWeight = 0.5 } = {}) {
  const positiveDelta = Math.max(0, delta);
  const negativeDelta = Math.max(0, -delta);
  const kind = segment.kind || 'free';
  const scores = {
    forward: ((forces.speed + forces.pursuit + forces.mechanical) * 0.36)
      + (Number(segment.pace || 0.5) * 0.2)
      + (Number(segment.energy || 0.5) * 0.18)
      + (positiveDelta * 0.08),
    lift: ((forces.light + (kind === 'chorus' ? 1 : 0)) * 0.3)
      + (positiveDelta * 0.34)
      + (Number(segment.pitch || 0.5) * 0.12)
      + (semanticWeight * 0.12),
    hold: ((1 - Math.min(1, absDelta)) * 0.34)
      + ((kind === 'intro' || kind === 'outro') ? 0.08 : 0)
      + ((forces.craft || 0) * 0.08),
    drop: ((forces.body + forces.craft) * 0.22)
      + (negativeDelta * 0.32)
      + ((kind === 'bridge' ? 1 : 0) * 0.18)
      + (Number(segment.breath || 0.5) * 0.08),
    reverse: ((forces.memory + forces.rupture) * 0.28)
      + ((kind === 'outro' ? 1 : 0) * 0.16)
      + (negativeDelta * 0.1),
  };

  let best = 'hold';
  let bestScore = scores.hold;
  for (const [id, score] of Object.entries(scores)) {
    if (score > bestScore) {
      best = id;
      bestScore = score;
    }
  }
  return findBranchCompass(best);
}

function buildD9Navigation({ segment = {}, forces = {}, density = 0.5, semanticWeight = 0.5, delta = 0, absDelta = 0 } = {}) {
  const branch = chooseD9Branch({ forces, segment, delta, absDelta, semanticWeight });
  const h1 = clamp(
    (Math.abs(Number(segment.real || 0)) * 0.26)
      + (Number(segment.energy || 0.5) * 0.25)
      + (Number(segment.pace || 0.5) * 0.22)
      + (density * 0.18)
      + ((Number(segment.prime || 2) % 13) / 13 * 0.09),
    0.05,
    1.35
  );
  const h2 = clamp(
    (Math.abs(Number(segment.imaginary || 0)) * 0.24)
      + (semanticWeight * 0.28)
      + (absDelta * 0.18)
      + ((forces.light + forces.memory + forces.rupture + forces.body) * 0.05),
    0.03,
    1.35
  );
  const k = clamp(
    0.2
      + (density * 0.22)
      + (Number(segment.pace || 0.5) * 0.2)
      + (semanticWeight * 0.16)
      + (Math.min(absDelta, 1.4) * 0.1)
      + (branch.id === 'forward' ? 0.08 : 0),
    0.16,
    1.25
  );
  const coherenceM = clamp(1 - (absDelta / Math.PI), 0, 1);
  const productReal = (branch.real * h1) - (branch.imaginary * h2);
  const productImaginary = (branch.real * h2) + (branch.imaginary * h1);
  const deltaReal = k * coherenceM * productReal;
  const deltaImaginary = k * coherenceM * productImaginary;

  return {
    equation: D9_NAVIGATION_EQUATION,
    branchId: branch.id,
    branchSymbol: branch.symbol,
    branchLabel: branch.label,
    branchReal: branch.real,
    branchImaginary: branch.imaginary,
    h1Real: round(h1),
    h2Imaginary: round(h2),
    accelerationK: round(k),
    coherenceM: round(coherenceM),
    deltaReal: round(deltaReal),
    deltaImaginary: round(deltaImaginary),
    nextReal: round(Number(segment.order || 0) + deltaReal),
    nextImaginary: round(Number(segment.phase || 0) + deltaImaginary),
  };
}

function buildDoubleHarmonicSegment(segment = {}, index = 0, total = 1) {
  const forces = semanticForces(segment.textPreview || segment.label);
  const anchors = topSemanticAnchors(forces);
  const density = estimateDensity(segment.textPreview || segment.label);
  const semanticWeight = clamp(
    0.24
      + (density * 0.24)
      + ((forces.mechanical + forces.speed + forces.pursuit + forces.body + forces.craft + forces.rupture) * 0.055),
    0.18,
    0.92
  );
  const narrativeLift = (
    (forces.speed * 0.28)
    + (forces.pursuit * 0.24)
    + (forces.body * 0.18)
    + (forces.light * 0.16)
    + (forces.memory * 0.12)
    + (forces.rupture * 0.2)
    - (forces.craft * 0.08)
  );
  const semanticPhase = segment.phase + ((semanticWeight - 0.5) * 0.72) + (narrativeLift * 0.34) + ((index / Math.max(1, total)) * 0.08);
  const delta = phaseDistance(segment.phase, semanticPhase);
  const absDelta = Math.abs(delta);
  const lock = absDelta <= 0.32 ? 'locked' : absDelta <= 0.72 ? 'guided' : 'loose';
  const { bpm, subdivision } = tempoGridForSegment(segment, segment.roleId);
  const triState = buildSemanticTriState(segment.curve, semanticPhase);
  const gain = clamp(0.72 + (segment.energy * 0.26) + (semanticWeight * 0.16), 0.62, 1.18);
  const breathMs = Math.round(clamp(160 + ((1 - segment.breath) * 380) + (semanticWeight * 80), 120, 640));
  const navigation = buildD9Navigation({ segment, forces, density, semanticWeight, delta, absDelta });
  const control = [
    `S${segment.order}`,
    segment.roleLabel,
    `${bpm}bpm`,
    subdivision,
    `lock=${lock}`,
    `branch=${navigation.branchSymbol}`,
    anchors.length ? `anchors=${anchors.join('+')}` : 'anchors=neutre',
    `tri=${triState}`,
  ].join(' ');

  return {
    id: `vivy-double-harmonic:${segment.id.replace(/^vivy-prosody-segment:/, '')}`,
    segmentId: segment.id,
    order: segment.order,
    label: segment.label,
    roleId: segment.roleId,
    roleLabel: segment.roleLabel,
    audio: {
      phase: segment.phase,
      tempoBpm: bpm,
      subdivision,
      energy: segment.energy,
      grain: segment.grain,
      breathMs,
    },
    semantic: {
      phase: round(semanticPhase),
      weight: round(semanticWeight),
      anchors,
      forceSignature: Object.entries(forces)
        .filter(([, value]) => Number(value) > 0)
        .map(([key]) => key)
        .join(',') || 'neutral',
    },
    sync: {
      state: lock,
      delta: round(delta),
      triState,
      gain: round(gain),
      instruction: lock === 'locked'
        ? 'garder la phrase en phase, ne pas lisser le grain'
        : lock === 'guided'
          ? 'caler le débit sur le sens, respirer avant les images fortes'
          : 'laisser un micro-décalage contrôlé, puis recoller au refrain',
    },
    navigation,
    control,
  };
}

function buildVivyDoubleHarmonicSync(plan = {}, input = {}) {
  const segments = (plan.segments || []).map((segment, index, list) => (
    buildDoubleHarmonicSegment(segment, index, list.length)
  ));
  const lockCount = segments.filter((segment) => segment.sync.state === 'locked').length;
  const guidedCount = segments.filter((segment) => segment.sync.state === 'guided').length;
  const avgTempo = segments.length
    ? Math.round(segments.reduce((sum, segment) => sum + segment.audio.tempoBpm, 0) / segments.length)
    : 0;
  const anchors = [];
  for (const segment of segments) {
    for (const anchor of segment.semantic.anchors) {
      if (!anchors.includes(anchor)) anchors.push(anchor);
    }
  }
  const lockRatio = segments.length ? round((lockCount + (guidedCount * 0.55)) / segments.length, 3) : 0;
  const mode = cleanOneLine(input.mode, 'song', 32);
  const summary = segments.length
    ? `Double harmonique sync: ${segments.length} segment${segments.length > 1 ? 's' : ''}, tempo moyen ${avgTempo} bpm, ${lockCount} verrouillé${lockCount > 1 ? 's' : ''}, ${guidedCount} guidé${guidedCount > 1 ? 's' : ''}, ancrages ${anchors.slice(0, 4).join(', ') || 'neutres'}.`
    : 'Double harmonique sync: aucun segment exploitable.';

  return {
    ok: true,
    schema: DOUBLE_HARMONIC_SCHEMA,
    id: `vivy-double-harmonic-plan:${plan.sourceHash || hashText(JSON.stringify(input), 16)}`,
    sourcePlanId: plan.id,
    mode,
    internalOnly: true,
    basis: {
      harmonicA: 'audio_timing_timbre_energy',
      harmonicB: 'semantic_intent_image_persona',
      branchCompass: BRANCH_COMPASS.map((branch) => ({ ...branch })),
      navigationEquation: D9_NAVIGATION_EQUATION,
      time: 'segment_local_time_then_song_grid',
      alphabet: '- 0 +',
      policy: 'hidden_control_surface_for_voice_and_song_generation_only',
    },
    avgTempoBpm: avgTempo,
    lockRatio,
    dominantAnchors: anchors.slice(0, 6),
    controlTags: segments.slice(0, 6).map((segment) => segment.control),
    summary,
    segments,
  };
}

function buildComplexCurve({ phase, energy, pitch, tension, pace, prime }) {
  const points = [];
  for (let index = 0; index < 5; index += 1) {
    const t = index / 4;
    const theta = phase + (t * (prime % 11) * 0.33) + ((pace - 0.5) * 0.22);
    const real = clampUnit(Math.cos(theta) * (0.45 + energy * 0.55) + ((t - 0.5) * pace * 0.18));
    const imaginary = clampUnit(Math.sin(theta) * (0.42 + pitch * 0.58) + ((0.5 - Math.abs(t - 0.5)) * (tension - 0.5) * 0.22));
    const magnitude = Math.sqrt(real * real + imaginary * imaginary);
    points.push({
      pointIndex: index,
      t: round(t, 2),
      real: round(real),
      imaginary: round(imaginary),
      magnitude: round(magnitude),
      phase: round(Math.atan2(imaginary, real)),
    });
  }
  return points.map((point, index) => {
    const previous = index > 0 ? points[index - 1].magnitude : point.magnitude;
    const diff = point.magnitude - previous;
    return {
      ...point,
      derivative: diff > 0.035 ? '+' : diff < -0.035 ? '-' : '0',
    };
  });
}

function deriveSegmentProsody({ section, roleId, prime, seed, index, total }) {
  const role = ROLE_BASE[roleId] || ROLE_BASE.vivy;
  const sectionBase = SECTION_BASE[section.kind] || SECTION_BASE.free;
  const forces = themeForces(section.text);
  const density = estimateDensity(section.text);
  const hashFrac = (hashNumber(`${seed}:${index}:${section.text}`) % 1000) / 1000;

  const energy = clamp(role.energy + sectionBase.energy + (density * 0.14) + (forces.mechanical * 0.08) + (forces.speed * 0.1) + ((prime % 5) * 0.018));
  const pace = clamp(role.pace + sectionBase.pace + (density * 0.16) + (forces.speed * 0.12) - (forces.memory * 0.04));
  const pitch = clamp(role.pitch + sectionBase.pitch + (forces.light * 0.08) - (forces.mechanical * 0.03) + ((prime % 7) * 0.01));
  const tension = clamp(0.42 + sectionBase.tension + (forces.speed * 0.12) + (forces.memory * 0.08) + (density * 0.12) + ((hashFrac - 0.5) * 0.12));
  const breath = clamp(sectionBase.breath - (density * 0.18) + (1 - pace) * 0.12);
  const space = clamp(role.space + (section.kind === 'chorus' ? 0.12 : 0) + (section.kind === 'bridge' ? 0.16 : 0) - (forces.mechanical * 0.05));
  const phase = (((prime % 13) / 13) + (index / Math.max(1, total)) + (hashFrac * 0.18)) * TWO_PI;
  const curve = buildComplexCurve({ phase, energy, pitch, tension, pace, prime });
  const anchor = curve[Math.floor(curve.length / 2)];

  return {
    energy: round(energy),
    pace: round(pace),
    pitch: round(pitch),
    tension: round(tension),
    breath: round(breath),
    space: round(space),
    grain: round(role.grain + (forces.mechanical * 0.08) + (density * 0.05)),
    attack: role.attack,
    phase: round(anchor.phase),
    real: round(anchor.real),
    imaginary: round(anchor.imaginary),
    magnitude: round(anchor.magnitude),
    derivative: curve.map((point) => point.derivative).join(''),
    curve,
  };
}

function summarizeSegment(segment) {
  return [
    `${segment.order}. ${segment.label}`,
    `${segment.roleLabel}`,
    `prime ${segment.prime}`,
    `pace ${segment.pace}`,
    `phase ${segment.phase}`,
    `motion ${segment.derivative}`,
  ].join(' / ');
}

function buildVivyProsodyPlan(input = {}) {
  const material = normalizeProsodyMaterial(input);
  const cast = buildVivySongArtistCast(input);
  const seedMaterial = cleanText([
    SCHEMA,
    cast.ids.join(','),
    input.mode,
    input.voiceTool,
    input.songSource,
    material,
  ].join('\n'), 3600);
  const planHash = hashText(seedMaterial, 16);
  const sections = splitSections(material);
  const castIds = cast.ids.length ? cast.ids : ['vivy'];
  const total = sections.length;
  const segments = sections.map((section, index) => {
    const segmentSeed = `${planHash}:${index}:${section.label}:${section.text}`;
    const prime = PRIME_SIGNATURE[(index + (hashNumber(segmentSeed) % PRIME_SIGNATURE.length)) % PRIME_SIGNATURE.length];
    const roleId = roleFromCastAndSection(castIds, section, index);
    const roleLabel = roleId === 'duo' ? 'Duo' : roleId === 'tous' ? 'Tous' : cleanOneLine(roleId, 'vivy', 32).replace(/^./, (letter) => letter.toUpperCase());
    const prosody = deriveSegmentProsody({ section, roleId, prime, seed: planHash, index, total });
    const id = `vivy-prosody-segment:${planHash}:${String(index + 1).padStart(2, '0')}`;
    const phaseId = `vivy-complex-phase:${planHash}:${String(index + 1).padStart(2, '0')}`;
    return {
      id,
      phaseId,
      order: index + 1,
      label: cleanOneLine(section.label, `[Segment ${index + 1}]`, 80),
      kind: section.kind,
      roleId,
      roleLabel,
      textHash: hashText(section.text, 16),
      textPreview: cleanOneLine(section.text, '', 180),
      prime,
      ...prosody,
    };
  });

  const summary = `${segments.length} segment${segments.length > 1 ? 's' : ''}, ${cast.countLabel}, ancrage premier + phase imaginaire continue.`;

  const plan = {
    ok: true,
    schema: SCHEMA,
    id: `vivy-prosody-plan:${planHash}`,
    generatedAt: new Date().toISOString(),
    model: 'prime-complex-time',
    sourceHash: planHash,
    internalOnly: true,
    cast: {
      ids: cast.ids,
      label: cast.label,
      count: cast.count,
      artists: cast.artists.map((artist) => ({
        id: artist.id,
        label: artist.label,
        role: artist.role,
      })),
    },
    primeSignature: PRIME_SIGNATURE,
    complexBasis: {
      real: 'drive_tension_projection',
      imaginary: 'phase_lift_projection',
      time: 'segment_local_0_to_1',
      storage: 'neo4j_scalar_float_properties',
    },
    neo4j: {
      labels: ['VivyProsodyPlan', 'VivyProsodySegment', 'VivyProsodyPoint', 'ComplexPhase', 'PrimePulse', 'VivyVocalCast', 'VivyDoubleHarmonicSync'],
      relationships: ['HAS_SEGMENT', 'USES_PRIME', 'HAS_COMPLEX_PHASE', 'HAS_POINT', 'ASSIGNED_TO_CAST', 'USES_CAST', 'HAS_DOUBLE_HARMONIC_SYNC'],
      propertyPolicy: 'Store prime as INTEGER; store real, imaginary, magnitude and phase as FLOAT properties; never store secrets or raw voice references.',
      constraints: buildVivyProsodyNeo4jConstraints(),
    },
    summary,
    promptSummary: [
      'Prime-complex prosody internal plan:',
      `Basis real=${'drive/tension'}, imaginary=${'phase/lift'}, t=${'0..1'}.`,
      `Cast ${cast.label}. ${segments.slice(0, 6).map(summarizeSegment).join(' | ')}`,
    ].join(' '),
    segments,
  };
  plan.doubleHarmonic = buildVivyDoubleHarmonicSync(plan, input);
  return plan;
}

function formatVivyProsodyPlanForBrief(plan = buildVivyProsodyPlan()) {
  if (!plan?.segments?.length) return '';
  const roles = Array.from(new Set(plan.segments.map((segment) => segment.roleLabel))).join(' + ');
  const primes = Array.from(new Set(plan.segments.map((segment) => segment.prime))).slice(0, 8).join(', ');
  const sync = formatVivyDoubleHarmonicSyncForBrief(plan.doubleHarmonic);
  return [
    `Prosodie interne: ${plan.segments.length} segment${plan.segments.length > 1 ? 's' : ''}, casting ${roles || plan.cast?.label || 'Vivy'}, impulsions premieres ${primes}. Courbe continue temps/phase, pas de clavier discret expose.`,
    sync,
  ].filter(Boolean).join(' ');
}

function formatVivyProsodyPlanForPrompt(plan = buildVivyProsodyPlan(), options = {}) {
  if (!plan?.segments?.length) return '';
  const maxSegments = Math.max(1, Math.min(9, Number(options.maxSegments || 7)));
  return [
    'Internal vocal prosody map. Do not sing, print, or explain the coordinates.',
    'Use it only to shape timing, breath, voice handoff, rap density, melodic lift and section energy.',
    'Neo4j-compatible basis: prime is integer; real, imaginary, magnitude and phase are floats.',
    `Plan ${plan.sourceHash}: ${plan.summary}`,
    formatVivyDoubleHarmonicSyncForPrompt(plan.doubleHarmonic, { maxSegments }),
    ...plan.segments.slice(0, maxSegments).map((segment) => (
      `- ${segment.label} ${segment.roleLabel}: prime=${segment.prime}, real=${segment.real}, imaginary=${segment.imaginary}, phase=${segment.phase}, pace=${segment.pace}, breath=${segment.breath}, motion=${segment.derivative}`
    )),
  ].filter(Boolean).join('\n');
}

function buildVivyProsodyStyleHint(plan = buildVivyProsodyPlan()) {
  if (!plan?.segments?.length) return '';
  const hasDjeff = plan.cast?.ids?.includes('djeff');
  const hasVivy = plan.cast?.ids?.includes('vivy');
  const avgPace = round(plan.segments.reduce((sum, segment) => sum + segment.pace, 0) / plan.segments.length);
  const avgEnergy = round(plan.segments.reduce((sum, segment) => sum + segment.energy, 0) / plan.segments.length);
  const handoff = hasDjeff && hasVivy
    ? 'tight Djeff rap to Vivy hook handoff'
    : 'continuous vocal phase';
  const doubleHarmonic = buildVivyDoubleHarmonicStyleHint(plan.doubleHarmonic);
  return cleanOneLine([
    `prime-pulsed phrasing, ${handoff}, avg pace ${avgPace}, avg energy ${avgEnergy}`,
    doubleHarmonic,
  ].filter(Boolean).join(', '), '', 240);
}

function formatVivyDoubleHarmonicSyncForBrief(sync = null) {
  if (!sync?.segments?.length) return '';
  const branches = Array.from(new Set(sync.segments.map((segment) => segment.navigation?.branchSymbol).filter(Boolean))).slice(0, 5).join('/');
  return `Double harmonique interne: piste rythme/timbre + piste intention/sens synchronisées; tempo moyen ${sync.avgTempoBpm} bpm, verrou ${sync.lockRatio}, branches D8/D9 ${branches || '0'}, ancrages ${sync.dominantAnchors.slice(0, 4).join(', ') || 'neutres'}.`;
}

function formatVivyDoubleHarmonicSyncForPrompt(sync = null, options = {}) {
  if (!sync?.segments?.length) return '';
  const maxSegments = Math.max(1, Math.min(9, Number(options.maxSegments || 7)));
  return [
    'Double harmonic sync internal map. Harmonic A drives audio timing/timbre; harmonic B drives semantic intent and imagery.',
    `Use trinary -/0/+ as hidden micro-timing correction, never print the code. Use D8/D9 branch compass {1,i,0,-i,-1} as hidden navigation only. Equation ${D9_NAVIGATION_EQUATION}. Avg tempo ${sync.avgTempoBpm} bpm; anchors ${sync.dominantAnchors.slice(0, 5).join(', ') || 'neutral'}.`,
    ...sync.segments.slice(0, maxSegments).map((segment) => (
      `- ${segment.label} ${segment.roleLabel}: tempo=${segment.audio.tempoBpm}, grid=${segment.audio.subdivision}, sync=${segment.sync.state}, branch=${segment.navigation?.branchSymbol || '0'}, k=${segment.navigation?.accelerationK || 0}, M=${segment.navigation?.coherenceM || 0}, tri=${segment.sync.triState}, semantic=${segment.semantic.forceSignature}, instruction=${segment.sync.instruction}`
    )),
  ].join('\n');
}

function buildVivyDoubleHarmonicStyleHint(sync = null) {
  if (!sync?.segments?.length) return '';
  const anchors = sync.dominantAnchors.slice(0, 3).join('/') || 'neutral';
  const branches = Array.from(new Set(sync.segments.map((segment) => segment.navigation?.branchSymbol).filter(Boolean))).slice(0, 4).join('/');
  return cleanOneLine(`double-harmonic synchronized flow, ${sync.avgTempoBpm} bpm grid, branches ${branches || '0'}, anchors ${anchors}, hidden trinary microtiming`, '', 160);
}

function buildVivyProsodyNeo4jConstraints() {
  return [
    'CREATE CONSTRAINT vivy_prosody_plan_id IF NOT EXISTS FOR (p:VivyProsodyPlan) REQUIRE p.id IS UNIQUE',
    'CREATE CONSTRAINT vivy_prosody_segment_id IF NOT EXISTS FOR (s:VivyProsodySegment) REQUIRE s.id IS UNIQUE',
    'CREATE CONSTRAINT vivy_prosody_point_id IF NOT EXISTS FOR (p:VivyProsodyPoint) REQUIRE p.id IS UNIQUE',
    'CREATE CONSTRAINT vivy_complex_phase_id IF NOT EXISTS FOR (p:ComplexPhase) REQUIRE p.id IS UNIQUE',
    'CREATE CONSTRAINT prime_pulse_value IF NOT EXISTS FOR (p:PrimePulse) REQUIRE p.value IS UNIQUE',
    'CREATE CONSTRAINT vivy_vocal_cast_id IF NOT EXISTS FOR (v:VivyVocalCast) REQUIRE v.id IS UNIQUE',
    'CREATE CONSTRAINT vivy_double_harmonic_sync_id IF NOT EXISTS FOR (s:VivyDoubleHarmonicSync) REQUIRE s.id IS UNIQUE',
  ];
}

function buildVivyProsodyNeo4jRows(plan = buildVivyProsodyPlan()) {
  const planProps = {
    id: plan.id,
    schema: plan.schema,
    model: plan.model,
    sourceHash: plan.sourceHash,
    summary: plan.summary,
    castLabel: plan.cast.label,
    castCount: plan.cast.count,
    castIds: plan.cast.ids,
    primeSignature: plan.primeSignature,
    complexRealBasis: plan.complexBasis.real,
    complexImaginaryBasis: plan.complexBasis.imaginary,
    timeBasis: plan.complexBasis.time,
    doubleHarmonicSchema: plan.doubleHarmonic?.schema || '',
    doubleHarmonicAvgTempoBpm: plan.doubleHarmonic?.avgTempoBpm || 0,
    doubleHarmonicLockRatio: plan.doubleHarmonic?.lockRatio || 0,
    doubleHarmonicAnchors: plan.doubleHarmonic?.dominantAnchors || [],
    doubleHarmonicBranchCompass: (plan.doubleHarmonic?.basis?.branchCompass || []).map((branch) => branch.symbol),
    doubleHarmonicNavigationEquation: plan.doubleHarmonic?.basis?.navigationEquation || '',
    doubleHarmonicSummary: plan.doubleHarmonic?.summary || '',
    internalOnly: true,
    generatedAt: plan.generatedAt,
  };

  const cast = plan.cast.artists.map((artist) => ({
    id: `vivy-vocal-cast:${artist.id}`,
    artistId: artist.id,
    label: artist.label,
    role: artist.role,
  }));
  if (plan.segments.some((segment) => segment.roleId === 'duo')) {
    cast.push({ id: 'vivy-vocal-cast:duo', artistId: 'duo', label: 'Duo', role: 'passage commun' });
  }
  if (plan.segments.some((segment) => segment.roleId === 'tous')) {
    cast.push({ id: 'vivy-vocal-cast:tous', artistId: 'tous', label: 'Tous', role: 'ensemble' });
  }

  const segments = plan.segments.map((segment) => ({
    props: {
      id: segment.id,
      planId: plan.id,
      order: segment.order,
      label: segment.label,
      kind: segment.kind,
      roleId: segment.roleId,
      roleLabel: segment.roleLabel,
      textHash: segment.textHash,
      textPreview: segment.textPreview,
      prime: segment.prime,
      energy: segment.energy,
      pace: segment.pace,
      pitch: segment.pitch,
      tension: segment.tension,
      breath: segment.breath,
      space: segment.space,
      grain: segment.grain,
      attack: segment.attack,
      derivative: segment.derivative,
    },
    prime: segment.prime,
    castId: `vivy-vocal-cast:${segment.roleId}`,
    phase: {
      id: segment.phaseId,
      segmentId: segment.id,
      real: segment.real,
      imaginary: segment.imaginary,
      magnitude: segment.magnitude,
      phase: segment.phase,
      basis: plan.complexBasis.storage,
    },
    points: segment.curve.map((point) => ({
      id: `vivy-prosody-point:${plan.sourceHash}:${String(segment.order).padStart(2, '0')}:${point.pointIndex}`,
      segmentId: segment.id,
      pointIndex: point.pointIndex,
      t: point.t,
      real: point.real,
      imaginary: point.imaginary,
      magnitude: point.magnitude,
      phase: point.phase,
      derivative: point.derivative,
    })),
  }));

  const sync = (plan.doubleHarmonic?.segments || []).map((segment) => ({
    segmentId: segment.segmentId,
    props: {
      id: segment.id,
      segmentId: segment.segmentId,
      order: segment.order,
      roleId: segment.roleId,
      roleLabel: segment.roleLabel,
      audioPhase: segment.audio.phase,
      semanticPhase: segment.semantic.phase,
      tempoBpm: segment.audio.tempoBpm,
      subdivision: segment.audio.subdivision,
      syncState: segment.sync.state,
      syncDelta: segment.sync.delta,
      triState: segment.sync.triState,
      gain: segment.sync.gain,
      breathMs: segment.audio.breathMs,
      forceSignature: segment.semantic.forceSignature,
      anchors: segment.semantic.anchors,
      instruction: segment.sync.instruction,
      navigationEquation: segment.navigation?.equation || D9_NAVIGATION_EQUATION,
      branchId: segment.navigation?.branchId || 'hold',
      branchSymbol: segment.navigation?.branchSymbol || '0',
      branchLabel: segment.navigation?.branchLabel || 'tenue neutre',
      branchReal: segment.navigation?.branchReal || 0,
      branchImaginary: segment.navigation?.branchImaginary || 0,
      h1Real: segment.navigation?.h1Real || 0,
      h2Imaginary: segment.navigation?.h2Imaginary || 0,
      accelerationK: segment.navigation?.accelerationK || 0,
      coherenceM: segment.navigation?.coherenceM || 0,
      navigationDeltaReal: segment.navigation?.deltaReal || 0,
      navigationDeltaImaginary: segment.navigation?.deltaImaginary || 0,
      navigationNextReal: segment.navigation?.nextReal || 0,
      navigationNextImaginary: segment.navigation?.nextImaginary || 0,
      control: segment.control,
    },
  }));

  return {
    plan: planProps,
    cast: cast.filter((item, index, list) => list.findIndex((candidate) => candidate.id === item.id) === index),
    segments,
    sync,
  };
}

function buildVivyProsodyNeo4jCypher() {
  return [
    'CYPHER 25',
    'MERGE (plan:VivyProsodyPlan {id: $plan.id})',
    'SET plan += $plan',
    'WITH plan',
    'UNWIND $cast AS castRow',
    'MERGE (voice:VivyVocalCast {id: castRow.id})',
    'SET voice += castRow',
    'MERGE (plan)-[:USES_CAST]->(voice)',
    'WITH plan',
    'UNWIND $segments AS segmentRow',
    'MERGE (segment:VivyProsodySegment {id: segmentRow.props.id})',
    'SET segment += segmentRow.props',
    'MERGE (plan)-[:HAS_SEGMENT]->(segment)',
    'MERGE (prime:PrimePulse {value: segmentRow.prime})',
    "SET prime.kind = 'prime-integer'",
    'MERGE (segment)-[:USES_PRIME]->(prime)',
    'MERGE (phase:ComplexPhase {id: segmentRow.phase.id})',
    'SET phase += segmentRow.phase',
    'MERGE (segment)-[:HAS_COMPLEX_PHASE]->(phase)',
    'WITH segment, segmentRow',
    'MATCH (voice:VivyVocalCast {id: segmentRow.castId})',
    'MERGE (segment)-[:ASSIGNED_TO_CAST]->(voice)',
    'WITH segment, segmentRow',
    'UNWIND segmentRow.points AS pointRow',
    'MERGE (point:VivyProsodyPoint {id: pointRow.id})',
    'SET point += pointRow',
    'MERGE (segment)-[:HAS_POINT]->(point)',
    'WITH count(DISTINCT segment) AS segmentsCount, count(DISTINCT point) AS pointsCount',
    'UNWIND $sync AS syncRow',
    'MERGE (sync:VivyDoubleHarmonicSync {id: syncRow.props.id})',
    'SET sync += syncRow.props',
    'WITH sync, syncRow, segmentsCount, pointsCount',
    'MATCH (segment:VivyProsodySegment {id: syncRow.segmentId})',
    'MERGE (segment)-[:HAS_DOUBLE_HARMONIC_SYNC]->(sync)',
    'RETURN segmentsCount AS segments, pointsCount AS points, count(DISTINCT sync) AS syncNodes',
  ].join('\n');
}

module.exports = {
  DOUBLE_HARMONIC_SCHEMA,
  PRIME_SIGNATURE,
  SCHEMA,
  buildVivyDoubleHarmonicSync,
  BRANCH_COMPASS,
  D9_NAVIGATION_EQUATION,
  buildVivyProsodyPlan,
  buildVivyProsodyNeo4jConstraints,
  buildVivyProsodyNeo4jCypher,
  buildVivyProsodyNeo4jRows,
  buildVivyDoubleHarmonicStyleHint,
  buildVivyProsodyStyleHint,
  formatVivyDoubleHarmonicSyncForBrief,
  formatVivyDoubleHarmonicSyncForPrompt,
  formatVivyProsodyPlanForBrief,
  formatVivyProsodyPlanForPrompt,
  stripLegacySignalTokens,
};
