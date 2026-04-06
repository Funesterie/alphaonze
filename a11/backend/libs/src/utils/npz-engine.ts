// ROME-TAG: 0x043BA9

import { getNpzNamespace } from './npz-config.js';
import fs from 'fs';
import * as path from 'path';
import { logger } from './logger.js';
import { Lane } from './npz-router.js';

const NS = getNpzNamespace();
const ENGINE_FILE = path.join(process.cwd(), '.qflush', `${NS}-npz-engine.json`);

type ScoreRecord = {
  laneId: number;
  score: number; // lower is better
  lastSuccess?: number;
  lastFailure?: number;
};

type EngineStore = Record<number, ScoreRecord>;

let store: EngineStore = {};

// decay parameters
const DECAY_INTERVAL_MS = 60 * 1000; // every minute
const DECAY_FACTOR = 0.9; // multiply score by this every decay interval (towards 0)

function ensureDir() {
  const dir = path.dirname(ENGINE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function load() {
  try {
    if (fs.existsSync(ENGINE_FILE)) {
      const raw = fs.readFileSync(ENGINE_FILE, 'utf8');
      store = JSON.parse(raw) as EngineStore;
    }
  } catch (e) {
    store = {};
    console.warn('[npz-engine] load failed, starting with empty store', String(e));
  }
}

function persist() {
  try {
    ensureDir();
    fs.writeFileSync(ENGINE_FILE, JSON.stringify(store, null, 2), 'utf8');
  } catch (e) {
    console.warn('[npz-engine] persist failed', String(e));
  }
}

function applyDecay() {
  const now = Date.now();
  let changed = false;
  for (const k of Object.keys(store)) {
    const id = Number(k);
    const rec = store[id];
    if (!rec) continue;
    // compute how many intervals since lastSuccess/lastFailure (use lastFailure as activity reference)
    const ref = rec.lastFailure || rec.lastSuccess || now;
    const intervals = Math.floor((now - ref) / DECAY_INTERVAL_MS);
    if (intervals <= 0) continue;
    const factor = Math.pow(DECAY_FACTOR, intervals);
    const newScore = rec.score * factor;
    if (Math.abs(newScore - rec.score) > 1e-6) {
      rec.score = newScore;
      changed = true;
    }
  }
  if (changed) persist();
}

load();

// schedule periodic decay in-memory (best-effort)
setInterval(() => {
  try { applyDecay(); } catch (e) { console.warn('[npz-engine] applyDecay errored', String(e)); }
}, DECAY_INTERVAL_MS);

/**
 * Adjust lane score.
 * delta: positive increases penalty (worse), negative decreases (better).
 * latencyMs: optional latency observed to weight the delta.
 */
export function scoreLane(laneId: number, delta: number, latencyMs?: number) {
  let rec = store[laneId];
  if (!rec) rec = { laneId, score: 0 };
  // weight delta by latency (if provided): normalized over 1000ms
  let weight = 1;
  if (latencyMs && latencyMs > 0) weight += Math.min(5, latencyMs / 1000); // cap weight
  rec.score = (rec.score || 0) + delta * weight;
  if (delta < 0) rec.lastSuccess = Date.now();
  if (delta > 0) rec.lastFailure = Date.now();
  store[laneId] = rec;
  persist();
}

export function getLaneScore(laneId: number) {
  const rec = store[laneId];
  if (!rec) return 0;
  // apply decay relative to now on read (non-persistent)
  const now = Date.now();
  const ref = rec.lastFailure || rec.lastSuccess || now;
  const intervals = Math.floor((now - ref) / DECAY_INTERVAL_MS);
  const factor = Math.pow(DECAY_FACTOR, intervals);
  return rec.score * factor;
}

export function orderLanesByScore(lanes: Lane[]) {
  // return copy sorted by score asc
  const out = lanes.slice();
  out.sort((a, b) => getLaneScore(a.id) - getLaneScore(b.id));
  return out;
}

export function resetScores() {
  store = {};
  persist();
}

export function getStore() {
  return store;
}

export default { scoreLane, getLaneScore, orderLanesByScore, resetScores, getStore };

