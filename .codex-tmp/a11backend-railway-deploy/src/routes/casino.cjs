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
const ROULETTE_ROUND_DURATION_MS = 25 * 1000;
const ROULETTE_RECENT_RESULTS_LIMIT = 8;
const TABLE_ROOM_TTL_MS = 90 * 1000;
const BLACKJACK_ROOM_IDS = ['lantern-quay', 'bat-parlor', 'scream-lounge'];
const POKER_ROOM_IDS = ['allmight-ring', 'upstream-port', 'captains-table'];
const JOKER_BONUS_RESPINS = 3;
const JOKER_BONUS_STAGE_HOLD_MS = 720;
const JOKER_BONUS_TRIGGER_COUNT = 5;
const JOKER_CROSS_INDEXES = [0, 2, 4, 6, 8, 10, 12, 14];

const SYMBOLS = [
  { id: 'PIRATE', label: 'Pavillon noir', weight: 7, payouts: { 3: 12, 4: 28, 5: 75 } },
  { id: 'CHEST', label: 'Coffre', weight: 10, payouts: { 3: 8, 4: 18, 5: 40 } },
  { id: 'COIN', label: 'Piastres', weight: 14, payouts: { 3: 6, 4: 12, 5: 22 } },
  { id: 'BAT', label: 'Chauve-souris', weight: 12, payouts: { 3: 5, 4: 10, 5: 18 } },
  { id: 'BLUNDERBUSS', label: 'Canon court', weight: 11, payouts: { 3: 7, 4: 14, 5: 26 } },
  { id: 'MAP', label: 'Carte au tresor', weight: 10, payouts: { 3: 9, 4: 18, 5: 34 } },
  { id: 'PARROT', label: 'Perroquet', weight: 10, payouts: { 3: 8, 4: 16, 5: 30 } },
  { id: 'SOLDAT', label: 'Spartiate', weight: 8, payouts: { 3: 12, 4: 26, 5: 60 } },
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
  return JOKER_CROSS_INDEXES.every((index) => {
    const rowIndex = Math.floor(index / REEL_COUNT);
    const columnIndex = index % REEL_COUNT;
    return grid?.[rowIndex]?.[columnIndex] === 'JOKER';
  });
}

