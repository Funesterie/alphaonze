// Cortex listener: watch a folder for PNG packets and dispatch decoded JSON to router
import * as fs from 'fs';
import * as path from 'path';
import { decodePNGsToPacket, parseCortexPacket } from './codec.js';
import { routeCortexPacket } from './router.js';
import { getServiceClients } from '../services.js';

const WATCH_DIR = path.join(process.cwd(), 'canal');

export function startCortexListener() {
  try {
    if (!fs.existsSync(WATCH_DIR)) fs.mkdirSync(WATCH_DIR, { recursive: true });
  } catch (e) {}

  console.log('[CORTEX] listener watching', WATCH_DIR);

  const pending = new Set<string>();

  // initialize service clients once
  const services = getServiceClients();

  fs.watch(WATCH_DIR, { persistent: false }, async (ev, filename) => {
    if (!filename) return;
    const full = path.join(WATCH_DIR, filename);
    if (!filename.endsWith('.png')) return;
    if (pending.has(full)) return;
    pending.add(full);
    // give the file a moment to be fully written
    setTimeout(async () => {
      try {
        // find all matching parts for this prefix
        const prefix = filename.replace(/_part\d+\.png$/, '');
        const glob = fs.readdirSync(WATCH_DIR).filter(f => f.startsWith(prefix) && f.endsWith('.png')).map(f => path.join(WATCH_DIR, f)).sort();
        if (!glob.length) {
          pending.delete(full);
          return;
        }
        const fullBuf = await decodePNGsToPacket(glob);
        const parsed = parseCortexPacket(fullBuf);
        // attempt to decode payload to JSON where possible
        let payload: any = null;
        try {
          const txt = parsed.raw.toString('utf-8');
          payload = JSON.parse(txt);
        } catch (e) {
          payload = parsed.raw;
        }
        const routed = await routeCortexPacket({ totalLen: parsed.totalLen, payloadLen: parsed.payloadLen, flags: parsed.flags, payload }, services);
        console.log('[CORTEX] routed packet result', routed);
      } catch (e) {
        console.warn('[CORTEX] decode failed', e);
      } finally {
        pending.delete(full);
      }
    }, 200);
  });
}
