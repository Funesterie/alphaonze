import * as path from 'path';
import { encodeCortexCommand } from './encoder.js';
import * as fs from 'fs';

export function cortexSend(cmd: string, args: any[] = []) {
  const id = 'cortex-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  const ner = { id, cmd, args, timestamp: Date.now() };
  const out = path.join('.qflush', 'cortex', 'inbox', id + '.png');
  encodeCortexCommand(ner, out);
  return id;
}

export function cortexWaitFor(id: string, timeoutMs = 5000) {
  const out = path.join('.qflush', 'cortex', 'outbox', id + '.png');
  const start = Date.now();
  return new Promise<any>((resolve, reject) => {
    const iv = setInterval(() => {
      if (Date.now() - start > timeoutMs) { clearInterval(iv); return reject(new Error('timeout')); }
      if (fs.existsSync(out)) {
        try {
          const dec = require('./decoder').decodeCortexPNG(out);
          try { fs.unlinkSync(out); } catch(e){}
          clearInterval(iv);
          resolve(dec);
        } catch (e) { clearInterval(iv); reject(e); }
      }
    }, 200);
  });
}
