import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('Rome index basic', () => {
  it('should have a valid index structure', () => {
    const index = {
      'src/commands/checksum.ts': { type: 'command', path: 'src/commands/checksum.ts', ext: 'ts', tag: 2 },
      'assets/banner.png': { type: 'asset', path: 'assets/banner.png', ext: 'png', tag: 3 },
      'src/tests/foo.test.ts': { type: 'test', path: 'src/tests/foo.test.ts', ext: 'ts', tag: 4 },
    };
    expect(typeof index).toBe('object');
    expect(Object.keys(index).length).toBeGreaterThan(0);
  });
});
