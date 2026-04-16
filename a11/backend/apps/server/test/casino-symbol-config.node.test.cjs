const test = require('node:test');
const assert = require('node:assert/strict');

const createCasinoRouter = require('../src/routes/casino.cjs');

const {
  buildSpinOutcome,
  evaluateSpinGrid,
  SYMBOLS,
} = createCasinoRouter.__private;

const EXPECTED_SYMBOL_TABLE = [
  { id: 'PIRATE', weight: 18, payouts: { 3: 12, 4: 28, 5: 75 } },
  { id: 'CHEST', weight: 15, payouts: { 3: 8, 4: 18, 5: 40 } },
  { id: 'COIN', weight: 22, payouts: { 3: 6, 4: 12, 5: 22 } },
  { id: 'BAT', weight: 14, payouts: { 3: 5, 4: 10, 5: 18 } },
  { id: 'BLUNDERBUSS', weight: 10, payouts: { 3: 7, 4: 14, 5: 26 } },
  { id: 'MAP', weight: 12, payouts: { 3: 9, 4: 18, 5: 34 } },
  { id: 'PARROT', weight: 5, payouts: { 3: 20, 4: 40, 5: 80 } },
  { id: 'SOLDAT', weight: 9, payouts: { 3: 12, 4: 26, 5: 60 } },
  { id: 'ELEPHANT', weight: 6, payouts: { 3: 15, 4: 34, 5: 90 } },
  { id: 'JOKER', weight: 6, payouts: { 3: 20, 4: 80, 5: 200 }, wild: true },
];

test('slot symbol table stays aligned with frontend weights and payouts', () => {
  const normalized = SYMBOLS.map((entry) => ({
    id: entry.id,
    weight: entry.weight,
    payouts: entry.payouts,
    ...(entry.wild ? { wild: true } : {}),
  }));

  assert.deepEqual(normalized, EXPECTED_SYMBOL_TABLE);
});

test('evaluateSpinGrid flags the parrot jackpot on a five-of-a-kind line', () => {
  const grid = [
    ['PARROT', 'PARROT', 'PARROT', 'PARROT', 'PARROT'],
    ['COIN', 'CHEST', 'MAP', 'BAT', 'SOLDAT'],
    ['MAP', 'COIN', 'ELEPHANT', 'CHEST', 'JOKER'],
  ];

  const result = evaluateSpinGrid(grid, 20);

  assert.equal(result.specialJackpot, true);
  assert.equal(result.totalPayout, 1600);
});

test('buildSpinOutcome keeps the jackpot flag when the opening grid is a full parrot line', () => {
  const result = buildSpinOutcome({
    bet: 100,
    randomInt: () => 91,
  });

  assert.equal(result.specialJackpot, true);
  assert.equal(result.bonus, null);
  assert.equal(result.wins.some((win) => win.symbol === 'PARROT' && win.matchCount === 5), true);
});
