const test = require('node:test');
const assert = require('node:assert/strict');

const createCasinoRouter = require('../src/routes/casino.cjs');

const {
  applyJokerBonus,
  detectJokerBonusTrigger,
  detectJokerCross,
} = createCasinoRouter.__private;

function countJokers(grid) {
  return grid.flat().filter((symbolId) => symbolId === 'JOKER').length;
}

function createDeterministicRandom(seed) {
  let state = seed >>> 0;
  return (maxExclusive) => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state % Math.max(1, Number(maxExclusive) || 1);
  };
}

test('applyJokerBonus keeps five respins available when no extra joker lands', () => {
  const openingGrid = [
    ['JOKER', 'COIN', 'MAP', 'BAT', 'PARROT'],
    ['CHEST', 'JOKER', 'COIN', 'SOLDAT', 'BAT'],
    ['MAP', 'COIN', 'JOKER', 'CHEST', 'ELEPHANT'],
  ];

  const result = applyJokerBonus({
    grid: openingGrid,
    randomInt: () => 9999,
  });

  assert.equal(result.stages.length, 5);
  assert.deepEqual(result.stages.map((stage) => stage.step), [1, 2, 3, 4, 5]);
  assert.equal(result.finalJokerCount, countJokers(openingGrid));
});

test('applyJokerBonus grows jokers gradually across the bonus stages', () => {
  const openingGrid = [
    ['JOKER', 'COIN', 'MAP', 'BAT', 'PARROT'],
    ['CHEST', 'JOKER', 'COIN', 'SOLDAT', 'BAT'],
    ['MAP', 'COIN', 'JOKER', 'CHEST', 'ELEPHANT'],
  ];
  const initialJokerCount = countJokers(openingGrid);

  const result = applyJokerBonus({
    grid: openingGrid,
    randomInt: createDeterministicRandom(17),
  });

  let previousJokerCount = initialJokerCount;

  result.stages.forEach((stage) => {
    assert.ok(stage.jokerCount >= previousJokerCount);
    assert.ok(stage.jokerCount - previousJokerCount <= 4);
    previousJokerCount = stage.jokerCount;
  });

  assert.ok(result.stages.some((stage) => stage.jokerCount > initialJokerCount));
  assert.equal(result.finalJokerCount, result.stages[result.stages.length - 1].jokerCount);
});

test('detectJokerBonusTrigger opens the bonus with four jokers even when they are scattered', () => {
  const openingGrid = [
    ['JOKER', 'COIN', 'MAP', 'BAT', 'PARROT'],
    ['CHEST', 'JOKER', 'COIN', 'SOLDAT', 'BAT'],
    ['MAP', 'COIN', 'JOKER', 'CHEST', 'JOKER'],
  ];

  const result = detectJokerBonusTrigger(openingGrid);

  assert.equal(result.triggered, true);
  assert.equal(result.reason, 'joker_count');
  assert.equal(result.initialJokerCount, 4);
  assert.equal(result.jokerCount, 4);
});

test('detectJokerCross upgrades to the power feature when five jokers are aligned on a payline', () => {
  const alignedGrid = [
    ['JOKER', 'COIN', 'MAP', 'BAT', 'PARROT'],
    ['JOKER', 'JOKER', 'JOKER', 'JOKER', 'JOKER'],
    ['MAP', 'COIN', 'JOKER', 'CHEST', 'JOKER'],
  ];

  assert.equal(detectJokerCross(alignedGrid), true);
});

test('detectJokerBonusTrigger does not open the bonus with only three jokers aligned', () => {
  const openingGrid = [
    ['JOKER', 'COIN', 'MAP', 'BAT', 'PARROT'],
    ['CHEST', 'JOKER', 'COIN', 'SOLDAT', 'BAT'],
    ['MAP', 'COIN', 'JOKER', 'CHEST', 'ELEPHANT'],
  ];

  const result = detectJokerBonusTrigger(openingGrid);

  assert.equal(result.triggered, false);
  assert.equal(result.reason, 'none');
});
