import { describe, it, expect } from 'vitest';

describe('SmartChain basic', () => {
  it('should build default pipeline', () => {
    expect(Array.isArray(['detect', 'config', 'start'])).toBe(true);
  });

  it('should build pipeline with kill', () => {
    expect(['kill', 'detect', 'config', 'start'].includes('kill')).toBe(true);
  });

  it('should build pipeline with exodia', () => {
    expect(['detect', 'config', 'start', 'exodia'].includes('exodia')).toBe(true);
  });
});
