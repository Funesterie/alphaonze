import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readCompose } from '../compose/parser.js';

describe('compose parser', () => {
  let originalCwd: string;
  let tmpDir: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qflush-compose-'));
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('prefers the generic qflush yaml file', () => {
    fs.writeFileSync('qflush.yml', 'modules:\n  worker:\n    path: ./worker\n    port: 4010\n', 'utf8');
    fs.writeFileSync('funesterie.yml', 'modules:\n  legacy:\n    path: ./legacy\n', 'utf8');

    expect(readCompose()).toEqual({
      modules: {
        worker: {
          path: './worker',
          port: 4010,
        },
      },
    });
  });

  it('keeps legacy funesterie fcl files working', () => {
    fs.writeFileSync('funesterie.fcl', '@service legacy\npath=./legacy\nport=4020\n', 'utf8');

    expect(readCompose()).toEqual({
      modules: {
        legacy: {
          path: './legacy',
          port: 4020,
          token: undefined,
          env: undefined,
        },
      },
    });
  });
});
