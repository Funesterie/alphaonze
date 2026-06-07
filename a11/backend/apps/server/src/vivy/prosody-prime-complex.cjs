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
const PRIME_SIGNATURE = Object.freeze([2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47]);
const TWO_PI = Math.PI * 2;

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

  return {
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
      labels: ['VivyProsodyPlan', 'VivyProsodySegment', 'VivyProsodyPoint', 'ComplexPhase', 'PrimePulse', 'VivyVocalCast'],
      relationships: ['HAS_SEGMENT', 'USES_PRIME', 'HAS_COMPLEX_PHASE', 'HAS_POINT', 'ASSIGNED_TO_CAST', 'USES_CAST'],
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
}

function formatVivyProsodyPlanForBrief(plan = buildVivyProsodyPlan()) {
  if (!plan?.segments?.length) return '';
  const roles = Array.from(new Set(plan.segments.map((segment) => segment.roleLabel))).join(' + ');
  const primes = Array.from(new Set(plan.segments.map((segment) => segment.prime))).slice(0, 8).join(', ');
  return `Prosodie interne: ${plan.segments.length} segment${plan.segments.length > 1 ? 's' : ''}, casting ${roles || plan.cast?.label || 'Vivy'}, impulsions premieres ${primes}. Courbe continue temps/phase, pas de clavier discret expose.`;
}

function formatVivyProsodyPlanForPrompt(plan = buildVivyProsodyPlan(), options = {}) {
  if (!plan?.segments?.length) return '';
  const maxSegments = Math.max(1, Math.min(9, Number(options.maxSegments || 7)));
  return [
    'Internal vocal prosody map. Do not sing, print, or explain the coordinates.',
    'Use it only to shape timing, breath, voice handoff, rap density, melodic lift and section energy.',
    'Neo4j-compatible basis: prime is integer; real, imaginary, magnitude and phase are floats.',
    `Plan ${plan.sourceHash}: ${plan.summary}`,
    ...plan.segments.slice(0, maxSegments).map((segment) => (
      `- ${segment.label} ${segment.roleLabel}: prime=${segment.prime}, real=${segment.real}, imaginary=${segment.imaginary}, phase=${segment.phase}, pace=${segment.pace}, breath=${segment.breath}, motion=${segment.derivative}`
    )),
  ].join('\n');
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
  return cleanOneLine(`prime-pulsed phrasing, ${handoff}, avg pace ${avgPace}, avg energy ${avgEnergy}`, '', 180);
}

function buildVivyProsodyNeo4jConstraints() {
  return [
    'CREATE CONSTRAINT vivy_prosody_plan_id IF NOT EXISTS FOR (p:VivyProsodyPlan) REQUIRE p.id IS UNIQUE',
    'CREATE CONSTRAINT vivy_prosody_segment_id IF NOT EXISTS FOR (s:VivyProsodySegment) REQUIRE s.id IS UNIQUE',
    'CREATE CONSTRAINT vivy_prosody_point_id IF NOT EXISTS FOR (p:VivyProsodyPoint) REQUIRE p.id IS UNIQUE',
    'CREATE CONSTRAINT vivy_complex_phase_id IF NOT EXISTS FOR (p:ComplexPhase) REQUIRE p.id IS UNIQUE',
    'CREATE CONSTRAINT prime_pulse_value IF NOT EXISTS FOR (p:PrimePulse) REQUIRE p.value IS UNIQUE',
    'CREATE CONSTRAINT vivy_vocal_cast_id IF NOT EXISTS FOR (v:VivyVocalCast) REQUIRE v.id IS UNIQUE',
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

  return {
    plan: planProps,
    cast: cast.filter((item, index, list) => list.findIndex((candidate) => candidate.id === item.id) === index),
    segments,
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
    'RETURN count(DISTINCT segment) AS segments, count(DISTINCT point) AS points',
  ].join('\n');
}

module.exports = {
  PRIME_SIGNATURE,
  SCHEMA,
  buildVivyProsodyPlan,
  buildVivyProsodyNeo4jConstraints,
  buildVivyProsodyNeo4jCypher,
  buildVivyProsodyNeo4jRows,
  buildVivyProsodyStyleHint,
  formatVivyProsodyPlanForBrief,
  formatVivyProsodyPlanForPrompt,
  stripLegacySignalTokens,
};
