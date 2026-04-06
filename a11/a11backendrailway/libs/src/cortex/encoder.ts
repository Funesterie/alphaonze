import fs from 'fs';
import * as path from 'path';
import zlib from 'zlib';
import { PNG } from 'pngjs';
import crypto from 'crypto';

export function encodeCortexCommand(ner: any, outPath: string) {
  const json = Buffer.from(JSON.stringify(ner), 'utf8');
  const compressed = zlib.brotliCompressSync(json, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 } });

  const pixelsCount = Math.ceil(compressed.length / 3);
  const width = Math.ceil(Math.sqrt(pixelsCount));
  const height = width;
  const png = new PNG({ width, height });

  let byteIndex = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const k = (width * y + x) << 2;
      const r = compressed[byteIndex++] ?? 0;
      const g = compressed[byteIndex++] ?? 0;
      const b = compressed[byteIndex++] ?? 0;
      png.data[k] = r;
      png.data[k + 1] = g;
      png.data[k + 2] = b;
      png.data[k + 3] = 255;
    }
  }

  // OC8: first byte of sha256 of compressed payload (simple integrity tag)
  const oc8 = crypto.createHash('sha256').update(compressed).digest().subarray(0, 1)[0];
  // store as tEXt chunk
  // @ts-ignore png.text exists on PNG
  png.text = png.text || {};
  // store numeric oc8 as string
  // @ts-ignore
  png.text.oc8 = String(oc8);

  // ensure parent dir
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const ws = fs.createWriteStream(outPath + '.tmp');
  png.pack().pipe(ws);
  ws.on('finish', () => {
    try {
      fs.renameSync(outPath + '.tmp', outPath);
    } catch (e) {
      // best effort
      if (fs.existsSync(outPath + '.tmp')) fs.unlinkSync(outPath + '.tmp');
    }
  });
}
