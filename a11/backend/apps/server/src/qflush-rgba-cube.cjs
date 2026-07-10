'use strict';

const crypto = require('node:crypto');

const SCHEMA = 'nossen.qflush.rgba_cube.v1';
const MAX_ITEMS = 64;

const FACE_DEFINITIONS = {
  R: {
    name: 'memory',
    label: 'Memory',
    targets: ['a11.memory.summary.v1', 'neo4j.memory', 'conversation.context'],
  },
  G: {
    name: 'tools',
    label: 'Tools',
    targets: ['tools.dispatcher', 'mcp.router', 'terminal.guard'],
  },
  B: {
    name: 'data',
    label: 'Data',
    targets: ['file.ingestion', 'vision.media', 'artifact.store'],
  },
  A: {
    name: 'orchestration',
    label: 'Orchestration',
    targets: ['orchestrator.queue', 'priority.scheduler', 'allmight.guard'],
  },
};

const KIND_FACE = {
  memory: 'R',
  conversation: 'R',
  conversation_current: 'R',
  conversation_history: 'R',
  shiryu_signal: 'R',
  summary: 'R',
  user_context: 'R',
  tool: 'G',
  command: 'G',
  mcp: 'G',
  terminal: 'G',
  file: 'B',
  media: 'B',
  image: 'B',
  audio: 'B',
  video: 'B',
  document: 'B',
  json: 'B',
  binary: 'B',
  job: 'A',
  route: 'A',
  workflow: 'A',
  dispatch: 'A',
  plan: 'A',
  zen_rgba: 'A',
};

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function byteLengthOf(value) {
  if (Buffer.isBuffer(value)) return value.length;
  if (typeof value === 'string') return Buffer.byteLength(value, 'utf8');
  return Buffer.byteLength(stableStringify(value), 'utf8');
}

function normalizePriority(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.min(255, Math.round(value)));
  }
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'admin' || raw === 'founder' || raw === 'urgent') return 245;
  if (raw === 'high' || raw === 'premium') return 210;
  if (raw === 'family' || raw === 'medium') return 170;
  if (raw === 'public' || raw === 'basic' || raw === 'low') return 95;
  return 128;
}

function normalizeKind(kind) {
  const raw = String(kind || '').trim().toLowerCase().replace(/[^a-z0-9_.:-]+/g, '_');
  if (!raw) return '';
  return raw.slice(0, 64);
}

function inferKind(payload, options = {}) {
  const explicit = normalizeKind(options.kind || options.type || options.intent);
  if (explicit) return explicit;

  const contentType = String(options.contentType || '').trim().toLowerCase();
  if (contentType.startsWith('image/')) return 'image';
  if (contentType.startsWith('audio/')) return 'audio';
  if (contentType.startsWith('video/')) return 'video';
  if (contentType === 'application/pdf') return 'document';
  if (contentType.includes('json')) return 'json';

  if (Buffer.isBuffer(payload)) return 'binary';
  if (typeof payload === 'string') return 'conversation';
  if (payload && typeof payload === 'object') {
    if (payload.flow || payload.workflow || payload.steps || payload.routes) return 'workflow';
    if (payload.tool || payload.command || payload.mcp || payload.terminal) return 'tool';
    if (payload.file || payload.filename || payload.mime || payload.mediaUrl) return 'file';
    if (Array.isArray(payload.messages) || payload.role || payload.content) return 'memory';
    return 'json';
  }

  return 'data';
}

function inferFace(kind, payload, options = {}) {
  const explicit = String(options.face || options.channel || '').trim().toUpperCase();
  if (FACE_DEFINITIONS[explicit]) return explicit;

  const normalizedKind = normalizeKind(kind);
  if (KIND_FACE[normalizedKind]) return KIND_FACE[normalizedKind];

  if (/memory|context|summary|conversation|chat/.test(normalizedKind)) return 'R';
  if (/tool|mcp|terminal|command|shell|browser|control/.test(normalizedKind)) return 'G';
  if (/file|media|image|audio|video|pdf|document|data|json|binary/.test(normalizedKind)) return 'B';
  if (/job|route|workflow|dispatch|plan|queue|orchestrat/.test(normalizedKind)) return 'A';

  if (payload && typeof payload === 'object' && (payload.flow || payload.steps)) return 'A';
  return 'B';
}

function buildRgbaVector(face, payload, options = {}) {
  const length = byteLengthOf(payload);
  const priority = normalizePriority(options.priority || options.accountTier || options.tier);
  const sizeScore = Math.max(24, Math.min(220, Math.ceil(Math.log2(length + 1) * 18)));
  const vector = { r: 32, g: 32, b: Math.max(32, sizeScore), a: priority };

  if (face === 'R') vector.r = 224;
  if (face === 'G') vector.g = 224;
  if (face === 'B') vector.b = Math.max(224, vector.b);
  if (face === 'A') vector.a = Math.max(224, priority);

  if (options.admin === true || String(options.accountTier || '').toLowerCase() === 'founder') {
    vector.a = 255;
  }

  return vector;
}

