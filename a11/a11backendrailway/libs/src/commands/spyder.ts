// ROME-TAG: 0x5PYD3R

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

async function resolveFetch() {
  if (typeof (globalThis as any).fetch === 'function') return (globalThis as any).fetch;
  try {
    const m = await import('node-fetch');
    return (m && (m as any).default) || m;
  } catch (e) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const undici = require('undici');
      if (undici && typeof undici.fetch === 'function') return undici.fetch;
    } catch (_) {}
  }
  return undefined;
}

const CFG_PATH = path.join(process.cwd(), '.qflush', 'spyder.config.json');

function loadCfg() {
  try {
    if (!fs.existsSync(CFG_PATH)) return null;
    return JSON.parse(fs.readFileSync(CFG_PATH, 'utf8'));
  } catch (e) { return null; }
}

export default async function runSpyder(argv: string[] = []) {
  const sub = (argv && argv[0]) || 'status';
  const cfg: any = loadCfg();
  if (!cfg || !cfg.enabled) {
    console.log('Spyder not enabled or not configured (see .qflush/spyder.config.json)');
    return 0;
  }

  if (sub === 'start') {
    if (!cfg.startCommand) { console.error('no startCommand configured for Spyder'); return 1; }
    try {
      const parts = Array.isArray(cfg.startCommand) ? cfg.startCommand : String(cfg.startCommand).split(' ');
      const proc = spawn(parts[0], parts.slice(1), { cwd: cfg.path || process.cwd(), detached: true, stdio: 'ignore', shell: true });
      proc.unref();
      if (cfg.pidFile) fs.writeFileSync(cfg.pidFile, String(proc.pid), 'utf8');
      console.log('Spyder start invoked (detached).');
      return 0;
    } catch (e) {
      console.error('failed to start Spyder:', String(e));
      return 1;
    }
  }

  if (sub === 'stop') {
    if (cfg.pidFile && fs.existsSync(cfg.pidFile)) {
      try {
        const pid = Number(fs.readFileSync(cfg.pidFile, 'utf8'));
        try { process.kill(pid); } catch (e) { console.warn('[spyder] process.kill failed', String(e)); }
        try { fs.unlinkSync(cfg.pidFile); } catch (e) { console.warn('[spyder] unlink pidFile failed', String(e)); }
        console.log('Spyder stop requested (pid ' + pid + ').');
        return 0;
      } catch (e) { console.error('failed to stop Spyder', String(e)); return 1; }
    }
    console.log('no pidFile for Spyder; cannot stop cleanly');
    return 0;
  }

  if (sub === 'status') {
    // status
    if (cfg.healthUrl) {
      try {
        const fetch = await resolveFetch();
        if (!fetch) throw new Error('fetch not available');
        const res = await fetch(cfg.healthUrl, { method: 'GET' });
        if (res.ok) { console.log('Spyder healthy'); return 0; }
        console.log('Spyder unhealthy, status', res.status);
        return 2;
      } catch (e) {
        console.log('Spyder health check failed:', String(e));
        return 3;
      }
    }

    // fallback: check pid
    if (cfg.pidFile && fs.existsSync(cfg.pidFile)) {
      try {
        const pid = Number(fs.readFileSync(cfg.pidFile,'utf8'));
        try { process.kill(pid, 0); console.log('Spyder running (pid', pid + ')'); return 0; } catch (e) { console.log('Spyder not running'); return 3; }
      } catch (e) { console.log('Spyder check failed', String(e)); return 3; }
    }

    console.log('Spyder not running (no healthUrl or pidFile)');
    return 3;
  }
}
