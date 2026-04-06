import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'path';
import * as net from 'node:net';
import os from 'node:os';

describe('spyder admin port occupied behavior', () => {
  let tmpDir: string;
  let origCwd: string;
  const OLD_ENV = { ...process.env };
  let server: net.Server | null = null;

  beforeEach(() => {
    origCwd = process.cwd();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qflush-test-'));
    process.chdir(tmpDir);
  });

  afterEach(() => {
    try { process.chdir(origCwd); } catch (err) { /* ignore */ }
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (err) { /* ignore */ }
    process.env = { ...OLD_ENV };
    if (server) {
      try { server.close(); } catch (err) { /* ignore */ }
      server = null;
    }
    vi.restoreAllMocks();
  });

  it('does not persist spyder config when admin port is already bound', async () => {
    // reserve a port
    const listenPort = 52345;
    server = net.createServer(() => {});
    await new Promise<void>((resolve, reject) => {
      server!.listen(listenPort, '127.0.0.1', (err?: any) => {
        if (err) reject(err); else resolve();
      });
    });

    process.env.QFLUSH_SPYDER_ADMIN_PORT = String(listenPort);

    // mock startService to avoid side effects
    vi.mock('../../src/services', () => ({ startService: async () => { return; } }));

    const { runStart } = await import('../../src/commands/start.js');
    await runStart({ services: ['spyder'] as any, flags: {} as any } as any);

    const cfgPath = path.join(process.cwd(), '.qflush', 'spyder.config.json');
    expect(fs.existsSync(cfgPath)).toBe(false);
  });
});
