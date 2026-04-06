import fs from 'fs';
import * as path from 'path';
import { decodeCortexPNG } from './decoder.js';
import { encodeCortexCommand } from './encoder.js';
import { execCommand } from '../rome/executor.js';

const inbox = path.join('.qflush', 'cortex', 'inbox');
const outbox = path.join('.qflush', 'cortex', 'outbox');

export function startCortexBus() {
  fs.mkdirSync(inbox, { recursive: true });
  fs.mkdirSync(outbox, { recursive: true });

  console.log('[CORTEX] Bus démarré — watching', inbox);

  const processFile = async (file: string) => {
    const full = path.join(inbox, file);
    if (!file.endsWith('.png')) return;
    try {
      const payload = decodeCortexPNG(full);
      const result = await execCommand(payload.cmd, payload.args || []);
      const response = { id: payload.id, ok: true, result, timestamp: Date.now() };
      const out = path.join(outbox, file);
      encodeCortexCommand(response, out);
    } catch (e) {
      console.error('[CORTEX] processing error', e);
      const resp = { id: path.basename(file, '.png'), ok: false, error: String(e), timestamp: Date.now() };
      try { encodeCortexCommand(resp, path.join(outbox, file)); } catch (e2) { /* ignore */ }
    } finally {
      try { fs.unlinkSync(full); } catch (e) { /* ignore */ }
    }
  };

  // simple poll/watch to be robust
  setInterval(() => {
    try {
      const files = fs.readdirSync(inbox || '.');
      for (const f of files) {
        processFile(f);
      }
    } catch (e) {
      // ignore
    }
  }, 500);
}
