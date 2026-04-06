// ROME-TAG: 0x70150D

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { saveLicense, loadLicense, clearLicense } from '../utils/gumroad-license.js';

describe('gumroad-license save/load/clear', () => {
  beforeAll(() => {
    clearLicense();
  });

  afterAll(() => {
    clearLicense();
  });

  test('save and load', () => {
    saveLicense({ key: 'ABC', product_id: 'p1', createdAt: Date.now() });
    const loaded = loadLicense();
    expect(loaded).not.toBeNull();
    expect(loaded!.key).toBe('ABC');
  });

  test('clear', () => {
    clearLicense();
    const loaded = loadLicense();
    expect(loaded).toBeNull();
  });
});
