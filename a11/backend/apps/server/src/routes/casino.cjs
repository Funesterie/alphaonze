const express = require('express');
const crypto = require('node:crypto');
const { encodeRoundToken, decodeRoundToken, ROUND_TOKEN_SECRET_FALLBACK } = require('./casino-round-token.cjs');
const {
  MAP_ROOM_COST,
  MAP_REWARD,
  TREASURE_POINTS,
  HUNT_ROOM_COST,
  HUNT_SHOTS_PER_ROUND,
  BLACKJACK_PLAYER_BETS,
  POKER_ANTE_PRESETS,
  ROULETTE_MIN_BET,
  ROULETTE_MAX_BET,
  clampInteger,
  buildTreasureHuntBoard,
  getTreasurePrizeMeta,
  maskTreasureHuntBoard,
  createPirateDeck,
  drawCards,
  getBlackjackScore,
  getBlackjackPayout,
  completeDealerHand,
  completeAiBlackjackHand,
  buildBlackjackAiSeats,
  comparePokerScores,
  evaluateBestPokerHand,
  describeHoleCards,
  buildPokerSeats,
  getPokerStageLabel,
  getRouletteColor,
  normalizeRouletteBet,
  resolveRouletteBetPayout,
} = require('./casino-game-logic.cjs');
const {
  advanceExpiredBlackjackTurns,
  advanceExpiredPokerTurns,
  applyBlackjackAction: applySharedBlackjackAction,
  applyPokerAction: applySharedPokerAction,
  buildWaitingBlackjackState,
  buildWaitingPokerState,
  clearTableBettingWindow: clearSharedTableBettingWindow,
  ensureTableBettingWindow: ensureSharedTableBettingWindow,
  getPokerBlindUnit: getSharedPokerBlindUnit,
  getSharedReadyTargetCount,
  hasDeadlineElapsed: hasSharedTableDeadlineElapsed,
  isTableRevealWindowOpen,
  parseBlackjackToken,
  parsePokerToken,
  queueBlackjackPendingSeat,
  queuePokerPendingSeat,
  serializeBlackjackState: serializeSharedBlackjackState,
  serializePokerState: serializeSharedPokerState,
  startBlackjackRound: startSharedBlackjackRound,
  startPokerHand,
  syncBlackjackStateWithPresence,
  syncPokerStateWithPresence,
  upsertBlackjackPendingSeat,
  upsertPokerPendingSeat,
} = require('./casino-shared-tables.cjs');

const DEFAULT_STARTING_BALANCE = 5000;
const DEFAULT_DAILY_BONUS_AMOUNT = 1200;
const DEFAULT_DAILY_BONUS_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MIN_BET = 20;
const DEFAULT_MAX_BET = 500;
const DEFAULT_ACTIVE_LINES = 5;
const REEL_COUNT = 5;
const ROW_COUNT = 3;
const SLOT_GRID_SIZE = REEL_COUNT * ROW_COUNT;
const ROULETTE_ROOM_ID = 'ats-harbor';
const ROULETTE_ROUND_DURATION_MS = 120 * 1000;
const ROULETTE_RECENT_RESULTS_LIMIT = 8;
const ROULETTE_ARCHIVE_KEEP_RESOLVED_ROUNDS = 24;
const ROULETTE_STATE_CACHE_TTL_ACTIVE_MS = 2500;
const ROULETTE_STATE_CACHE_TTL_IDLE_MS = 8000;
const TABLE_ROOM_TTL_MS = 75 * 1000;
const TABLE_ROOM_TOUCH_INTERVAL_MS = 10 * 1000;
const TABLE_ROOM_PRUNE_INTERVAL_MS = 10 * 1000;
const LEGACY_TABLE_PRESENCE_CLIENT_ID = 'legacy';
const BLACKJACK_TABLE_MAX_PLAYERS = 3;
const BLACKJACK_ROOM_IDS = ['lantern-quay', 'bat-parlor', 'scream-lounge'];
const POKER_ROOM_IDS = ['allmight-ring', 'upstream-port', 'captains-table'];
const POKER_TABLE_MAX_PLAYERS = 6;
const JOKER_BONUS_RESPINS = 5;
const JOKER_BONUS_STAGE_HOLD_MS = 820;
const JOKER_BONUS_TRIGGER_COUNT = 4;
const POKER_ACTION_LOG_LIMIT = 8;

const tableRoomTouchCache = new Map();
const rouletteStateCache = new Map();
let nextTableRoomPruneAt = 0;

const SYMBOLS = [
  { id: 'PIRATE', label: 'Pavillon noir', weight: 18, payouts: { 3: 12, 4: 28, 5: 75 } },
  { id: 'CHEST', label: 'Coffre', weight: 15, payouts: { 3: 8, 4: 18, 5: 40 } },
  { id: 'COIN', label: 'Piastres', weight: 22, payouts: { 3: 6, 4: 12, 5: 22 } },
  { id: 'BAT', label: 'Chauve-souris', weight: 14, payouts: { 3: 5, 4: 10, 5: 18 } },
  { id: 'BLUNDERBUSS', label: 'Canon court', weight: 10, payouts: { 3: 7, 4: 14, 5: 26 } },
  { id: 'MAP', label: 'Carte au tresor', weight: 12, payouts: { 3: 9, 4: 18, 5: 34 } },
  { id: 'PARROT', label: 'Perroquet', weight: 5, payouts: { 3: 20, 4: 40, 5: 80 } },
  { id: 'SOLDAT', label: 'Spartiate', weight: 9, payouts: { 3: 12, 4: 26, 5: 60 } },
  { id: 'ELEPHANT', label: 'Elephant royal', weight: 6, payouts: { 3: 15, 4: 34, 5: 90 } },
  { id: 'JOKER', label: 'Joker royal', weight: 6, payouts: { 3: 20, 4: 80, 5: 200 }, wild: true },
];

const SYMBOL_INDEX = new Map(SYMBOLS.map((entry) => [entry.id, entry]));
const PAYLINES = [
  [0, 0, 0, 0, 0],
  [1, 1, 1, 1, 1],
  [2, 2, 2, 2, 2],
  [0, 1, 2, 1, 0],
  [2, 1, 0, 1, 2],
];

function cloneGrid(grid) {
  return Array.isArray(grid) ? grid.map((row) => (Array.isArray(row) ? row.slice() : [])) : [];
}

function toGridIndex(rowIndex, columnIndex) {
  return rowIndex * REEL_COUNT + columnIndex;
}

function listSymbolIndexes(grid, symbolId) {
  const indexes = [];
  grid.forEach((row, rowIndex) => {
    row.forEach((value, columnIndex) => {
      if (value === symbolId) {
        indexes.push(toGridIndex(rowIndex, columnIndex));
      }
    });
  });
  return indexes;
}

function setGridSymbolAtIndex(grid, index, symbolId) {
  const rowIndex = Math.floor(index / REEL_COUNT);
  const columnIndex = index % REEL_COUNT;
  if (!grid?.[rowIndex]) return;
  grid[rowIndex][columnIndex] = symbolId;
}

function shuffleIndexes(indexes, randomInt) {
  const shuffled = indexes.slice();
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1);
    const current = shuffled[index];
    shuffled[index] = shuffled[swapIndex];
    shuffled[swapIndex] = current;
  }
  return shuffled;
}

function listNonJokerIndexes(grid) {
  return Array.from({ length: SLOT_GRID_SIZE }, (_, index) => index).filter((index) => {
    const rowIndex = Math.floor(index / REEL_COUNT);
    const columnIndex = index % REEL_COUNT;
    return grid?.[rowIndex]?.[columnIndex] !== 'JOKER';
  });
}

function listJokerLineIndexes(grid, lineRows) {
  const indexes = [];
  lineRows.forEach((rowIndex, columnIndex) => {
    if (grid?.[rowIndex]?.[columnIndex] === 'JOKER') {
      indexes.push(toGridIndex(rowIndex, columnIndex));
    }
  });
  return indexes;
}

function detectJokerCross(grid) {
  return PAYLINES.some((lineRows) => listJokerLineIndexes(grid, lineRows).length >= REEL_COUNT);
}

function detectJokerBonusTrigger(grid) {
  const jokerIndexes = listSymbolIndexes(grid, 'JOKER');
  let bestLine = null;

  PAYLINES.forEach((lineRows, lineIndex) => {
    const indexes = listJokerLineIndexes(grid, lineRows);
    const jokerCount = indexes.length;
    if (jokerCount < JOKER_BONUS_TRIGGER_COUNT) return;
    if (!bestLine || jokerCount > bestLine.jokerCount) {
      bestLine = {
        lineIndex,
        jokerCount,
        indexes,
      };
    }
  });

  if (bestLine) {
    return {
      triggered: true,
      reason: 'joker_line',
      initialJokerCount: jokerIndexes.length,
      triggerIndexes: bestLine.indexes,
      lineIndex: bestLine.lineIndex,
      jokerCount: bestLine.jokerCount,
    };
  }

  if (jokerIndexes.length >= JOKER_BONUS_TRIGGER_COUNT) {
    return {
      triggered: true,
      reason: 'joker_count',
      initialJokerCount: jokerIndexes.length,
      triggerIndexes: jokerIndexes,
      lineIndex: null,
      jokerCount: jokerIndexes.length,
    };
  }

  return {
    triggered: false,
    reason: 'none',
    initialJokerCount: jokerIndexes.length,
    triggerIndexes: jokerIndexes,
    lineIndex: null,
    jokerCount: 0,
  };
}

function buildJokerConversionRatio(stageIndex, heldJokerCount) {
  const heldRatio = heldJokerCount / SLOT_GRID_SIZE;
  const stageMomentum = stageIndex / Math.max(1, JOKER_BONUS_RESPINS - 1);
  return Math.min(0.42, Number((0.08 + heldRatio * 0.14 + stageMomentum * 0.11).toFixed(4)));
}

function buildJokerStageConversionCap(stageIndex, heldJokerCount, availableCount) {
  const heldRatio = heldJokerCount / SLOT_GRID_SIZE;
  const stageMomentum = stageIndex / Math.max(1, JOKER_BONUS_RESPINS - 1);
  const softCap = 1 + Math.round(stageMomentum + heldRatio * 2.2);
  return Math.max(1, Math.min(availableCount, softCap));
}

function normalizeUserId(value) {
  return String(value || '').trim();
}

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeTablePresenceClientId(value) {
  const normalized = normalizeText(value).slice(0, 120);
  return normalized || LEGACY_TABLE_PRESENCE_CLIENT_ID;
}

function getTablePresenceClientIdFromRequest(req) {
  return normalizeTablePresenceClientId(req?.headers?.['x-casino-tab-id']);
}

function getTableRoomIds(game) {
  if (game === 'blackjack') return BLACKJACK_ROOM_IDS;
  if (game === 'poker') return POKER_ROOM_IDS;
  return [];
}

function normalizeTableRoomId(game, value) {
  const normalized = normalizeText(value).toLowerCase();
  const roomIds = getTableRoomIds(game);
  if (!roomIds.length) return null;
  return roomIds.includes(normalized) ? normalized : roomIds[0];
}

function createRandomInt(randomIntFn) {
  if (typeof randomIntFn === 'function') return randomIntFn;
  return (maxExclusive) => crypto.randomInt(0, Math.max(1, Number(maxExclusive) || 1));
}

function pickWeightedSymbol(randomInt) {
  const totalWeight = SYMBOLS.reduce((sum, entry) => sum + entry.weight, 0);
  let cursor = randomInt(totalWeight);
  for (const entry of SYMBOLS) {
    cursor -= entry.weight;
    if (cursor < 0) return entry.id;
  }
  return SYMBOLS[SYMBOLS.length - 1].id;
}

function generateGrid(randomInt) {
  return Array.from({ length: ROW_COUNT }, () =>
    Array.from({ length: REEL_COUNT }, () => pickWeightedSymbol(randomInt))
  );
}

function evaluateLineSymbols(symbols, lineBet) {
  const firstNonWild = symbols.find((symbolId) => symbolId !== 'JOKER');
  const targetId = firstNonWild || 'JOKER';
  const target = SYMBOL_INDEX.get(targetId) || SYMBOL_INDEX.get('COIN');
  let matchCount = 0;

  for (const symbolId of symbols) {
    if (symbolId === targetId || symbolId === 'JOKER' || targetId === 'JOKER') {
      matchCount += 1;
      continue;
    }
    break;
  }

  if (matchCount < 3) return null;

  const payoutMultiplier = Number(target?.payouts?.[matchCount] || 0);
  if (!payoutMultiplier) return null;

  return {
    symbol: targetId,
    label: target?.label || targetId,
    matchCount,
    payout: lineBet * payoutMultiplier,
  };
}

