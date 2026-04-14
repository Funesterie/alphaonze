const test = require('node:test');
const assert = require('node:assert/strict');

const {
  advanceExpiredPokerTurns,
  getSharedReadyTargetCount,
  syncBlackjackStateWithPresence,
  syncPokerStateWithPresence,
} = require('../src/routes/casino-shared-tables.cjs');

test('getSharedReadyTargetCount clamps the waiting target for shared tables', () => {
  assert.equal(getSharedReadyTargetCount(3, 2, 6, 2), 3);
  assert.equal(getSharedReadyTargetCount(1, 1, 6, 2), 2);
  assert.equal(getSharedReadyTargetCount(0, 2, 6, 2), 2);
  assert.equal(getSharedReadyTargetCount(4, 1, 3, 1), 3);
});

test('syncPokerStateWithPresence marks a disconnected acting seat absent but keeps the current timer running', () => {
  const now = new Date('2026-04-13T12:00:00.000Z');
  const afterDeadline = new Date('2026-04-13T12:01:05.000Z');
  const state = {
    kind: 'poker_table',
    roomId: 'allmight-ring',
    handId: 7,
    stage: 'turn',
    ante: 20,
    pendingSeats: [],
    seats: [
      {
        userId: 'cc',
        username: 'cc',
        cards: [],
        chips: 180,
        folded: false,
        isAllIn: false,
        actedThisStreet: false,
        totalCommitted: 20,
        streetCommitted: 0,
        lastAction: 'check',
        hand: null,
        isWinner: false,
        payoutAmount: 0,
        lastDelta: -20,
      },
      {
        userId: 'jj',
        username: 'jj',
        cards: [],
        chips: 180,
        folded: false,
        isAllIn: false,
        actedThisStreet: false,
        totalCommitted: 20,
        streetCommitted: 0,
        lastAction: 'check',
        hand: null,
        isWinner: false,
        payoutAmount: 0,
        lastDelta: -20,
      },
    ],
    communityCards: [],
    communityReserve: [],
    actingSeatIndex: 0,
    dealerSeatIndex: 0,
    pot: 40,
    currentBet: 0,
    minBet: 20,
    minRaiseTo: 20,
    bettingOpenedAt: null,
    bettingClosesAt: null,
    turnStartedAt: '2026-04-13T11:59:00.000Z',
    turnDeadlineAt: '2026-04-13T12:01:00.000Z',
    message: 'Tour en cours.',
    actionLog: [],
    updatedAt: '2026-04-13T11:59:00.000Z',
  };

  const synced = syncPokerStateWithPresence(state, ['jj'], now);
  assert.equal(synced.seats[0].isAbsent, true);
  assert.equal(synced.seats[0].absentAt, now.toISOString());
  assert.equal(synced.turnDeadlineAt, '2026-04-13T12:01:00.000Z');

  const advanced = advanceExpiredPokerTurns(synced, afterDeadline, {
    evaluateBestPokerHand: () => ({ label: 'High card', rank: [1] }),
    comparePokerScores: () => 0,
  });

  assert.equal(advanced.stage, 'showdown');
  assert.equal(advanced.seats[0].folded, true);
  assert.equal(advanced.seats[1].isWinner, true);
});

test('syncBlackjackStateWithPresence keeps the active timer when the acting player disappears', () => {
  const now = new Date('2026-04-13T12:00:00.000Z');
  const state = {
    kind: 'blackjack_table',
    roomId: 'lantern-quay',
    roundId: 4,
    stage: 'player-turn',
    pendingSeats: [],
    seats: [
      {
        userId: 'cc',
        username: 'cc',
        wager: 60,
        chips: 440,
        cards: [],
        hands: [],
      },
      {
        userId: 'jj',
        username: 'jj',
        wager: 60,
        chips: 440,
        cards: [],
        hands: [],
      },
    ],
    dealerCards: [],
    dealerHidden: true,
    activeSeatIndex: 0,
    bettingOpenedAt: null,
    bettingClosesAt: null,
    turnStartedAt: '2026-04-13T11:59:00.000Z',
    turnDeadlineAt: '2026-04-13T12:01:00.000Z',
    message: 'A toi de jouer.',
    updatedAt: '2026-04-13T11:59:00.000Z',
  };

  const synced = syncBlackjackStateWithPresence(state, ['jj'], now);
  assert.equal(synced.turnDeadlineAt, '2026-04-13T12:01:00.000Z');
});
