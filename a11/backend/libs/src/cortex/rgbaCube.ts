import { createHash } from "crypto";

export const QFLUSH_RGBA_CUBE_SCHEMA = "nossen.qflush.rgba_cube.v1";
export const QFLUSH_RGBA_MULTILOAD_SCHEMA = "nossen.qflush.rgba_multiload.v1";

const MAX_ITEMS = 64;

export type QflushRgbaFace = "R" | "G" | "B" | "A";

export interface QflushRgbaFaceDefinition {
  name: "memory" | "tools" | "data" | "orchestration";
  label: string;
  targets: string[];
}

export interface QflushRgbaInput {
  payload?: unknown;
  kind?: string;
  type?: string;
  intent?: string;
  face?: string;
  channel?: string;
  contentType?: string;
  source?: string;
  sessionId?: string;
  accountTier?: string;
  tier?: string;
  priority?: string | number;
  admin?: boolean;
  ttlMs?: number;
}

export interface QflushRgbaPacket {
  schema: typeof QFLUSH_RGBA_CUBE_SCHEMA;
  id: string;
  hash: string;
  face: QflushRgbaFace;
  faceName: QflushRgbaFaceDefinition["name"];
  rgba: { r: number; g: number; b: number; a: number };
  kind: string;
  contentType: string;
  source: string;
  sessionId: string | null;
  sizeBytes: number;
  preview: string | null;
  route: {
    lane: QflushRgbaFaceDefinition["name"];
    targets: string[];
    priority: number;
    ttlMs: number;
  };
  createdAt: string;
}

export interface QflushRgbaOptions {
  kind?: string;
  type?: string;
  intent?: string;
  face?: string;
  channel?: string;
  contentType?: string;
  source?: string;
  sessionId?: string;
  accountTier?: string;
  tier?: string;
  priority?: string | number;
  admin?: boolean;
  ttlMs?: number;
  dedupe?: boolean;
  maxItems?: number;
  includePreview?: boolean;
}

export const QFLUSH_RGBA_FACES: Record<QflushRgbaFace, QflushRgbaFaceDefinition> = {
  R: {
    name: "memory",
    label: "Memory",
    targets: ["a11.memory.summary.v1", "neo4j.memory", "conversation.context"],
  },
  G: {
    name: "tools",
    label: "Tools",
    targets: ["tools.dispatcher", "mcp.router", "terminal.guard"],
  },
  B: {
    name: "data",
    label: "Data",
    targets: ["file.ingestion", "vision.media", "artifact.store"],
  },
  A: {
    name: "orchestration",
    label: "Orchestration",
    targets: ["orchestrator.queue", "priority.scheduler", "allmight.guard"],
  },
};

const KIND_FACE: Record<string, QflushRgbaFace> = {
  memory: "R",
  conversation: "R",
  summary: "R",
  user_context: "R",
  tool: "G",
  command: "G",
  mcp: "G",
  terminal: "G",
  file: "B",
  media: "B",
  image: "B",
  audio: "B",
  video: "B",
  document: "B",
  json: "B",
  binary: "B",
  job: "A",
  route: "A",
  workflow: "A",
  dispatch: "A",
  plan: "A",
};

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "undefined";
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const objectValue = value as Record<string, unknown>;
  const keys = Object.keys(objectValue).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(objectValue[key])}`).join(",")}}`;
}

function sha256Hex(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function byteLengthOf(value: unknown): number {
  if (Buffer.isBuffer(value)) return value.length;
  if (typeof value === "string") return Buffer.byteLength(value, "utf8");
  return Buffer.byteLength(stableStringify(value), "utf8");
}

export function normalizePriority(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.min(255, Math.round(value)));
  }
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "admin" || raw === "founder" || raw === "urgent") return 245;
  if (raw === "high" || raw === "premium") return 210;
  if (raw === "family" || raw === "medium") return 170;
  if (raw === "public" || raw === "basic" || raw === "low") return 95;
  return 128;
}

function normalizeKind(kind: unknown): string {
  const raw = String(kind || "").trim().toLowerCase().replace(/[^a-z0-9_.:-]+/g, "_");
  return raw.slice(0, 64);
}

export function inferQflushRgbaKind(payload: unknown, options: QflushRgbaOptions = {}): string {
  const explicit = normalizeKind(options.kind || options.type || options.intent);
  if (explicit) return explicit;

  const contentType = String(options.contentType || "").trim().toLowerCase();
  if (contentType.startsWith("image/")) return "image";
  if (contentType.startsWith("audio/")) return "audio";
  if (contentType.startsWith("video/")) return "video";
  if (contentType === "application/pdf") return "document";
  if (contentType.includes("json")) return "json";

  if (Buffer.isBuffer(payload)) return "binary";
  if (typeof payload === "string") return "conversation";
  if (payload && typeof payload === "object") {
    const objectValue = payload as Record<string, unknown>;
    if (objectValue.flow || objectValue.workflow || objectValue.steps || objectValue.routes) return "workflow";
    if (objectValue.tool || objectValue.command || objectValue.mcp || objectValue.terminal) return "tool";
    if (objectValue.file || objectValue.filename || objectValue.mime || objectValue.mediaUrl) return "file";
    if (Array.isArray(objectValue.messages) || objectValue.role || objectValue.content) return "memory";
    return "json";
  }

  return "data";
}