function applyJokerBonus({ grid, randomInt }) {
  let currentGrid = cloneGrid(grid);
  const stages = [];

  for (let stageIndex = 0; stageIndex < JOKER_BONUS_RESPINS; stageIndex += 1) {
    const heldIndexes = listSymbolIndexes(currentGrid, 'JOKER');
    const ratio = buildJokerConversionRatio(stageIndex, heldIndexes.length);
    const threshold = Math.max(1, Math.round(ratio * 10000));
    const nextGrid = cloneGrid(currentGrid);
    const nonJokerIndexes = shuffleIndexes(listNonJokerIndexes(currentGrid), randomInt);

    const stageConversionCap = buildJokerStageConversionCap(stageIndex, heldIndexes.length, nonJokerIndexes.length);
    let stageConversions = 0;

    nonJokerIndexes.forEach((index) => {
      if (stageConversions >= stageConversionCap) return;
      if (randomInt(10000) >= threshold) return;
      setGridSymbolAtIndex(nextGrid, index, 'JOKER');
      stageConversions += 1;
    });

    if (
      stageConversions === 0
      && nonJokerIndexes.length
      && stageIndex < JOKER_BONUS_RESPINS - 1
      && randomInt(10000) < Math.min(7500, threshold + 1800)
    ) {
      setGridSymbolAtIndex(nextGrid, nonJokerIndexes[0], 'JOKER');
    }

    currentGrid = nextGrid;
    const nextHeldIndexes = listSymbolIndexes(currentGrid, 'JOKER');
    stages.push({
      step: stageIndex + 1,
      ratio,
      heldIndexes: nextHeldIndexes,
      jokerCount: nextHeldIndexes.length,
      grid: cloneGrid(currentGrid),
    });

    if (nextHeldIndexes.length >= SLOT_GRID_SIZE) {
      break;
    }
  }

  const finalJokerCount = listSymbolIndexes(currentGrid, 'JOKER').length;
  const fullJoker = finalJokerCount >= SLOT_GRID_SIZE;
  const crossJoker = !fullJoker && detectJokerCross(currentGrid);
  const feature = fullJoker ? 'joker_full' : crossJoker ? 'joker_cross' : 'joker_line';

  return {
    stages,
    finalGrid: currentGrid,
    finalJokerCount,
    fullJoker,
    crossJoker,
    feature,
  };
}

function evaluateSpinGrid(grid, lineBet) {
  const wins = [];
  let totalPayout = 0;

  PAYLINES.forEach((lineRows, lineIndex) => {
    const lineSymbols = lineRows.map((rowIndex, columnIndex) => grid[rowIndex]?.[columnIndex] || 'COIN');
    const lineResult = evaluateLineSymbols(lineSymbols, lineBet);
    if (!lineResult) return;

    const indexes = lineRows
      .slice(0, lineResult.matchCount)
      .map((rowIndex, columnIndex) => rowIndex * REEL_COUNT + columnIndex);

    wins.push({
      lineIndex,
      symbol: lineResult.symbol,
      label: lineResult.label,
      matchCount: lineResult.matchCount,
      payout: lineResult.payout,
      indexes,
      lineRows,
    });
    totalPayout += lineResult.payout;
  });

  let specialJackpot = false;
  for (const win of wins) {
    if (win.symbol === 'PARROT' && win.matchCount === 5) {
      specialJackpot = true;
      break;
    }
  }

  return {
    wins,
    totalPayout,
    specialJackpot,
  };
}

function buildSpinOutcome({ bet, randomInt }) {
  const safeBet = clampInteger(bet, DEFAULT_MIN_BET, DEFAULT_MAX_BET, DEFAULT_MIN_BET);
  const lineBet = Math.max(1, Math.floor(safeBet / DEFAULT_ACTIVE_LINES));
  const openingGrid = generateGrid(randomInt);
  const openingEvaluation = evaluateSpinGrid(openingGrid, lineBet);
  const bonusTrigger = detectJokerBonusTrigger(openingGrid);
  let grid = openingGrid;
  let wins = openingEvaluation.wins;
  let totalPayout = openingEvaluation.totalPayout;
  let bonus = null;

  if (bonusTrigger.triggered) {
    const bonusResult = applyJokerBonus({ grid: openingGrid, randomInt });
    const bonusEvaluation = evaluateSpinGrid(bonusResult.finalGrid, lineBet);
    grid = bonusResult.finalGrid;
    wins = bonusEvaluation.wins;
    totalPayout = bonusEvaluation.totalPayout;
    bonus = {
      triggered: true,
      trigger: bonusTrigger.reason,
      triggerIndexes: bonusTrigger.triggerIndexes,
      initialJokerCount: bonusTrigger.initialJokerCount,
      openingGrid: cloneGrid(openingGrid),
      stages: bonusResult.stages,
      finalJokerCount: bonusResult.finalJokerCount,
      crossJoker: bonusResult.crossJoker,
      fullJoker: bonusResult.fullJoker,
      feature: bonusResult.feature,
      holdDurationMs: JOKER_BONUS_STAGE_HOLD_MS,
      stageDurationMs: JOKER_BONUS_STAGE_HOLD_MS,
    };
  }

  return {
    bet: safeBet,
    lineBet,
    reelCount: REEL_COUNT,
    rowCount: ROW_COUNT,
    activeLines: DEFAULT_ACTIVE_LINES,
    grid,
    wins,
    totalPayout,
    netChange: totalPayout - safeBet,
    bonus,
    specialJackpot,
    generatedAt: new Date().toISOString(),
  };
}

function toTransactionRecord(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    kind: String(row.kind || '').trim() || 'casino',
    amount: Number(row.amount || 0),
    balanceAfter: Number(row.balance_after || 0),
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    metadata: row.metadata && typeof row.metadata === 'object' ? row.metadata : null,
  };
}

function buildWalletPayload(row, options = {}) {
  const bonusAmount = Number(options.dailyBonusAmount || DEFAULT_DAILY_BONUS_AMOUNT);
  const cooldownMs = Number(options.dailyBonusCooldownMs || DEFAULT_DAILY_BONUS_COOLDOWN_MS);
  const lastDailyBonusAt = row?.last_daily_bonus_at ? new Date(row.last_daily_bonus_at).toISOString() : null;
  const nextDailyBonusAt = lastDailyBonusAt
    ? new Date(new Date(lastDailyBonusAt).getTime() + cooldownMs).toISOString()
    : null;
  const canClaimDailyBonus = !nextDailyBonusAt || Date.now() >= new Date(nextDailyBonusAt).getTime();

  return {
    balance: Number(row?.balance || 0),
    lifetimeWagered: Number(row?.lifetime_wagered || 0),
    lifetimeWon: Number(row?.lifetime_won || 0),
    gamesPlayed: Number(row?.games_played || 0),
    lastDailyBonusAt,
    nextDailyBonusAt,
    canClaimDailyBonus,
    dailyBonusAmount: bonusAmount,
    minBet: DEFAULT_MIN_BET,
    maxBet: DEFAULT_MAX_BET,
    activeLines: DEFAULT_ACTIVE_LINES,
  };
}

