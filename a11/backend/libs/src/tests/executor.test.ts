// ROME-TAG: 0x34E4E4

import { executeAction } from '../rome/executor.js';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';

export async function runTests() {
  // Use a temp workspace for hermeticity
  const os = await import('os');
  const tmp = await import('fs/promises');
  const tempDir = await tmp.mkdtemp(path.join(os.tmpdir(), 'executor-test-'));
  const qflushDir = path.join(tempDir, '.qflush');
  fs.mkdirSync(qflushDir, { recursive: true });
  const logicConfigPath = path.join(qflushDir, 'logic-config.json');
  // Fixture réaliste, conforme à la logique attendue
  const logicConfig = {
    allowedCommandSubstrings: ['npm', 'node', 'echo'],
    allowedCommands: ['echo hello', 'npm run build'],
    commandTimeoutMs: 15000,
    webhookUrl: 'http://127.0.0.1:9999'
  };
  fs.writeFileSync(logicConfigPath, JSON.stringify(logicConfig, null, 2), 'utf8');

  // start webhook server
  const calls: any[] = [];
  const srv = http.createServer((req, res) => {
    let raw = '';
    req.on('data', d=>raw+=d.toString());
    req.on('end', ()=>{ try { calls.push(JSON.parse(raw)); } catch(e){} res.end('ok'); });
  });
  await new Promise<void>(resolve => srv.listen(0, resolve));
  const port = (srv.address() as any).port;
  // update logicConfig with actual webhook port
  logicConfig.webhookUrl = `http://127.0.0.1:${port}`;
  fs.writeFileSync(logicConfigPath, JSON.stringify(logicConfig, null, 2), 'utf8');

  // Save original cwd and switch to temp workspace
  const origCwd = process.cwd();
  process.chdir(tempDir);
  try {
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
  } finally {
    process.chdir(origCwd);
    await new Promise(resolve => srv.close(resolve));
    // Clean up temp workspace même en cas d’échec
    await tmp.rm(tempDir, { recursive: true, force: true });
  }
  console.log('executor tests passed');
}


import { describe, it } from 'vitest';

describe('executor (hermetic)', () => {
  it('runs hermetically', async () => {
    await runTests();
  });
});
