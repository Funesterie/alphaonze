// ROME-TAG: 0x096E30

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';

const emitter = new EventEmitter();
const INDEX_PATH = path.join(process.cwd(), '.qflush', 'rome-index.json');
let lastStatMs = 0;

export function getEmitter() { return emitter; }

export function startIndexWatcher(intervalMs = 5000) {
  try {
    if (!fs.existsSync(INDEX_PATH)) return;
    // simple poll to avoid fs.watch platform issues
    setInterval(() => {
      try {
        const st = fs.statSync(INDEX_PATH);
        if (st.mtimeMs > lastStatMs) {
          lastStatMs = st.mtimeMs;
          // load file
          const raw = fs.readFileSync(INDEX_PATH, 'utf8') || '{}';
          let json: any = {};
          try { json = JSON.parse(raw); } catch (e) { json = {}; }
          emitter.emit('rome.index.file.changed', { path: INDEX_PATH, index: json });
        }
      } catch (e) {
        // ignore
      }
    }, intervalMs).unref();
  } catch (e) {
    // ignore
  }
}

export function emitRomeIndexUpdated(oldIndex: any, newIndex: any) {
  // compute changed paths: tag changed or new/removed
  const changed: string[] = [];
  const all = new Set<string>([...Object.keys(oldIndex || {}), ...Object.keys(newIndex || {})]);
  for (const k of all) {
    const a = oldIndex && oldIndex[k];
    const b = newIndex && newIndex[k];
    if (!a && b) { changed.push(k); continue; }
    if (a && !b) { changed.push(k); continue; }
    if (a && b) {
      if (a.tag !== b.tag) changed.push(k);
    }
  }
  emitter.emit('rome.index.updated', { oldIndex, newIndex, changedPaths: changed });
}
