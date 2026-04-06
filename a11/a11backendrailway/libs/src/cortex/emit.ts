import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';

const emitter = new EventEmitter();
const QFLUSH_DIR = path.join(process.cwd(), '.qflush');
const DRIP_LOG = path.join(QFLUSH_DIR, 'cortex', 'drip.log');

export function cortexEmit(eventName: string, payload: any) {
  try {
    if (!fs.existsSync(path.dirname(DRIP_LOG))) fs.mkdirSync(path.dirname(DRIP_LOG), { recursive: true });
    const line = JSON.stringify({ t: new Date().toISOString(), event: eventName, payload });
    fs.appendFileSync(DRIP_LOG, line + '\n', 'utf8');
  } catch (e) {
    console.warn('[cortex] drip log write failed', String(e));
  }
  try { emitter.emit(eventName, payload); } catch (e) { console.warn('[cortex] emitter.emit failed', String(e)); }
}

export function onCortexEvent(eventName: string, cb: (p: any) => void) {
  emitter.on(eventName, cb);
}

export default { cortexEmit, onCortexEvent };
