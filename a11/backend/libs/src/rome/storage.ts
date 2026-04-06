// ROME-TAG: 0x75DEC5

import * as fs from 'fs';
import * as path from 'path';

// Lightweight storage helper: prefer sqlite (better-sqlite3) if available,
// otherwise fallback to a JSON file under .qflush/storage.json

const DEFAULT_DIR = path.join(process.cwd(), '.qflush');
const JSON_PATH = path.join(DEFAULT_DIR, 'storage.json');

let db: any = null;
let useSqlite = false;

function ensureDir() {
  try { if (!fs.existsSync(DEFAULT_DIR)) fs.mkdirSync(DEFAULT_DIR, { recursive: true }); } catch (e) { console.warn('[storage] ensureDir failed', String(e)); }
}

try {
  // attempt to use better-sqlite3 if installed
   
  const Database = require('better-sqlite3');
  const dbPath = path.join(DEFAULT_DIR, 'qflush.db');
  db = new Database(dbPath);
  // initialize tables
  db.exec(`CREATE TABLE IF NOT EXISTS telemetry (id TEXT PRIMARY KEY, type TEXT, ts INTEGER, payload TEXT);
            CREATE TABLE IF NOT EXISTS engine_history (id TEXT PRIMARY KEY, ts INTEGER, path TEXT, action TEXT, result TEXT);
            `);
  useSqlite = true;
} catch (e) {
  // fallback to JSON
  useSqlite = false;
  console.warn('[storage] sqlite init failed', String(e));
}

function writeJsonFile(obj: any) {
  ensureDir();
  try {
    fs.writeFileSync(JSON_PATH + '.tmp', JSON.stringify(obj, null, 2), 'utf8');
    fs.renameSync(JSON_PATH + '.tmp', JSON_PATH);
  } catch (e) { console.warn('[storage] writeJsonFile failed', String(e)); }
}

function readJsonFile() {
  try {
    if (!fs.existsSync(JSON_PATH)) return { telemetry: [], engine_history: [] };
    const raw = fs.readFileSync(JSON_PATH, 'utf8') || '{}';
    return JSON.parse(raw);
  } catch (e) {
    console.warn('[storage] readJsonFile failed', String(e));
    return { telemetry: [], engine_history: [] };
  }
}

export function saveTelemetryEvent(id: string, type: string, timestamp: number, payload: any) {
  if (useSqlite && db) {
    try {
      const stmt = db.prepare('INSERT OR REPLACE INTO telemetry (id,type,ts,payload) VALUES (?,?,?,?)');
      stmt.run(id, type, timestamp, JSON.stringify(payload));
      return true;
    } catch (e) { console.warn('[storage] saveTelemetryEvent sqlite failed', String(e)); return false; }
  }
  // json fallback
  const obj = readJsonFile();
  obj.telemetry = obj.telemetry || [];
  obj.telemetry.push({ id, type, ts: timestamp, payload });
  writeJsonFile(obj);
  return true;
}

export function getRecentTelemetry(limit = 100) {
  if (useSqlite && db) {
    try {
      const stmt = db.prepare('SELECT id,type,ts,payload FROM telemetry ORDER BY ts DESC LIMIT ?');
      const rows = stmt.all(limit);
      return rows.map((r: any) => ({ id: r.id, type: r.type, ts: r.ts, payload: JSON.parse(r.payload) }));
    } catch (e) { console.warn('[storage] getRecentTelemetry sqlite failed', String(e)); return []; }
  }
  const obj = readJsonFile();
  const arr = obj.telemetry || [];
  return arr.slice(-limit).reverse();
}

export function saveEngineHistory(id: string, timestamp: number, pathVal: string, action: string, result: any) {
  if (useSqlite && db) {
    try {
      const stmt = db.prepare('INSERT OR REPLACE INTO engine_history (id,ts,path,action,result) VALUES (?,?,?,?,?)');
      stmt.run(id, timestamp, pathVal, action, JSON.stringify(result));
      return true;
    } catch (e) { console.warn('[storage] saveEngineHistory sqlite failed', String(e)); return false; }
  }
  const obj = readJsonFile();
  obj.engine_history = obj.engine_history || [];
  obj.engine_history.push({ id, ts: timestamp, path: pathVal, action, result });
  writeJsonFile(obj);
  return true;
}

export function getEngineHistory(limit = 100) {
  if (useSqlite && db) {
    try {
      const stmt = db.prepare('SELECT id,ts,path,action,result FROM engine_history ORDER BY ts DESC LIMIT ?');
      const rows = stmt.all(limit);
      return rows.map((r: any) => ({ id: r.id, ts: r.ts, path: r.path, action: r.action, result: JSON.parse(r.result) }));
    } catch (e) { console.warn('[storage] getEngineHistory sqlite failed', String(e)); return []; }
  }
  const obj = readJsonFile();
  const arr = obj.engine_history || [];
  return arr.slice(-limit).reverse();
}
