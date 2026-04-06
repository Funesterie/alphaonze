#!/usr/bin/env node
// ROME-TAG: 0x10C74C

import * as fs from 'fs';
import * as path from 'path';

async function resolveFetch() {
  // prefer global
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
  throw new Error('No fetch implementation available (install node-fetch or undici)');
}

export default async function runCopilotBridge(args: string[]) {
  const cfgPath = '.qflush/copilot.json';
  if (!fs.existsSync(cfgPath)) { console.error('copilot not configured'); return 1; }
  const cfg = JSON.parse(fs.readFileSync(cfgPath,'utf8'));
  if (args[0] === 'send-snapshot') {
    const state = { /* minimal snapshot */ };
    try {
      const fetch = await resolveFetch();
      await fetch(cfg.webhookUrl, { method: 'POST', body: JSON.stringify({ type: 'engine_snapshot', snapshot: state }), headers: { 'Content-Type': 'application/json' } });
      console.log('sent');
    } catch (e) { console.error('failed', e); return 2; }
    return 0;
  }
  console.log('copilot-bridge: noop');
  return 0;
}
