// ROME-TAG: 0x11D9FC

import fs from 'fs';
import * as path from 'path';
import { createRecord as redisCreate, getRecord as redisGet, updateRecord as redisUpdate } from './npz-store-redis.js';
import { getNpzNamespace } from './npz-config.js';

const NS = getNpzNamespace();
// Use .qflush as canonical state directory (was .qflush)
const STORE_DIR = path.join(process.cwd(), '.qflush');
const REQUEST_STORE = path.join(STORE_DIR, `${NS}-npz-requests.json`);

type NpzRecord = {
  id: string;
  laneId?: number;
  ts: number;
  meta?: Record<string, any>;
};

let fileStore: Record<string, NpzRecord> = {};

function ensureDir() {
  if (!fs.existsSync(STORE_DIR)) fs.mkdirSync(STORE_DIR, { recursive: true });
}

function loadFileStore() {
  try {
    if (fs.existsSync(REQUEST_STORE)) {
      const raw = fs.readFileSync(REQUEST_STORE, 'utf8');
      fileStore = JSON.parse(raw);
    }
  } catch (e) {
    fileStore = {};
  }
}

function persistFileStore() {
  try {
    ensureDir();
    fs.writeFileSync(REQUEST_STORE, JSON.stringify(fileStore, null, 2), 'utf8');
  } catch (e) {}
}

loadFileStore();

const ENABLE_REDIS = (process.env.QFLUSH_ENABLE_REDIS === '1' || String(process.env.QFLUSH_ENABLE_REDIS).toLowerCase() === 'true');
const USE_REDIS = ENABLE_REDIS && Boolean(process.env.REDIS_URL);

export async function createRequestRecord(idOrMeta?: string | Record<string, any>, maybeMeta?: Record<string, any>) {
  if (USE_REDIS) {
    const meta = typeof idOrMeta === 'string' ? maybeMeta : (idOrMeta as Record<string, any> | undefined);
    const rec = await redisCreate(meta);
    return rec;
  }

  // file mode: if id provided, use it
  let id: string;
  let meta: Record<string, any> | undefined;
  if (typeof idOrMeta === 'string') {
    id = idOrMeta;
    meta = maybeMeta;
  } else {
    id = (idOrMeta && (idOrMeta as any).id) || (Math.random() + '_' + Date.now()).toString();
    meta = (idOrMeta as Record<string, any>) || undefined;
  }
  const rec: NpzRecord = { id, ts: Date.now(), meta };
  fileStore[id] = rec;
  persistFileStore();
  return rec;
}

export async function updateRequestRecord(id: string, patch: Partial<NpzRecord>) {
  if (USE_REDIS) {
    return await redisUpdate(id, patch as any);
  }
  if (!fileStore[id]) return null;
  fileStore[id] = { ...fileStore[id], ...patch };
  persistFileStore();
  return fileStore[id];
}

export async function getRequestRecord(id: string) {
  if (USE_REDIS) {
    return await redisGet(id);
  }
  return fileStore[id] || null;
}

export default { createRequestRecord, updateRequestRecord, getRequestRecord };

