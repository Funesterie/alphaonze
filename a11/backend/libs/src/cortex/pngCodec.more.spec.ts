import { describe, it, expect } from 'vitest';
import { encodeCortexPacketToPng, decodeCortexPacketFromPng } from './pngCodec.js';
import * as fs from 'fs';
import * as path from 'path';

describe('pngCodec additional tests', () => {
  it('redCurtain mode encodes and decodes payload correctly', async () => {
    const tmpDir = path.join(process.cwd(), 'tmp');
    try { if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir); } catch (e) {}
    const out = path.join(tmpDir, 'test_cxpk_red.png');

    const packet: any = {
      version: 1,
      kind: 'cortex-packet',
      type: 'cortex:spyder-vision',
      id: 'test-red-456',
      payload: { cmd: 'red', data: [9,8,7], note: 'redCurtain' }
    };

    await encodeCortexPacketToPng(packet, out, { width: 8, redCurtainMode: true });
    expect(fs.existsSync(out)).toBe(true);

    const decoded = await decodeCortexPacketFromPng(out);
    expect(decoded).toBeDefined();
    expect(decoded.kind).toBe('cortex-packet');
    expect(decoded.type).toBe(packet.type);
    // payload should match at least 'cmd'
    expect((decoded.payload as any).cmd || (decoded.payload as any).payload?.cmd).toEqual('red');

    try { fs.unlinkSync(out); } catch (e) {}
  });

  it('multi-pixel output handles larger payloads', async () => {
    const tmpDir = path.join(process.cwd(), 'tmp');
    try { if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir); } catch (e) {}
    const out = path.join(tmpDir, 'test_cxpk_multi.png');

    // create a payload that'll force multiple pixels / rows
    const bigArr = new Array(2000).fill(0).map((_,i)=>i%256);
    const packet: any = {
      version: 1,
      kind: 'cortex-packet',
      type: 'cortex:npz-graph',
      id: 'test-big-789',
      payload: { cmd: 'big', data: bigArr }
    };

    await encodeCortexPacketToPng(packet, out, { width: 16, redCurtainMode: false });
    expect(fs.existsSync(out)).toBe(true);

    const decoded = await decodeCortexPacketFromPng(out);
    expect(decoded).toBeDefined();
    expect(decoded.kind).toBe('cortex-packet');
    expect(decoded.type).toBe(packet.type);
    expect((decoded.payload as any).payload?.cmd || (decoded.payload as any).cmd).toBeDefined();

    try { fs.unlinkSync(out); } catch (e) {}
  });
});
