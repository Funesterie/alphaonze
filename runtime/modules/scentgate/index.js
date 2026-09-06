import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const DEFAULT_ALIASES = Object.freeze(['PortalCake', 'CakeIsReal', 'CakeIsALie']);
const DEFAULT_LIMITS = Object.freeze({
  ttlMinutes: 30,
  maxDocs: 12,
  maxBytes: 5_000_000
});

function toText(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  return String(value).replace(/\s+/g, ' ').trim();
}

function clampInt(value, min, max, fallback) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function toList(value) {
  if (value === null || value === undefined) return [];
  const items = Array.isArray(value) ? value : [value];
  return items
    .flatMap((entry) => String(entry).split(','))
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function uniqueStable(values) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function allowedText(value, fallback = '', maxLength = 280) {
  const out = toText(value, fallback);
  return out.slice(0, maxLength);
}

function nowMs(value) {
  if (value instanceof Date) return value.getTime();
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function toIso(ms) {
  return new Date(ms).toISOString();
}

function onlySafeInput(input = {}) {
  return {
    mission: input.mission ?? input.intent ?? '',
    alias: input.alias ?? input.aliases ?? [],
    corpusHints: input.corpusHints ?? input.corpus ?? input.refs ?? [],
    shaRefs: input.shaRefs ?? input.hashes ?? [],
    laneHints: input.laneHints ?? input.lanes ?? [],
    scope: input.scope ?? 'scentgate/research',
    operator: input.operator ?? '',
    auditTag: input.auditTag ?? 'ScentGate',
    ticketId: input.ticketId ?? input.id ?? '',
    ttlMinutes: input.ttlMinutes ?? DEFAULT_LIMITS.ttlMinutes,
    maxDocs: input.maxDocs ?? DEFAULT_LIMITS.maxDocs,
    maxBytes: input.maxBytes ?? DEFAULT_LIMITS.maxBytes
  };
}

export function createScentGateCapsule(input = {}) {
  const safe = onlySafeInput(input);
  const aliases = uniqueStable([...DEFAULT_ALIASES, ...toList(safe.alias)]);
  const ttlMinutes = clampInt(safe.ttlMinutes, 5, 240, DEFAULT_LIMITS.ttlMinutes);
  const maxDocs = clampInt(safe.maxDocs, 1, 200, DEFAULT_LIMITS.maxDocs);
  const maxBytes = clampInt(safe.maxBytes, 1024, 50 * 1024 * 1024, DEFAULT_LIMITS.maxBytes);
  const createdAtMs = nowMs(input.now);
  const expiresAtMs = createdAtMs + ttlMinutes * 60 * 1000;

  return {
    version: '0.1.0',
    name: 'ScentGate Capsule',
    aliases,
    memoryAlias: 'PortalCake',
    mission: allowedText(safe.mission, 'Ephemeral multi-corpus research capsule', 320),
    operator: allowedText(safe.operator, ''),
    auditTag: allowedText(safe.auditTag, 'ScentGate'),
    ticketId: allowedText(safe.ticketId, ''),
    mode: 'ephemeral-research',
    transport: {
      odour: 'Rome',
      router: 'NPZ',
      runtime: 'Podman',
      proof: 'Neo4j'
    },
    limits: {
      ttlMinutes,
      maxDocs,
      maxBytes,
      retainRaw: false
    },
    scope: allowedText(safe.scope, 'scentgate/research'),
    inputs: {
      corpusHints: toList(safe.corpusHints).map((entry) => allowedText(entry, '', 120)),
      shaRefs: toList(safe.shaRefs).map((entry) => allowedText(entry, '', 120)),
      laneHints: toList(safe.laneHints).map((entry) => allowedText(entry, '', 80))
    },
    outputs: ['summary', 'hashes', 'provenance', 'scores', 'paths'],
    policy: {
      retainRaw: false,
      noShell: true,
      noDockerSock: true,
      auditAppendOnly: true,
      destroyOnExit: true,
      rotateKeysOnExit: true
    },
    lifecycle: {
      stage: 'ephemeral',
      createdAt: toIso(createdAtMs),
      expiresAt: toIso(expiresAtMs),
      exitAction: 'destroy-capsule',
      ttlMinutes
    },
    notes: [
      'PortalCake is the memory alias.',
      'CakeIsReal means the capsule exists.',
      'CakeIsALie means the capsule must not retain raw content.'
    ]
  };
}

export function isScentGateExpired(capsule, now = Date.now()) {
  if (!capsule || typeof capsule !== 'object') return true;
  if (capsule.lifecycle?.stage === 'destroyed') return true;
  const expiresAt = Date.parse(capsule.lifecycle?.expiresAt || '');
  if (!Number.isFinite(expiresAt)) return true;
  return nowMs(now) >= expiresAt;
}

export function assertScentGateActive(capsule, now = Date.now()) {
  if (isScentGateExpired(capsule, now)) {
    const error = new Error('ScentGate capsule is expired or destroyed');
    error.code = 'SCENTGATE_INACTIVE';
    throw error;
  }
  return capsule;
}

export function destroyScentGateCapsule(capsule, options = {}) {
  const destroyedAt = toIso(nowMs(options.now));
  return {
    version: capsule?.version || '0.1.0',
    name: 'ScentGate Capsule Tombstone',
    aliases: uniqueStable(toList(capsule?.aliases || DEFAULT_ALIASES)),
    memoryAlias: capsule?.memoryAlias || 'PortalCake',
    auditTag: allowedText(capsule?.auditTag, 'ScentGate'),
    ticketId: allowedText(capsule?.ticketId, ''),
    mode: 'destroyed',
    scope: allowedText(capsule?.scope, 'scentgate/research'),
    policy: {
      retainRaw: false,
      noShell: true,
      noDockerSock: true,
      auditAppendOnly: true,
      destroyOnExit: true,
      rotateKeysOnExit: true
    },
    lifecycle: {
      stage: 'destroyed',
      previousStage: capsule?.lifecycle?.stage || 'unknown',
      createdAt: capsule?.lifecycle?.createdAt,
      expiresAt: capsule?.lifecycle?.expiresAt,
      destroyedAt,
      exitAction: 'destroyed'
    },
    outputs: ['tombstone', 'provenance'],
    notes: ['Capsule destroyed; raw inputs are not retained.']
  };
}

export async function withScentGateCapsule(input, fn) {
  const capsule = createScentGateCapsule(input);
  try {
    assertScentGateActive(capsule);
    const result = await fn(capsule);
    return {
      result,
      tombstone: destroyScentGateCapsule(capsule)
    };
  } catch (error) {
    error.scentGateTombstone = destroyScentGateCapsule(capsule);
    throw error;
  }
}

export function renderScentGateCapsule(capsule) {
  return JSON.stringify(capsule, null, 2);
}

export function describeScentGate() {
  return 'ScentGate builds an ephemeral research capsule: Rome scents, NPZ routes, Podman isolates, Neo4j proves, then the capsule disappears.';
}

export const SCENT_GATE_SIGNAL_TYPES = Object.freeze([
  'job.completed',
  'job.failed',
  'job.cancelled'
]);

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function signalSecret(secret) {
  const value = Buffer.isBuffer(secret) ? secret : Buffer.from(String(secret || ''), 'utf8');
  if (value.length < 32) {
    const error = new Error('ScentGate signal secret must contain at least 32 bytes');
    error.code = 'SCENTGATE_SIGNAL_SECRET_WEAK';
    throw error;
  }
  return value;
}

function signSignalPayload(payload, secret) {
  return createHmac('sha256', signalSecret(secret)).update(canonicalJson(payload)).digest('base64url');
}

/**
 * Sous-contrat de notification ferme et signe. Il ne remplace ni la capsule de
 * recherche ScentGate, ni BLOOP (sonar Neo4j), ni EKKO (capture audio).
 */
export function createScentGateSignal(input = {}, options = {}) {
  const type = allowedText(input.type, '', 40);
  if (!SCENT_GATE_SIGNAL_TYPES.includes(type)) {
    const error = new Error(`Unsupported ScentGate signal type: ${type || 'empty'}`);
    error.code = 'SCENTGATE_SIGNAL_TYPE_DENIED';
    throw error;
  }
  const now = nowMs(options.now);
  const ttlSeconds = clampInt(input.ttlSeconds, 15, 600, 120);
  const payload = {
    schema: 'nossen.scentgate.signal.v1',
    type,
    issuer: allowedText(input.issuer, '', 80),
    audience: allowedText(input.audience, '', 80),
    jobId: allowedText(input.jobId, '', 160),
    resultDigest: allowedText(input.resultDigest, '', 128).toLowerCase(),
    bloopReportId: allowedText(input.bloopReportId, '', 160),
    issuedAt: toIso(now),
    expiresAt: toIso(now + ttlSeconds * 1000),
    nonce: allowedText(options.nonce || input.nonce || randomBytes(18).toString('base64url'), '', 120)
  };
  if (!payload.issuer || !payload.audience || !payload.jobId || !payload.nonce) {
    const error = new Error('ScentGate signal issuer, audience, jobId and nonce are required');
    error.code = 'SCENTGATE_SIGNAL_INVALID';
    throw error;
  }
  if (payload.resultDigest && !/^[a-f0-9]{64}$/.test(payload.resultDigest)) {
    const error = new Error('ScentGate resultDigest must be a SHA-256 hexadecimal digest');
    error.code = 'SCENTGATE_SIGNAL_DIGEST_INVALID';
    throw error;
  }
  return {
    payload,
    signature: signSignalPayload(payload, options.secret)
  };
}

/* -------------------------------------------------------------------------- */
/* Pièce de capacité — le jeton temporaire du Jukebox NUMA.                     */
/* -------------------------------------------------------------------------- */

/**
 * Une pièce dit « cet agent peut faire CETTE action, dans CETTE zone, pendant
 * CE temps ». Elle ne contient jamais de jeton OAuth: la vraie clé reste dans le
 * coffre, la pièce n'est qu'un droit de tirage borné.
 *
 * Pourquoi un contrat séparé du signal de job plutôt qu'un type de plus. Le signal
 * répond « le travail est fini » et son enveloppe est faite pour ça: resultDigest,
 * bloopReportId. Une capacité répond « tu as le droit », ce qui demande d'autres
 * champs et surtout d'autres validations — un chemin de zone mal vérifié est une
 * faille, pas une donnée. Mélanger les deux dans un schéma unique aurait rendu
 * chaque champ optionnel, donc chaque validation facultative.
 */
export const SCENT_GATE_CAPABILITY_ACTIONS = Object.freeze([
  'read',
  'list',
  'write'
]);

// La suppression n'est délibérément PAS une capacité délivrable. Effacer chez
// quelqu'un demande une décision humaine, pas une pièce de soixante secondes.

const CAPABILITY_SCHEMA = 'nossen.scentgate.capability.v1';

/**
 * Normalise une zone et refuse tout ce qui pourrait en sortir.
 *
 * C'est la validation la plus importante du module. Une pièce pour
 * /Vivy/Productions qui se laisse ramener à / donne accès à tout le disque; la
 * traversée de chemin est la façon habituelle d'y arriver. On refuse plutôt que
 * de nettoyer: un chemin douteux est une erreur d'appelant, pas une entrée à
 * corriger en silence.
 */
function normalizeZone(value) {
  const brut = String(value ?? '').trim();
  if (!brut) {
    const error = new Error('ScentGate capability zone is required');
    error.code = 'SCENTGATE_CAPABILITY_ZONE_MISSING';
    throw error;
  }
  // On travaille en séparateurs POSIX: les Drive (Graph, Google) les utilisent.
  const unifie = brut.replace(/\\/g, '/');
  if (unifie.includes('\0') || /%2e|%2f/i.test(unifie)) {
    const error = new Error('ScentGate capability zone contains an encoded traversal');
    error.code = 'SCENTGATE_CAPABILITY_ZONE_INVALID';
    throw error;
  }
  const segments = unifie.split('/').filter((s) => s.length > 0);
  if (segments.some((s) => s === '.' || s === '..')) {
    const error = new Error('ScentGate capability zone must not contain . or ..');
    error.code = 'SCENTGATE_CAPABILITY_ZONE_INVALID';
    throw error;
  }
  if (!segments.length) {
    // « / » seul reviendrait à donner le disque entier. Une pièce doit être bornée.
    const error = new Error('ScentGate capability zone must not be the drive root');
    error.code = 'SCENTGATE_CAPABILITY_ZONE_TOO_BROAD';
    throw error;
  }
  const zone = `/${segments.join('/')}`;
  if (zone.length > 240) {
    const error = new Error('ScentGate capability zone is too long');
    error.code = 'SCENTGATE_CAPABILITY_ZONE_INVALID';
    throw error;
  }
  return zone;
}

/**
 * Forge une pièce signée. Le secret et les règles de signature sont exactement
 * ceux du signal: même HMAC-SHA-256 sur JSON canonique, même plancher de 32 octets.
 *
 * @param {object} input  { agent, drive, zone, action, issuer, audience, ttlSeconds, nonce }
 * @param {object} options { secret, now, nonce }
 */
export function createScentGateCapability(input = {}, options = {}) {
  const action = allowedText(input.action, '', 20).toLowerCase();
  if (!SCENT_GATE_CAPABILITY_ACTIONS.includes(action)) {
    const error = new Error(`Unsupported ScentGate capability action: ${action || 'empty'}`);
    error.code = 'SCENTGATE_CAPABILITY_ACTION_DENIED';
    throw error;
  }
  const now = nowMs(options.now);
  // TTL volontairement plus court que celui d'un signal: une pièce se consomme
  // tout de suite. Une minute par défaut, cinq au maximum.
  const ttlSeconds = clampInt(input.ttlSeconds, 15, 300, 60);
  const payload = {
    schema: CAPABILITY_SCHEMA,
    action,
    agent: allowedText(input.agent, '', 60),
    drive: allowedText(input.drive, '', 60),
    zone: normalizeZone(input.zone),
    issuer: allowedText(input.issuer, '', 80),
    audience: allowedText(input.audience, '', 80),
    issuedAt: toIso(now),
    expiresAt: toIso(now + ttlSeconds * 1000),
    nonce: allowedText(options.nonce || input.nonce || randomBytes(18).toString('base64url'), '', 120)
  };
  if (!payload.agent || !payload.drive || !payload.issuer || !payload.audience || !payload.nonce) {
    const error = new Error('ScentGate capability agent, drive, issuer, audience and nonce are required');
    error.code = 'SCENTGATE_CAPABILITY_INVALID';
    throw error;
  }
  return {
    payload,
    signature: signSignalPayload(payload, options.secret)
  };
}

/**
 * Vérifie une pièce et, si on lui donne une demande concrète, vérifie que cette
 * demande tient DANS la pièce.
 *
 * Le second contrôle est celui qu'on oublie: une signature valide prouve que la
 * pièce est authentique, pas qu'elle autorise ce qu'on est en train de faire.
 * Sans `requested`, on ne rend qu'une authenticité.
 *
 * @param {object} envelope   { payload, signature }
 * @param {object} options    { secret, expectedAudience, now, clockSkewMs, seenNonces,
 *                              requested: { drive, zone, action } }
 */
export function verifyScentGateCapability(envelope, options = {}) {
  try {
    const payload = envelope?.payload;
    if (!payload || payload.schema !== CAPABILITY_SCHEMA) {
      return { ok: false, error: 'SCENTGATE_CAPABILITY_SCHEMA_INVALID' };
    }
    if (!SCENT_GATE_CAPABILITY_ACTIONS.includes(payload.action)) {
      return { ok: false, error: 'SCENTGATE_CAPABILITY_ACTION_DENIED' };
    }
    if (options.expectedAudience && payload.audience !== options.expectedAudience) {
      return { ok: false, error: 'SCENTGATE_CAPABILITY_AUDIENCE_MISMATCH' };
    }
    const signature = Buffer.from(String(envelope.signature || ''), 'base64url');
    const expected = Buffer.from(signSignalPayload(payload, options.secret), 'base64url');
    if (signature.length !== expected.length || !timingSafeEqual(signature, expected)) {
      return { ok: false, error: 'SCENTGATE_CAPABILITY_SIGNATURE_INVALID' };
    }
    const now = nowMs(options.now);
    const issuedAt = Date.parse(payload.issuedAt || '');
    const expiresAt = Date.parse(payload.expiresAt || '');
    const clockSkewMs = Math.max(0, Number(options.clockSkewMs || 5000));
    if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || issuedAt > now + clockSkewMs || now >= expiresAt) {
      return { ok: false, error: 'SCENTGATE_CAPABILITY_EXPIRED' };
    }
    const nonce = String(payload.nonce || '');
    if (!nonce) return { ok: false, error: 'SCENTGATE_CAPABILITY_NONCE_MISSING' };
    if (options.seenNonces?.has?.(nonce)) return { ok: false, error: 'SCENTGATE_CAPABILITY_REPLAYED' };

    const demande = options.requested;
    if (demande) {
      if (allowedText(demande.drive, '', 60) !== payload.drive) {
        return { ok: false, error: 'SCENTGATE_CAPABILITY_DRIVE_MISMATCH' };
      }
      const actionDemandee = allowedText(demande.action, '', 20).toLowerCase();
      // Pas de hiérarchie implicite: une pièce « read » n'autorise pas « list ».
      // Une échelle de privilèges devinée est une échelle qu'on escalade.
      if (actionDemandee !== payload.action) {
        return { ok: false, error: 'SCENTGATE_CAPABILITY_ACTION_MISMATCH' };
      }
      let zoneDemandee;
      try {
        zoneDemandee = normalizeZone(demande.zone);
      } catch (_) {
        return { ok: false, error: 'SCENTGATE_CAPABILITY_ZONE_INVALID' };
      }
      // Confinement: la zone demandée doit être la zone accordée ou dessous.
      // La barre oblique finale évite que /Vivy/Prod autorise /Vivy/Production.
      const prefixe = payload.zone.endsWith('/') ? payload.zone : `${payload.zone}/`;
      if (zoneDemandee !== payload.zone && !zoneDemandee.startsWith(prefixe)) {
        return { ok: false, error: 'SCENTGATE_CAPABILITY_ZONE_OUTSIDE' };
      }
    }

    // Le nonce n'est consommé qu'une fois TOUT validé: une pièce refusée pour une
    // zone hors périmètre doit rester rejouable pour la bonne zone.
    options.seenNonces?.add?.(nonce);
    return { ok: true, payload };
  } catch (error) {
    return { ok: false, error: String(error?.code || 'SCENTGATE_CAPABILITY_INVALID') };
  }
}

export function verifyScentGateSignal(envelope, options = {}) {
  try {
    const payload = envelope?.payload;
    if (!payload || payload.schema !== 'nossen.scentgate.signal.v1') {
      return { ok: false, error: 'SCENTGATE_SIGNAL_SCHEMA_INVALID' };
    }
    if (!SCENT_GATE_SIGNAL_TYPES.includes(payload.type)) {
      return { ok: false, error: 'SCENTGATE_SIGNAL_TYPE_DENIED' };
    }
    if (options.expectedAudience && payload.audience !== options.expectedAudience) {
      return { ok: false, error: 'SCENTGATE_SIGNAL_AUDIENCE_MISMATCH' };
    }
    const signature = Buffer.from(String(envelope.signature || ''), 'base64url');
    const expected = Buffer.from(signSignalPayload(payload, options.secret), 'base64url');
    if (signature.length !== expected.length || !timingSafeEqual(signature, expected)) {
      return { ok: false, error: 'SCENTGATE_SIGNAL_SIGNATURE_INVALID' };
    }
    const now = nowMs(options.now);
    const issuedAt = Date.parse(payload.issuedAt || '');
    const expiresAt = Date.parse(payload.expiresAt || '');
    const clockSkewMs = Math.max(0, Number(options.clockSkewMs || 5000));
    if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || issuedAt > now + clockSkewMs || now >= expiresAt) {
      return { ok: false, error: 'SCENTGATE_SIGNAL_EXPIRED' };
    }
    const nonce = String(payload.nonce || '');
    if (!nonce) return { ok: false, error: 'SCENTGATE_SIGNAL_NONCE_MISSING' };
    if (options.seenNonces?.has?.(nonce)) return { ok: false, error: 'SCENTGATE_SIGNAL_REPLAYED' };
    options.seenNonces?.add?.(nonce);
    return { ok: true, payload };
  } catch (error) {
    return { ok: false, error: String(error?.code || 'SCENTGATE_SIGNAL_INVALID') };
  }
}

export default {
  DEFAULT_ALIASES,
  DEFAULT_LIMITS,
  SCENT_GATE_SIGNAL_TYPES,
  SCENT_GATE_CAPABILITY_ACTIONS,
  assertScentGateActive,
  createScentGateCapability,
  createScentGateCapsule,
  createScentGateSignal,
  destroyScentGateCapsule,
  describeScentGate,
  isScentGateExpired,
  renderScentGateCapsule,
  verifyScentGateCapability,
  verifyScentGateSignal,
  withScentGateCapsule
};
