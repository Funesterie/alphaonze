const test = require('node:test');
const assert = require('node:assert/strict');

const {
  BLACKJACK_PLAYER_BETS,
  clampInteger,
} = require('../src/routes/casino-game-logic.cjs');

test('blackjack bet presets stay aligned with the client buttons', () => {
  assert.deepEqual(BLACKJACK_PLAYER_BETS, [20, 50, 100, 200]);
});

test('blackjack bet normalization keeps the minimum preset available', () => {
  const normalized = clampInteger(20, BLACKJACK_PLAYER_BETS[0], BLACKJACK_PLAYER_BETS[BLACKJACK_PLAYER_BETS.length - 1], BLACKJACK_PLAYER_BETS[0]);
  assert.equal(normalized, 20);
});
