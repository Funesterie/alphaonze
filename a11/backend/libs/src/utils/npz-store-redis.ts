// ROME-TAG: 0xC27F4F

// Redis implementation removed - use in-memory fallback to avoid external dependency.
import { v4 as uuidv4 } from 'uuid';
import { getNpzNamespace } from './npz-config.js';

// NOTE: this module intentionally does NOT depend on ioredis anymore.
// It exposes the same async API but stores data in memory with TTL semantics.

const NS = getNpzNamespace();

type RedisNpzRecord = { id: string; laneId?: number; ts: number; meta?: Record<string, any> };

const store = new Map<string, RedisNpzRecord & { expiresAt?: number }>();

function nowMs() { return Date.now(); }

export async function createRecord(meta?: Record<string, any>) {
  const id = uuidv4();
  const rec: RedisNpzRecord = { id, ts: nowMs(), meta };
  // default TTL 24h
  const expiresAt = nowMs() + 24 * 3600 * 1000;
  store.set(id, Object.assign({}, rec, { expiresAt }));
  return rec;
}

export async function updateRecord(id: string, patch: Partial<RedisNpzRecord>) {
  const entry = store.get(id);
  if (!entry) return null;
  const updated = Object.assign({}, entry, patch);
  store.set(id, updated);
  // return shallow copy
  const copy = Object.assign({}, updated);
  delete (copy as any).expiresAt;
  return copy;
}

export async function getRecord(id: string) {
  const entry = store.get(id);
  if (!entry) return null;
  if (entry.expiresAt && entry.expiresAt < nowMs()) {
    store.delete(id);
    return null;
  }
  const copy = Object.assign({}, entry);
  delete (copy as any).expiresAt;
  return copy;
}

export async function deleteRecord(id: string) {
  return store.delete(id);
}

export async function listRecords() {
  const now = nowMs();
  const res: Array<RedisNpzRecord> = [];
  for (const [k, v] of store.entries()) {
    if (v.expiresAt && v.expiresAt < now) { store.delete(k); continue; }
    const copy = Object.assign({}, v);
    delete (copy as any).expiresAt;
    res.push(copy);
  }
  return res;
}

export async function clearAll() {
  const n = store.size;
  store.clear();
  return n;
}

// helper: not part of original API but useful for tests
export function __internal_size() { return store.size; }