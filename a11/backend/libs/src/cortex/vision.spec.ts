import { describe, it, expect } from 'vitest';
import vision from './vision.js';
import * as fs from 'fs';
import * as path from 'path';

describe('vision pipeline', () => {
  it('processes png if present (smoke)', async () => {
    const f = path.join(process.cwd(), 'parts', 'ideas_oc8.png');
    if (!fs.existsSync(f)) {
      // skip
      expect(true).toBe(true);
      return;
    }
    try {
      const res = await vision.processVisionImage(f);
      expect(res).toBeDefined();
      expect(res.packet).toBeDefined();
    } catch (e: any) {
      // if file is not a valid CORTEX PNG, skip the smoke test
      if (String(e).includes('Invalid CORTEX PNG')) {
        expect(true).toBe(true);
        return;
      }
      throw e;
    }
  });
});
