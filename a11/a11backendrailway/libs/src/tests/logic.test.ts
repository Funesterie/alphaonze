// ROME-TAG: 0xDEC58D

import { parseLogicFile } from '../rome/logic-parser.js';
import { loadLogicRules } from '../rome/logic-loader.js';
import { describe, it, expect } from 'vitest';

export async function runTests() {
  const rules = parseLogicFile('src/rome/logic/logic.qfl');
  console.log('parsed rules:', rules.map(r => r.name));
  if (rules.length === 0) throw new Error('no rules parsed');
}

describe('logic (stub)', () => {
  it('stub passes', () => {
    expect(true).toBe(true);
  });
});
