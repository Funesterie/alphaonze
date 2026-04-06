import * as fs from 'fs';
import * as path from 'path';
import { CortexPacket } from './types.js';
import { executeAction } from '../rome/executor.js';

const QFLUSH_DIR = path.join(process.cwd(), '.qflush');
const CACHE_PATH = path.join(QFLUSH_DIR, 'spyder.cache.json');
const PATCHES_DIR = path.join(QFLUSH_DIR, 'patches');
const PATCH_AUDIT = path.join(PATCHES_DIR, 'audit.log');

function loadCache(): { appliedIds: string[] } {
  try {
    if (!fs.existsSync(CACHE_PATH)) return { appliedIds: [] };
    const raw = fs.readFileSync(CACHE_PATH, 'utf8') || '{}';
    const obj = JSON.parse(raw);
    return { appliedIds: Array.isArray(obj.appliedIds) ? obj.appliedIds : [] };
  } catch (e) {
    console.warn('[APPLY] loadCache failed', String(e));
    return { appliedIds: [] };
  }
}

function saveCache(cache: { appliedIds: string[] }) {
  try {
    if (!fs.existsSync(QFLUSH_DIR)) fs.mkdirSync(QFLUSH_DIR, { recursive: true });
    fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2), 'utf8');
  } catch (e) {
    console.warn('[APPLY] saveCache failed', String(e));
  }
}

function ensurePatchesDir() {
  try {
    if (!fs.existsSync(PATCHES_DIR)) fs.mkdirSync(PATCHES_DIR, { recursive: true });
  } catch (e) {
    console.warn('[APPLY] ensurePatchesDir failed', String(e));
  }
}

function appendPatchAudit(entry: any) {
  try {
    ensurePatchesDir();
    const line = JSON.stringify(entry) + "\n";
    fs.appendFileSync(PATCH_AUDIT, line, 'utf8');
  } catch (e) {
    console.warn('[APPLY] appendPatchAudit failed', String(e));
  }
}

function loadPatchWhitelist(): string[] {
  try {
    const wlFile = path.join(PATCHES_DIR, 'whitelist.json');
    if (fs.existsSync(wlFile)) {
      const raw = fs.readFileSync(wlFile, 'utf8') || '[]';
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return arr.map(String);
    }
  } catch (e) {
    console.warn('[APPLY] loadPatchWhitelist failed', String(e));
  }
  return ['routes', 'spyder', 'npz', 'telemetry', 'logic-config', 'flags', 'paths', 'services'];
}

function isPatchAllowed(patch: any): { ok: boolean; reason?: string } {
  try {
    if (!patch || typeof patch !== 'object') return { ok: false, reason: 'invalid_patch' };
    const whitelist = loadPatchWhitelist();
    const keys = Object.keys(patch);
    for (const k of keys) {
      if (!whitelist.includes(k)) return { ok: false, reason: `key_not_allowed:${k}` };
    }
    return { ok: true };
  } catch (e) {
    console.warn('[APPLY] isPatchAllowed failed', String(e));
    return { ok: false, reason: 'validation_error' };
  }
}

export async function applyCortexPacket(packet: CortexPacket): Promise<void> {
  try {
    const cache = loadCache();
    if (packet.id && cache.appliedIds.includes(packet.id)) {
      console.log('[APPLY] packet already applied (id=', packet.id, ') — skipping');
      return;
    }

    switch (String(packet.type).toLowerCase()) {
      case 'enable-spyder':
      case 'cortex:enable-spyder':
        await applyEnableSpyder(packet);
        break;

      case 'cortex:routes':
      case 'cortex:routes:':
        await applyCortexRoutes(packet);
        break;

      case 'qflush:apply':
      case 'cortex:apply':
        await applyQflushConfigPatch(packet);
        break;

      case 'npz-graph':
      case 'npz:graph':
      case 'cortex:npz-graph':
        await applyNpzGraph(packet);
        break;

      case 'save-state':
      case 'save:state':
      case 'cortex:save-state':
        await applySaveState(packet);
        break;

      case 'auto-patch':
      case 'auto_patch':
      case 'qflush:auto-patch':
      case 'cortex:auto-patch':
        await applyAutoPatch(packet);
        break;

      case 'cortex:oc8':
      case 'oc8':
        await applyOc8(packet);
        break;

      case 'cortex:qrouter':
      case 'qrouter':
        await applyQrouter(packet);
        break;

      case 'cortex:spyder-sound':
      case 'spyder-sound':
        await applySpyderSound(packet);
        break;

      case 'cortex:a11-key':
      case 'a11-key':
        await applyA11Key(packet);
        break;

      case 'cortex:magic':
      case 'magic':
        await applyMagic(packet);
        break;

      default:
        console.warn('[APPLY] Type de packet non géré:', packet.type);
    }

    try {
      if (packet.id) {
        const cache2 = loadCache();
        cache2.appliedIds.push(packet.id);
        cache2.appliedIds = Array.from(new Set(cache2.appliedIds));
        saveCache(cache2);
      }
    } catch (e) {
      console.warn('[APPLY] record applied id failed', String(e));
    }
  } catch (e) {
    console.warn('[APPLY] applyCortexPacket failed:', String(e));
  }
}

