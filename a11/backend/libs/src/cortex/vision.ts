import * as fs from 'fs';
import * as path from 'path';
import { decodeCortexPacketFromPng } from './pngCodec.js';

const OUT = path.join(process.cwd(), '.qflush', 'spyder-vision.json');

export async function processVisionImage(pngPath: string) {
  try {
    const pkt = await decodeCortexPacketFromPng(pngPath);
    // naive vision: store packet payload or metadata
    const data = { source: pngPath, packet: pkt, processedAt: new Date().toISOString() };
    try {
      const dir = path.dirname(OUT);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(OUT, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {}
    return data;
  } catch (e) {
    throw e;
  }
}

export default { processVisionImage };
