import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { startCortexListener } from './listener.js';

// Sketch: simulate placing a decoded JSON packet file (already extracted) into canal

describe('Cortex listener (integration sketch)', () => {
  const CANAL = path.join(process.cwd(), 'canal');
  const SPY_CFG = path.join(process.cwd(), '.qflush', 'spyder.config.json');

  beforeEach(() => {
    if (!fs.existsSync(CANAL)) fs.mkdirSync(CANAL, { recursive: true });
    if (fs.existsSync(SPY_CFG)) fs.unlinkSync(SPY_CFG);
  });

  afterEach(() => {
    try { if (fs.existsSync(SPY_CFG)) fs.unlinkSync(SPY_CFG); } catch (e) {}
  });

  it('should create spyder config when receiving enable-spyder packet (sketch)', async () => {
    // This is a sketch: actual test would write PNG parts into canal and wait for listener to process
    // For now assert that listener function exists and can be started
    expect(typeof startCortexListener).toBe('function');
  });
});
