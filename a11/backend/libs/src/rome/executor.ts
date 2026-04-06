// ROME-TAG: 0xDE237C

import { spawn, execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import { importUtil } from '../utils/alias.js';

let fetchFn: any = undefined;
const fetchMod = importUtil('../utils/fetch') || importUtil('node-fetch');
if (fetchMod) fetchFn = fetchMod.default || fetchMod;
if (!fetchFn && typeof (globalThis as any).fetch === 'function') fetchFn = (globalThis as any).fetch.bind(globalThis);

let saveEngineHistory: any;
try { saveEngineHistory = require('./storage').saveEngineHistory; } catch (e) { saveEngineHistory = undefined; console.warn('[executor] load storage failed', String(e)); }

// (daemon-control supprimé, ignorer ce module)
let callReload: any = undefined;

const DEFAULT_CFG = { allowedCommandSubstrings: ['npm','node','echo'], allowedCommands: ['echo hello','npm run build'], commandTimeoutMs: 15000, webhookUrl: '' };

function loadConfig() {
  try {
    const p = path.join(process.cwd(), '.qflush', 'logic-config.json');
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {}
  return DEFAULT_CFG;
}
// report errors reading config
function _loadConfigSafe() { try { return loadConfig(); } catch (e) { console.warn('[executor] loadConfig failed', String(e)); return DEFAULT_CFG; } }

function safeExecFile(cmd: string, cwd: string, timeoutMs: number): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const parts = cmd.split(' ').filter(Boolean);
    if (parts.length === 0) return resolve({ code: 1, stdout: '', stderr: 'empty command' });
    // if simple executable with args, prefer execFile
    if (/^[\w@.\-\/\\]+$/.test(parts[0])) {
      const child = execFile(parts[0], parts.slice(1), { cwd, env: { PATH: process.env.PATH || '' }, timeout: timeoutMs }, (err: any, stdout: any, stderr: any) => {
        if (err && (err as any).code === 'ENOENT') {
          // fallback to shell when executable not found (e.g. shell built-ins like echo)
          const sh = spawn(cmd, { cwd, env: { PATH: process.env.PATH || '' }, shell: true });
          let out = '';
          let er = '';
          sh.stdout?.on('data', (d) => out += d.toString());
          sh.stderr?.on('data', (d) => er += d.toString());
          let finished = false;
          const to = setTimeout(() => { try { sh.kill(); } catch(e){ console.warn('[executor] failed to kill fallback shell', String(e)); } }, timeoutMs);
          sh.on('close', (code) => { if (!finished) { finished = true; clearTimeout(to); resolve({ code, stdout: out, stderr: er }); } });
          sh.on('error', (e) => { if (!finished) { finished = true; clearTimeout(to); resolve({ code: 1, stdout: out, stderr: String(e) }); } });
          return;
        }
        if (err && (err as any).code && (err as any).signal === undefined) {
          resolve({ code: (err as any).code, stdout: stdout?.toString?.() || String(stdout), stderr: stderr?.toString?.() || String(stderr) });
        } else if (err) {
          resolve({ code: 1, stdout: stdout?.toString?.() || String(stdout), stderr: (err && err.message) || String(stderr) });
        } else {
          resolve({ code: 0, stdout: stdout?.toString?.() || String(stdout), stderr: stderr?.toString?.() || String(stderr) });
        }
      });
      return;
    }
    // fallback to shell spawn
    const child = spawn(cmd, { cwd, env: { PATH: process.env.PATH || '' }, shell: true });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => out += d.toString());
    child.stderr.on('data', (d) => err += d.toString());
    let finished = false;
    const to = setTimeout(() => { try { child.kill(); } catch(e){ console.warn('[executor] failed to kill child', String(e)); } }, timeoutMs);
    child.on('close', (code) => { if (!finished) { finished = true; clearTimeout(to); resolve({ code, stdout: out, stderr: err }); } });
    child.on('error', (e) => { if (!finished) { finished = true; clearTimeout(to); resolve({ code: 1, stdout: out, stderr: String(e) }); } });
  });
}

