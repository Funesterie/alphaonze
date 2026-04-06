// ROME-TAG: 0x1D49C5

import engine from '../../utils/npz-engine.js';

export type ScoreRecord = {
  laneId: number;
  score: number;
  lastSuccess?: number;
  lastFailure?: number;
};

export function getScores(): ScoreRecord[] {
  const store = engine.getStore();
  return Object.values(store).map((r: any) => ({ laneId: r.laneId, score: r.score, lastSuccess: r.lastSuccess, lastFailure: r.lastFailure }));
}

export function resetScores() {
  engine.resetScores();
}

export function getOrderedLanes(lanes: { id: number }[]) {
  return engine.orderLanesByScore(lanes as any);
}

export default { getScores, resetScores, getOrderedLanes };
