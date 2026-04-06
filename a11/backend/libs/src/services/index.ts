import { join } from 'path';
import * as fs from 'fs';
import { logger } from '../utils/logger.js';

export type ServiceEntry = {
  start: (opts?: any) => Promise<void>;
  stop?: () => Promise<void>;
};

export const ServiceState: Record<string, { running: boolean; lastError: any | null; lastStart: number | null; idle?: boolean }> = {
  bat: { running: false, lastError: null, lastStart: null },
  spyder: { running: false, lastError: null, lastStart: null },
  nezlephant: { running: false, lastError: null, lastStart: null },
  freeland: { running: false, lastError: null, lastStart: null },
};

export const GlobalState: { sleep?: boolean } = { sleep: false };

function tryRequireService(modulePath: string): any | null {
  try {
    if (fs.existsSync(modulePath)) {
      // require cache-safe
      const mod = require(modulePath);
      return mod;
    }
  } catch (e) {
    logger.warn(`service loader: failed to require ${modulePath}: ${e}`);
  }
  return null;
}

async function makeWrapper(name: string): Promise<ServiceEntry> {
  // try local dist/<name>/index.js then <name>/dist/index.js then node_modules
  const cand1 = join(process.cwd(), name, 'dist', 'index.js');
  const cand2 = join(process.cwd(), 'dist', name, 'index.js');
  const cand3 = join(process.cwd(), 'node_modules', name, 'dist', 'index.js');

  const m = tryRequireService(cand1) || tryRequireService(cand2) || tryRequireService(cand3);
  if (m) {
    const startFn = (m && (m.start || m.default || m.main)) ? (m.start || m.default || m.main) : null;
    const stopFn = (m && (m.stop)) ? m.stop : undefined;
    if (startFn) {
      return {
        start: async (opts?: any) => {
          try {
            await Promise.resolve(startFn(opts));
          } catch (e) {
            throw e;
          }
        },
        stop: stopFn ? async () => Promise.resolve(stopFn()) : undefined,
      };
    }
  }

  // fallback: no embedded API available, provide noop that throws to signal fallback
  return {
    start: async () => {
      throw new Error(`embedded start not available for service ${name}`);
    },
    stop: async () => {},
  };
}

const registry: Record<string, ServiceEntry> = {} as any;

async function ensureRegistered(name: string) {
  const key = name.toLowerCase();
  if (!registry[key]) {
    registry[key] = await makeWrapper(key);
  }
  return registry[key];
}

export function listAvailableServices() {
  return Object.keys(ServiceState);
}

function ensureQflushDir() {
  const dir = join(process.cwd(), '.qflush');
  try { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); } catch (e) { logger.warn(`[services] ensureQflushDir failed: ${String(e)}`); }
  return dir;
}

function persistSafeMode(obj: any) {
  try {
    const dir = ensureQflushDir();
    const p = join(dir, 'safe-modes.json');
    fs.writeFileSync(p, JSON.stringify(obj, null, 2), 'utf8');
  } catch (e) {
    logger.warn(`failed to persist safe-modes: ${String(e)}`);
  }
}

export async function startService(name: string, opts?: any) {
  const key = String(name || '').toLowerCase();
  if (!ServiceState[key]) throw new Error(`Unknown service: ${name}`);

  // safe CI mode
  if (process.env.QFLUSH_SAFE_CI === '1') {
    logger.info(`[SAFE_CI] Skipping service ${key}`);
    return;
  }

  const svc = await ensureRegistered(key);
  try {
    ServiceState[key].lastError = null;
    ServiceState[key].lastStart = Date.now();
    await svc.start(opts);
    ServiceState[key].running = true;
    ServiceState[key].idle = false;
    logger.info(`[SERVICE] started ${key}`);
  } catch (e) {
    ServiceState[key].running = false;
    ServiceState[key].lastError = e;
    logger.error(`[SERVICE] failed to start ${key}: ${e}`);
    throw e;
  }
}

export async function stopService(name: string) {
  const key = String(name || '').toLowerCase();
  if (!ServiceState[key]) throw new Error(`Unknown service: ${name}`);
  const svc = await ensureRegistered(key);
  try {
    if (svc.stop) await svc.stop();
    ServiceState[key].running = false;
    ServiceState[key].idle = false;
    logger.info(`[SERVICE] stopped ${key}`);
  } catch (e) {
    ServiceState[key].lastError = e;
    logger.error(`[SERVICE] failed to stop ${key}: ${e}`);
    throw e;
  }
}

export function enterSleepMode() {
  logger.info('[BAT] Sleep mode activated — entering quiet state.');
  GlobalState.sleep = true;
  // mark services idle
  for (const k of Object.keys(ServiceState)) {
    ServiceState[k].idle = true;
  }
  // persist mode
  persistSafeMode({ mode: 'sleep', ts: Date.now() });
}

export function exitSleepMode() {
  logger.info('[BAT] Sleep mode deactivated — resuming normal operations.');
  GlobalState.sleep = false;
  for (const k of Object.keys(ServiceState)) {
    ServiceState[k].idle = false;
  }
  persistSafeMode({ mode: 'normal', ts: Date.now() });
}

export async function jokerWipe() {
  logger.warn('[JOKER] EXPLOSIVE WIPE requested — attempting total cleanup.');
  // attempt graceful stops
  for (const k of Object.keys(ServiceState)) {
    try {
      await stopService(k);
    } catch (e) {
      logger.warn(`[JOKER] stop ${k} failed: ${e}`);
    }
  }

  // kill child processes if any (best-effort)
  try {
    // non-portable: attempt to kill by listing process.children if available
    // fallback: no-op here, supervisor mode would handle SIGKILL
  } catch (e) { logger.warn(`[services] attempt to kill child processes failed: ${String(e)}`); }

  // clear NPZ storage files and logs
  try {
    const dir = ensureQflushDir();
    const logs = join(dir, 'logs');
    if (fs.existsSync(logs)) {
      fs.rmSync(logs, { recursive: true, force: true });
    }
    const active = join(dir, 'active-services.json');
    if (fs.existsSync(active)) fs.unlinkSync(active);
  } catch (e) { logger.warn(`[JOKER] cleanup fs failed: ${e}`); }

  // persist mode
  persistSafeMode({ mode: 'joker', ts: Date.now() });

  // exit process shortly unless running under tests or explicit test mode
  const isTest = process.env.VITEST === 'true' || process.env.QFLUSH_TEST_MODE === '1';
  if (isTest) {
    logger.warn('[JOKER] Test mode detected — skipping process.exit');
    return;
  }

  setTimeout(() => {
    logger.warn('[JOKER] Exiting process (forced).');
    try { process.exit(137); } catch (err) { logger.warn('[services] process.exit failed: ' + String(err)); }
  }, 300);
}

// Add a small client-facing services provider so cortex/other modules can call non-blocking adapters
export function getServiceClients() {
  const clients: any = {};
  try {
    const a11Adapter = require('../cortex/a11-adapter');
    if (a11Adapter) {
      clients.a11 = {
        ask: async (prompt: string, opts?: any) => {
          return a11Adapter.askA11(prompt, opts);
        },
        health: async () => {
          return a11Adapter.isA11Available();
        }
      };
    }
  } catch (e) {
    logger.info('[SERVICES] no A-11 adapter available: ' + String(e));
  }
  return clients;
}
