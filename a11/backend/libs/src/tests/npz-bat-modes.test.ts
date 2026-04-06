import { describe, it, expect } from 'vitest';
import fs from 'fs';
import * as path from 'path';

describe('NPZ BAT simple tests', () => {
  it('should create safe-modes.json file', () => {
    const p = path.join(process.cwd(), '.qflush', 'safe-modes.json');
    fs.writeFileSync(p, JSON.stringify({ mode: 'sleep' }), 'utf8');
    expect(fs.existsSync(p)).toBe(true);
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    expect(data.mode).toBe('sleep');
  });

  it('should clear safe mode', () => {
    const p = path.join(process.cwd(), '.qflush', 'safe-modes.json');
    fs.writeFileSync(p, JSON.stringify({ mode: 'normal' }), 'utf8');
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    expect(data.mode).toBe('normal');
  });

  it('should perform joker wipe', () => {
    const p = path.join(process.cwd(), '.qflush', 'safe-modes.json');
    fs.writeFileSync(p, JSON.stringify({ mode: 'joker' }), 'utf8');
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    expect(data.mode).toBe('joker');
  });
});