function previewPayload(payload) {
  if (Buffer.isBuffer(payload)) return `[binary:${payload.length}]`;
  const raw = typeof payload === 'string' ? payload : stableStringify(payload);
  return raw.length > 120 ? `${raw.slice(0, 117)}...` : raw;
}

function buildQflushRgbaPacket(input = {}, options = {}) {
  const payload = Object.prototype.hasOwnProperty.call(input, 'payload') ? input.payload : input;
  const kind = inferKind(payload, { ...options, ...input });
  const face = inferFace(kind, payload, { ...options, ...input });
  const contentType = String(input.contentType || options.contentType || (typeof payload === 'string' ? 'text/plain' : 'application/json')).trim();
  const source = String(input.source || options.source || 'qflush').trim().slice(0, 80);
  const sessionId = String(input.sessionId || options.sessionId || '').trim().slice(0, 128) || null;
  const rawHashSeed = Buffer.isBuffer(payload)
    ? Buffer.concat([Buffer.from(`${kind}\0${contentType}\0`), payload])
    : Buffer.from(`${kind}\0${contentType}\0${stableStringify(payload)}`, 'utf8');
  const hash = sha256Hex(rawHashSeed);
  const def = FACE_DEFINITIONS[face];
  const rgba = buildRgbaVector(face, payload, { ...options, ...input });
  const priority = rgba.a;

  return {
    schema: SCHEMA,
    id: `qfc_${hash.slice(0, 16)}`,
    hash,
    face,
    faceName: def.name,
    rgba,
    kind,
    contentType,
    source,
    sessionId,
    sizeBytes: byteLengthOf(payload),
    preview: options.includePreview === true ? previewPayload(payload) : null,
    route: {
      lane: def.name,
      targets: [...def.targets],
      priority,
      ttlMs: Math.max(1000, Math.min(24 * 60 * 60 * 1000, Number(input.ttlMs || options.ttlMs || 15 * 60 * 1000))),
    },
    createdAt: new Date().toISOString(),
  };
}

function buildQflushRgbaMultiload(items = [], options = {}) {
  const rawItems = Array.isArray(items) ? items : [items];
  const maxItems = Math.max(1, Math.min(MAX_ITEMS, Number(options.maxItems || MAX_ITEMS)));
  const seen = new Map();
  const duplicates = [];
  const packets = [];

  for (const rawItem of rawItems.slice(0, maxItems)) {
    const packet = buildQflushRgbaPacket(rawItem, options);
    const dedupeKey = [
      packet.sessionId || options.sessionId || 'global',
      packet.kind,
      packet.hash,
    ].join(':');

    if (options.dedupe !== false && seen.has(dedupeKey)) {
      duplicates.push({
        id: packet.id,
        duplicateOf: seen.get(dedupeKey),
        hash: packet.hash,
        kind: packet.kind,
        face: packet.face,
      });
      continue;
    }

    seen.set(dedupeKey, packet.id);
    packets.push(packet);
  }

  packets.sort((a, b) => {
    if (b.route.priority !== a.route.priority) return b.route.priority - a.route.priority;
    const faceOrder = { A: 0, G: 1, R: 2, B: 3 };
    return (faceOrder[a.face] ?? 9) - (faceOrder[b.face] ?? 9);
  });

  const faces = { R: 0, G: 0, B: 0, A: 0 };
  const totals = { r: 0, g: 0, b: 0, a: 0 };
  const routes = {};

  for (const packet of packets) {
    faces[packet.face] += 1;
    totals.r += packet.rgba.r;
    totals.g += packet.rgba.g;
    totals.b += packet.rgba.b;
    totals.a += packet.rgba.a;
    routes[packet.faceName] ||= { face: packet.face, targets: packet.route.targets, packets: [] };
    routes[packet.faceName].packets.push(packet.id);
  }

  const divisor = Math.max(1, packets.length);

  return {
    ok: true,
    schema: 'nossen.qflush.rgba_multiload.v1',
    mode: 'plan',
    count: packets.length,
    droppedDuplicates: duplicates.length,
    packets,
    duplicates,
    cube: {
      faces,
      averageRgba: {
        r: Math.round(totals.r / divisor),
        g: Math.round(totals.g / divisor),
        b: Math.round(totals.b / divisor),
        a: Math.round(totals.a / divisor),
      },
      routeOrder: packets.map((packet) => ({
        id: packet.id,
        face: packet.face,
        lane: packet.faceName,
        priority: packet.route.priority,
      })),
    },
    routes: Object.values(routes),
    createdAt: new Date().toISOString(),
  };
}

