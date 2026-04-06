import { describe, it, expect } from 'vitest';
import { encodeCortexPacketToPng, decodeCortexPacketFromPng } from './pngCodec.js';
import * as fs from 'fs';
import * as path from 'path';

describe('pngCodec roundtrip', () => {
  it('encodes and decodes a CortexPacket via PNG CXPK', async () => {
    const tmpDir = path.join(process.cwd(), 'tmp');
    try { if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir); } catch (e) {}
    const out = path.join(tmpDir, 'test_cxpk.png');

    const packet: any = {
      version: 1,
      kind: 'cortex-packet',
      type: 'cortex:spyder-vision',
      id: 'test-123',
      payload: { cmd: 'test', data: [1,2,3], note: 'roundtrip' }
    };

    await encodeCortexPacketToPng(packet, out, { width: 16, redCurtainMode: false });
    expect(fs.existsSync(out)).toBe(true);

    const decoded = await decodeCortexPacketFromPng(out);
    expect(decoded).toBeDefined();
    expect(decoded.kind).toBe('cortex-packet');
    expect(decoded.type).toBe(packet.type);
    expect(decoded.payload).toBeDefined();
    expect((decoded.payload as any).payload?.cmd ?? (decoded.payload as any).cmd ?? (decoded.payload as any).payload).toBeDefined();

    // cleanup
    try { fs.unlinkSync(out); } catch (e) {}
  });
});