export function inferQflushRgbaFace(kind: string, payload: unknown, options: QflushRgbaOptions = {}): QflushRgbaFace {
  const explicit = String(options.face || options.channel || "").trim().toUpperCase();
  if (explicit in QFLUSH_RGBA_FACES) return explicit as QflushRgbaFace;

  const normalizedKind = normalizeKind(kind);
  if (KIND_FACE[normalizedKind]) return KIND_FACE[normalizedKind];
  if (/memory|context|summary|conversation|chat/.test(normalizedKind)) return "R";
  if (/tool|mcp|terminal|command|shell|browser|control/.test(normalizedKind)) return "G";
  if (/file|media|image|audio|video|pdf|document|data|json|binary/.test(normalizedKind)) return "B";
  if (/job|route|workflow|dispatch|plan|queue|orchestrat/.test(normalizedKind)) return "A";

  if (payload && typeof payload === "object") {
    const objectValue = payload as Record<string, unknown>;
    if (objectValue.flow || objectValue.steps) return "A";
  }
  return "B";
}

function buildRgbaVector(face: QflushRgbaFace, payload: unknown, options: QflushRgbaOptions = {}) {
  const length = byteLengthOf(payload);
  const priority = normalizePriority(options.priority || options.accountTier || options.tier);
  const sizeScore = Math.max(24, Math.min(220, Math.ceil(Math.log2(length + 1) * 18)));
  const vector = { r: 32, g: 32, b: Math.max(32, sizeScore), a: priority };

  if (face === "R") vector.r = 224;
  if (face === "G") vector.g = 224;
  if (face === "B") vector.b = Math.max(224, vector.b);
  if (face === "A") vector.a = Math.max(224, priority);
  if (options.admin === true || String(options.accountTier || "").toLowerCase() === "founder") vector.a = 255;

  return vector;
}

function previewPayload(payload: unknown): string {
  if (Buffer.isBuffer(payload)) return `[binary:${payload.length}]`;
  const raw = typeof payload === "string" ? payload : stableStringify(payload);
  return raw.length > 120 ? `${raw.slice(0, 117)}...` : raw;
}

export function buildQflushRgbaPacket(input: QflushRgbaInput = {}, options: QflushRgbaOptions = {}): QflushRgbaPacket {
  const payload = Object.prototype.hasOwnProperty.call(input, "payload") ? input.payload : input;
  const mergedOptions = { ...options, ...input };
  const kind = inferQflushRgbaKind(payload, mergedOptions);
  const face = inferQflushRgbaFace(kind, payload, mergedOptions);
  const contentType = String(input.contentType || options.contentType || (typeof payload === "string" ? "text/plain" : "application/json")).trim();
  const source = String(input.source || options.source || "qflush").trim().slice(0, 80);
  const sessionId = String(input.sessionId || options.sessionId || "").trim().slice(0, 128) || null;
  const rawHashSeed = Buffer.isBuffer(payload)
    ? Buffer.concat([Buffer.from(`${kind}\0${contentType}\0`), payload])
    : Buffer.from(`${kind}\0${contentType}\0${stableStringify(payload)}`, "utf8");
  const hash = sha256Hex(rawHashSeed);
  const definition = QFLUSH_RGBA_FACES[face];
  const rgba = buildRgbaVector(face, payload, mergedOptions);
  const priority = rgba.a;

  return {
    schema: QFLUSH_RGBA_CUBE_SCHEMA,
    id: `qfc_${hash.slice(0, 16)}`,
    hash,
    face,
    faceName: definition.name,
    rgba,
    kind,
    contentType,
    source,
    sessionId,
    sizeBytes: byteLengthOf(payload),
    preview: options.includePreview === true ? previewPayload(payload) : null,
    route: {
      lane: definition.name,
      targets: [...definition.targets],
      priority,
      ttlMs: Math.max(1000, Math.min(24 * 60 * 60 * 1000, Number(input.ttlMs || options.ttlMs || 15 * 60 * 1000))),
    },
    createdAt: new Date().toISOString(),
  };
}

export function buildQflushRgbaMultiload(items: QflushRgbaInput[] = [], options: QflushRgbaOptions = {}) {
  const rawItems = Array.isArray(items) ? items : [items];
  const maxItems = Math.max(1, Math.min(MAX_ITEMS, Number(options.maxItems || MAX_ITEMS)));
  const seen = new Map<string, string>();
  const duplicates: Array<{ id: string; duplicateOf: string; hash: string; kind: string; face: QflushRgbaFace }> = [];
  const packets: QflushRgbaPacket[] = [];

  for (const rawItem of rawItems.slice(0, maxItems)) {
    const packet = buildQflushRgbaPacket(rawItem, options);
    const dedupeKey = [packet.sessionId || options.sessionId || "global", packet.kind, packet.hash].join(":");

    if (options.dedupe !== false && seen.has(dedupeKey)) {
      duplicates.push({
        id: packet.id,
        duplicateOf: seen.get(dedupeKey) || packet.id,
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
    const faceOrder: Record<QflushRgbaFace, number> = { A: 0, G: 1, R: 2, B: 3 };
    return faceOrder[a.face] - faceOrder[b.face];
  });

  const faces: Record<QflushRgbaFace, number> = { R: 0, G: 0, B: 0, A: 0 };
  const totals = { r: 0, g: 0, b: 0, a: 0 };
  const routes: Record<string, { face: QflushRgbaFace; targets: string[]; packets: string[] }> = {};

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
    schema: QFLUSH_RGBA_MULTILOAD_SCHEMA,
    mode: "plan",
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
