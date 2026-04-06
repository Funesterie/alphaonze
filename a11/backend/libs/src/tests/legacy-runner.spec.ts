/// <reference types="vitest" />
// ROME-TAG: 0x1EC911

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// import { startServer, stopServer } from '../daemon/qflushd';
import fs from 'fs';
import * as path from 'path';

const TEST_DIR = path.join(__dirname);

describe('legacy test runner', () => {
  const files = fs.readdirSync(TEST_DIR).filter((f: string) => f.endsWith('.test.ts') && f !== 'legacy-runner.spec.ts');
  for (const file of files) {
    test(`run ${file}`, async () => {
      const p = path.join(TEST_DIR, file);
      try {
        // dynamic import so vitest handles TS transpilation
        const mod = await import(p);
        if (mod && typeof mod.runTests === 'function') {
          await mod.runTests();
        }
      } catch (err) {
        throw err;
      }
    });
  }
});
