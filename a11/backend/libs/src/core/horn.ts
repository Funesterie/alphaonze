import { spawn } from 'child_process';

export interface HornFallback {
  bin: string;
  args?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export interface HornResult {
  ok: boolean;
  event: string;
  payload?: unknown;
  code?: number | null;
  out?: string;
  err?: string;
  results?: unknown[];
}

export type HornHandler = (payload?: unknown, event?: string) => unknown | Promise<unknown>;

const handlers = new Map<string, Set<HornHandler>>();

function scopedEvent(scope: string, event: string): string {
  if (!scope) return event;
  return event.startsWith(`${scope}.`) ? event : `${scope}.${event}`;
}

export function registerHorn(event: string, handler: HornHandler): () => void {
  const list = handlers.get(event) || new Set<HornHandler>();
  list.add(handler);
  handlers.set(event, list);

  return () => {
    const current = handlers.get(event);
    if (!current) return;
    current.delete(handler);
    if (current.size === 0) handlers.delete(event);
  };
}

async function runFallback(event: string, payload: unknown, fallback: HornFallback): Promise<HornResult> {
  return await new Promise((resolve, reject) => {
    const child = spawn(fallback.bin, fallback.args || [], {
      cwd: fallback.cwd || process.cwd(),
      env: { ...process.env, ...(fallback.env || {}) },
      shell: process.platform === 'win32',
    });

    let out = '';
    let err = '';
    child.stdout?.on('data', (chunk) => { out += String(chunk); });
    child.stderr?.on('data', (chunk) => { err += String(chunk); });
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ ok: code === 0, event, payload, code, out, err });
    });
  });
}

export async function scream(event: string, payload?: unknown, fallback?: HornFallback): Promise<HornResult> {
  const list = handlers.get(event);
  if (list && list.size > 0) {
    const results = [];
    for (const handler of list) {
      results.push(await handler(payload, event));
    }
    return { ok: true, event, payload, results };
  }

  if (fallback) {
    return await runFallback(event, payload, fallback);
  }

  return { ok: false, event, payload, out: '', err: 'No horn handler registered' };
}

export function useHorn(scope: string) {
  return {
    scream: (event: string, payload?: unknown, fallback?: HornFallback) => {
      return scream(scopedEvent(scope, event), payload, fallback);
    },
    register: (event: string, handler: HornHandler) => {
      return registerHorn(scopedEvent(scope, event), handler);
    },
  };
}

