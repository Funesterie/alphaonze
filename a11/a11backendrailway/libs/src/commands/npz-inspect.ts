// ROME-TAG: 0x025858

import npzStore from '../utils/npz-store.js';

export async function runNpzInspect(id: string) {
  const rec = await npzStore.getRequestRecord(id);
  if (!rec) {
    console.log(`npz: record ${id} not found`);
    return 1;
  }
  console.log(JSON.stringify(rec, null, 2));
  return 0;
}

export default runNpzInspect;