async function applyNpzGraph(packet: CortexPacket) {
  try {
    const payload: any = packet.payload ?? {};
    const filePath = String(payload?.path ?? process.cwd());
    console.log('[APPLY] NPZ-GRAPH ingest for', filePath);
    const res = await executeAction('npz.encode', { path: filePath });
    console.log('[APPLY] NPZ-GRAPH result', res);
    appendPatchAudit({ id: packet.id ?? null, type: packet.type, action: 'npz.encode', path: filePath, result: res, when: new Date().toISOString() });
  } catch (e) {
    console.warn('[APPLY] NPZ-GRAPH failed', String(e));
    appendPatchAudit({ id: packet.id ?? null, type: packet.type, action: 'npz.encode', error: String(e), when: new Date().toISOString() });
  }
}

async function applySaveState(packet: CortexPacket) {
  try {
    if (!fs.existsSync(QFLUSH_DIR)) fs.mkdirSync(QFLUSH_DIR, { recursive: true });
    const stateFile = path.join(QFLUSH_DIR, 'state.json');
    const snapshotDir = path.join(QFLUSH_DIR, 'snapshots');
    if (!fs.existsSync(snapshotDir)) fs.mkdirSync(snapshotDir, { recursive: true });
    const now = new Date().toISOString().replace(/:/g, '-').replace(/\./g, '-');
    const snapshotFile = path.join(snapshotDir, `state-${now}.json`);

    let current: any = {};
    try {
      if (fs.existsSync(stateFile)) current = JSON.parse(fs.readFileSync(stateFile, 'utf8') || '{}');
    } catch (e) {
      current = {};
      console.warn('[APPLY] read state file failed', String(e));
    }

    const payload: any = packet.payload ?? {};
    const merged = { ...current, ...payload };
    fs.writeFileSync(snapshotFile, JSON.stringify(merged, null, 2), 'utf8');
    fs.writeFileSync(stateFile, JSON.stringify(merged, null, 2), 'utf8');

    console.log('[APPLY] SAVE-STATE snapshot written to', snapshotFile);
    appendPatchAudit({ id: packet.id ?? null, type: packet.type, action: 'save-state', path: snapshotFile, when: new Date().toISOString() });
  } catch (e) {
    console.warn('[APPLY] SAVE-STATE failed', String(e));
    appendPatchAudit({ id: packet.id ?? null, type: packet.type, action: 'save-state', error: String(e), when: new Date().toISOString() });
  }
}

