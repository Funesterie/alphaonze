const test = require('node:test');
const assert = require('node:assert/strict');

const {
  advanceExpiredPokerTurns,
  getSharedReadyTargetCount,
  queueBlackjackPendingSeat,
  queuePokerPendingSeat,
  syncBlackjackStateWithPresence,
  syncPokerStateWithPresence,
} = require('../src/routes/casino-shared-tables.cjs');

test('getSharedReadyTargetCount clamps the waiting target for shared tables', () => {
  assert.equal(getSharedReadyTargetCount(3, 2, 6, 2), 3);
  assert.equal(getSharedReadyTargetCount(1, 1, 6, 2), 2);
  assert.equal(getSharedReadyTargetCount(0, 2, 6, 2), 2);
  assert.equal(getSharedReadyTargetCount(4, 1, 3, 1), 3);
});

test('queueBlackjackPendingSeat keeps an active round intact while reserving the next seat', () => {
  const now = new Date('2026-04-14T10:00:00.000Z');
  const state = {
    kind: 'blackjack_table',
    roomId: 'lantern-quay',
    roundId: 9,
    stage: 'player-turn',
    pendingSeats: [],
    seats: [{ userId: 'cc', username: 'cc', wager: 50, chips: 450, cards: [], hands: [] }],
    dealerCards: [],
    dealerHidden: true,
    activeSeatIndex: 0,
    turnDeadlineAt: '2026-04-14T10:01:00.000Z',
    updatedAt: '2026-04-14T09:59:00.000Z',
  };

  const queued = queueBlackjackPendingSeat(state, {
    roomId: 'lantern-quay',
    userId: 'jj',
    username: 'jj',
    wager: 20,
  }, now);

  assert.equal(queued.stage, 'player-turn');
  assert.equal(queued.seats.length, 1);
  assert.equal(queued.pendingSeats.length, 1);
  assert.equal(queued.pendingSeats[0].userId, 'jj');
  assert.equal(queued.turnDeadlineAt, '2026-04-14T10:01:00.000Z');
});

test('queuePokerPendingSeat keeps an active hand intact while reserving the next seat', () => {
  const now = new Date('2026-04-14T10:00:00.000Z');
  const state = {
    kind: 'poker_table',
    roomId: 'allmight-ring',
    handId: 4,
    stage: 'flop',
    ante: 60,
    pendingSeats: [],
    seats: [{ userId: 'cc', username: 'cc', cards: [], chips: 240, folded: false, isAllIn: false, actedThisStreet: false, totalCommitted: 60, streetCommitted: 0, lastAction: 'check', hand: null, isWinner: false, payoutAmount: 0, lastDelta: -60 }],
    communityCards: [],
    communityReserve: [],
    actingSeatIndex: 0,
    dealerSeatIndex: 0,
    pot: 60,
    currentBet: 0,
    minBet: 30,
    minRaiseTo: 30,
    turnDeadlineAt: '2026-04-14T10:01:00.000Z',
    updatedAt: '2026-04-14T09:59:00.000Z',
  };

  const queued = queuePokerPendingSeat(state, {
    roomId: 'allmight-ring',
    userId: 'jj',
    username: 'jj',
    ante: 60,
  }, now);

  assert.equal(queued.stage, 'flop');
  assert.equal(queued.seats.length, 1);
  assert.equal(queued.pendingSeats.length, 1);
  assert.equal(queued.pendingSeats[0].userId, 'jj');
  assert.equal(queued.ante, 60);
  assert.equal(queued.turnDeadlineAt, '2026-04-14T10:01:00.000Z');
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

test('syncPokerStateWithPresence keeps showdown cards visible during the reveal window while carrying all active seats forward', () => {
  const now = new Date('2026-04-14T10:00:05.000Z');
  const state = {
    kind: 'poker_table',
    roomId: 'allmight-ring',
    handId: 8,
    stage: 'showdown',
    revealStartedAt: '2026-04-14T10:00:00.000Z',
    ante: 60,
    pendingSeats: [],
    seats: [
      { userId: 'cc', username: 'cc', cards: [{ id: 'c1' }], chips: 300, folded: false, isAllIn: false, actedThisStreet: true, totalCommitted: 60, streetCommitted: 0, lastAction: 'check', hand: { label: 'Paire' }, isWinner: true, payoutAmount: 180, lastDelta: 120 },
      { userId: 'jj', username: 'jj', cards: [{ id: 'c2' }], chips: 120, folded: false, isAllIn: false, actedThisStreet: true, totalCommitted: 60, streetCommitted: 0, lastAction: 'call', hand: { label: 'Hauteur' }, isWinner: false, payoutAmount: 0, lastDelta: -60 },
      { userId: 'mm', username: 'mm', cards: [{ id: 'c3' }], chips: 120, folded: true, isAllIn: false, actedThisStreet: true, totalCommitted: 60, streetCommitted: 0, lastAction: 'fold', hand: null, isWinner: false, payoutAmount: 0, lastDelta: -60 },
    ],
    communityCards: [{ id: 'b1' }, { id: 'b2' }, { id: 'b3' }, { id: 'b4' }, { id: 'b5' }],
    communityReserve: [{ id: 'b1' }, { id: 'b2' }, { id: 'b3' }, { id: 'b4' }, { id: 'b5' }],
    actingSeatIndex: -1,
    dealerSeatIndex: 0,
    pot: 180,
    currentBet: 0,
    minBet: 30,
    minRaiseTo: 30,
    turnDeadlineAt: null,
    bettingClosesAt: null,
    updatedAt: '2026-04-14T10:00:00.000Z',
    message: 'Showdown',
    actionLog: [],
  };

  const synced = syncPokerStateWithPresence(state, ['cc', 'jj', 'mm'], now);
  assert.equal(synced.stage, 'showdown');
  assert.equal(synced.seats.length, 3);
  assert.equal(synced.pendingSeats.length, 3);
  assert.equal(synced.pendingSeats.map((seat) => seat.userId).join(','), 'cc,jj,mm');
  assert.equal(synced.bettingClosesAt, null);
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

test('syncBlackjackStateWithPresence keeps resolved seats visible during the reveal window', () => {
  const now = new Date('2026-04-14T10:00:05.000Z');
  const state = {
    kind: 'blackjack_table',
    roomId: 'lantern-quay',
    roundId: 11,
    stage: 'resolved',
    revealStartedAt: '2026-04-14T10:00:00.000Z',
    pendingSeats: [],
    seats: [
      {
        userId: 'cc',
        username: 'cc',
        wager: 50,
        chips: 550,
        cards: [{ id: 'a1' }, { id: 'a2' }],
        hands: [],
      },
    ],
    dealerCards: [{ id: 'd1' }, { id: 'd2' }],
    dealerHidden: false,
    activeSeatIndex: -1,
    bettingClosesAt: null,
    turnDeadlineAt: null,
    updatedAt: '2026-04-14T10:00:00.000Z',
    message: 'Resultat',
  };

  const synced = syncBlackjackStateWithPresence(state, ['cc'], now);
  assert.equal(synced.stage, 'resolved');
  assert.equal(synced.seats.length, 1);
  assert.equal(synced.seats[0].userId, 'cc');
  assert.equal(synced.bettingClosesAt, null);
});