function detectJokerBonusTrigger(grid) {
  const jokerIndexes = listSymbolIndexes(grid, 'JOKER');
  let bestLine = null;

  PAYLINES.forEach((lineRows, lineIndex) => {
    const indexes = listJokerLineIndexes(grid, lineRows);
    const jokerCount = indexes.length;
    if (jokerCount < 3) return;
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
  return Math.min(0.78, Number((0.18 + heldRatio * 0.34 + stageIndex * 0.15).toFixed(4)));
}

function normalizeUserId(value) {
  return String(value || '').trim();
}

function normalizeText(value) {
  return String(value || '').trim();
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

    for (let rowIndex = 0; rowIndex < ROW_COUNT; rowIndex += 1) {
      for (let columnIndex = 0; columnIndex < REEL_COUNT; columnIndex += 1) {
        if (currentGrid?.[rowIndex]?.[columnIndex] === 'JOKER') continue;
        if (randomInt(10000) < threshold) {
          nextGrid[rowIndex][columnIndex] = 'JOKER';
        }
      }
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

  return {
    wins,
    totalPayout,
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
            updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
            created_at TIMESTAMP DEFAULT NOW(),
            PRIMARY KEY (game, room_id, user_id)
          )
        `);
        await db.query('CREATE INDEX IF NOT EXISTS idx_casino_transactions_user_created ON casino_transactions (user_id, created_at DESC)');
        await db.query('CREATE INDEX IF NOT EXISTS idx_casino_roulette_rounds_room_created ON casino_roulette_rounds (room_id, created_at DESC)');
        await db.query('CREATE INDEX IF NOT EXISTS idx_casino_roulette_bets_round_created ON casino_roulette_bets (round_id, created_at ASC)');
        await db.query('CREATE INDEX IF NOT EXISTS idx_casino_table_room_presence_game_room_updated ON casino_table_room_presence (game, room_id, updated_at DESC)');
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

  async function pruneTableRoomPresence(client) {
    const thresholdIso = new Date(now().getTime() - TABLE_ROOM_TTL_MS).toISOString();
    await client.query(
      'DELETE FROM casino_table_room_presence WHERE updated_at < $1',
      [thresholdIso]
    );
  }

  async function touchTableRoomPresence(client, game, roomId, userId) {
    const updatedAtIso = now().toISOString();
    await client.query(
      `
        INSERT INTO casino_table_room_presence (game, room_id, user_id, updated_at)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (game, room_id, user_id)
        DO UPDATE SET updated_at = EXCLUDED.updated_at
      `,
      [game, roomId, userId, updatedAtIso]
    );
  }

  async function buildTableRoomPayload(client, game, currentUserId, currentRoomId = null) {
    const roomIds = getTableRoomIds(game);
    const effectiveRoomId = normalizeTableRoomId(game, currentRoomId);
    const thresholdIso = new Date(now().getTime() - TABLE_ROOM_TTL_MS).toISOString();
    const { rows } = await client.query(
      `
        SELECT room_id, user_id, updated_at
        FROM casino_table_room_presence
        WHERE game = $1 AND updated_at >= $2
        ORDER BY updated_at DESC
      `,
      [game, thresholdIso]
    );

    const rooms = [];
    for (const roomId of roomIds) {
      const roomRows = rows.filter((entry) => String(entry.room_id || '') === roomId);
      const participants = [];
      for (const row of roomRows.slice(0, 8)) {
        const user = await getUserRow(String(row.user_id || ''));
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

  function resolveUserId(req) {
    return normalizeUserId(req?.user?.id || req?.user?.sub || '');
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
            bets: entry.bets,
          },
        });
      }
    }

    return {
      ...round,
      winning_number: winningNumber,
      winning_color: winningColor,
      resolved_at: resolvedAtIso,
    };
  }

  async function ensureCurrentRouletteRound(client, roomId = ROULETTE_ROOM_ID) {
    let latest = await getLatestRouletteRound(client, roomId, true);
    const currentTime = now();

    if (!latest) {
      return {
        currentRound: await createRouletteRound(client, roomId, currentTime),
        latestResolved: null,
      };
    }

    let latestResolved = latest?.resolved_at ? latest : null;
    const closesAtMs = latest?.closes_at ? new Date(latest.closes_at).getTime() : 0;

    if (!latest.resolved_at && closesAtMs && currentTime.getTime() >= closesAtMs) {
      latestResolved = await resolveRouletteRound(client, latest);
      latest = await createRouletteRound(client, roomId, currentTime);
      return { currentRound: latest, latestResolved };
    }

    if (latest.resolved_at) {
      latest = await createRouletteRound(client, roomId, currentTime);
      return { currentRound: latest, latestResolved };
    }

    return { currentRound: latest, latestResolved };
  }

  async function buildRouletteRoomPayload(client, userId) {
    const { currentRound, latestResolved } = await ensureCurrentRouletteRound(client, ROULETTE_ROOM_ID);
    const currentBets = await getRouletteBetsForRound(client, currentRound.id);
    const recentResultRows = (await client.query(
      'SELECT id, winning_number, winning_color, resolved_at FROM casino_roulette_rounds WHERE room_id = $1 AND resolved_at IS NOT NULL ORDER BY id DESC LIMIT $2',
      [ROULETTE_ROOM_ID, ROULETTE_RECENT_RESULTS_LIMIT]
    )).rows;

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
      const user = await getUserRow(entry.userId);
      participants.push({
        userId: entry.userId,
        username: user?.username ? String(user.username) : `Joueur ${entry.userId}`,
        totalAmount: entry.totalAmount,
        betCount: entry.betCount,
      });
    }

    return {
      id: ROULETTE_ROOM_ID,
      round: {
        id: Number(currentRound.id),
        opensAt: currentRound.opens_at ? new Date(currentRound.opens_at).toISOString() : null,
        closesAt: currentRound.closes_at ? new Date(currentRound.closes_at).toISOString() : null,
        remainingMs: Math.max(0, new Date(currentRound.closes_at).getTime() - now().getTime()),
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

  function resolvePokerShowdown(state, forceFold = false) {
    const fullBoard = state.communityReserve.slice(0, 5);
    const resolvedAiSeats = state.aiSeats.map((seat) => {
      const hand = evaluateBestPokerHand([...seat.cards, ...fullBoard]);
      return {
        ...seat,
        hand,
        isWinner: false,
        read: hand.label,
      };
    });

    const playerFolded = Boolean(forceFold || state.playerFolded);
    const playerHand = playerFolded ? null : evaluateBestPokerHand([...state.playerCards, ...fullBoard]);

    let bestScore = playerHand;
    resolvedAiSeats.forEach((seat) => {
      if (!bestScore || comparePokerScores(seat.hand, bestScore) > 0) {
        bestScore = seat.hand;
      }
    });

    const winningAiIds = resolvedAiSeats
      .filter((seat) => bestScore && comparePokerScores(seat.hand, bestScore) === 0)
      .map((seat) => seat.id);
    const playerWins = Boolean(playerHand && bestScore && comparePokerScores(playerHand, bestScore) === 0);
    const winnersCount = winningAiIds.length + (playerWins ? 1 : 0);
    const share = winnersCount ? Math.floor(state.pot / winnersCount) : 0;

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
      lastDelta: playerWins ? share - state.ante : -state.ante,
      message: playerWins
        ? `Showdown propre. Tu prends ${share} jetons avec ${playerHand?.label.toLowerCase()}.`
        : playerFolded
          ? 'Tu couches la main. Le pot part chez les IA.'
          : `Le pot glisse ailleurs. La meilleure main est ${bestScore?.label.toLowerCase()}.`,
    };
  }

  function serializePokerState(state) {
    return {
      token: state.stage !== 'showdown' ? encodeRoundToken(state, roundTokenSecret) : null,
      roomId: normalizeTableRoomId('poker', state.roomId),
      stage: state.stage,
      stageLabel: getPokerStageLabel(state.stage),
      ante: state.ante,
      pot: state.pot,
      playerCards: state.playerCards,
      communityCards: state.stage === 'showdown' ? state.communityReserve : state.communityCards,
      aiSeats: state.aiSeats,
      playerFolded: state.playerFolded,
      playerHand: state.playerFolded ? null : state.playerHand || evaluateBestPokerHand([...state.playerCards, ...state.communityCards]),
      lastDelta: state.lastDelta,
      payoutAmount: Number(state.payoutAmount || 0),
      message: state.message,
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
        lifetimeWagered: MAP_ROOM_COST,
        lifetimeWon: reward,
        gamesPlayed: 1,
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

      const roomId = normalizeTableRoomId(game, req.body?.roomId);
      if (!roomId) {
        return res.status(400).json({ ok: false, error: 'invalid_room' });
      }

      client = await db.connect();
      await client.query('BEGIN');
      await pruneTableRoomPresence(client);
      await touchTableRoomPresence(client, game, roomId, auth.userId);
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

  router.post('/api/casino/blackjack/start', verifyJWT, express.json({ limit: '64kb' }), async (req, res) => {
    let client = null;
    try {
      const auth = await requireCasinoUser(req, res);
      if (!auth) return;

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
      await touchTableRoomPresence(client, 'blackjack', roomId, auth.userId);
      const walletRow = await getWalletRow(auth.userId, client, true);
      const currentBalance = Number(walletRow?.balance || 0);
      if (currentBalance < wager) {
        await client.query('ROLLBACK');
        return res.status(400).json({ ok: false, error: 'insufficient_credits' });
      }

      const nextBalance = currentBalance - wager;
      await applyWalletDeltas(client, auth.userId, {
        balance: nextBalance,
        lifetimeWagered: wager,
        lifetimeWon: 0,
        gamesPlayed: 1,
      });
      await appendTransaction(client, {
        userId: auth.userId,
        kind: 'blackjack_buyin',
        amount: -wager,
        balanceAfter: nextBalance,
        metadata: { wager },
      });
      await client.query('COMMIT');

      let workingDeck = createPirateDeck(random);
      const playerOpening = drawCards(workingDeck, 2);
      workingDeck = playerOpening.deck;
      const dealerOpening = drawCards(workingDeck, 2);
      workingDeck = dealerOpening.deck;
      const aiSeats = buildBlackjackAiSeats().map((seat) => {
        const dealt = drawCards(workingDeck, 2);
        workingDeck = dealt.deck;
        return {
          ...seat,
          chips: seat.chips - seat.wager,
          cards: dealt.cards,
          result: 'en jeu',
          mood: describeHoleCards(dealt.cards),
        };
      });

      let state = {
        game: 'blackjack',
        deck: workingDeck,
        roomId,
        playerCards: playerOpening.cards,
        dealerCards: dealerOpening.cards,
        aiSeats,
        wager,
        dealerHidden: true,
        stage: 'player-turn',
        payoutAmount: 0,
        lastDelta: -wager,
        message: 'Le sabot est chaud. A toi de tirer ou de rester.',
      };

      if (getBlackjackScore(playerOpening.cards).isBlackjack) {
        state = settleBlackjackState(state);
        if (Number(state.payoutAmount || 0) > 0) {
          await client.query('BEGIN');
          const payoutWallet = await getWalletRow(auth.userId, client, true);
          const payoutBalance = Number(payoutWallet?.balance || 0) + Number(state.payoutAmount || 0);
          await applyWalletDeltas(client, auth.userId, {
            balance: payoutBalance,
            lifetimeWagered: 0,
            lifetimeWon: Number(state.payoutAmount || 0),
            gamesPlayed: 0,
          });
          await appendTransaction(client, {
            userId: auth.userId,
            kind: 'blackjack_payout',
            amount: Number(state.payoutAmount || 0),
            balanceAfter: payoutBalance,
            metadata: {
              wager,
              message: state.message,
            },
          });
          await client.query('COMMIT');
        }
      }

      return res.json({
        ok: true,
        state: serializeBlackjackState(state),
        profile: await loadProfile(auth.userId),
      });
    } catch (error_) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      logger?.error?.('[CASINO] blackjack start failed:', error_?.message);
      return res.status(500).json({ ok: false, error: 'blackjack_start_failed' });
    } finally {
      client?.release?.();
    }
  });

  router.post('/api/casino/blackjack/action', verifyJWT, express.json({ limit: '64kb' }), async (req, res) => {
    let client = null;
    try {
      const auth = await requireCasinoUser(req, res);
      if (!auth) return;

      const action = normalizeText(req.body?.action).toLowerCase();
      if (!['hit', 'stand'].includes(action)) {
        return res.status(400).json({ ok: false, error: 'invalid_action' });
      }

      let state = decodeRoundToken(req.body?.token, roundTokenSecret);
      if (state?.game !== 'blackjack' || state.stage !== 'player-turn') {
        return res.status(400).json({ ok: false, error: 'invalid_round_token' });
      }

      client = await db.connect();
      await client.query('BEGIN');
      await pruneTableRoomPresence(client);
      await touchTableRoomPresence(client, 'blackjack', normalizeTableRoomId('blackjack', state.roomId), auth.userId);
      await client.query('COMMIT');
      client.release();
      client = null;

      if (action === 'hit') {
        const draw = drawCards(state.deck, 1);
        state = {
          ...state,
          playerCards: [...state.playerCards, ...draw.cards],
          deck: draw.deck,
          message: 'Encore une carte. Le croupier te regarde sans broncher.',
        };
        if (getBlackjackScore(state.playerCards).isBust) {
          state = settleBlackjackState(state);
        }
      } else {
        state = settleBlackjackState(state);
      }

      if (state.stage === 'resolved' && Number(state.payoutAmount || 0) > 0) {
        client = await db.connect();
        await client.query('BEGIN');
        const walletRow = await getWalletRow(auth.userId, client, true);
        const nextBalance = Number(walletRow?.balance || 0) + Number(state.payoutAmount || 0);
        await applyWalletDeltas(client, auth.userId, {
          balance: nextBalance,
          lifetimeWagered: 0,
          lifetimeWon: Number(state.payoutAmount || 0),
          gamesPlayed: 0,
        });
        await appendTransaction(client, {
          userId: auth.userId,
          kind: 'blackjack_payout',
          amount: Number(state.payoutAmount || 0),
          balanceAfter: nextBalance,
          metadata: {
            wager: Number(state.wager || 0),
            message: state.message,
          },
        });
        await client.query('COMMIT');
      }

      return res.json({
        ok: true,
        state: serializeBlackjackState(state),
        profile: state.stage === 'resolved' ? await loadProfile(auth.userId) : null,
      });
    } catch (error_) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      const code = error_?.code === 'invalid_round_token' ? 'invalid_round_token' : 'blackjack_action_failed';
      logger?.error?.('[CASINO] blackjack action failed:', error_?.message);
      return res.status(code === 'invalid_round_token' ? 400 : 500).json({ ok: false, error: code });
    } finally {
      client?.release?.();
    }
  });

  router.post('/api/casino/poker/start', verifyJWT, express.json({ limit: '64kb' }), async (req, res) => {
    let client = null;
    try {
      const auth = await requireCasinoUser(req, res);
      if (!auth) return;

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
      await touchTableRoomPresence(client, 'poker', roomId, auth.userId);
      const walletRow = await getWalletRow(auth.userId, client, true);
      const currentBalance = Number(walletRow?.balance || 0);
      if (currentBalance < ante) {
        await client.query('ROLLBACK');
        return res.status(400).json({ ok: false, error: 'insufficient_credits' });
      }

      const nextBalance = currentBalance - ante;
      await applyWalletDeltas(client, auth.userId, {
        balance: nextBalance,
        lifetimeWagered: ante,
        lifetimeWon: 0,
        gamesPlayed: 1,
      });
      await appendTransaction(client, {
        userId: auth.userId,
        kind: 'poker_buyin',
        amount: -ante,
        balanceAfter: nextBalance,
        metadata: { ante },
      });
      await client.query('COMMIT');

      let workingDeck = createPirateDeck(random);
      const playerDeal = drawCards(workingDeck, 2);
      workingDeck = playerDeal.deck;
      const aiSeats = buildPokerSeats().map((seat) => {
        const dealt = drawCards(workingDeck, 2);
        workingDeck = dealt.deck;
        return {
          ...seat,
          chips: seat.chips - ante,
          cards: dealt.cards,
          hand: null,
          read: describeHoleCards(dealt.cards),
          isWinner: false,
        };
      });
      const board = drawCards(workingDeck, 5);
      const state = {
        game: 'poker',
        roomId,
        ante,
        stage: 'preflop',
        pot: ante * (aiSeats.length + 1),
        playerCards: playerDeal.cards,
        communityCards: [],
        communityReserve: board.cards,
        aiSeats,
        playerFolded: false,
        playerHand: null,
        payoutAmount: 0,
        lastDelta: -ante,
        message: 'Les antes tombent sur le feutre. La table attend le flop.',
      };

      return res.json({
        ok: true,
        state: serializePokerState(state),
        profile: await loadProfile(auth.userId),
      });
    } catch (error_) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      logger?.error?.('[CASINO] poker start failed:', error_?.message);
      return res.status(500).json({ ok: false, error: 'poker_start_failed' });
    } finally {
      client?.release?.();
    }
  });

  router.post('/api/casino/poker/action', verifyJWT, express.json({ limit: '64kb' }), async (req, res) => {
    let client = null;
    try {
      const auth = await requireCasinoUser(req, res);
      if (!auth) return;

      const action = normalizeText(req.body?.action).toLowerCase();
      if (!['reveal', 'showdown', 'fold'].includes(action)) {
        return res.status(400).json({ ok: false, error: 'invalid_action' });
      }

      let state = decodeRoundToken(req.body?.token, roundTokenSecret);
      if (state?.game !== 'poker' || state.stage === 'showdown') {
        return res.status(400).json({ ok: false, error: 'invalid_round_token' });
      }

      client = await db.connect();
      await client.query('BEGIN');
      await pruneTableRoomPresence(client);
      await touchTableRoomPresence(client, 'poker', normalizeTableRoomId('poker', state.roomId), auth.userId);
      await client.query('COMMIT');
      client.release();
      client = null;

      if (action === 'reveal') {
        if (state.stage === 'preflop') {
          const nextCommunity = state.communityReserve.slice(0, 3);
          state = {
            ...state,
            stage: 'flop',
            communityCards: nextCommunity,
            aiSeats: state.aiSeats.map((seat) => ({
              ...seat,
              read: evaluateBestPokerHand([...seat.cards, ...nextCommunity]).label.toLowerCase(),
            })),
            message: "Le flop est dehors. Les regards se ferment et la fumee s'epaissit.",
          };
        } else if (state.stage === 'flop') {
          const nextCommunity = state.communityReserve.slice(0, 4);
          state = {
            ...state,
            stage: 'turn',
            communityCards: nextCommunity,
            aiSeats: state.aiSeats.map((seat) => ({
              ...seat,
              read: evaluateBestPokerHand([...seat.cards, ...nextCommunity]).label.toLowerCase(),
            })),
            message: 'La turn change la temperature de la table.',
          };
        } else if (state.stage === 'turn') {
          const nextCommunity = state.communityReserve.slice(0, 5);
          state = {
            ...state,
            stage: 'river',
            communityCards: nextCommunity,
            aiSeats: state.aiSeats.map((seat) => ({
              ...seat,
              read: evaluateBestPokerHand([...seat.cards, ...nextCommunity]).label.toLowerCase(),
            })),
            message: 'River ouverte. Les jeux sont presque faits.',
          };
        } else {
          return res.status(400).json({ ok: false, error: 'invalid_action' });
        }
      } else {
        state = resolvePokerShowdown(state, action === 'fold');
      }

      if (state.stage === 'showdown' && Number(state.payoutAmount || 0) > 0) {
        client = await db.connect();
        await client.query('BEGIN');
        const walletRow = await getWalletRow(auth.userId, client, true);
        const nextBalance = Number(walletRow?.balance || 0) + Number(state.payoutAmount || 0);
        await applyWalletDeltas(client, auth.userId, {
          balance: nextBalance,
          lifetimeWagered: 0,
          lifetimeWon: Number(state.payoutAmount || 0),
          gamesPlayed: 0,
        });
        await appendTransaction(client, {
          userId: auth.userId,
          kind: 'poker_payout',
          amount: Number(state.payoutAmount || 0),
          balanceAfter: nextBalance,
          metadata: {
            ante: Number(state.ante || 0),
            pot: Number(state.pot || 0),
            message: state.message,
          },
        });
        await client.query('COMMIT');
      }

      return res.json({
        ok: true,
        state: serializePokerState(state),
        profile: state.stage === 'showdown' ? await loadProfile(auth.userId) : null,
      });
    } catch (error_) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      const code = error_?.code === 'invalid_round_token' ? 'invalid_round_token' : 'poker_action_failed';
      logger?.error?.('[CASINO] poker action failed:', error_?.message);
      return res.status(code === 'invalid_round_token' ? 400 : 500).json({ ok: false, error: code });
    } finally {
      client?.release?.();
    }
  });

  router.get('/api/casino/roulette/state', verifyJWT, async (req, res) => {
    let client = null;
    try {
      const auth = await requireCasinoUser(req, res);
      if (!auth) return;

      client = await db.connect();
      await client.query('BEGIN');
      const room = await buildRouletteRoomPayload(client, auth.userId);
      await client.query('COMMIT');

      return res.json({
        ok: true,
        room,
        profile: await loadProfile(auth.userId),
      });
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

      const normalizedBet = normalizeRouletteBet(req.body?.betType, req.body?.betValue);
      if (!normalizedBet) {
        return res.status(400).json({ ok: false, error: 'invalid_bet' });
      }

      const amount = clampInteger(req.body?.amount, ROULETTE_MIN_BET, ROULETTE_MAX_BET, ROULETTE_MIN_BET);

      client = await db.connect();
      await client.query('BEGIN');
      const { currentRound } = await ensureCurrentRouletteRound(client, ROULETTE_ROOM_ID);
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

      const room = await buildRouletteRoomPayload(client, auth.userId);
      await client.query('COMMIT');

      return res.json({
        ok: true,
        room,
        profile: await loadProfile(auth.userId),
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
