import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import * as zlib from 'zlib';
import sharp from 'sharp';

const brotliCompressSync = (input: Buffer) => zlib.brotliCompressSync(input, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 } });
const brotliDecompressSync = (input: Buffer) => zlib.brotliDecompressSync(input);

// CRC-8 OC8 implementation
export function crc8_oc8(data: Buffer, poly = 0x07, init = 0x00): number {
  let crc = init & 0xff;
  for (const b of data) {
    crc ^= b;
    for (let i = 0; i < 8; i++) {
      if ((crc & 0x80) !== 0) crc = ((crc << 1) ^ poly) & 0xff;
      else crc = (crc << 1) & 0xff;
    }
  }
  return crc & 0xff;
}

export function buildCortexPacket(raw: Buffer, flags = 0): Buffer {
  const compressed = brotliCompressSync(raw);
  const crc = crc8_oc8(compressed);
  const payload = Buffer.concat([compressed, Buffer.from([crc])]);
  const payloadLen = payload.length;
  const totalLen = payloadLen + 16;
  const header = Buffer.alloc(16);
  header.writeUInt32BE(totalLen, 0);
  header.writeUInt32BE(payloadLen, 4);
  header.writeUInt8(flags & 0xff, 8);
  // reserved 7 bytes already zero
  return Buffer.concat([header, payload]);
}

export function parseCortexPacket(buf: Buffer) {
  if (buf.length < 16) throw new Error('Stream too short for Cortex header');
  const totalLen = buf.readUInt32BE(0);
  const payloadLen = buf.readUInt32BE(4);
  const flags = buf.readUInt8(8);
  if (payloadLen < 1) throw new Error('invalid payload length');
  if (buf.length < 16 + payloadLen) throw new Error('buffer shorter than payload');
  const payloadWithCrc = buf.slice(16, 16 + payloadLen);
  const compressed = payloadWithCrc.slice(0, -1);
  const crc = payloadWithCrc[payloadWithCrc.length - 1];
  const expected = crc8_oc8(compressed);
  if (crc !== expected) throw new Error(`CRC mismatch: expected ${expected}, got ${crc}`);
  const raw = brotliDecompressSync(compressed);
  return { totalLen, payloadLen, flags, raw };
}

function padToMultipleOf3(buf: Buffer): Buffer {
  const pad = (3 - (buf.length % 3)) % 3;
  if (pad === 0) return buf;
  return Buffer.concat([buf, Buffer.alloc(pad)]);
}

export async function encodePacketToPNGs(packet: Buffer, outputPrefix: string, maxPngBytes = 200 * 1024 * 1024): Promise<string[]> {
  const rgb = padToMultipleOf3(packet);
  const totalPixels = Math.floor(rgb.length / 3);
  const maxPixelsPerImg = Math.max(1, Math.floor(maxPngBytes / 3));
  const numImages = Math.max(1, Math.ceil(totalPixels / maxPixelsPerImg));
  const outPaths: string[] = [];

  let pixelOffset = 0;
  for (let idx = 0; idx < numImages; idx++) {
    const pixelsInChunk = Math.min(maxPixelsPerImg, totalPixels - pixelOffset);
    if (pixelsInChunk <= 0) break;
    const start = pixelOffset * 3;
    const end = start + pixelsInChunk * 3;
    const chunk = rgb.slice(start, end);
    // compute dims
    const width = Math.min(4096, Math.max(1, Math.round(Math.sqrt(pixelsInChunk))));
    const height = Math.ceil(pixelsInChunk / width);
    const required = width * height * 3;
    let data = chunk;
    if (required > chunk.length) data = Buffer.concat([chunk, Buffer.alloc(required - chunk.length)]);

    const outName = `${outputPrefix}_part${idx.toString().padStart(2, '0')}.png`;
    // sharp expects raw with channels=3
    await sharp(data, { raw: { width, height, channels: 3 } }).png({ compressionLevel: 1 }).toFile(outName);
    outPaths.push(outName);
    pixelOffset += pixelsInChunk;
  }
  return outPaths;
}

export async function decodePNGsToPacket(paths: string[]): Promise<Buffer> {
  // read in order, extract raw RGB bytes
  const parts: Buffer[] = [];
  for (const p of paths) {
    const res = await sharp(p).raw().toBuffer({ resolveWithObject: true });
    let { data, info } = res as any;
    if (info.channels === 4) {
      // strip alpha
      const stripped = Buffer.alloc((data.length / 4) * 3);
      let j = 0;
      for (let i = 0; i < data.length; i += 4) {
        stripped[j++] = data[i];
        stripped[j++] = data[i + 1];
        stripped[j++] = data[i + 2];
      }
      data = stripped;
    } else if (info.channels === 3) {
      // ok
    } else {
      // attempt to convert to rgb buffer
      const rgbBuf = await sharp(p).ensureAlpha().raw().toBuffer();
      // then strip
      const stripped = Buffer.alloc((rgbBuf.length / 4) * 3);
      let j = 0;
      for (let i = 0; i < rgbBuf.length; i += 4) {
        stripped[j++] = rgbBuf[i];
        stripped[j++] = rgbBuf[i + 1];
        stripped[j++] = rgbBuf[i + 2];
      }
      data = stripped;
    }
    parts.push(data as Buffer);
  }
  const full = Buffer.concat(parts);
  // no padding removal necessary: parse header and payload lengths
  return full;
}

// Convenience helpers for file io
export async function encodeFileToPNGs(inputPath: string, outputPrefix: string) {
  const raw = fs.readFileSync(inputPath);
  const packet = buildCortexPacket(raw, 0);
  return encodePacketToPNGs(packet, outputPrefix);
}

export async function decodePNGsToFile(pngGlobPaths: string[], outputPath: string) {
  const full = await decodePNGsToPacket(pngGlobPaths);
  const parsed = parseCortexPacket(full);
  fs.writeFileSync(outputPath, parsed.raw);
}

export function decodeCortexPacket(buf: Buffer) {
  // parseCortexPacket already verifies CRC and decompresses
  const parsed = parseCortexPacket(buf);
  let payload: any = null;
  try {
    const txt = parsed.raw.toString('utf-8');
    payload = JSON.parse(txt);
  } catch (e) {
    payload = parsed.raw;
  }
  return {
    totalLen: parsed.totalLen,
    payloadLen: parsed.payloadLen,
    flags: parsed.flags,
    payload
  };
}

export default { buildCortexPacket, parseCortexPacket, decodeCortexPacket, encodePacketToPNGs, decodePNGsToPacket };