function clampRgbaByte(value) {
  return Math.max(0, Math.min(255, Math.round(Number(value) || 0)));
}

function buildControlledNoiseVector(hash = '') {
  const clean = String(hash || '').replace(/[^a-f0-9]/gi, '').padEnd(8, '0');
  const bytes = [0, 2, 4, 6].map((offset) => Number.parseInt(clean.slice(offset, offset + 2), 16) || 0);
  return {
    r: (bytes[0] % 17) - 8,
    g: (bytes[1] % 17) - 8,
    b: (bytes[2] % 17) - 8,
    a: Math.max(-4, Math.min(4, (bytes[3] % 9) - 4)),
  };
}

function buildShiryuZenRgba(input = {}, options = {}) {
  const payload = Object.prototype.hasOwnProperty.call(input, 'payload') ? input.payload : input;
  const currentMessage = String(input.currentMessage || input.current || input.message || '').trim();
  const history = Array.isArray(input.history) ? input.history.slice(-8) : [];
  const sessionId = String(input.sessionId || options.sessionId || '').trim() || null;
  const items = [];

  if (currentMessage) {
    items.push({
      payload: currentMessage,
      kind: 'conversation_current',
      face: 'R',
      priority: input.priority || options.priority || 'high',
      sessionId,
      source: 'shiryu.current',
    });
  }

  if (history.length) {
    items.push({
      payload: { messages: history },
      kind: 'conversation_history',
      face: 'R',
      priority: 'medium',
      sessionId,
      source: 'shiryu.history',
    });
  }

  items.push({
    payload,
    kind: input.kind || 'json',
    face: 'B',
    priority: input.priority || options.priority || input.accountTier || options.accountTier,
    sessionId,
    source: 'shiryu.json',
  });

  if (input.intent) {
    items.push({
      payload: { flow: 'shiryu.intent.cleanse', intent: input.intent },
      kind: 'zen_rgba',
      face: 'A',
      priority: 'high',
      sessionId,
      source: 'shiryu.intent',
    });
  }

  const plan = buildQflushRgbaMultiload(items, {
    sessionId,
    accountTier: input.accountTier || options.accountTier,
    admin: options.admin === true || input.admin === true,
    dedupe: input.dedupe,
    includePreview: input.includePreview === true,
    maxItems: Math.min(MAX_ITEMS, Math.max(1, Number(input.maxItems || options.maxItems || items.length))),
  });
  const seed = sha256Hex(stableStringify({
    currentMessage,
    history,
    payload,
    intent: input.intent || null,
  }));
  const noise = buildControlledNoiseVector(seed);
  const base = plan.cube.averageRgba;
  const sculptedRgba = {
    r: clampRgbaByte(base.r + noise.r),
    g: clampRgbaByte(base.g + noise.g),
    b: clampRgbaByte(base.b + noise.b),
    a: clampRgbaByte(base.a + noise.a),
  };

  return {
    ok: true,
    schema: 'nossen.shiryu.zen_rgba.v1',
    mode: 'zen_rgba_smoke_cut',
    blade: 'blood-rain',
    principle: 'json-to-zen-signal, rgba-controlled-noise, current-message-first',
    seed: seed.slice(0, 16),
    controlledNoise: noise,
    sculptedRgba,
    layers: {
      R: 'memory/current conversation signal',
      G: 'tools and dispatch signal',
      B: 'json/data material',
      A: 'orchestration and priority',
    },
    zen: {
      currentFirst: true,
      historyIsContextOnly: true,
      duplicateFamiliesCut: plan.droppedDuplicates,
      signalBytes: plan.packets.reduce((sum, packet) => sum + packet.sizeBytes, 0),
      rules: [
        'slice the current message before reading old smoke',
        'dedupe repeated families before composing',
        'encode JSON as RGBA lanes, then add bounded deterministic noise',
      ],
    },
    plan,
    createdAt: new Date().toISOString(),
  };
}

function getQflushRgbaCubeSpec() {
  return {
    ok: true,
    schema: SCHEMA,
    description: 'Qflush RGBA cube maps payloads to memory, tools, data and orchestration lanes.',
    faces: FACE_DEFINITIONS,
    flows: ['qflush.rgba.multiload.v1', 'qflush.shiryu.zen_rgba.v1'],
    modules: {
      shiryu: 'Blood-rain blade: JSON to zen RGBA signal with bounded deterministic noise for conversation smoke cutting.',
    },
    publicEndpoints: [
      'GET /api/qflush/cube/status',
      'POST /api/qflush/cube/plan',
    ],
  };
}

module.exports = {
  SCHEMA,
  FACE_DEFINITIONS,
  buildQflushRgbaPacket,
  buildQflushRgbaMultiload,
  buildShiryuZenRgba,
  buildControlledNoiseVector,
  getQflushRgbaCubeSpec,
  inferKind,
  inferFace,
  stableStringify,
};
