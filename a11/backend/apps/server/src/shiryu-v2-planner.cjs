'use strict';

/**
 * Shiryu V2 — fan-out planner ("neuf lames").
 *
 * V1 ({@link buildShiryuZenRgba}) slices a request into RGBA lanes (R memory,
 * G tools, B data, A orchestration), deduped and priority-sorted. V2 turns those
 * lanes into a PARALLEL job plan: each lane -> a Cerbère head + a task, grouped
 * into concurrency waves. Metaphor: 3 heads x 3 task types = 9 parallel blades.
 *
 * This module is PURE and deterministic (no network, no shell). It only PLANS.
 * A runner executes the waves — locally via the Cerbère provider chain, or as
 * k8s worker pods (the plan is the contract between the two). Kubernetes doesn't
 * make the slice faster (it is already sub-ms); it scales the heavy lanes.
 */

const { buildShiryuZenRgba } = require('./qflush-rgba-cube.cjs');

// Default Cerbère heads (mirror the song-mode provider chain). Overridable via options.heads.
const DEFAULT_HEADS = Object.freeze([
  Object.freeze({ id: 'groq', label: 'Groq gpt-oss-120b', speed: 'fast', strength: 'medium', maxConcurrent: 3 }),
  Object.freeze({ id: 'ollama-cloud', label: 'Ollama Cloud gpt-oss:120b', speed: 'medium', strength: 'high', maxConcurrent: 3 }),
  Object.freeze({ id: 'cerbere-sonnet', label: 'Cerbère anthropic/claude-sonnet', speed: 'medium', strength: 'top', maxConcurrent: 3 }),
]);

// Default task per RGBA face.
const FACE_TASK = Object.freeze({
  R: 'recall',      // memory / conversation
  G: 'dispatch',    // tools / mcp
  B: 'transform',   // data / media
  A: 'orchestrate', // orchestration / priority — always runs first
});

// An explicit intent overrides the task for text/memory lanes.
const INTENT_TASK = Object.freeze({
  translate: 'translate',
  translation: 'translate',
  prompt: 'prompt',
  prompting: 'prompt',
  compose: 'compose',
  summarize: 'summarize',
  summary: 'summarize',
  describe: 'describe',
  image: 'image',
  video: 'video',
});

// Which head class fits which task ("top" = strongest, "high" = capable, "fast" = cheap+quick).
const TASK_HEAD_CLASS = Object.freeze({
  orchestrate: 'top',
  compose: 'top',
  prompt: 'top',
  transform: 'high',
  describe: 'high',
  image: 'high',
  video: 'high',
  summarize: 'high',
  recall: 'fast',
  dispatch: 'fast',
  translate: 'fast',
});

const CLASS_MATCH = Object.freeze({
  fast: (h) => h.speed === 'fast',
  high: (h) => h.strength === 'high' || h.strength === 'top',
  top: (h) => h.strength === 'top',
});

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function normalizeHeads(input) {
  const list = Array.isArray(input) && input.length ? input : DEFAULT_HEADS;
  const heads = list
    .map((h, index) => {
      const id = String(h && (h.id || h.name) || '').trim() || `head-${index + 1}`;
      return {
        id,
        label: String(h && h.label || id).trim(),
        speed: ['fast', 'medium', 'slow'].includes(String(h && h.speed)) ? String(h.speed) : 'medium',
        strength: ['top', 'high', 'medium', 'low'].includes(String(h && h.strength)) ? String(h.strength) : 'medium',
        maxConcurrent: clampInt(h && h.maxConcurrent, 1, 32, 3),
      };
    })
    .slice(0, 16);
  return heads.length ? heads : DEFAULT_HEADS.map((h) => ({ ...h }));
}

function firstToken(value) {
  return String(value || '').trim().toLowerCase().split(/[.\s:_-]+/).filter(Boolean)[0] || '';
}

function resolveTask(packet, explicitIntentTask) {
  if (packet.face === 'A') return 'orchestrate';
  // The user's intent (translate/prompt/...) drives the conversation lane (R).
  // Data/tool lanes keep their face-default task — they are material, not the ask.
  if (explicitIntentTask && packet.face === 'R') return explicitIntentTask;
  return FACE_TASK[packet.face] || 'transform';
}

function assignHead(task, heads, rr) {
  const cls = TASK_HEAD_CLASS[task] || 'fast';
  const match = CLASS_MATCH[cls] || (() => true);
  const candidates = heads.filter(match);
  const pool = candidates.length ? candidates : heads;
  const head = pool[rr.count % pool.length];
  rr.count += 1;
  return head;
}

