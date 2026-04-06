// ROME-TAG: 0xA11A11

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { useHorn } from '../core/horn';
import { whiteLight } from '../core/gandalf-light';
import { resolveGollumPath } from '../rome/gollum-paths';

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

const CFG_PATH = path.join(process.cwd(), '.qflush', 'a11.config.json');

function loadCfg() {
  try {
    if (!fs.existsSync(CFG_PATH)) return null;
    return JSON.parse(fs.readFileSync(CFG_PATH, 'utf8'));
  } catch (e) { return null; }
}

export default async function runA11(argv: string[] = []) {
  whiteLight('daemon.start', { phase: 'a11-init', argv });
  const sub = argv[0] || 'status';
  const cfg = loadCfg();
  if (!cfg || !cfg.enabled) {
    whiteLight('fs.test', { file: 'a11.config.json', found: false });
    console.log('A-11 not enabled or not configured (see .qflush/a11.config.json)');
    return 0;
  }
  whiteLight('fs.test', { file: 'a11.config.json', found: true });

  if (sub === 'start') {
    if (!cfg.startCommand) { console.error('no startCommand configured for A-11'); return 1; }
    try {
      const parts = cfg.startCommand.split(' ');
      const proc = spawn(parts[0], parts.slice(1), { cwd: cfg.path || process.cwd(), detached: true, stdio: 'ignore', shell: true });
      proc.unref();
      if (cfg.pidFile) fs.writeFileSync(cfg.pidFile, String(proc.pid), 'utf8');
      whiteLight('daemon.start', { phase: 'a11-start', pid: proc.pid });
      console.log('A-11 start invoked (detached).');
      return 0;
    } catch (e) {
      console.error('failed to start A-11:', String(e));
      return 1;
    }
  }

  if (sub === 'stop') {
    if (cfg.pidFile && fs.existsSync(cfg.pidFile)) {
      try {
        const pid = Number(fs.readFileSync(cfg.pidFile, 'utf8'));
        try { process.kill(pid); } catch (e) { console.warn('[a11] process.kill failed', String(e)); }
        try { fs.unlinkSync(cfg.pidFile); } catch (e) { console.warn('[a11] unlink pidFile failed', String(e)); }
        whiteLight('daemon.start', { phase: 'a11-stop', pid });
        console.log('A-11 stop requested (pid ' + pid + ').');
        return 0;
      } catch (e) { console.error('failed to stop A-11', String(e)); return 1; }
    }
    console.log('no pidFile for A-11; cannot stop cleanly');
    return 0;
  }

  // status
  if (cfg.healthUrl) {
    try {
      const fetch = await resolveFetch();
      if (!fetch) throw new Error('fetch not available');
      const res = await fetch(cfg.healthUrl, { method: 'GET' });
      if (res.ok) { console.log('A-11 healthy'); return 0; }
      console.log('A-11 unhealthy, status', res.status);
      return 2;
    } catch (e) {
      console.log('A-11 health check failed:', String(e));
      return 3;
    }
  }

  // fallback: check pid
  if (cfg.pidFile && fs.existsSync(cfg.pidFile)) {
    try {
      const pid = Number(fs.readFileSync(cfg.pidFile,'utf8'));
      try { process.kill(pid, 0); whiteLight('daemon.start', { phase: 'a11-running', pid }); console.log('A-11 running (pid', pid + ')'); return 0; } catch (e) { console.log('A-11 not running'); return 3; }
    } catch (e) { console.log('A-11 check failed', String(e)); return 3; }
  }

  console.log('A-11 not running (no healthUrl or pidFile)');
  whiteLight('daemon.start', { phase: 'a11-not-running' });
  return 3;
}