function suspicious(cmd: string) {
  // reject characters that allow shell expansions redirections or chaining
  return /[;&|<>$`]/.test(cmd);
}

function writeNpzMetadata(record: any) {
    try {
    const dir = path.join(process.cwd(), '.qflush', 'npz');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const idxPath = path.join(dir, 'index.json');
    let idx: any = {};
    if (fs.existsSync(idxPath)) {
      try { idx = JSON.parse(fs.readFileSync(idxPath, 'utf8') || '{}'); } catch (e) { idx = {}; console.warn('[executor] read npz index failed', String(e)); }
    }
    idx[record.id] = record;
    fs.writeFileSync(idxPath, JSON.stringify(idx, null, 2), 'utf8');
  } catch (e) {
    console.warn('[executor] writeNpzMetadata failed', String(e));
  }
}

export async function executeAction(action: string, ctx: any = {}): Promise<any> {
  const cfg = loadConfig();
  if (!action) return { success: false, error: 'empty' };

  try {
    if (action.startsWith('run ')) {
      const m = /run\s+"([^"]+)"(?:\s+in\s+"([^"]+)")?/.exec(action);
      if (!m) return { success: false, error: 'invalid run syntax' };
      const cmd = m[1];
      const dir = m[2] ? path.resolve(m[2]) : process.cwd();

      if (suspicious(cmd)) return { success: false, error: 'command contains suspicious characters' };

      // normalize command for comparison
      const normalizedCmd = String(cmd).trim().replace(/\s+/g, ' ');

      // Robust detection of command name (handles path separators)
      const cmdName = String(normalizedCmd).split(' ')[0].toLowerCase();
      const baseName = cmdName.split(/[\\\/]/).pop() || cmdName;
      const isEcho = baseName === 'echo';
      let allowedByPolicy = false;
      if (isEcho) {
        allowedByPolicy = true;
      }

      // prepare allowedCommands list
      const allowedCommands = Array.isArray(cfg.allowedCommands) ? cfg.allowedCommands.map((c: any) => String(c).trim().replace(/\s+/g, ' ')) : [];

      // if explicit allowedCommands provided, allow when exact, prefix, or contains match OR when substrings allow it
      if (!allowedByPolicy) {
        if (allowedCommands.length) {
          const exact = allowedCommands.includes(normalizedCmd);
          const prefix = allowedCommands.some((ac: string) => normalizedCmd.startsWith(ac));
          const contains = allowedCommands.some((ac: string) => normalizedCmd.includes(ac));
          if (exact || prefix || contains) {
            allowedByPolicy = true;
          } else {
            const substrings = Array.isArray(cfg.allowedCommandSubstrings) ? cfg.allowedCommandSubstrings : [];
            const okSub = substrings.some((s: string) => normalizedCmd.includes(String(s)));
            if (okSub) allowedByPolicy = true;
          }
        } else {
          // fallback substring check when no explicit allowedCommands
          const substrings = Array.isArray(cfg.allowedCommandSubstrings) ? cfg.allowedCommandSubstrings : [];
          const ok = substrings.some((s: string) => normalizedCmd.includes(String(s)));
          if (ok) allowedByPolicy = true;
        }
      }

      if (!allowedByPolicy) return { success: false, error: 'command not allowed by policy' };

      if (ctx.dryRun) {
        return { success: true, dryRun: true, cmd };
      }

      const result = await safeExecFile(cmd, dir, cfg.commandTimeoutMs || 15000);
      const res = { success: result.code === 0, stdout: result.stdout, stderr: result.stderr, code: result.code };

      // webhook notify
      if (cfg.webhookUrl && fetchFn) {
        try { await fetchFn(cfg.webhookUrl, { method: 'POST', body: JSON.stringify({ action: cmd, path: ctx.path || null, result: res }), headers: { 'Content-Type': 'application/json' } }); } catch (e) { console.warn('[executor] webhook notify failed', String(e)); }
      }

      // persist execution history
      try { if (saveEngineHistory) saveEngineHistory('exec-'+Date.now(), Date.now(), ctx.path || '', cmd, res); } catch (e) { console.warn('[executor] saveEngineHistory failed', String(e)); }

      return res;
    }

    if (action.startsWith('npz.encode')) {
      const filePath = ctx.path || 'unknown';
      if (ctx.dryRun) {
        return { success: true, dryRun: true, note: 'would encode ' + filePath };
      }
      const id = 'npz-' + Math.random().toString(36).slice(2,10);
      const outDir = path.join(process.cwd(), '.qflush', 'npz');
      try { if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true }); } catch (e) { console.warn('[executor] mkdir npz outDir failed', String(e)); }
      const outFile = path.join(outDir, id + '.bin');
      // write a simple placeholder binary (could be real encoding later)
      try { fs.writeFileSync(outFile, Buffer.from(`encoded:${filePath}`)); } catch (e) { console.warn('[executor] write npz outFile failed', String(e)); }

      const metadata = { id, source: filePath, createdAt: new Date().toISOString(), path: outFile };
      writeNpzMetadata(metadata);

      const res = { success: true, id, path: outFile, metadata };
      if (cfg.webhookUrl && fetchFn) { try { await fetchFn(cfg.webhookUrl, { method: 'POST', body: JSON.stringify({ action: 'npz.encode', path: filePath, result: res }), headers: { 'Content-Type': 'application/json' } }); } catch (e) { console.warn('[executor] webhook notify npz failed', String(e)); } }
      try { if (saveEngineHistory) saveEngineHistory('npz-'+Date.now(), Date.now(), filePath, 'npz.encode', res); } catch (e) { console.warn('[executor] saveEngineHistory npz failed', String(e)); }
      return res;
    }

    // daemon.reload supprimé, refresh_on_index supprimé
    return { success: false, error: 'unknown action' };
  } catch (e: any) {
    return { success: false, error: e && e.message ? e.message : String(e) };
  }
}

// New helper used by cortex bus to execute a simple command with args
export async function execCommand(cmd: string, args: string[] = []) {
  try {
    const command = [cmd, ...(args || [])].join(' ');
    const res = await safeExecFile(command, process.cwd(), (loadConfig() as any).commandTimeoutMs || 15000);
    return { code: res.code, stdout: res.stdout, stderr: res.stderr };
  } catch (e) {
    return { code: 1, stdout: '', stderr: String(e) };
  }
}
