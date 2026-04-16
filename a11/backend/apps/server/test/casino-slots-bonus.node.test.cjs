const test = require('node:test');
const assert = require('node:assert/strict');

const createCasinoRouter = require('../src/routes/casino.cjs');

const { applyJokerBonus } = createCasinoRouter.__private;

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
