// ROME-TAG: 0x3BEED1

import * as fs from 'fs';
import * as path from 'path';
import { RomeIndex } from './rome-tag.js';
import { emitRomeIndexUpdated, startIndexWatcher, getEmitter } from './events.js';

const INDEX_PATH = path.join(process.cwd(), '.qflush', 'rome-index.json');
let cachedIndex: RomeIndex = {};
let lastIndexRaw = '';

export function loadRomeIndexFromDisk(): RomeIndex {
  try {
    if (!fs.existsSync(INDEX_PATH)) { cachedIndex = {}; return cachedIndex; }
    const raw = fs.readFileSync(INDEX_PATH, 'utf8') || '{}';
    // compare raw to detect changes
    const parsed = JSON.parse(raw);
    const old = cachedIndex || {};
    cachedIndex = parsed as RomeIndex;
    // emit update if changed
    if (lastIndexRaw && lastIndexRaw !== raw) {
      emitRomeIndexUpdated(old, cachedIndex);
    }
    lastIndexRaw = raw;
    return cachedIndex;
  } catch (e) {
    // on error return empty
    cachedIndex = {};
    return cachedIndex;
  }
}

export function getCachedRomeIndex(): RomeIndex {
  return cachedIndex;
}

export function startRomeIndexAutoRefresh(intervalMs = 30 * 1000) {
  // initial load
  loadRomeIndexFromDisk();
  try {
    setInterval(() => {
      loadRomeIndexFromDisk();
    }, intervalMs).unref();
  } catch (e) {
    // ignore
  }
  // start external watcher too
  startIndexWatcher(Math.max(2000, Math.floor(intervalMs/10)));
}

export function onRomeIndexUpdated(cb: (payload: any)=>void) {
  getEmitter().on('rome.index.updated', cb);
}
