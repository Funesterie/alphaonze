/// <reference types="vitest" />
import { resolveRomeToken, computeRomeLinksForFiles, mergeAndWrite, readExistingLinks, romeLinksEmitter } from '../rome/linker.js';
import { describe, it, expect } from 'vitest';

const projectRoot = process.cwd();

describe('rome linker resolver', () => {
  it('resolves tokens using index', () => {
    // this test relies on existing .qflush/rome-index.json in workspace
    const from = 'src/rome/linker.test.ts';
    const token = 'linker';
    const res = resolveRomeToken(projectRoot, from, token);
    expect(res).toBeDefined();
    expect(res.score).toBeGreaterThanOrEqual(0);
  });

  it('emits update on mergeAndWrite', async () => {
    const testLinks = [{ from: 'src/a.ts', line: 1, token: 'a', target: null, score: 0 }];
    await new Promise((resolve, reject) => {
      const handler = (updated: any) => {
        try {
          expect(Array.isArray(updated)).toBe(true);
          romeLinksEmitter.removeListener('updated', handler);
          resolve(undefined);
        } catch (e) {
          reject(e);
        }
      };
      romeLinksEmitter.on('updated', handler);
      mergeAndWrite(projectRoot, testLinks as any);
    });
  });
});
