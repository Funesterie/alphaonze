import * as fs from 'fs';
import zlib from 'zlib';
import { PNG } from 'pngjs';
import * as crypto from 'crypto';

const seenIds = new Set<string>();

export function decodeCortexPNG(file: string) {
  const buf = fs.readFileSync(file);
  const png = PNG.sync.read(buf);

  // Helper: attempt to parse OC8 header embedded directly in RGBA stream
  const tryOc8Header = (): any | null => {
    const rgba = Buffer.from(png.data);
    const hdr = Buffer.from('OC8');
    const idx = rgba.indexOf(hdr);
    if (idx === -1) return null;

    const verIndex = idx + 3;
    if (verIndex >= rgba.length) throw new Error('OC8 header truncated (no version byte)');
    const ver = rgba[verIndex];
    if (ver !== 1) console.warn(`decodeCortexPNG: OC8 version ${ver} (expected 1)`);

    const lenIndex = verIndex + 1;
    if (lenIndex + 4 > rgba.length) throw new Error('OC8 header truncated (no length)');
    const lenBytes = rgba.slice(lenIndex, lenIndex + 4);
    // little-endian
    const payloadLen = lenBytes.readInt32LE(0);
    const compStart = lenIndex + 4;
    let compEnd = compStart + payloadLen;
    if (compEnd > rgba.length) {
      console.warn(`OC8: advertised payload length ${payloadLen} exceeds available bytes (${rgba.length - compStart}). Truncating.`);
      compEnd = rgba.length;
    }
    const compressed = rgba.slice(compStart, compEnd);
    try {
      const json = zlib.brotliDecompressSync(compressed);
      return JSON.parse(json.toString('utf8'));
    } catch (e) {
      throw new Error('OC8 Brotli decompression/parsing failed: ' + String(e));
    }
  };

  // Helper: take RGB triplets and produce compressed buffer (strip trailing zero padding)
  const rgbCompressedBuffer = (): Buffer => {
    const bytes: number[] = [];
    for (let i = 0; i < png.data.length; i += 4) {
      bytes.push(png.data[i], png.data[i + 1], png.data[i + 2]);
    }
    // trim trailing zeros that were padding
    let end = bytes.length;
    while (end > 0 && bytes[end - 1] === 0) end--;
    return Buffer.from(bytes.slice(0, end));
  };

  // 1) Try OC8 header mode first (direct RGBA payload with OC8 header)
  try {
    const oc8Result = tryOc8Header();
    if (oc8Result !== null) {
      // replay protection
      if (oc8Result && oc8Result.id) {
        if (seenIds.has(oc8Result.id)) throw new Error('replay detected');
        seenIds.add(oc8Result.id);
        if (seenIds.size > 10000) {
          const it = seenIds.values();
          const remove = it.next().value;
          if (remove) seenIds.delete(remove);
        }
      }
      return oc8Result;
    }
  } catch (e) {
    throw e;
  }

  // 2) Fallback: PNG text oc8 checksum mode (encoder may store compressed payload in RGB)
  const compressed = rgbCompressedBuffer();
  const oc8Text = (png.text && png.text.oc8) ? Number(png.text.oc8) : null;
  if (oc8Text !== null) {
    const calc = crypto.createHash('sha256').update(compressed).digest().subarray(0, 1)[0];
    if (oc8Text !== calc) throw new Error('OC8 checksum mismatch');
    const json = zlib.brotliDecompressSync(compressed);
    const payload = JSON.parse(json.toString('utf8'));
    if (payload && payload.id) {
      if (seenIds.has(payload.id)) throw new Error('replay detected');
      seenIds.add(payload.id);
      if (seenIds.size > 10000) {
        const it = seenIds.values();
        const remove = it.next().value;
        if (remove) seenIds.delete(remove);
      }
    }
    return payload;
  }

  // 3) Last resort: try to decompress trimmed RGB buffer and parse JSON
  try {
    const json = zlib.brotliDecompressSync(compressed);
    const payload = JSON.parse(json.toString('utf8'));
    if (payload && payload.id) {
      if (seenIds.has(payload.id)) throw new Error('replay detected');
      seenIds.add(payload.id);
      if (seenIds.size > 10000) {
        const it = seenIds.values();
        const remove = it.next().value;
        if (remove) seenIds.delete(remove);
      }
    }
    return payload;
  } catch (e) {
    throw new Error('Failed to decode cortex PNG: no OC8 header, no oc8 text checksum, and Brotli decompression failed: ' + String(e));
  }
}

export default { decodeCortexPNG };
