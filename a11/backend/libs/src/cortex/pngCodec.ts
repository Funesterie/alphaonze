import { CortexPacket } from './types.js';
import { PNG } from 'pngjs';
import * as fs from 'fs';
import * as zlib from 'zlib';

const MAGIC = Buffer.from('CXPK');
const HEADER_SIZE = 12; // 4 + 1 +3 +4

export interface EncodePngOptions {
  width?: number;
  redCurtainMode?: boolean;
}

export function encodeCortexPacketToPng(
  packet: CortexPacket,
  outputPath: string,
  options: EncodePngOptions = {}
): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const json = JSON.stringify(packet);
      const payload = zlib.brotliCompressSync(Buffer.from(json, 'utf8'));

      const header = Buffer.alloc(HEADER_SIZE);
      MAGIC.copy(header, 0); // 0..3
      header.writeUInt8(1, 4); // version
      header.writeUInt8(0, 5);
      header.writeUInt8(0, 6);
      header.writeUInt8(0, 7);
      header.writeUInt32BE(payload.length, 8);

      const rawData = Buffer.concat([header, payload]);

      const redCurtainMode = options.redCurtainMode ?? false;
      const bytesPerPixel = redCurtainMode ? 1 : 4;

      const totalPixels = Math.ceil(rawData.length / bytesPerPixel);
      const width = options.width ?? 8;
      const height = Math.ceil(totalPixels / width);

      const png = new PNG({ width, height });
      const data = png.data;

      for (let i = 0; i < totalPixels; i++) {
        const pxIndex = i * 4;
        const byteIndex = i * bytesPerPixel;
        if (redCurtainMode) {
          const value = rawData[byteIndex] ?? 0;
          data[pxIndex] = value;
          data[pxIndex + 1] = 0;
          data[pxIndex + 2] = 0;
          data[pxIndex + 3] = 255;
        } else {
          data[pxIndex] = rawData[byteIndex] ?? 0;
          data[pxIndex + 1] = rawData[byteIndex + 1] ?? 0;
          data[pxIndex + 2] = rawData[byteIndex + 2] ?? 0;
          data[pxIndex + 3] = rawData[byteIndex + 3] ?? 0;
        }
      }

      // padding
      for (let i = totalPixels * 4; i < data.length; i++) data[i] = data[i] || 0;

      const ws = fs.createWriteStream(outputPath);
      png.pack().pipe(ws);
      ws.on('finish', () => resolve());
      ws.on('error', reject);
    } catch (e) {
      reject(e);
    }
  });
}

export function decodeCortexPacketFromPng(inputPath: string): Promise<CortexPacket> {
  return new Promise((resolve, reject) => {
    try {
      const rs = fs.createReadStream(inputPath);
      // pngjs types may not match stream typings in TS env; cast to any for pipe
      rs.pipe(new (PNG as any)())
        .on('parsed', function (this: PNG) {
          try {
            const data = this.data; // RGBA
            // attempt red-curtain detection: many pixels with G=B=0 and A=255
            let redCurtain = true;
            for (let i = 0; i < data.length; i += 4) {
              if (!(data[i + 1] === 0 && data[i + 2] === 0 && data[i + 3] === 255)) { redCurtain = false; break; }
            }

            let rawData: Buffer;
            if (redCurtain) {
              const bytes = data.length / 4;
              rawData = Buffer.alloc(bytes);
              for (let i = 0; i < bytes; i++) rawData[i] = data[i * 4];
            } else {
              // take raw RGBA stream
              rawData = Buffer.from(data);
            }

            const magic = rawData.subarray(0, 4);
            if (!magic.equals(MAGIC)) return reject(new Error('Invalid CORTEX PNG, bad MAGIC'));
            const version = rawData.readUInt8(4);
            const length = rawData.readUInt32BE(8);
            const headerSize = HEADER_SIZE;
            const payloadBytes = rawData.subarray(headerSize, headerSize + length);
            const decompressed = zlib.brotliDecompressSync(payloadBytes);
            const jsonString = decompressed.toString('utf8');
            const packet = JSON.parse(jsonString) as CortexPacket;
            if (packet.kind !== 'cortex-packet') return reject(new Error('Invalid cortex packet kind'));
            resolve(packet);
          } catch (e) {
            reject(e);
          }
        })
        .on('error', reject);
    } catch (e) {
      reject(e);
    }
  });
}
