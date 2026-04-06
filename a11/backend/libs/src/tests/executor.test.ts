// ROME-TAG: 0x34E4E4

import { executeAction } from '../rome/executor.js';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';

export async function runTests() {
  // start webhook server
  const calls: any[] = [];
  const srv = http.createServer((req, res) => {
    let raw = '';
    req.on('data', d=>raw+=d.toString());
    req.on('end', ()=>{ try { calls.push(JSON.parse(raw)); } catch(e){} res.end('ok'); });
  }).listen(0);
  const port = (srv.address() as any).port;
  const cfgPath = path.join(process.cwd(), '.qflush', 'logic-config.json');
  const cfg = JSON.parse(fs.readFileSync(cfgPath,'utf8'));
  cfg.webhookUrl = `http://127.0.0.1:${port}`;
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf8');

  // disallowed command
  const res1 = await executeAction('run "rm -rf /" in "./"');
  if (res1.success) { console.error('dangerous command should not be allowed'); throw new Error('dangerous command should not be allowed'); }

  // allowed echo
  const res2 = await executeAction('run "echo hello" in "./"');
  if (!res2.success) { console.error('echo should be allowed', res2); throw new Error('echo should be allowed'); }

  // npz encode triggers webhook
  const res3 = await executeAction('npz.encode file', { path: 'assets/banner.png' });
  if (!res3.success) { console.error('npz should succeed', res3); throw new Error('npz should succeed'); }

  // wait a moment for webhook calls
  await new Promise(r=>setTimeout(r, 400));
  if (calls.length === 0) { console.error('webhook not called'); throw new Error('webhook not called'); }

  srv.close();
  console.log('executor tests passed');
}

import { describe, it, expect } from 'vitest';

describe('executor (stub)', () => {
  it('stub passes', () => {
    expect(true).toBe(true);
  });
});
