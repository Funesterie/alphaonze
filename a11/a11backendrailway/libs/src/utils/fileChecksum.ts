import * as fs from 'fs';
import normalize from './normalize.js';
import * as os from 'os';
import * as path from 'path';

// Note: keep local xor implementation to avoid circular import issues
export function xorChecksum(buffer: Uint8Array | Buffer): number {
  let x = 0;
  for (let i = 0; i < buffer.length; i++) x ^= buffer[i];
  return x & 0xff;
}

export function checksumBufferIgnoringRomeTag(buf: Buffer | Uint8Array): number {
  // normalize by removing ROME-TAG lines from UTF-8 interpretation
  const text = Buffer.isBuffer(buf) ? buf.toString('utf8') : Buffer.from(buf).toString('utf8');
  const cleaned = normalize.stripRomeTagLines(text);
  const b = Buffer.from(cleaned, 'utf8');
  return xorChecksum(b);
}

export function checksumFileIgnoringRomeTag(filePath: string): number {
  const raw = fs.readFileSync(filePath);
  return checksumBufferIgnoringRomeTag(raw);
}

// Flexible checksum: try multiple decoding strategies
export async function flexibleChecksumBuffer(buf: Buffer | Uint8Array): Promise<number> {
  const buffer = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);

  // 1) PNG detection (PNG file signature: 89 50 4E 47 0D 0A 1A 0A)
  try {
    if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
      // write to temp file and try to decode via existing pngCodec
      try {
        const tmp = path.join(os.tmpdir(), `qflush_cxpk_${Date.now()}_${Math.random().toString(36).slice(2,8)}.png`);
        fs.writeFileSync(tmp, buffer);
        try {
          // dynamic import to avoid circular deps
          const pngCodec = require('../cortex/pngCodec');
          if (pngCodec && typeof pngCodec.decodeCortexPacketFromPng === 'function') {
            const pkt = await pngCodec.decodeCortexPacketFromPng(tmp);
            try { fs.unlinkSync(tmp); } catch (e) { console.warn('[fileChecksum] unlink tmp failed', String(e)); }
            // use payload or whole packet JSON
            const target = pkt && pkt.payload ? pkt.payload : pkt;
            const json = JSON.stringify(target);
            return xorChecksum(Buffer.from(json, 'utf8'));
          }
        } catch (e) {
          try { fs.unlinkSync(tmp); } catch (e2) { console.warn('[fileChecksum] unlink tmp failed', String(e2)); }
          console.warn('[fileChecksum] png decode attempt failed', String(e));
        }
      } catch (e) {
        // ignore and fallback, but record for diagnostics
        console.warn('[fileChecksum] png detection fallback', String(e));
      }
    }
  } catch (e) { console.warn('[fileChecksum] png detection outer error', String(e)); }

  // 2) Cortex binary packet (try parse via src/cortex/codec)
  try {
    const codec = require('../cortex/codec');
    if (codec && typeof codec.decodeCortexPacket === 'function') {
      try {
        const parsed = codec.decodeCortexPacket(buffer);
        if (parsed && parsed.payload) {
          const json = typeof parsed.payload === 'string' ? parsed.payload : JSON.stringify(parsed.payload);
          return xorChecksum(Buffer.from(json, 'utf8'));
        }
      } catch (e) {
        // not a cortex binary packet, continue
        console.warn('[fileChecksum] codec decode failed', String(e));
      }
    }
  } catch (e) { console.warn('[fileChecksum] cortex codec require failed', String(e)); }

  // 3) fallback to text normalization checksum
  try {
    return checksumBufferIgnoringRomeTag(buffer);
  } catch (e) {
    // last resort: plain xor on raw bytes
    return xorChecksum(buffer);
  }
}

export async function flexibleChecksumFile(filePath: string): Promise<number> {
  const raw = fs.readFileSync(filePath);
  return flexibleChecksumBuffer(raw);
}

export default { xorChecksum, checksumBufferIgnoringRomeTag, checksumFileIgnoringRomeTag, flexibleChecksumBuffer, flexibleChecksumFile };