async function applyAutoPatch(packet: CortexPacket) {
  try {
    const payload: any = packet.payload ?? {};
    const patch = payload.patch ?? payload;
    const approve = Boolean(payload.approve ?? payload.approved ?? false);
    const dryRun = Boolean(payload.dryRun ?? payload.dry ?? true);

    const validation = isPatchAllowed(patch);
    if (!validation.ok) {
      try {
        ensurePatchesDir();
        const blockedFile = path.join(PATCHES_DIR, `blocked-${packet.id ?? Date.now()}.json`);
        fs.writeFileSync(blockedFile, JSON.stringify({ packetId: packet.id ?? null, reason: validation.reason, patch }, null, 2), 'utf8');
        appendPatchAudit({ id: packet.id ?? null, type: packet.type, action: 'auto-patch', status: 'blocked', reason: validation.reason, when: new Date().toISOString() });
      } catch (e) {
        console.warn('[APPLY] write blocked patch failed', String(e));
      }
      console.warn('[APPLY] AUTO-PATCH blocked by whitelist:', validation.reason);
      return;
    }

    const dir = QFLUSH_DIR;
    const cfgFile = path.join(dir, 'config.json');
    let current: any = {};
    try {
      if (fs.existsSync(cfgFile)) current = JSON.parse(fs.readFileSync(cfgFile, 'utf8') || '{}');
    } catch (e) {
      current = {};
      console.warn('[APPLY] read cfgFile failed', String(e));
    }

    const merged = { ...current, ...patch };

    if (dryRun || !approve) {
      const outDir = path.join(dir, 'patches');
      if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
      const outFile = path.join(outDir, `dryrun-${packet.id ?? Date.now()}.json`);
      fs.writeFileSync(outFile, JSON.stringify({ current, patch, merged }, null, 2), 'utf8');
      appendPatchAudit({ id: packet.id ?? null, type: packet.type, action: 'auto-patch', status: 'dryrun', file: outFile, when: new Date().toISOString() });
      console.log('[APPLY] AUTO-PATCH dry-run saved to', outFile);
      if (!approve) return;
    }

    fs.writeFileSync(cfgFile, JSON.stringify(merged, null, 2), 'utf8');
    appendPatchAudit({ id: packet.id ?? null, type: packet.type, action: 'auto-patch', status: 'applied', file: cfgFile, when: new Date().toISOString() });
    console.log('[APPLY] AUTO-PATCH applied to', cfgFile);
  } catch (e) {
    console.warn('[APPLY] AUTO-PATCH failed', String(e));
    appendPatchAudit({ id: packet.id ?? null, type: packet.type, action: 'auto-patch', status: 'error', error: String(e), when: new Date().toISOString() });
  }
}

async function applyEnableSpyder(packet: CortexPacket) {
  try {
    const dir = path.join(process.cwd(), '.qflush');
    const file = path.join(dir, 'spyder.config.json');
    const current = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};

    const payload: any = packet.payload ?? {};
    const spyderConfig = { ...current, ...(payload.spyder ?? {}) };

    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(spyderConfig, null, 2), 'utf8');
    console.log('[APPLY] SPYDER mis à jour via packet enable-spyder');
    appendPatchAudit({ id: packet.id ?? null, type: packet.type, action: 'enable-spyder', when: new Date().toISOString() });
  } catch (e) {
    console.warn('[APPLY] enable-spyder failed', String(e));
  }
}

async function applyCortexRoutes(packet: CortexPacket) {
  try {
    const dir = path.join(process.cwd(), '.qflush');
    const file = path.join(dir, 'cortex.routes.json');
    const payload: any = packet.payload ?? {};

    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(payload, null, 2), 'utf8');
    console.log('[APPLY] cortex.routes.json mis à jour.');
    appendPatchAudit({ id: packet.id ?? null, type: packet.type, action: 'cortex:routes', when: new Date().toISOString() });
  } catch (e) {
    console.warn('[APPLY] cortex:routes failed', String(e));
  }
}

async function applyQflushConfigPatch(packet: CortexPacket) {
  try {
    const dir = path.join(process.cwd(), '.qflush');
    const file = path.join(dir, 'config.json');
    const current = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};

    const payload: any = packet.payload ?? {};
    const merged = { ...current, ...payload };

    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(merged, null, 2), 'utf8');
    console.log('[APPLY] config.json mis à jour via packet qflush:apply');
    appendPatchAudit({ id: packet.id ?? null, type: packet.type, action: 'qflush:apply', when: new Date().toISOString() });
  } catch (e) {
    console.warn('[APPLY] qflush:apply failed', String(e));
  }
}

