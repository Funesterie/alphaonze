#!/usr/bin/env node
// ROME-TAG: 0xE2F4A9

import { loadRomeIndexFromDisk } from '../rome/index-loader.js';
import { evaluateIndex } from '../rome/engine.js';
import { executeAction } from '../rome/executor.js';

export default async function runEngine(args: string[]) {
  const dry = args.includes('--dry-run') || args.includes('--dry');
  const idx = loadRomeIndexFromDisk();
  const actions = evaluateIndex(idx);
  console.log('Engine actions:', actions);
  if (dry) {
    console.log('Running in dry-run mode, simulating actions...');
    for (const a of actions) {
      try {
        // simulate by calling executeAction with dryRun
        const actionString = String((a as any).action ?? a);
        const res = await executeAction(actionString, { path: (a as any).path || null, dryRun: true });
        console.log('Simulate', a, '->', res);
      } catch (e) {
        console.warn('simulate failed', e);
      }
    }
  }
  return 0;
}