function buildWaves(jobs, maxConcurrency) {
  const orchestration = jobs.filter((j) => j.lane === 'A');
  const rest = jobs.filter((j) => j.lane !== 'A');
  const waves = [];
  if (orchestration.length) {
    waves.push({ phase: 'orchestrate', parallel: orchestration.map((j) => j.id) });
  }
  for (let i = 0; i < rest.length; i += maxConcurrency) {
    waves.push({ phase: 'fanout', parallel: rest.slice(i, i + maxConcurrency).map((j) => j.id) });
  }
  return waves;
}

/**
 * Build the Shiryu V2 fan-out plan from a request.
 * @param {object} input  { currentMessage, history, payload, intent, accountTier, ... } (same as V1)
 * @param {object} [options] { heads?: Head[], maxConcurrency?: number, admin?: boolean, now?: string }
 * @returns {object} the parallel job plan (schema nossen.shiryu.v2_fanout.v1)
 */
function buildShiryuV2Plan(input = {}, options = {}) {
  const heads = normalizeHeads(options.heads);
  const headCapacity = heads.reduce((sum, h) => sum + h.maxConcurrent, 0) || 9;
  const maxConcurrency = clampInt(options.maxConcurrency, 1, 16, Math.min(9, headCapacity));

  // 1) slice with V1 (already deduped + priority-sorted)
  const slice = buildShiryuZenRgba(input, options);
  const packets = Array.isArray(slice.plan && slice.plan.packets) ? slice.plan.packets : [];

  const explicitIntentTask = INTENT_TASK[firstToken(input.intent)] || null;

  // 2) one job per lane, deduped by (task, content hash)
  const rr = { count: 0 };
  const seen = new Set();
  let droppedJobDuplicates = 0;
  const jobs = [];
  for (const packet of packets) {
    const task = resolveTask(packet, explicitIntentTask);
    const dedupeKey = `${task}:${packet.hash}`;
    if (seen.has(dedupeKey)) {
      droppedJobDuplicates += 1;
      continue;
    }
    seen.add(dedupeKey);
    const head = assignHead(task, heads, rr);
    jobs.push({
      id: `sh2_${packet.hash.slice(0, 12)}_${task}`,
      lane: packet.face,
      laneName: packet.faceName,
      task,
      head: head.id,
      headLabel: head.label,
      priority: packet.route.priority,
      kind: packet.kind,
      sizeBytes: packet.sizeBytes,
      source: packet.source,
      sessionId: packet.sessionId,
      dependsOnOrchestration: packet.face !== 'A',
    });
  }

  // 3) orchestration first, then priority desc, then face order A>G>R>B
  const faceOrder = { A: 0, G: 1, R: 2, B: 3 };
  jobs.sort((a, b) => {
    if ((a.lane === 'A') !== (b.lane === 'A')) return a.lane === 'A' ? -1 : 1;
    if (b.priority !== a.priority) return b.priority - a.priority;
    return (faceOrder[a.lane] ?? 9) - (faceOrder[b.lane] ?? 9);
  });

  const waves = buildWaves(jobs, maxConcurrency);
  const headLoad = {};
  for (const job of jobs) headLoad[job.head] = (headLoad[job.head] || 0) + 1;

  return {
    ok: true,
    schema: 'nossen.shiryu.v2_fanout.v1',
    blade: 'nine-blades',
    principle: '3 heads x 3 tasks = 9 parallel blades; orchestration first, then priority',
    heads: heads.map((h) => ({ id: h.id, label: h.label, speed: h.speed, strength: h.strength })),
    maxConcurrency,
    jobCount: jobs.length,
    waveCount: waves.length,
    droppedFamilies: Number(slice.plan && slice.plan.droppedDuplicates) || 0,
    droppedJobDuplicates,
    headLoad,
    jobs,
    waves,
    mergeOrder: jobs.map((j) => j.id),
    slice: {
      seed: slice.seed,
      sculptedRgba: slice.sculptedRgba,
      layers: slice.layers,
    },
    createdAt: String(options.now || new Date().toISOString()),
  };
}

function getShiryuV2Spec() {
  return {
    ok: true,
    schema: 'nossen.shiryu.v2_fanout.v1',
    description: 'Shiryu V2 fan-out planner: slices a request (V1) then dispatches each RGBA lane to a Cerbère head + task, in parallel waves.',
    faces: FACE_TASK,
    intents: Object.keys(INTENT_TASK),
    defaultHeads: DEFAULT_HEADS.map((h) => ({ id: h.id, label: h.label })),
    note: 'Kubernetes scales the heavy lanes (workers), not the slice itself.',
  };
}

module.exports = {
  DEFAULT_HEADS,
  FACE_TASK,
  INTENT_TASK,
  buildShiryuV2Plan,
  getShiryuV2Spec,
  normalizeHeads,
  resolveTask,
};