function createCasinoRouter({
  db,
  verifyJWT,
  startingBalance = DEFAULT_STARTING_BALANCE,
  dailyBonusAmount = DEFAULT_DAILY_BONUS_AMOUNT,
  dailyBonusCooldownMs = DEFAULT_DAILY_BONUS_COOLDOWN_MS,
  spinCasinoOutcome = null,
  randomInt = null,
  now = () => new Date(),
  logger = console,
  roundTokenSecret = process.env.CASINO_ROUND_TOKEN_SECRET || process.env.JWT_SECRET || ROUND_TOKEN_SECRET_FALLBACK,
} = {}) {
  const router = express.Router();
  const random = createRandomInt(randomInt);
  let ensureTablesPromise = null;

  async function ensureTables() {
    if (!db || typeof db.query !== 'function') return false;
    if (!ensureTablesPromise) {
      ensureTablesPromise = (async () => {
        await db.query(`
          CREATE TABLE IF NOT EXISTS casino_wallets (
            user_id TEXT PRIMARY KEY,
            balance INTEGER NOT NULL DEFAULT 0,
            lifetime_wagered INTEGER NOT NULL DEFAULT 0,
            lifetime_won INTEGER NOT NULL DEFAULT 0,
            games_played INTEGER NOT NULL DEFAULT 0,
            last_daily_bonus_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
          )
        `);
        await db.query(`
          CREATE TABLE IF NOT EXISTS casino_transactions (
            id SERIAL PRIMARY KEY,
            user_id TEXT NOT NULL,
            kind TEXT NOT NULL,
            amount INTEGER NOT NULL,
            balance_after INTEGER NOT NULL,
            metadata JSONB,
            created_at TIMESTAMP DEFAULT NOW()
          )
        `);
        await db.query(`
          CREATE TABLE IF NOT EXISTS casino_roulette_rounds (
            id SERIAL PRIMARY KEY,
            room_id TEXT NOT NULL,
            opens_at TIMESTAMP NOT NULL,
            closes_at TIMESTAMP NOT NULL,
            winning_number INTEGER,
            winning_color TEXT,
            resolved_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT NOW()
          )
        `);
        await db.query(`
          CREATE TABLE IF NOT EXISTS casino_roulette_bets (
            id SERIAL PRIMARY KEY,
            room_id TEXT NOT NULL,
            round_id INTEGER NOT NULL,
            user_id TEXT NOT NULL,
            bet_type TEXT NOT NULL,
            bet_value TEXT NOT NULL,
            amount INTEGER NOT NULL,
            payout INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMP DEFAULT NOW()
          )
        `);
        await db.query(`
          CREATE TABLE IF NOT EXISTS casino_table_room_presence (
            game TEXT NOT NULL,
            room_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            client_id TEXT NOT NULL DEFAULT '${LEGACY_TABLE_PRESENCE_CLIENT_ID}',
            updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
            created_at TIMESTAMP DEFAULT NOW(),
            PRIMARY KEY (game, room_id, user_id, client_id)
          )
        `);
        await db.query(
          `ALTER TABLE casino_table_room_presence ADD COLUMN IF NOT EXISTS client_id TEXT NOT NULL DEFAULT '${LEGACY_TABLE_PRESENCE_CLIENT_ID}'`
        );
        await db.query('ALTER TABLE casino_table_room_presence DROP CONSTRAINT IF EXISTS casino_table_room_presence_pkey');
        await db.query('ALTER TABLE casino_table_room_presence ADD PRIMARY KEY (game, room_id, user_id, client_id)');
        await db.query(`
          CREATE TABLE IF NOT EXISTS casino_blackjack_tables (
            room_id TEXT PRIMARY KEY,
            table_state JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
          )
        `);
        await db.query(`
          CREATE TABLE IF NOT EXISTS casino_poker_tables (
            room_id TEXT PRIMARY KEY,
            table_state JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
          )
        `);
        await db.query('CREATE INDEX IF NOT EXISTS idx_casino_transactions_user_created ON casino_transactions (user_id, created_at DESC)');
        await db.query('CREATE INDEX IF NOT EXISTS idx_casino_roulette_rounds_room_created ON casino_roulette_rounds (room_id, created_at DESC)');
        await db.query('CREATE INDEX IF NOT EXISTS idx_casino_roulette_bets_round_created ON casino_roulette_bets (round_id, created_at ASC)');
        await db.query('CREATE INDEX IF NOT EXISTS idx_casino_table_room_presence_game_room_updated ON casino_table_room_presence (game, room_id, updated_at DESC)');
        await db.query('CREATE INDEX IF NOT EXISTS idx_casino_table_room_presence_game_room_user_updated ON casino_table_room_presence (game, room_id, user_id, updated_at DESC)');
        await db.query('CREATE INDEX IF NOT EXISTS idx_casino_table_room_presence_user_client_updated ON casino_table_room_presence (user_id, client_id, updated_at DESC)');
        await db.query('CREATE INDEX IF NOT EXISTS idx_casino_blackjack_tables_updated ON casino_blackjack_tables (updated_at DESC)');
        await db.query('CREATE INDEX IF NOT EXISTS idx_casino_poker_tables_updated ON casino_poker_tables (updated_at DESC)');
      })().catch((error_) => {
        ensureTablesPromise = null;
        throw error_;
      });
    }
    await ensureTablesPromise;
    return true;
  }

  async function getUserRow(userId) {
    const { rows } = await db.query(
      'SELECT id, username, email FROM users WHERE id::text = $1 LIMIT 1',
      [userId]
    );
    return rows[0] || null;
  }

  async function ensureWalletRow(userId, client = db) {
    await ensureTables();
    await client.query(
      `
        INSERT INTO casino_wallets (user_id, balance)
        VALUES ($1, $2)
        ON CONFLICT (user_id) DO NOTHING
      `,
      [userId, startingBalance]
    );
  }

  async function getWalletRow(userId, client = db, lock = false) {
    await ensureWalletRow(userId, client);
    const suffix = lock ? ' FOR UPDATE' : '';
    const { rows } = await client.query(
      `SELECT * FROM casino_wallets WHERE user_id = $1 LIMIT 1${suffix}`,
      [userId]
    );
    return rows[0] || null;
  }

  async function getRecentTransactions(userId, limit = 12) {
    const { rows } = await db.query(
      'SELECT id, kind, amount, balance_after, metadata, created_at FROM casino_transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2',
      [userId, clampInteger(limit, 1, 50, 12)]
    );
    return rows.map(toTransactionRecord).filter(Boolean);
  }

  async function getUsersByIds(userIds = [], client = db) {
    const normalizedIds = [...new Set(
      (Array.isArray(userIds) ? userIds : [userIds])
        .map((entry) => normalizeUserId(entry))
        .filter(Boolean)
    )];
    if (!normalizedIds.length) return new Map();

    const { rows } = await client.query(
      'SELECT id::text AS id, username, email FROM users WHERE id::text = ANY($1::text[])',
      [normalizedIds]
    );

    return new Map(rows.map((row) => [
      String(row.id || '').trim(),
      {
        id: String(row.id || '').trim(),
        username: String(row.username || '').trim(),
        email: String(row.email || '').trim() || null,
      },
    ]));
  }

  async function loadProfile(userId) {
    const user = await getUserRow(userId);
    if (!user) return null;
    const walletRow = await getWalletRow(userId);
    return {
      ok: true,
      user: {
        id: String(user.id),
        username: String(user.username || '').trim(),
        email: String(user.email || '').trim() || null,
      },
      wallet: buildWalletPayload(walletRow, { dailyBonusAmount, dailyBonusCooldownMs }),
      recentTransactions: await getRecentTransactions(userId),
    };
  }

  async function appendTransaction(client, { userId, kind, amount, balanceAfter, metadata = null }) {
    await client.query(
      'INSERT INTO casino_transactions (user_id, kind, amount, balance_after, metadata) VALUES ($1, $2, $3, $4, $5::jsonb)',
      [userId, kind, amount, balanceAfter, metadata ? JSON.stringify(metadata) : null]
    );
  }

  async function applyWalletDeltas(client, userId, { balance, lifetimeWagered = 0, lifetimeWon = 0, gamesPlayed = 0 }) {
    await client.query(
      `
        UPDATE casino_wallets
        SET balance = $2,
            lifetime_wagered = COALESCE(lifetime_wagered, 0) + $3,
            lifetime_won = COALESCE(lifetime_won, 0) + $4,
            games_played = COALESCE(games_played, 0) + $5,
            updated_at = NOW()
        WHERE user_id = $1
      `,
      [userId, balance, lifetimeWagered, lifetimeWon, gamesPlayed]
    );
  }

  function getTableRoomTouchKey(game, roomId, userId, clientId = LEGACY_TABLE_PRESENCE_CLIENT_ID) {
    return `${String(game || '').trim()}::${String(roomId || '').trim()}::${normalizeUserId(userId)}::${normalizeTablePresenceClientId(clientId)}`;
  }

  function shouldTouchTableRoomPresence(game, roomId, userId, clientId = LEGACY_TABLE_PRESENCE_CLIENT_ID, minIntervalMs = TABLE_ROOM_TOUCH_INTERVAL_MS) {
    const key = getTableRoomTouchKey(game, roomId, userId, clientId);
    const currentTimeMs = now().getTime();
    const lastTouchedAt = Number(tableRoomTouchCache.get(key) || 0);
    if ((currentTimeMs - lastTouchedAt) < Math.max(1000, Number(minIntervalMs) || TABLE_ROOM_TOUCH_INTERVAL_MS)) {
      return false;
    }
    tableRoomTouchCache.set(key, currentTimeMs);
    return true;
  }

  function getRouletteStateCacheKey(userId = '', variant = 'default') {
    const normalizedUserId = normalizeUserId(userId);
    const normalizedVariant = String(variant || 'default').trim().toLowerCase() || 'default';
    return normalizedUserId ? `${normalizedUserId}::${normalizedVariant}` : '';
  }

  function clearRouletteStateCache(userId = '') {
    const normalizedUserId = normalizeUserId(userId);
    if (!normalizedUserId) {
      rouletteStateCache.clear();
      return;
    }
    for (const key of [...rouletteStateCache.keys()]) {
      if (String(key || '').startsWith(`${normalizedUserId}::`)) {
        rouletteStateCache.delete(key);
      }
    }
  }

  function getRouletteStateCacheEntry(userId = '', variant = 'default') {
    const cacheKey = getRouletteStateCacheKey(userId, variant);
    if (!cacheKey) return null;
    const entry = rouletteStateCache.get(cacheKey);
    if (!entry) return null;
    if (Number(entry.expiresAt || 0) <= now().getTime()) {
      rouletteStateCache.delete(cacheKey);
      return null;
    }
    return entry;
  }

  function setRouletteStateCacheEntry(userId = '', payload = null, variant = 'default') {
    const cacheKey = getRouletteStateCacheKey(userId, variant);
    if (!cacheKey || !payload || typeof payload !== 'object') return;
    const remainingMs = Math.max(0, Number(payload?.room?.round?.remainingMs || 0));
    const roomActive = Boolean(payload?.room?.roomActive);
    const baseTtlMs = roomActive ? ROULETTE_STATE_CACHE_TTL_ACTIVE_MS : ROULETTE_STATE_CACHE_TTL_IDLE_MS;
    const ttlMs = remainingMs > 0
      ? Math.max(800, Math.min(baseTtlMs, remainingMs))
      : baseTtlMs;
    rouletteStateCache.set(cacheKey, {
      payload,
      expiresAt: now().getTime() + ttlMs,
    });
  }

  async function pruneTableRoomPresence(client) {
    const currentTimeMs = now().getTime();
    if (currentTimeMs < nextTableRoomPruneAt) return;
    nextTableRoomPruneAt = currentTimeMs + TABLE_ROOM_PRUNE_INTERVAL_MS;
    const thresholdIso = new Date(now().getTime() - TABLE_ROOM_TTL_MS).toISOString();
    await client.query(
      'DELETE FROM casino_table_room_presence WHERE updated_at < $1',
      [thresholdIso]
    );
  }

  function collapseTableRoomPresenceRows(rows = []) {
    const latestByRoomUser = new Map();
    for (const row of rows || []) {
      const roomId = String(row?.room_id || '');
      const userId = String(row?.user_id || '');
      if (!roomId || !userId) continue;
      const dedupeKey = `${roomId}::${userId}`;
      const updatedAtMs = row?.updated_at ? new Date(row.updatedAt).getTime() : 0;
      const previous = latestByRoomUser.get(dedupeKey);
      const previousUpdatedAtMs = previous?.updated_at ? new Date(previous.updated_at).getTime() : 0;
      if (!previous || updatedAtMs >= previousUpdatedAtMs) {
        latestByRoomUser.set(dedupeKey, row);
      }
    }
    return [...latestByRoomUser.values()];
  }

  async function clearOtherTableRoomPresenceForClient(client, userId, clientId, currentGame = null, currentRoomId = null) {
    const normalizedUserId = normalizeUserId(userId);
    const normalizedClientId = normalizeTablePresenceClientId(clientId);
    if (!normalizedUserId || !normalizedClientId) return;

    if (currentGame && currentRoomId) {
      await client.query(
        `
          DELETE FROM casino_table_room_presence
          WHERE user_id = $1
            AND client_id = $2
            AND NOT (game = $3 AND room_id = $4)
        `,
        [normalizedUserId, normalizedClientId, String(currentGame || ''), String(currentRoomId || '')]
      );
      return;
    }

    await client.query(
      'DELETE FROM casino_table_room_presence WHERE user_id = $1 AND client_id = $2',
      [normalizedUserId, normalizedClientId]
    );
  }

  async function touchTableRoomPresence(client, game, roomId, userId, clientId = LEGACY_TABLE_PRESENCE_CLIENT_ID) {
    const updatedAtIso = now().toISOString();
    const normalizedClientId = normalizeTablePresenceClientId(clientId);
    await clearOtherTableRoomPresenceForClient(client, userId, normalizedClientId, game, roomId);
    await client.query(
      `
        INSERT INTO casino_table_room_presence (game, room_id, user_id, client_id, updated_at)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (game, room_id, user_id, client_id)
        DO UPDATE SET updated_at = EXCLUDED.updated_at
      `,
      [game, roomId, userId, normalizedClientId, updatedAtIso]
    );
  }

  async function removeTableRoomPresence(client, game, roomId, userId, clientId = null) {
    if (clientId) {
      await client.query(
        'DELETE FROM casino_table_room_presence WHERE game = $1 AND room_id = $2 AND user_id = $3 AND client_id = $4',
        [game, roomId, userId, normalizeTablePresenceClientId(clientId)]
      );
      return;
    }

    await client.query(
      'DELETE FROM casino_table_room_presence WHERE game = $1 AND room_id = $2 AND user_id = $3',
      [game, roomId, userId]
    );
  }

  async function buildTableRoomPayload(client, game, currentUserId, currentRoomId = null) {
    const roomIds = getTableRoomIds(game);
    const effectiveRoomId = normalizeTableRoomId(game, currentRoomId);
    const thresholdIso = new Date(now().getTime() - TABLE_ROOM_TTL_MS).toISOString();
    const queryResult = await client.query(
      `
        SELECT room_id, user_id, client_id, updated_at
        FROM casino_table_room_presence
        WHERE game = $1 AND updated_at >= $2
        ORDER BY updated_at DESC
      `,
      [game, thresholdIso]
    );
    const rows = collapseTableRoomPresenceRows(queryResult.rows || []);
    const usersById = await getUsersByIds(rows.map((entry) => entry.user_id), client);

    const rooms = [];
    for (const roomId of roomIds) {
      const roomRows = rows.filter((entry) => String(entry.room_id || '') === roomId);
      const participants = [];
      for (const row of roomRows.slice(0, 8)) {
        const user = usersById.get(String(row.user_id || '')) || null;
        participants.push({
          userId: String(row.user_id || ''),
          username: user?.username ? String(user.username) : `Joueur ${row.user_id}`,
          updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
        });
      }

      rooms.push({
        id: roomId,
        playerCount: roomRows.length,
        participants,
        isCurrent: roomId === effectiveRoomId,
        hasSelf: roomRows.some((row) => String(row.user_id || '') === currentUserId),
      });
    }

    return {
      game,
      joinedRoomId: effectiveRoomId,
      rooms,
    };
  }

  async function listActiveRoomPresence(client, game, roomId) {
    const thresholdIso = new Date(now().getTime() - TABLE_ROOM_TTL_MS).toISOString();
    const queryResult = await client.query(
      `
        SELECT room_id, user_id, client_id, updated_at
        FROM casino_table_room_presence
        WHERE game = $1 AND room_id = $2 AND updated_at >= $3
        ORDER BY updated_at ASC
      `,
        [game, roomId, thresholdIso]
      );
    const rows = collapseTableRoomPresenceRows(queryResult.rows || []);
    const usersById = await getUsersByIds(rows.map((entry) => entry.user_id), client);
    const participants = rows.map((row) => {
      const userId = String(row.user_id || '');
      const user = usersById.get(userId) || null;
      return {
        userId,
        username: user?.username ? String(user.username) : `Joueur ${userId}`,
        updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
      };
    });
    return participants;
  }

  async function getSharedTableStateRow(client, tableName, roomId, fallbackState, lock = false) {
    const suffix = lock ? ' FOR UPDATE' : '';
    const { rows } = await client.query(
      `SELECT room_id, table_state, updated_at FROM ${tableName} WHERE room_id = $1${suffix}`,
      [roomId]
    );
    if (rows[0]) {
      return rows[0];
    }
    const inserted = await client.query(
      `
        INSERT INTO ${tableName} (room_id, table_state)
        VALUES ($1, $2::jsonb)
        ON CONFLICT (room_id) DO NOTHING
        RETURNING room_id, table_state, updated_at
      `,
      [roomId, JSON.stringify(fallbackState)]
    );
    if (inserted.rows[0]) return inserted.rows[0];
    const retry = await client.query(
      `SELECT room_id, table_state, updated_at FROM ${tableName} WHERE room_id = $1${suffix}`,
      [roomId]
    );
    return retry.rows[0] || { room_id: roomId, table_state: fallbackState, updated_at: null };
  }

  async function saveSharedTableState(client, tableName, roomId, nextState) {
    await client.query(
      `
        INSERT INTO ${tableName} (room_id, table_state, updated_at)
        VALUES ($1, $2::jsonb, NOW())
        ON CONFLICT (room_id)
        DO UPDATE SET
          table_state = EXCLUDED.table_state,
          updated_at = NOW()
      `,
      [roomId, JSON.stringify(nextState)]
    );
  }

  async function loadBlackjackTableState(client, roomId, lock = false) {
    const fallback = buildWaitingBlackjackState(roomId);
    const row = await getSharedTableStateRow(client, 'casino_blackjack_tables', roomId, fallback, lock);
    return row?.table_state && typeof row.table_state === 'object' ? row.table_state : fallback;
  }

  async function loadPokerTableState(client, roomId, lock = false) {
    const fallback = buildWaitingPokerState(roomId);
    const row = await getSharedTableStateRow(client, 'casino_poker_tables', roomId, fallback, lock);
    return row?.table_state && typeof row.table_state === 'object' ? row.table_state : fallback;
  }

  async function createRouletteRound(client, roomId, openedAt) {
    const opensAtIso = new Date(openedAt).toISOString();
    const closesAtIso = new Date(new Date(openedAt).getTime() + ROULETTE_ROUND_DURATION_MS).toISOString();
    const { rows } = await client.query(
      `
        INSERT INTO casino_roulette_rounds (room_id, opens_at, closes_at)
        VALUES ($1, $2, $3)
        RETURNING *
      `,
      [roomId, opensAtIso, closesAtIso]
    );
    return rows[0] || null;
  }

  async function getLatestRouletteRound(client, roomId, lock = false) {
    const suffix = lock ? ' FOR UPDATE' : '';
    const { rows } = await client.query(
      `SELECT * FROM casino_roulette_rounds WHERE room_id = $1 ORDER BY id DESC LIMIT 1${suffix}`,
      [roomId]
    );
    return rows[0] || null;
  }

  async function getRouletteBetsForRound(client, roundId) {
    const { rows } = await client.query(
      'SELECT * FROM casino_roulette_bets WHERE round_id = $1 ORDER BY created_at ASC',
      [roundId]
    );
    return rows;
  }

  async function pruneRouletteArchive(client, roomId = ROULETTE_ROOM_ID, keepResolvedRounds = ROULETTE_ARCHIVE_KEEP_RESOLVED_ROUNDS) {
    const normalizedKeep = Math.max(8, Number(keepResolvedRounds) || ROULETTE_ARCHIVE_KEEP_RESOLVED_ROUNDS);
    await client.query(
      `
        DELETE FROM casino_roulette_bets
        WHERE round_id IN (
          SELECT id
          FROM casino_roulette_rounds
          WHERE room_id = $1
            AND resolved_at IS NOT NULL
          ORDER BY id DESC
          OFFSET $2
        )
      `,
      [roomId, normalizedKeep]
    );
    await client.query(
      `
        DELETE FROM casino_roulette_rounds
        WHERE id IN (
          SELECT id
          FROM casino_roulette_rounds
          WHERE room_id = $1
            AND resolved_at IS NOT NULL
          ORDER BY id DESC
          OFFSET $2
        )
      `,
      [roomId, normalizedKeep]
    );
  }

  async function getRouletteActiveParticipants(client) {
    return listActiveRoomPresence(client, 'roulette', ROULETTE_ROOM_ID);
  }

  function resolveUserId(req) {
    return normalizeUserId(req?.user?.id || req?.user?.sub || '');
  }

  function isCompactRouletteView(req) {
    const raw = String(req?.query?.view || req?.body?.view || '').trim().toLowerCase();
    return raw === 'compact';
  }

  function shouldIncludeRouletteProfile(req, defaultValue = true) {
    const raw = String(req?.query?.includeProfile || req?.body?.includeProfile || '').trim().toLowerCase();
    if (!raw) return defaultValue;
    return ['1', 'true', 'yes', 'on'].includes(raw);
  }

  async function requireCasinoUser(req, res) {
    if (!db || typeof db.query !== 'function') {
      res.status(503).json({ ok: false, error: 'database_unavailable' });
      return null;
    }

    const userId = resolveUserId(req);
    if (!userId) {
      res.status(401).json({ ok: false, error: 'missing_user' });
      return null;
    }

    await ensureTables();
    const user = await getUserRow(userId);
    if (!user) {
      res.status(404).json({ ok: false, error: 'user_not_found' });
      return null;
    }

    return { userId, user };
  }

  async function resolveRouletteRound(client, round) {
    const winningNumber = random(37);
    const winningColor = getRouletteColor(winningNumber);
    const resolvedAtIso = now().toISOString();
    const bets = await getRouletteBetsForRound(client, round.id);
    const payoutsByUser = new Map();

    for (const bet of bets) {
      const payout = resolveRouletteBetPayout({
        betType: bet.bet_type,
        betValue: bet.bet_value,
        amount: bet.amount,
        winningNumber,
        winningColor,
      });
      await client.query('UPDATE casino_roulette_bets SET payout = $2 WHERE id = $1', [bet.id, payout]);

      const userId = String(bet.user_id || '');
      const current = payoutsByUser.get(userId) || { payout: 0, bets: [] };
      current.payout += payout;
      current.bets.push({
        id: Number(bet.id),
        betType: String(bet.bet_type || ''),
        betValue: String(bet.bet_value || ''),
        amount: Number(bet.amount || 0),
        payout,
      });
      payoutsByUser.set(userId, current);
    }

    await client.query(
      `
        UPDATE casino_roulette_rounds
        SET winning_number = $2,
            winning_color = $3,
            resolved_at = $4
        WHERE id = $1
      `,
      [round.id, winningNumber, winningColor, resolvedAtIso]
    );

    for (const [userId, entry] of payoutsByUser.entries()) {
      const walletRow = await getWalletRow(userId, client, true);
      const currentBalance = Number(walletRow?.balance || 0);
      const nextBalance = currentBalance + Number(entry.payout || 0);
      await applyWalletDeltas(client, userId, {
        balance: nextBalance,
        lifetimeWon: Number(entry.payout || 0),
        gamesPlayed: 1,
      });

      if (entry.payout > 0) {
        await appendTransaction(client, {
          userId,
          kind: 'roulette_payout',
          amount: Number(entry.payout || 0),
          balanceAfter: nextBalance,
          metadata: {
            roomId: round.room_id,
            roundId: Number(round.id),
            winningNumber,
            winningColor,
            payout: Number(entry.payout || 0),
          },
        });
      }
    }

    await pruneRouletteArchive(client, String(round.room_id || ROULETTE_ROOM_ID));
    clearRouletteStateCache();

    return {
      ...round,
      winning_number: winningNumber,
      winning_color: winningColor,
      resolved_at: resolvedAtIso,
    };
  }

  async function ensureCurrentRouletteRound(client, roomId = ROULETTE_ROOM_ID, options = {}) {
    const activateRound = options?.activateRound === true;
    let latest = await getLatestRouletteRound(client, roomId, true);
    const currentTime = now();

    if (!latest) {
      if (!activateRound) {
        return {
          currentRound: null,
          latestResolved: null,
          activeParticipants: [],
          roomActive: false,
        };
      }
      return {
        currentRound: await createRouletteRound(client, roomId, currentTime),
        latestResolved: null,
        activeParticipants: [],
        roomActive: true,
      };
    }

    let latestResolved = latest?.resolved_at ? latest : null;
    const closesAtMs = latest?.closes_at ? new Date(latest.closes_at).getTime() : 0;
    const latestBets = !latest?.resolved_at ? await getRouletteBetsForRound(client, latest.id) : [];

    if (!latest.resolved_at && closesAtMs && currentTime.getTime() >= closesAtMs) {
      latestResolved = await resolveRouletteRound(client, latest);
      latest = activateRound ? await createRouletteRound(client, roomId, currentTime) : null;
      return {
        currentRound: latest,
        latestResolved,
        activeParticipants: [],
        roomActive: Boolean(latest),
      };
    }

    if (latest.resolved_at) {
      if (!activateRound) {
        return {
          currentRound: null,
          latestResolved,
          activeParticipants: [],
          roomActive: false,
        };
      }
      latest = await createRouletteRound(client, roomId, currentTime);
      return {
        currentRound: latest,
        latestResolved,
        activeParticipants: [],
        roomActive: true,
      };
    }

    return {
      currentRound: latest,
      latestResolved,
      activeParticipants: [],
      roomActive: latestBets.length > 0,
    };
  }

  async function buildRouletteRoomPayload(client, userId, options = {}) {
    const compact = options?.compact === true;
    const { currentRound, latestResolved, activeParticipants, roomActive } = await ensureCurrentRouletteRound(client, ROULETTE_ROOM_ID);
    const currentBets = currentRound?.id ? await getRouletteBetsForRound(client, currentRound.id) : [];
    const recentResultRows = (await client.query(
      'SELECT id, winning_number, winning_color, resolved_at FROM casino_roulette_rounds WHERE room_id = $1 AND resolved_at IS NOT NULL ORDER BY id DESC LIMIT $2',
      [ROULETTE_ROOM_ID, ROULETTE_RECENT_RESULTS_LIMIT]
    )).rows;
    const participantUsersById = await getUsersByIds(
      currentBets.map((bet) => bet.user_id),
      client
    );

    const participantTotals = new Map();
    currentBets.forEach((bet) => {
      const key = String(bet.user_id || '');
      const participant = participantTotals.get(key) || { userId: key, totalAmount: 0, betCount: 0 };
      participant.totalAmount += Number(bet.amount || 0);
      participant.betCount += 1;
      participantTotals.set(key, participant);
    });

    const participants = [];
    for (const entry of [...participantTotals.values()]
      .sort((left, right) => right.totalAmount - left.totalAmount || left.userId.localeCompare(right.userId))
      .slice(0, 6)) {
      const user = participantUsersById.get(entry.userId) || null;
      participants.push({
        userId: entry.userId,
        username: user?.username ? String(user.username) : `Joueur ${entry.userId}`,
        totalAmount: entry.totalAmount,
        betCount: entry.betCount,
      });
    }

    const participantNameMap = new Map();
    activeParticipants.forEach((entry) => {
      participantNameMap.set(entry.userId, entry.username);
    });
    participants.forEach((entry) => {
      participantNameMap.set(entry.userId, entry.username);
    });

    const visibleBetsBySpotMap = new Map();
    const visibleBetsByPlayerMap = new Map();
    currentBets.forEach((bet) => {
      const betType = String(bet.bet_type || '');
      const betValue = String(bet.bet_value || '');
      const playerId = String(bet.user_id || '');
      const displayName = participantNameMap.get(playerId) || `Joueur ${playerId}`;
      const spotKey = `${betType}::${betValue}`;
      const spotEntry = visibleBetsBySpotMap.get(spotKey) || {
        betType,
        betValue,
        totalAmount: 0,
        playerCount: 0,
        players: [],
      };
      const playerEntry = visibleBetsByPlayerMap.get(playerId) || {
        playerId,
        displayName,
        totalAmount: 0,
        bets: [],
      };

      spotEntry.totalAmount += Number(bet.amount || 0);
      playerEntry.totalAmount += Number(bet.amount || 0);

      const spotPlayer = spotEntry.players.find((entry) => entry.playerId === playerId);
      if (spotPlayer) {
        spotPlayer.amount += Number(bet.amount || 0);
      } else {
        spotEntry.players.push({
          playerId,
          displayName,
          amount: Number(bet.amount || 0),
        });
      }
      spotEntry.playerCount = spotEntry.players.length;

      const playerBet = playerEntry.bets.find((entry) => entry.betType === betType && entry.betValue === betValue);
      if (playerBet) {
        playerBet.amount += Number(bet.amount || 0);
      } else {
        playerEntry.bets.push({
          betType,
          betValue,
          amount: Number(bet.amount || 0),
        });
      }

      visibleBetsBySpotMap.set(spotKey, spotEntry);
      visibleBetsByPlayerMap.set(playerId, playerEntry);
    });

    return {
      id: ROULETTE_ROOM_ID,
      roomActive,
      nextClosesAt: currentRound?.closes_at ? new Date(currentRound.closes_at).toISOString() : null,
      round: {
        id: Number(currentRound?.id || 0),
        opensAt: currentRound?.opens_at ? new Date(currentRound.opens_at).toISOString() : null,
        closesAt: currentRound?.closes_at ? new Date(currentRound.closes_at).toISOString() : null,
        remainingMs: currentRound?.closes_at ? Math.max(0, new Date(currentRound.closes_at).getTime() - now().getTime()) : 0,
        totalPot: currentBets.reduce((sum, entry) => sum + Number(entry.amount || 0), 0),
        playerCount: participantTotals.size,
        participants,
        myBets: currentBets
          .filter((bet) => String(bet.user_id || '') === userId)
          .map((bet) => ({
            id: Number(bet.id),
            betType: String(bet.bet_type || ''),
            betValue: String(bet.bet_value || ''),
            amount: Number(bet.amount || 0),
            payout: Number(bet.payout || 0),
            createdAt: bet.created_at ? new Date(bet.created_at).toISOString() : null,
          })),
        ...(compact ? {} : {
          activeParticipants,
          visibleBetsBySpot: [...visibleBetsBySpotMap.values()],
          visibleBetsByPlayer: [...visibleBetsByPlayerMap.values()],
        }),
      },
      latestResolved: latestResolved?.resolved_at
        ? {
          id: Number(latestResolved.id),
          winningNumber: Number(latestResolved.winning_number),
          winningColor: String(latestResolved.winning_color || getRouletteColor(Number(latestResolved.winning_number || 0))),
          resolvedAt: latestResolved.resolved_at ? new Date(latestResolved.resolved_at).toISOString() : null,
        }
        : null,
      recentResults: recentResultRows.map((row) => ({
        id: Number(row.id),
        winningNumber: Number(row.winning_number || 0),
        winningColor: String(row.winning_color || getRouletteColor(Number(row.winning_number || 0))),
        resolvedAt: row.resolved_at ? new Date(row.resolved_at).toISOString() : null,
      })),
    };
  }

  function settleBlackjackState(state) {
    const dealerFinal = completeDealerHand(state.deck, state.dealerCards);
    const aiFinal = state.aiSeats.reduce(
      (accumulator, seat) => {
        const completed = completeAiBlackjackHand(accumulator.deck, seat);
        return {
          deck: completed.deck,
          seats: [...accumulator.seats, completed.seat],
        };
      },
      { deck: dealerFinal.deck, seats: [] }
    );

    const playerOutcome = getBlackjackPayout(state.playerCards, dealerFinal.cards, state.wager);
    return {
      ...state,
      deck: aiFinal.deck,
      aiSeats: aiFinal.seats.map((seat) => {
        const payout = getBlackjackPayout(seat.cards, dealerFinal.cards, seat.wager);
        return {
          ...seat,
          chips: seat.chips + payout.amount,
          result: payout.label,
          mood: payout.amount > seat.wager ? 'empoche le pot' : payout.amount === seat.wager ? 'annule la manche' : 'encaisse le choc',
        };
      }),
      dealerCards: dealerFinal.cards,
      dealerHidden: false,
      stage: 'resolved',
      payoutAmount: playerOutcome.amount,
      lastDelta: playerOutcome.amount - state.wager,
      message: `${playerOutcome.label}. Ta main finit a ${getBlackjackScore(state.playerCards).total}, le croupier a ${getBlackjackScore(dealerFinal.cards).total}.`,
    };
  }

  function serializeBlackjackState(state) {
    return {
      token: state.stage !== 'resolved' ? encodeRoundToken(state, roundTokenSecret) : null,
      roomId: normalizeTableRoomId('blackjack', state.roomId),
      stage: state.stage,
      wager: state.wager,
      dealerHidden: Boolean(state.dealerHidden && state.stage === 'player-turn'),
      playerCards: state.playerCards,
      dealerCards: state.dealerCards,
      aiSeats: state.aiSeats,
      playerScore: getBlackjackScore(state.playerCards),
      dealerScore: getBlackjackScore(state.dealerCards),
      lastDelta: state.lastDelta,
      message: state.message,
      payoutAmount: Number(state.payoutAmount || 0),
    };
  }

  function getPokerBlindUnit(ante) {
    return Math.max(10, Math.round(Number(ante || 0) / 2) || 10);
  }

  function roundPokerBetAmount(amount, ante) {
    const blindUnit = getPokerBlindUnit(ante);
    return Math.max(blindUnit, Math.round(Number(amount || 0) / blindUnit) * blindUnit);
  }

  function clampPokerBetAmount(amount, min, max, ante) {
    const upper = Math.max(0, Number(max || 0));
    if (!upper) return 0;
    const lower = Math.min(Math.max(0, Number(min || 0)), upper);
    const rounded = roundPokerBetAmount(amount, ante);
    return Math.max(lower, Math.min(upper, rounded));
  }

  function appendPokerLog(state, entry) {
    return {
      ...state,
      actionLog: [...(state.actionLog || []), entry].filter(Boolean).slice(-POKER_ACTION_LOG_LIMIT),
    };
  }

  function buildPokerSeatRead(seat, board) {
    if (seat.folded) return 'se couche';
    if ((board || []).length >= 3) {
      return evaluateBestPokerHand([...(seat.cards || []), ...(board || [])]).label.toLowerCase();
    }
    return describeHoleCards(seat.cards || []);
  }

  function getPokerPreflopStrength(cards) {
    if (!Array.isArray(cards) || cards.length < 2) return 0.12;
    const [high, low] = cards
      .map((card) => Number(card?.rankValue || 0))
      .sort((left, right) => right - left);
    const suited = cards[0]?.suit && cards[0]?.suit === cards[1]?.suit;
    const pair = high === low;
    const gap = Math.abs(high - low);

    let score = high / 14 * 0.28 + low / 14 * 0.18;
    if (pair) score += 0.34 + high / 14 * 0.18;
    if (suited) score += 0.08;
    if (gap === 0) score += 0.05;
    if (gap === 1) score += 0.06;
    if (gap === 2) score += 0.03;
    if (high >= 13 && low >= 11) score += 0.08;
    if (high === 14 && low >= 10) score += 0.06;
    if (gap >= 4) score -= 0.07;

    return Math.max(0.08, Math.min(0.96, score));
  }

  function getPokerPostflopStrength(cards, board) {
    const hand = evaluateBestPokerHand([...(cards || []), ...(board || [])]);
    const tiebreakers = hand?.tiebreakers || [];
    const primary = Number(tiebreakers[0] || 0) / 14;
    const secondary = Number(tiebreakers[1] || 0) / 14;
    const tertiary = Number(tiebreakers[2] || 0) / 14;
    const madeValue = 0.18 + Number(hand?.category || 0) * 0.1;
    return Math.max(0.14, Math.min(0.99, madeValue + primary * 0.2 + secondary * 0.06 + tertiary * 0.03));
  }

  function getPokerSeatStrength(cards, board) {
    return (board || []).length < 3 ? getPokerPreflopStrength(cards) : getPokerPostflopStrength(cards, board);
  }

  function getPokerFreeActionPrompt(stage) {
    switch (stage) {
      case 'preflop':
        return "Action au bouton hero. La parole t'arrive sans relance, tu peux checker ou ouvrir.";
      case 'flop':
        return 'Le flop est checke jusqua toi. Tu peux controler ou c-bet.';
      case 'turn':
        return 'La turn ralentit et la parole te revient. Tu peux checker ou mettre la pression.';
      case 'river':
        return 'La river est checkee jusqua toi. Derniere decision avant la fin de main.';
      default:
        return 'La table attend ta decision.';
    }
  }

  function getPokerStreetTransitionCopy(stage) {
    switch (stage) {
      case 'preflop':
        return "Le flop frappe le feutre et ouvre un vrai tour de mise.";
      case 'flop':
        return 'La turn tombe et resserre les ranges.';
      case 'turn':
        return 'La river arrive, tout se joue maintenant.';
      default:
        return 'La table continue.';
    }
  }

  function resolvePokerHeroPot(state, message) {
    const fullBoard = state.communityReserve.slice(0, 5);
    const playerHand = evaluateBestPokerHand([...state.playerCards, ...fullBoard]);

    return {
      ...state,
      stage: 'showdown',
      communityCards: fullBoard,
      playerFolded: false,
      aiSeats: state.aiSeats.map((seat) => ({
        ...seat,
        hand: seat.folded ? null : evaluateBestPokerHand([...seat.cards, ...fullBoard]),
        isWinner: false,
        read: seat.folded ? 'se couche' : 'laisse filer',
      })),
      playerHand,
      payoutAmount: Number(state.pot || 0),
      lastDelta: Number(state.pot || 0) - Number(state.playerCommitted || state.ante || 0),
      currentBet: 0,
      toCall: 0,
      minBet: 0,
      minRaiseTo: 0,
      legalActions: [],
      message: message || `La table passe. Tu ramasses ${state.pot} jetons sans contestation.`,
    };
  }

  function resolvePokerShowdown(state, forceFold = false) {
    const fullBoard = state.communityReserve.slice(0, 5);
    const playerFolded = Boolean(forceFold || state.playerFolded);
    const contenders = [];
    const resolvedAiSeats = state.aiSeats.map((seat) => {
      if (seat.folded) {
        return {
          ...seat,
          hand: null,
          isWinner: false,
          read: 'se couche',
        };
      }

      const hand = evaluateBestPokerHand([...seat.cards, ...fullBoard]);
      contenders.push({ id: seat.id, hand });
      return {
        ...seat,
        hand,
        isWinner: false,
        read: hand.label,
      };
    });

    const playerHand = playerFolded ? null : evaluateBestPokerHand([...state.playerCards, ...fullBoard]);

    let bestScore = playerHand;
    contenders.forEach((seat) => {
      if (!bestScore || comparePokerScores(seat.hand, bestScore) > 0) {
        bestScore = seat.hand;
      }
    });

    const winningAiIds = contenders
      .filter((seat) => bestScore && comparePokerScores(seat.hand, bestScore) === 0)
      .map((seat) => seat.id);
    const playerWins = Boolean(playerHand && bestScore && comparePokerScores(playerHand, bestScore) === 0);
    const winnersCount = winningAiIds.length + (playerWins ? 1 : 0);
    const share = winnersCount ? Math.floor(Number(state.pot || 0) / winnersCount) : 0;
    const playerCommitted = Number(state.playerCommitted || state.ante || 0);

    return {
      ...state,
      stage: 'showdown',
      communityCards: fullBoard,
      playerFolded,
      aiSeats: resolvedAiSeats.map((seat) => ({
        ...seat,
        chips: winningAiIds.includes(seat.id) ? seat.chips + share : seat.chips,
        isWinner: winningAiIds.includes(seat.id),
      })),
      playerHand,
      payoutAmount: playerWins ? share : 0,
      lastDelta: playerWins ? share - playerCommitted : -playerCommitted,
      currentBet: 0,
      toCall: 0,
      minBet: 0,
      minRaiseTo: 0,
      legalActions: [],
      message: playerWins
        ? `Fin de main propre. Tu prends ${share} jetons avec ${playerHand?.label.toLowerCase()}.`
        : playerFolded
          ? 'Tu couches la main. Le pot part chez les survivants.'
          : `Le pot glisse ailleurs. La meilleure main est ${bestScore?.label.toLowerCase()}.`,
    };
  }

  function preparePokerDecisionState(state) {
    if (Number(state.playerChips || 0) <= 0) {
      return resolvePokerShowdown(state);
    }

    const blindUnit = getPokerBlindUnit(state.ante);
    const board = state.communityCards || [];
    const composeMessage = (prompt) => [state.message, prompt].filter(Boolean).join(' ').trim();
    const refreshedSeats = state.aiSeats.map((seat) => ({
      ...seat,
      streetCommitted: 0,
      lastAction: seat.folded ? 'se couche' : 'attend',
      read: buildPokerSeatRead(seat, board),
    }));
    const activeSeats = refreshedSeats.filter((seat) => !seat.folded);
    if (!activeSeats.length) {
      return resolvePokerHeroPot({ ...state, aiSeats: refreshedSeats }, 'Les dernieres cartes se couchent devant toi.');
    }

    const playerCap = Number(state.playerChips || 0);
    const baseState = {
      ...state,
      aiSeats: refreshedSeats,
      playerStreetCommitted: 0,
      currentBet: 0,
      toCall: 0,
      minBet: 0,
      minRaiseTo: 0,
      legalActions: ['check', 'bet', 'fold'],
      aggressorId: null,
      aggressorName: null,
    };

    const suggestedOpen = clampPokerBetAmount(
      Math.max(
        blindUnit,
        state.stage === 'preflop'
          ? Number(state.ante || 0) * (2.2 + random(5) / 10)
          : Number(state.pot || 0) * (state.stage === 'river' ? 0.58 : state.stage === 'turn' ? 0.64 : 0.55)
      ),
      Math.min(blindUnit, playerCap),
      playerCap,
      state.ante
    );

    const seatSnapshots = activeSeats.map((seat) => ({
      seat,
      strength: getPokerSeatStrength(seat.cards, board),
      weight: Math.max(1, Math.round(20 + getPokerSeatStrength(seat.cards, board) * 100)),
    }));
    const strongestSeat = seatSnapshots.reduce(
      (best, current) => (!best || current.strength > best.strength ? current : best),
      null
    );
    const pressureBase = {
      preflop: 0.56,
      flop: 0.48,
      turn: 0.43,
      river: 0.38,
    }[state.stage] || 0.42;
    const pressureChance = Math.min(0.84, pressureBase + Number(strongestSeat?.strength || 0) * 0.18);
    const shouldFaceBet =
      playerCap >= blindUnit &&
      seatSnapshots.some((entry) => Number(entry.seat.chips || 0) >= blindUnit) &&
      random(1000) < Math.round(pressureChance * 1000);

    if (!shouldFaceBet) {
      return {
        ...baseState,
        legalActions: suggestedOpen > 0 ? ['check', 'bet', 'fold'] : ['check', 'fold'],
        minBet: suggestedOpen,
        message: composeMessage(getPokerFreeActionPrompt(state.stage)),
      };
    }

    const totalWeight = seatSnapshots.reduce((sum, entry) => sum + entry.weight, 0);
    let cursor = random(totalWeight);
    let openerSnapshot = seatSnapshots[0];
    for (const entry of seatSnapshots) {
      cursor -= entry.weight;
      if (cursor < 0) {
        openerSnapshot = entry;
        break;
      }
    }

    const openerCap = Math.min(Number(openerSnapshot?.seat?.chips || 0), playerCap);
    const openAmount = clampPokerBetAmount(
      suggestedOpen * (0.92 + Number(openerSnapshot?.strength || 0) * 0.45),
      blindUnit,
      openerCap,
      state.ante
    );

    if (!openAmount) {
      return {
        ...baseState,
        legalActions: suggestedOpen > 0 ? ['check', 'bet', 'fold'] : ['check', 'fold'],
        minBet: suggestedOpen,
        message: composeMessage(getPokerFreeActionPrompt(state.stage)),
      };
    }

    return {
      ...baseState,
      pot: Number(state.pot || 0) + openAmount,
      currentBet: openAmount,
      toCall: openAmount,
      minRaiseTo: clampPokerBetAmount(
        openAmount + Math.max(blindUnit, Math.round(openAmount * 0.7)),
        openAmount + blindUnit,
        playerCap,
        state.ante
      ),
      legalActions: playerCap > openAmount ? ['fold', 'call', 'raise'] : ['fold', 'call'],
      aggressorId: openerSnapshot.seat.id,
      aggressorName: openerSnapshot.seat.name,
      aiSeats: refreshedSeats.map((seat) =>
        seat.id === openerSnapshot.seat.id
          ? {
              ...seat,
              chips: seat.chips - openAmount,
              streetCommitted: openAmount,
              totalCommitted: Number(seat.totalCommitted || 0) + openAmount,
              lastAction: `ouvre ${openAmount}`,
              read: buildPokerSeatRead(seat, board),
            }
          : seat
      ),
      message: composeMessage(`${openerSnapshot.seat.name} met ${openAmount} au milieu. A toi de repondre.`),
    };
  }

  router.get('/api/casino/me', verifyJWT, async (req, res) => {
    try {
      const auth = await requireCasinoUser(req, res);
      if (!auth) return;
      const profile = await loadProfile(auth.userId);
      return res.json(profile);
    } catch (error_) {
      logger?.error?.('[CASINO] profile failed:', error_?.message);
      return res.status(500).json({ ok: false, error: 'casino_profile_failed' });
    }
  });

  router.post('/api/casino/daily-bonus', verifyJWT, express.json({ limit: '64kb' }), async (req, res) => {
    let client = null;
    try {
      const auth = await requireCasinoUser(req, res);
      if (!auth) return;

      client = await db.connect();
      await client.query('BEGIN');

      await client.query(
        `
          INSERT INTO casino_wallets (user_id, balance)
          VALUES ($1, $2)
          ON CONFLICT (user_id) DO NOTHING
        `,
        [auth.userId, startingBalance]
      );

      const walletResult = await client.query(
        'SELECT * FROM casino_wallets WHERE user_id = $1 LIMIT 1 FOR UPDATE',
        [auth.userId]
      );
      const walletRow = walletResult.rows[0];
      const lastClaimMs = walletRow?.last_daily_bonus_at ? new Date(walletRow.last_daily_bonus_at).getTime() : 0;
      const currentMs = now().getTime();
      const nextClaimMs = lastClaimMs ? lastClaimMs + dailyBonusCooldownMs : 0;

      if (lastClaimMs && currentMs < nextClaimMs) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          ok: false,
          error: 'daily_bonus_not_ready',
          nextDailyBonusAt: new Date(nextClaimMs).toISOString(),
          wallet: buildWalletPayload(walletRow, { dailyBonusAmount, dailyBonusCooldownMs }),
        });
      }

      const nextBalance = Number(walletRow.balance || 0) + dailyBonusAmount;
      const claimedAt = now().toISOString();
      await client.query(
        `
          UPDATE casino_wallets
          SET balance = $2,
              last_daily_bonus_at = $3,
              updated_at = NOW()
          WHERE user_id = $1
        `,
        [auth.userId, nextBalance, claimedAt]
      );
      await appendTransaction(client, {
        userId: auth.userId,
        kind: 'daily_bonus',
        amount: dailyBonusAmount,
        balanceAfter: nextBalance,
        metadata: { source: 'daily_bonus' },
      });

      await client.query('COMMIT');
      const profile = await loadProfile(auth.userId);
      return res.json({
        ok: true,
        claimedAmount: dailyBonusAmount,
        profile,
      });
    } catch (error_) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      logger?.error?.('[CASINO] daily bonus failed:', error_?.message);
      return res.status(500).json({ ok: false, error: 'daily_bonus_failed' });
    } finally {
      client?.release?.();
    }
  });

  router.post('/api/casino/slots/spin', verifyJWT, express.json({ limit: '64kb' }), async (req, res) => {
    let client = null;
    try {
      const auth = await requireCasinoUser(req, res);
      if (!auth) return;

      const requestedBet = clampInteger(req.body?.bet, DEFAULT_MIN_BET, DEFAULT_MAX_BET, DEFAULT_MIN_BET);

      client = await db.connect();
      await client.query('BEGIN');
      await client.query(
        `
          INSERT INTO casino_wallets (user_id, balance)
          VALUES ($1, $2)
          ON CONFLICT (user_id) DO NOTHING
        `,
        [auth.userId, startingBalance]
      );

      const walletResult = await client.query(
        'SELECT * FROM casino_wallets WHERE user_id = $1 LIMIT 1 FOR UPDATE',
        [auth.userId]
      );
      const walletRow = walletResult.rows[0];
      const currentBalance = Number(walletRow?.balance || 0);
      if (currentBalance < requestedBet) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          ok: false,
          error: 'insufficient_credits',
          wallet: buildWalletPayload(walletRow, { dailyBonusAmount, dailyBonusCooldownMs }),
        });
      }

      const outcome = typeof spinCasinoOutcome === 'function'
        ? spinCasinoOutcome({ bet: requestedBet, randomInt: random })
        : buildSpinOutcome({ bet: requestedBet, randomInt: random });
      const totalPayout = Number(outcome.totalPayout || 0);
      const nextBalance = currentBalance - requestedBet + totalPayout;

      await client.query(
        `
          UPDATE casino_wallets
          SET balance = $2,
              lifetime_wagered = COALESCE(lifetime_wagered, 0) + $3,
              lifetime_won = COALESCE(lifetime_won, 0) + $4,
              games_played = COALESCE(games_played, 0) + 1,
              updated_at = NOW()
          WHERE user_id = $1
        `,
        [auth.userId, nextBalance, requestedBet, totalPayout]
      );

      await appendTransaction(client, {
        userId: auth.userId,
        kind: 'slots_spin',
        amount: outcome.netChange,
        balanceAfter: nextBalance,
        metadata: {
          bet: requestedBet,
          payout: totalPayout,
          wins: outcome.wins,
          grid: outcome.grid,
          bonus: outcome.bonus || null,
        },
      });

      await client.query('COMMIT');
      const profile = await loadProfile(auth.userId);
      return res.json({
        ok: true,
        spin: outcome,
        profile,
      });
    } catch (error_) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      logger?.error?.('[CASINO] spin failed:', error_?.message);
      return res.status(500).json({ ok: false, error: 'casino_spin_failed' });
    } finally {
      client?.release?.();
    }
  });

  router.post('/api/casino/treasure-map/play', verifyJWT, express.json({ limit: '64kb' }), async (req, res) => {
    let client = null;
    try {
      const auth = await requireCasinoUser(req, res);
      if (!auth) return;

      const selectedPoint = normalizeText(req.body?.pointId);
      if (!TREASURE_POINTS.some((point) => point.id === selectedPoint)) {
        return res.status(400).json({ ok: false, error: 'invalid_point' });
      }

      client = await db.connect();
      await client.query('BEGIN');
      const walletRow = await getWalletRow(auth.userId, client, true);
      const currentBalance = Number(walletRow?.balance || 0);
      if (currentBalance < MAP_ROOM_COST) {
        await client.query('ROLLBACK');
        return res.status(400).json({ ok: false, error: 'insufficient_credits' });
      }

      const winningPoint = TREASURE_POINTS[random(TREASURE_POINTS.length)]?.id || TREASURE_POINTS[0].id;
      const reward = selectedPoint === winningPoint ? MAP_REWARD : 0;
      const netChange = reward - MAP_ROOM_COST;
      const nextBalance = currentBalance + netChange;

      await applyWalletDeltas(client, auth.userId, {
        balance: nextBalance,
        lifetimeWagered: 0,
        lifetimeWon: reward,
        gamesPlayed: 0,
      });
      await appendTransaction(client, {
        userId: auth.userId,
        kind: 'treasure_map',
        amount: netChange,
        balanceAfter: nextBalance,
        metadata: {
          selectedPoint,
          winningPoint,
          cost: MAP_ROOM_COST,
          reward,
        },
      });
      await client.query('COMMIT');

      return res.json({
        ok: true,
        result: {
          selectedPoint,
          winningPoint,
          reward,
          cost: MAP_ROOM_COST,
          netChange,
          playedAt: now().toISOString(),
        },
        profile: await loadProfile(auth.userId),
      });
    } catch (error_) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      logger?.error?.('[CASINO] treasure map failed:', error_?.message);
      return res.status(500).json({ ok: false, error: 'treasure_map_failed' });
    } finally {
      client?.release?.();
    }
  });

  router.post('/api/casino/treasure-hunt/start', verifyJWT, express.json({ limit: '64kb' }), async (req, res) => {
    let client = null;
    try {
      const auth = await requireCasinoUser(req, res);
      if (!auth) return;

      client = await db.connect();
      await client.query('BEGIN');
      const walletRow = await getWalletRow(auth.userId, client, true);
      const currentBalance = Number(walletRow?.balance || 0);
      if (currentBalance < HUNT_ROOM_COST) {
        await client.query('ROLLBACK');
        return res.status(400).json({ ok: false, error: 'insufficient_credits' });
      }

      const nextBalance = currentBalance - HUNT_ROOM_COST;
      await applyWalletDeltas(client, auth.userId, {
        balance: nextBalance,
        lifetimeWagered: HUNT_ROOM_COST,
        lifetimeWon: 0,
        gamesPlayed: 1,
      });
      await appendTransaction(client, {
        userId: auth.userId,
        kind: 'treasure_hunt_buyin',
        amount: -HUNT_ROOM_COST,
        balanceAfter: nextBalance,
        metadata: { cost: HUNT_ROOM_COST },
      });
      await client.query('COMMIT');

      const state = {
        game: 'treasure-hunt',
        board: buildTreasureHuntBoard(random),
        revealed: [],
        shotsLeft: HUNT_SHOTS_PER_ROUND,
        reward: 0,
        cost: HUNT_ROOM_COST,
        phase: 'playing',
        message: 'Trois tirs, trois chances. Choisis tes navires avec soin.',
      };

      return res.json({
        ok: true,
        state: {
          token: encodeRoundToken(state, roundTokenSecret),
          phase: state.phase,
          shotsLeft: state.shotsLeft,
          reward: state.reward,
          cost: state.cost,
          board: maskTreasureHuntBoard(state.board, state.revealed),
          message: state.message,
        },
        profile: await loadProfile(auth.userId),
      });
    } catch (error_) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      logger?.error?.('[CASINO] treasure hunt start failed:', error_?.message);
      return res.status(500).json({ ok: false, error: 'treasure_hunt_start_failed' });
    } finally {
      client?.release?.();
    }
  });

  router.post('/api/casino/treasure-hunt/reveal', verifyJWT, express.json({ limit: '64kb' }), async (req, res) => {
    let client = null;
    try {
      const auth = await requireCasinoUser(req, res);
      if (!auth) return;

      const state = decodeRoundToken(req.body?.token, roundTokenSecret);
      if (state?.game !== 'treasure-hunt') {
        return res.status(400).json({ ok: false, error: 'invalid_round_token' });
      }

      const tileId = clampInteger(req.body?.tileId, 0, 8, -1);
      if (tileId < 0 || state.phase !== 'playing' || state.shotsLeft <= 0 || state.revealed.includes(tileId)) {
        return res.status(400).json({ ok: false, error: 'invalid_tile' });
      }

      const reward = Number(state.board[tileId] || 0);
      const nextState = {
        ...state,
        revealed: [...state.revealed, tileId],
        shotsLeft: Number(state.shotsLeft || 0) - 1,
        reward: Number(state.reward || 0) + reward,
      };

      if (nextState.shotsLeft <= 0) {
        nextState.phase = 'resolved';
        nextState.message = reward > 0
          ? `Derniere salve reussie. La cale remonte avec ${nextState.reward} jetons.`
          : `Expedition bouclee. Bilan de chasse: ${nextState.reward} jetons.`;

        client = await db.connect();
        await client.query('BEGIN');
        const walletRow = await getWalletRow(auth.userId, client, true);
        const currentBalance = Number(walletRow?.balance || 0);
        const nextBalance = currentBalance + nextState.reward;
        await applyWalletDeltas(client, auth.userId, {
          balance: nextBalance,
          lifetimeWagered: 0,
          lifetimeWon: nextState.reward,
          gamesPlayed: 0,
        });
        if (nextState.reward > 0) {
          await appendTransaction(client, {
            userId: auth.userId,
            kind: 'treasure_hunt_payout',
            amount: nextState.reward,
            balanceAfter: nextBalance,
            metadata: {
              cost: HUNT_ROOM_COST,
              reward: nextState.reward,
              revealed: nextState.revealed,
            },
          });
        }
        await client.query('COMMIT');

        return res.json({
          ok: true,
          state: {
            token: null,
            phase: nextState.phase,
            shotsLeft: nextState.shotsLeft,
            reward: nextState.reward,
            cost: HUNT_ROOM_COST,
            board: maskTreasureHuntBoard(nextState.board, nextState.revealed, true),
            message: nextState.message,
          },
          profile: await loadProfile(auth.userId),
        });
      }

      nextState.message = reward > 0
        ? `${getTreasurePrizeMeta(reward)?.label || 'Tresor'} repere. Encore ${nextState.shotsLeft} tir${nextState.shotsLeft > 1 ? 's' : ''}.`
        : `Rien que de l'ecume. Il reste ${nextState.shotsLeft} tir${nextState.shotsLeft > 1 ? 's' : ''}.`;

      return res.json({
        ok: true,
        state: {
          token: encodeRoundToken(nextState, roundTokenSecret),
          phase: nextState.phase,
          shotsLeft: nextState.shotsLeft,
          reward: nextState.reward,
          cost: HUNT_ROOM_COST,
          board: maskTreasureHuntBoard(nextState.board, nextState.revealed),
          message: nextState.message,
        },
      });
    } catch (error_) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      const code = error_?.code === 'invalid_round_token' ? 'invalid_round_token' : 'treasure_hunt_reveal_failed';
      logger?.error?.('[CASINO] treasure hunt reveal failed:', error_?.message);
      return res.status(code === 'invalid_round_token' ? 400 : 500).json({ ok: false, error: code });
    } finally {
      client?.release?.();
    }
  });

  async function joinTableRoom(req, res, game) {
    let client = null;
    try {
      const auth = await requireCasinoUser(req, res);
      if (!auth) return;
      const presenceClientId = getTablePresenceClientIdFromRequest(req);

      const roomId = normalizeTableRoomId(game, req.body?.roomId);
      if (!roomId) {
        return res.status(400).json({ ok: false, error: 'invalid_room' });
      }

      client = await db.connect();
      await client.query('BEGIN');
      await pruneTableRoomPresence(client);
      await touchTableRoomPresence(client, game, roomId, auth.userId, presenceClientId);
      const payload = await buildTableRoomPayload(client, game, auth.userId, roomId);
      await client.query('COMMIT');

      return res.json({
        ok: true,
        ...payload,
      });
    } catch (error_) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      logger?.error?.(`[CASINO] ${game} room join failed:`, error_?.message);
      return res.status(500).json({ ok: false, error: `${game}_room_join_failed` });
    } finally {
      client?.release?.();
    }
  }

  router.post('/api/casino/blackjack/rooms/join', verifyJWT, express.json({ limit: '64kb' }), async (req, res) => {
    return joinTableRoom(req, res, 'blackjack');
  });

  router.post('/api/casino/poker/rooms/join', verifyJWT, express.json({ limit: '64kb' }), async (req, res) => {
    return joinTableRoom(req, res, 'poker');
  });

  router.post('/api/casino/table-presence/leave', verifyJWT, express.json({ limit: '64kb' }), async (req, res) => {
    let client = null;
    try {
      const auth = await requireCasinoUser(req, res);
      if (!auth) return;

      const game = normalizeText(req.body?.game).toLowerCase();
      const roomId = normalizeTableRoomId(game, req.body?.roomId);
      const presenceClientId = getTablePresenceClientIdFromRequest(req);
      if (!['blackjack', 'poker'].includes(game) || !roomId) {
        return res.status(400).json({ ok: false, error: 'invalid_room' });
      }

      client = await db.connect();
      await client.query('BEGIN');
      await pruneTableRoomPresence(client);
      await removeTableRoomPresence(client, game, roomId, auth.userId, presenceClientId);
      await client.query('COMMIT');

      return res.json({ ok: true });
    } catch (error_) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      logger?.error?.('[CASINO] table presence leave failed:', error_?.message);
      return res.status(500).json({ ok: false, error: 'table_presence_leave_failed' });
    } finally {
      client?.release?.();
    }
  });

  router.get('/api/casino/blackjack/state', verifyJWT, async (req, res) => {
    let client = null;
    try {
      const auth = await requireCasinoUser(req, res);
      if (!auth) return;
      const presenceClientId = getTablePresenceClientIdFromRequest(req);
      const roomId = normalizeTableRoomId('blackjack', req.query?.roomId);
      if (!roomId) {
        return res.status(400).json({ ok: false, error: 'invalid_room' });
      }

      const shouldTouchPresence = shouldTouchTableRoomPresence('blackjack', roomId, auth.userId, presenceClientId);
      client = await db.connect();
      await client.query('BEGIN');
      if (shouldTouchPresence) {
        await pruneTableRoomPresence(client);
        await touchTableRoomPresence(client, 'blackjack', roomId, auth.userId, presenceClientId);
      }
      let state = await loadBlackjackTableState(client, roomId, false);
      const blackjackSync = await syncBlackjackRoomState(client, roomId, state);
      state = blackjackSync.state;
      state = (await settleExpiredBlackjackTurns(client, roomId, state)).state;
      state = await resolveBlackjackWaitingState(client, roomId, state);
      await saveSharedTableState(client, 'casino_blackjack_tables', roomId, state);
      await client.query('COMMIT');

      return res.json({
        ok: true,
        state: serializeBlackjackClientState(state, auth.userId, blackjackSync.activeParticipants),
      });
    } catch (error_) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      logger?.error?.('[CASINO] blackjack state failed:', error_?.message);
      return res.status(500).json({ ok: false, error: 'blackjack_state_failed' });
    } finally {
      client?.release?.();
    }
  });

  router.post('/api/casino/blackjack/start', verifyJWT, express.json({ limit: '64kb' }), async (req, res) => {
    let client = null;
    try {
      const auth = await requireCasinoUser(req, res);
      if (!auth) return;
      const presenceClientId = getTablePresenceClientIdFromRequest(req);

      const wager = clampInteger(
        req.body?.bet,
        BLACKJACK_PLAYER_BETS[0],
        BLACKJACK_PLAYER_BETS[BLACKJACK_PLAYER_BETS.length - 1],
        BLACKJACK_PLAYER_BETS[1]
      );
      if (!BLACKJACK_PLAYER_BETS.includes(wager)) {
        return res.status(400).json({ ok: false, error: 'invalid_bet' });
      }
      const roomId = normalizeTableRoomId('blackjack', req.body?.roomId);

      client = await db.connect();
      await client.query('BEGIN');
      await pruneTableRoomPresence(client);
      await touchTableRoomPresence(client, 'blackjack', roomId, auth.userId, presenceClientId);
      let state = await loadBlackjackTableState(client, roomId, true);
      const blackjackSync = await syncBlackjackRoomState(client, roomId, state);
      state = blackjackSync.state;
      state = (await settleExpiredBlackjackTurns(client, roomId, state)).state;
      const requesterIsSeated = (state.seats || []).some((seat) => String(seat?.userId || '') === String(auth.userId || ''));
      const revealOpen = isTableRevealWindowOpen(state, now());
      if (state.stage === 'player-turn') {
        if (!requesterIsSeated) {
          state = queueBlackjackPendingSeat(state, {
            roomId,
            userId: auth.userId,
            username: auth.user?.username ? String(auth.user.username) : `Joueur ${auth.userId}`,
            wager,
          }, now());
        }
        await saveSharedTableState(client, 'casino_blackjack_tables', roomId, state);
        await client.query('COMMIT');
        return res.json({
          ok: true,
          state: serializeBlackjackClientState(state, auth.userId, blackjackSync.activeParticipants),
          profile: await loadProfile(auth.userId),
        });
      }
      if (state.stage === 'resolved' && revealOpen) {
        if (!requesterIsSeated) {
          state = queueBlackjackPendingSeat(state, {
            roomId,
            userId: auth.userId,
            username: auth.user?.username ? String(auth.user.username) : `Joueur ${auth.userId}`,
            wager,
          }, now());
        }
        await saveSharedTableState(client, 'casino_blackjack_tables', roomId, state);
        await client.query('COMMIT');
        return res.json({
          ok: true,
          state: serializeBlackjackClientState(state, auth.userId, blackjackSync.activeParticipants),
          profile: await loadProfile(auth.userId),
        });
      }

      state = upsertBlackjackPendingSeat(state, {
        roomId,
        userId: auth.userId,
        username: auth.user?.username ? String(auth.user.username) : `Joueur ${auth.userId}`,
        wager,
      }, now());
      state = await resolveBlackjackWaitingState(client, roomId, state, auth.userId);

      await saveSharedTableState(client, 'casino_blackjack_tables', roomId, state);
      await client.query('COMMIT');

      return res.json({
        ok: true,
        state: serializeBlackjackClientState(state, auth.userId, blackjackSync.activeParticipants),
        profile: await loadProfile(auth.userId),
      });
    } catch (error_) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      const code = ['insufficient_credits', 'table_full'].includes(error_?.code)
        ? error_.code
        : 'blackjack_start_failed';
      logger?.error?.('[CASINO] blackjack start failed:', error_?.message);
      return res.status(code === 'blackjack_start_failed' ? 500 : 400).json({ ok: false, error: code });
    } finally {
      client?.release?.();
    }
  });

  router.post('/api/casino/blackjack/action', verifyJWT, express.json({ limit: '64kb' }), async (req, res) => {
    let client = null;
    try {
      const auth = await requireCasinoUser(req, res);
      if (!auth) return;
      const presenceClientId = getTablePresenceClientIdFromRequest(req);

      const action = normalizeText(req.body?.action).toLowerCase();
      if (!['hit', 'stand', 'double', 'split'].includes(action)) {
        return res.status(400).json({ ok: false, error: 'invalid_action' });
      }
      const parsedToken = parseBlackjackToken(req.body?.token);
      if (!parsedToken?.roomId) {
        return res.status(400).json({ ok: false, error: 'invalid_round_token' });
      }

      client = await db.connect();
      await client.query('BEGIN');
      await pruneTableRoomPresence(client);
      await touchTableRoomPresence(client, 'blackjack', parsedToken.roomId, auth.userId, presenceClientId);
      const blackjackParticipants = await listActiveRoomPresence(client, 'blackjack', parsedToken.roomId);
      let state = await loadBlackjackTableState(client, parsedToken.roomId, true);
      if (Number(state.roundId || 0) !== Number(parsedToken.roundId || 0)) {
        await client.query('ROLLBACK');
        return res.status(400).json({ ok: false, error: 'invalid_round_token' });
      }

      const blackjackTimeoutSync = await settleExpiredBlackjackTurns(client, parsedToken.roomId, state);
      state = blackjackTimeoutSync.state;
      if (blackjackTimeoutSync.changed) {
        await saveSharedTableState(client, 'casino_blackjack_tables', parsedToken.roomId, state);
        await client.query('COMMIT');
        return res.status(400).json({
          ok: false,
          error: state.stage === 'player-turn' ? 'not_your_turn' : 'invalid_round_token',
        });
      }

      state = applySharedBlackjackAction(state, {
        userId: auth.userId,
        action,
        now: now(),
        drawCards,
        getBlackjackScore,
        completeDealerHand,
        getBlackjackPayout,
      });

      if (state.stage === 'resolved') {
        for (const seat of state.seats || []) {
          if (Number(seat.payoutAmount || 0) > 0) {
            await creditWalletForTable(client, seat.userId, seat.payoutAmount, 'blackjack_payout', {
              roomId: parsedToken.roomId,
              wager: Number(seat.wager || 0),
              roundId: Number(state.roundId || 0),
              message: state.message,
            });
          }
        }
      }

      await saveSharedTableState(client, 'casino_blackjack_tables', parsedToken.roomId, state);
      await client.query('COMMIT');

      return res.json({
        ok: true,
        state: serializeBlackjackClientState(state, auth.userId, blackjackParticipants),
        profile: await loadProfile(auth.userId),
      });
    } catch (error_) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      const code = ['invalid_round_token', 'invalid_action', 'not_your_turn'].includes(error_?.code)
        ? error_.code
        : 'blackjack_action_failed';
      logger?.error?.('[CASINO] blackjack action failed:', error_?.message);
      return res.status(code === 'blackjack_action_failed' ? 500 : 400).json({ ok: false, error: code });
    } finally {
      client?.release?.();
    }
  });

  router.get('/api/casino/poker/state', verifyJWT, async (req, res) => {
    let client = null;
    try {
      const auth = await requireCasinoUser(req, res);
      if (!auth) return;
      const presenceClientId = getTablePresenceClientIdFromRequest(req);
      const roomId = normalizeTableRoomId('poker', req.query?.roomId);
      if (!roomId) {
        return res.status(400).json({ ok: false, error: 'invalid_room' });
      }

      const shouldTouchPresence = shouldTouchTableRoomPresence('poker', roomId, auth.userId, presenceClientId);
      client = await db.connect();
      await client.query('BEGIN');
      if (shouldTouchPresence) {
        await pruneTableRoomPresence(client);
        await touchTableRoomPresence(client, 'poker', roomId, auth.userId, presenceClientId);
      }
      let state = await loadPokerTableState(client, roomId, false);
      const pokerSync = await syncPokerRoomState(client, roomId, state);
      state = pokerSync.state;
      state = (await settleExpiredPokerTurns(client, roomId, state)).state;
      state = await resolvePokerWaitingState(client, roomId, state);
      await saveSharedTableState(client, 'casino_poker_tables', roomId, state);
      await client.query('COMMIT');

      return res.json({
        ok: true,
        state: serializePokerClientState(state, auth.userId, pokerSync.activeParticipants),
      });
    } catch (error_) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      logger?.error?.('[CASINO] poker state failed:', error_?.message);
      return res.status(500).json({ ok: false, error: 'poker_state_failed' });
    } finally {
      client?.release?.();
    }
  });

  router.post('/api/casino/poker/start', verifyJWT, express.json({ limit: '64kb' }), async (req, res) => {
    let client = null;
    try {
      const auth = await requireCasinoUser(req, res);
      if (!auth) return;
      const presenceClientId = getTablePresenceClientIdFromRequest(req);

      const ante = clampInteger(
        req.body?.ante,
        POKER_ANTE_PRESETS[0],
        POKER_ANTE_PRESETS[POKER_ANTE_PRESETS.length - 1],
        POKER_ANTE_PRESETS[1]
      );
      if (!POKER_ANTE_PRESETS.includes(ante)) {
        return res.status(400).json({ ok: false, error: 'invalid_ante' });
      }
      const roomId = normalizeTableRoomId('poker', req.body?.roomId);

      client = await db.connect();
      await client.query('BEGIN');
      await pruneTableRoomPresence(client);
      await touchTableRoomPresence(client, 'poker', roomId, auth.userId, presenceClientId);
      let state = await loadPokerTableState(client, roomId, true);
      const pokerSync = await syncPokerRoomState(client, roomId, state);
      state = pokerSync.state;
      state = (await settleExpiredPokerTurns(client, roomId, state)).state;
      const requesterIsSeated = (state.seats || []).some((seat) => String(seat?.userId || '') === String(auth.userId || ''));
      const revealOpen = isTableRevealWindowOpen(state, now());
      if (state.stage && !['waiting', 'showdown'].includes(state.stage)) {
        if (!requesterIsSeated) {
          state = queuePokerPendingSeat(state, {
            roomId,
            userId: auth.userId,
            username: auth.user?.username ? String(auth.user.username) : `Joueur ${auth.userId}`,
            ante,
          }, now());
        }
        await saveSharedTableState(client, 'casino_poker_tables', roomId, state);
        await client.query('COMMIT');
        return res.json({
          ok: true,
          state: serializePokerClientState(state, auth.userId, pokerSync.activeParticipants),
          profile: await loadProfile(auth.userId),
        });
      }
      if (state.stage === 'showdown' && revealOpen) {
        if (!requesterIsSeated) {
          state = queuePokerPendingSeat(state, {
            roomId,
            userId: auth.userId,
            username: auth.user?.username ? String(auth.user.username) : `Joueur ${auth.userId}`,
            ante,
          }, now());
        }
        await saveSharedTableState(client, 'casino_poker_tables', roomId, state);
        await client.query('COMMIT');
        return res.json({
          ok: true,
          state: serializePokerClientState(state, auth.userId, pokerSync.activeParticipants),
          profile: await loadProfile(auth.userId),
        });
      }

      state = upsertPokerPendingSeat(state, {
        roomId,
        userId: auth.userId,
        username: auth.user?.username ? String(auth.user.username) : `Joueur ${auth.userId}`,
        ante,
      }, now());
      state = await resolvePokerWaitingState(client, roomId, state, auth.userId);

      await saveSharedTableState(client, 'casino_poker_tables', roomId, state);
      await client.query('COMMIT');

      return res.json({
        ok: true,
        state: serializePokerClientState(state, auth.userId, pokerSync.activeParticipants),
        profile: await loadProfile(auth.userId),
      });
    } catch (error_) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      const code = ['insufficient_credits', 'table_full'].includes(error_?.code)
        ? error_.code
        : 'poker_start_failed';
      logger?.error?.('[CASINO] poker start failed:', error_?.message);
      return res.status(code === 'poker_start_failed' ? 500 : 400).json({ ok: false, error: code });
    } finally {
      client?.release?.();
    }
  });

  router.post('/api/casino/poker/remove-absent', verifyJWT, express.json({ limit: '64kb' }), async (req, res) => {
    let client = null;
    try {
      const auth = await requireCasinoUser(req, res);
      if (!auth) return;
      const presenceClientId = getTablePresenceClientIdFromRequest(req);

      const roomId = normalizeTableRoomId('poker', req.body?.roomId);
      const targetUserId = normalizeUserId(req.body?.userId);
      if (!roomId || !targetUserId || targetUserId === normalizeUserId(auth.userId)) {
        return res.status(400).json({ ok: false, error: 'invalid_target_user' });
      }

      client = await db.connect();
      await client.query('BEGIN');
      await pruneTableRoomPresence(client);
      await touchTableRoomPresence(client, 'poker', roomId, auth.userId, presenceClientId);
      let state = await loadPokerTableState(client, roomId, true);
      const pokerSync = await syncPokerRoomState(client, roomId, state);
      state = pokerSync.state;
      state = (await settleExpiredPokerTurns(client, roomId, state)).state;

      const activeParticipants = await listActiveRoomPresence(client, 'poker', roomId);
      const targetParticipant = activeParticipants.find((entry) => String(entry.userId || '') === targetUserId) || null;
      const targetSeat = (state?.seats || []).find((seat) => String(seat.userId || '') === targetUserId) || null;
      const targetPendingSeat = (state?.pendingSeats || []).find((seat) => String(seat.userId || '') === targetUserId) || null;
      const targetHeartbeatAt = targetParticipant?.updatedAt ? Date.parse(String(targetParticipant.updatedAt || '')) : null;
      const participantIsStale = Number.isFinite(targetHeartbeatAt)
        ? (now().getTime() - Number(targetHeartbeatAt || 0)) >= TABLE_ROOM_TTL_MS
        : false;

      if (!targetParticipant && !targetSeat && !targetPendingSeat) {
        await client.query('ROLLBACK');
        return res.status(400).json({ ok: false, error: 'invalid_target_user' });
      }

      if (targetPendingSeat || (!targetSeat?.isAbsent && !participantIsStale)) {
        await client.query('ROLLBACK');
        return res.status(400).json({ ok: false, error: 'target_not_absent' });
      }

      await removeTableRoomPresence(client, 'poker', roomId, targetUserId);
      const refreshedPokerSync = await syncPokerRoomState(client, roomId, state);
      state = refreshedPokerSync.state;
      state = await resolvePokerWaitingState(client, roomId, state);
      await saveSharedTableState(client, 'casino_poker_tables', roomId, state);
      const lobby = await buildTableRoomPayload(client, 'poker', auth.userId, roomId);
      await client.query('COMMIT');

      return res.json({
        ok: true,
        state: serializePokerClientState(state, auth.userId, refreshedPokerSync.activeParticipants),
        rooms: lobby.rooms,
        profile: await loadProfile(auth.userId),
      });
    } catch (error_) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      const code = ['invalid_target_user', 'target_not_absent'].includes(error_?.code)
        ? error_.code
        : 'poker_remove_absent_failed';
      logger?.error?.('[CASINO] poker remove absent failed:', error_?.message);
      return res.status(code === 'poker_remove_absent_failed' ? 500 : 400).json({ ok: false, error: code });
    } finally {
      client?.release?.();
    }
  });

  router.post('/api/casino/poker/action', verifyJWT, express.json({ limit: '64kb' }), async (req, res) => {
    let client = null;
    try {
      const auth = await requireCasinoUser(req, res);
      if (!auth) return;
      const presenceClientId = getTablePresenceClientIdFromRequest(req);

      const rawAction = normalizeText(req.body?.action).toLowerCase();
      const action = rawAction === 'reveal' || rawAction === 'showdown' ? 'check' : rawAction;
      if (!['check', 'call', 'bet', 'raise', 'fold'].includes(action)) {
        return res.status(400).json({ ok: false, error: 'invalid_action' });
      }
      const parsedToken = parsePokerToken(req.body?.token);
      if (!parsedToken?.roomId) {
        return res.status(400).json({ ok: false, error: 'invalid_round_token' });
      }

      client = await db.connect();
      await client.query('BEGIN');
      await pruneTableRoomPresence(client);
      await touchTableRoomPresence(client, 'poker', parsedToken.roomId, auth.userId, presenceClientId);
      const pokerParticipants = await listActiveRoomPresence(client, 'poker', parsedToken.roomId);
      const previousState = await loadPokerTableState(client, parsedToken.roomId, true);
      if (Number(previousState.handId || 0) !== Number(parsedToken.handId || 0)) {
        await client.query('ROLLBACK');
        return res.status(400).json({ ok: false, error: 'invalid_round_token' });
      }

      const pokerTimeoutSync = await settleExpiredPokerTurns(client, parsedToken.roomId, previousState);
      const settledState = pokerTimeoutSync.state;
      if (pokerTimeoutSync.changed) {
        await saveSharedTableState(client, 'casino_poker_tables', parsedToken.roomId, settledState);
        await client.query('COMMIT');
        return res.status(400).json({
          ok: false,
          error: ['preflop', 'flop', 'turn', 'river'].includes(String(settledState.stage || '')) ? 'not_your_turn' : 'invalid_round_token',
        });
      }

      const actingSeatBefore = settledState.seats?.[settledState.actingSeatIndex] || null;
      const nextState = applySharedPokerAction(settledState, {
        userId: auth.userId,
        action,
        amount: clampInteger(req.body?.amount, 0, 1000000, 0),
        now: now(),
      }, {
        evaluateBestPokerHand,
        comparePokerScores,
      });

      const actingSeatAfter = (nextState.seats || []).find((seat) => String(seat.userId || '') === auth.userId) || null;
      const wagerAmount = Math.max(0, Number(actingSeatAfter?.totalCommitted || 0) - Number(actingSeatBefore?.totalCommitted || 0));
      if (wagerAmount > 0) {
        await chargeWalletForTable(client, auth.userId, wagerAmount, `poker_${action}`, {
          roomId: parsedToken.roomId,
          handId: Number(nextState.handId || 0),
          stage: nextState.stage,
          targetBet: Number(actingSeatAfter?.streetCommitted || 0),
          potAfter: Number(nextState.pot || 0),
        });
      }

      if (nextState.stage === 'showdown') {
        for (const seat of nextState.seats || []) {
          if (Number(seat.payoutAmount || 0) > 0) {
            await creditWalletForTable(client, seat.userId, seat.payoutAmount, 'poker_payout', {
              roomId: parsedToken.roomId,
              handId: Number(nextState.handId || 0),
              ante: Number(nextState.ante || 0),
              committed: Number(seat.totalCommitted || 0),
              pot: Number(nextState.pot || 0),
              message: nextState.message,
            });
          }
        }
      }

      await saveSharedTableState(client, 'casino_poker_tables', parsedToken.roomId, nextState);
      await client.query('COMMIT');

      return res.json({
        ok: true,
        state: serializePokerClientState(nextState, auth.userId, pokerParticipants),
        profile: await loadProfile(auth.userId),
      });
    } catch (error_) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      const code = ['invalid_round_token', 'invalid_action', 'not_your_turn', 'insufficient_credits'].includes(error_?.code)
        ? error_.code
        : 'poker_action_failed';
      logger?.error?.('[CASINO] poker action failed:', error_?.message);
      return res.status(code === 'poker_action_failed' ? 500 : 400).json({ ok: false, error: code });
    } finally {
      client?.release?.();
    }
  });

  router.get('/api/casino/roulette/state', verifyJWT, async (req, res) => {
    let client = null;
    try {
      const auth = await requireCasinoUser(req, res);
      if (!auth) return;
      const presenceClientId = getTablePresenceClientIdFromRequest(req);

      const compactView = isCompactRouletteView(req);
      const includeProfile = shouldIncludeRouletteProfile(req, true);
      const cacheVariant = compactView ? 'compact' : 'full';
      const cachedState = getRouletteStateCacheEntry(auth.userId, cacheVariant);

      client = await db.connect();
      await client.query('BEGIN');
      if (cachedState && !includeProfile) {
        await client.query('COMMIT');
        return res.json(cachedState.payload);
      }
      await pruneTableRoomPresence(client);
      await clearOtherTableRoomPresenceForClient(client, auth.userId, presenceClientId);
      const room = await buildRouletteRoomPayload(client, auth.userId, { compact: compactView });
      await client.query('COMMIT');
      const payload = {
        ok: true,
        room,
        ...(includeProfile ? { profile: await loadProfile(auth.userId) } : {}),
      };
      if (!includeProfile) {
        setRouletteStateCacheEntry(auth.userId, payload, cacheVariant);
      }

      return res.json(payload);
    } catch (error_) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      logger?.error?.('[CASINO] roulette state failed:', error_?.message);
      return res.status(500).json({ ok: false, error: 'roulette_state_failed' });
    } finally {
      client?.release?.();
    }
  });

  router.post('/api/casino/roulette/bet', verifyJWT, express.json({ limit: '64kb' }), async (req, res) => {
    let client = null;
    try {
      const auth = await requireCasinoUser(req, res);
      if (!auth) return;
      const presenceClientId = getTablePresenceClientIdFromRequest(req);

      const compactView = isCompactRouletteView(req);
      const includeProfile = shouldIncludeRouletteProfile(req, true);
      const normalizedBet = normalizeRouletteBet(req.body?.betType, req.body?.betValue);
      if (!normalizedBet) {
        return res.status(400).json({ ok: false, error: 'invalid_bet' });
      }

      const amount = clampInteger(req.body?.amount, ROULETTE_MIN_BET, ROULETTE_MAX_BET, ROULETTE_MIN_BET);

      client = await db.connect();
      await client.query('BEGIN');
      await pruneTableRoomPresence(client);
      await clearOtherTableRoomPresenceForClient(client, auth.userId, presenceClientId);
      const { currentRound, roomActive } = await ensureCurrentRouletteRound(client, ROULETTE_ROOM_ID, { activateRound: true });
      if (!roomActive || !currentRound?.closes_at) {
        await client.query('ROLLBACK');
        return res.status(409).json({ ok: false, error: 'roulette_room_inactive' });
      }
      if (now().getTime() >= new Date(currentRound.closes_at).getTime()) {
        await client.query('ROLLBACK');
        return res.status(409).json({ ok: false, error: 'roulette_round_closed' });
      }

      const walletRow = await getWalletRow(auth.userId, client, true);
      const currentBalance = Number(walletRow?.balance || 0);
      if (currentBalance < amount) {
        await client.query('ROLLBACK');
        return res.status(400).json({ ok: false, error: 'insufficient_credits' });
      }

      const nextBalance = currentBalance - amount;
      await applyWalletDeltas(client, auth.userId, {
        balance: nextBalance,
        lifetimeWagered: amount,
        lifetimeWon: 0,
        gamesPlayed: 0,
      });
      await client.query(
        `
          INSERT INTO casino_roulette_bets (room_id, round_id, user_id, bet_type, bet_value, amount, payout)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
        `,
        [ROULETTE_ROOM_ID, currentRound.id, auth.userId, normalizedBet.betType, normalizedBet.betValue, amount, 0]
      );
      await appendTransaction(client, {
        userId: auth.userId,
        kind: 'roulette_bet',
        amount: -amount,
        balanceAfter: nextBalance,
        metadata: {
          roomId: ROULETTE_ROOM_ID,
          roundId: Number(currentRound.id),
          betType: normalizedBet.betType,
          betValue: normalizedBet.betValue,
        },
      });

      const room = await buildRouletteRoomPayload(client, auth.userId, { compact: compactView });
      await client.query('COMMIT');
      clearRouletteStateCache();

      return res.json({
        ok: true,
        room,
        ...(includeProfile ? { profile: await loadProfile(auth.userId) } : {}),
      });
    } catch (error_) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      logger?.error?.('[CASINO] roulette bet failed:', error_?.message);
      return res.status(500).json({ ok: false, error: 'roulette_bet_failed' });
    } finally {
      client?.release?.();
    }
  });

  router.bootstrapCasinoStorage = () => ensureTables();
  return router;
}

module.exports = createCasinoRouter;
module.exports.__private = {
  applyJokerBonus,
  buildSpinOutcome,
  buildWalletPayload,
  detectJokerBonusTrigger,
  detectJokerCross,
  evaluateSpinGrid,
};