async function applyOc8(packet: CortexPacket) {
  try {
    const payload: any = packet.payload ?? {};
    const metaFile = path.join(QFLUSH_DIR, 'oc8.meta.json');
    const info = payload.info ?? { name: 'OC8', description: 'OC8 format' };
    if (!fs.existsSync(QFLUSH_DIR)) fs.mkdirSync(QFLUSH_DIR, { recursive: true });
    fs.writeFileSync(metaFile, JSON.stringify(info, null, 2), 'utf8');
    appendPatchAudit({ id: packet.id ?? null, type: packet.type, action: 'oc8:register', file: metaFile, when: new Date().toISOString() });
    console.log('[APPLY] OC8 metadata written to', metaFile);
  } catch (e) {
    console.warn('[APPLY] oc8 failed', String(e));
  }
}

async function applyQrouter(packet: CortexPacket) {
  try {
    const payload: any = packet.payload ?? {};
    const file = path.join(QFLUSH_DIR, 'cortex.routes.json');
    let current: any = {};
    try {
      if (fs.existsSync(file)) current = JSON.parse(fs.readFileSync(file, 'utf8') || '{}');
    } catch (e) {
      current = {};
      console.warn('[APPLY] read qrouter current failed', String(e));
    }
    const merged = { ...current, ...(payload.routes ?? {}) };
    if (!fs.existsSync(QFLUSH_DIR)) fs.mkdirSync(QFLUSH_DIR, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(merged, null, 2), 'utf8');
    appendPatchAudit({ id: packet.id ?? null, type: packet.type, action: 'qrouter:update', file, when: new Date().toISOString() });
    console.log('[APPLY] QROUTER updated', file);
  } catch (e) {
    console.warn('[APPLY] qrouter failed', String(e));
  }
}

async function applySpyderSound(packet: CortexPacket) {
  try {
    const payload: any = packet.payload ?? {};
    const file = path.join(QFLUSH_DIR, 'spyder-sound.config.json');
    let current: any = {};
    try {
      if (fs.existsSync(file)) current = JSON.parse(fs.readFileSync(file, 'utf8') || '{}');
    } catch (e) {
      current = {};
      console.warn('[APPLY] read spyder-sound current failed', String(e));
    }
    const merged = { ...current, ...payload };
    if (!fs.existsSync(QFLUSH_DIR)) fs.mkdirSync(QFLUSH_DIR, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(merged, null, 2), 'utf8');
    appendPatchAudit({ id: packet.id ?? null, type: packet.type, action: 'spyder-sound', file, when: new Date().toISOString() });
    console.log('[APPLY] spyder-sound config updated');
  } catch (e) {
    console.warn('[APPLY] spyder-sound failed', String(e));
  }
}

async function applyA11Key(packet: CortexPacket) {
  try {
    const payload: any = packet.payload ?? {};
    const file = path.join(QFLUSH_DIR, 'a11.config.json');
    let current: any = {};
    try {
      if (fs.existsSync(file)) current = JSON.parse(fs.readFileSync(file, 'utf8') || '{}');
    } catch (e) {
      current = {};
      console.warn('[APPLY] read a11 current failed', String(e));
    }

    const safePayload = { ...payload };
    if (safePayload.apiKey) delete safePayload.apiKey;
    const merged = { ...current, ...payload };
    if (!fs.existsSync(QFLUSH_DIR)) fs.mkdirSync(QFLUSH_DIR, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(merged, null, 2), 'utf8');
    appendPatchAudit({ id: packet.id ?? null, type: packet.type, action: 'a11-key', file, when: new Date().toISOString() });
    console.log('[APPLY] A11 config updated (apiKey redacted in logs)');
  } catch (e) {
    console.warn('[APPLY] a11 failed', String(e));
  }
}

async function applyMagic(packet: CortexPacket) {
  try {
    const entry = { id: packet.id ?? null, when: new Date().toISOString(), payload: packet.payload };
    const file = path.join(QFLUSH_DIR, 'magic.log');
    if (!fs.existsSync(QFLUSH_DIR)) fs.mkdirSync(QFLUSH_DIR, { recursive: true });
    fs.appendFileSync(file, JSON.stringify(entry) + '\n', 'utf8');
    appendPatchAudit({ id: packet.id ?? null, type: packet.type, action: 'magic', file, when: new Date().toISOString() });
    console.log('[APPLY] magic recorded');
  } catch (e) {
    console.warn('[APPLY] magic failed', String(e));
  }
}

export default { applyCortexPacket };
