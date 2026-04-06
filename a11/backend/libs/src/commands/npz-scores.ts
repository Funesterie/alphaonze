// ROME-TAG: 0xF933B3

import engine from '../utils/npz-engine.js';
import { stringify } from 'csv-stringify/sync';

export async function runNpzScores(args: string[] = []) {
  const store = engine.getStore();
  const items = Object.values(store).map((r: any) => ({ laneId: r.laneId, score: r.score, lastSuccess: r.lastSuccess, lastFailure: r.lastFailure }));
  // sort by score asc
  items.sort((a, b) => (a.score as number) - (b.score as number));

  if (args.includes('--reset')) {
    engine.resetScores();
    console.log('npz: scores reset');
    return 0;
  }

  if (args.includes('--csv')) {
    const records = items.map((it) => ({ laneId: it.laneId, score: it.score, lastSuccess: it.lastSuccess || '', lastFailure: it.lastFailure || '' }));
    const csv = stringify(records, { header: true });
    console.log(csv);
    return 0;
  }

  console.log(JSON.stringify(items, null, 2));
  return 0;
}

export default runNpzScores;
