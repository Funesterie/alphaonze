import { describe, it, expect } from 'vitest';
import { loadRoutesConfig, pickBestRoute, isRouteEnabled } from './routesConfig.js';
import * as fs from 'fs';
import * as path from 'path';

describe('routesConfig', () => {
  it('loads array routes', () => {
    const tmp = path.join(process.cwd(), '.qflush', 'cortex.routes.json');
    try {
      if (!fs.existsSync(path.dirname(tmp))) fs.mkdirSync(path.dirname(tmp), { recursive: true });
      fs.writeFileSync(tmp, JSON.stringify({ routes: ['A','B'] }, null, 2), 'utf8');
      const cfg = loadRoutesConfig();
      expect(cfg).toBeTruthy();
      const pick = pickBestRoute(['A','B']);
      expect(pick).toBe('A');
    } finally {
      try { fs.unlinkSync(tmp); } catch (e) {}
    }
  });

  it('respects disabled flag', () => {
    const tmp = path.join(process.cwd(), '.qflush', 'cortex.routes.json');
    try {
      fs.writeFileSync(tmp, JSON.stringify({ cortexActions: { 'A': true, 'B': false } }, null, 2), 'utf8');
      expect(isRouteEnabled('A')).toBe(true);
      expect(isRouteEnabled('B')).toBe(false);
    } finally { try { fs.unlinkSync(tmp); } catch (e) {} }
  });
});
