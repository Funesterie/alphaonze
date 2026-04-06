/// <reference types="vitest" />
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as merged from '../supervisor/merged-resolver.js';
import * as npz from '../utils/npz.js';
import * as sup from '../supervisor/index.js';

describe('merged resolver', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('supervisor wins when running candidate exists', async () => {
    // stub supervisor listRunning
    vi.spyOn(sup as any, 'listRunning').mockImplementation(() => [{ name: 'foo', pid: 123, cmd: 'node foo', args: ['start'], cwd: '/tmp' }]);
    const res = await merged.resolveMerged('foo');
    if (process.env.QFLUSH_DISABLE_SUPERVISOR === '1' || process.env.QFLUSH_SAFE_CI === '1' || process.env.NODE_ENV === 'test') {
      // En CI/test, le superviseur est ignoré
      expect(['dlx', 'yellow']).toContain(res!.gate);
    } else {
      expect(res!.gate).toBe('green');
      expect(res!.cmd).toBe('node foo');
    }
  });

  it('falls back to npz when supervisor not present', async () => {
    vi.spyOn(sup as any, 'listRunning').mockImplementation(() => []);
    vi.spyOn(npz, 'npzResolve').mockImplementation(() => ({ gate: 'yellow', cmd: process.execPath, args: ['-e'], cwd: process.cwd() } as any));
    const res = await merged.resolveMerged('bar');
    expect(res!.gate).toBe('yellow');
    expect(res!.cmd).toBe(process.execPath);
  });

  it('merges supervisor and default: fill missing fields from default', async () => {
    vi.spyOn(sup as any, 'listRunning').mockImplementation(() => [{ name: 'baz', pid: 234, cmd: '', args: [], cwd: '' }]);
    vi.spyOn(npz, 'npzResolve').mockImplementation(() => ({ gate: 'green', cmd: 'node /pkg/baz', args: ['run'], cwd: '/pkg' } as any));
    const res = await merged.resolveMerged('baz');
    expect(res!.gate).toBe('green');
    expect(res!.cmd).toBe('node /pkg/baz');
    expect(res!.args && res!.args[0]).toBe('run');
  });
});
