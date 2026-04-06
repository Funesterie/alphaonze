const MAP_ROOM_COST = 90;
const MAP_REWARD = 340;
const TREASURE_POINTS = [
  { id: 'west', left: '24.8%', top: '37.4%', label: 'Recif ouest' },
  { id: 'south', left: '35.6%', top: '69.7%', label: 'Maree du sud' },
  { id: 'east', left: '68.3%', top: '53.8%', label: 'Crique est' },
];

const HUNT_ROOM_COST = 120;
const HUNT_SHOTS_PER_ROUND = 3;
const HUNT_PRIZES = [
  { reward: 520, label: 'Opale reine' },
  { reward: 320, label: 'Rubis braise' },
  { reward: 180, label: 'Saphir du sillage' },
];

const BLACKJACK_PLAYER_BETS = [50, 100, 200, 400];
const BLACKJACK_AI_NAMES = ['Mira Voss', 'Blaise Flint', 'Nox Vale', 'Soren Pike'];

const POKER_ANTE_PRESETS = [60, 120, 200, 320];
const POKER_AI_NAMES = ['Iris Dray', 'Cain Voss', 'Leda Crow', 'Marek Tide'];
const POKER_CATEGORY_LABELS = [
  'Carte haute',
  'Une paire',
  'Deux paires',
  'Brelan',
  'Suite',
  'Couleur',
  'Full',
  'Carre',
  'Quinte flush',
];

const PIRATE_SUITS = ['flintlock', 'elephant', 'bat', 'legion'];
const PIRATE_RANKS = [
  { rank: '2', value: 2, blackjackValue: 2 },
  { rank: '3', value: 3, blackjackValue: 3 },
  { rank: '4', value: 4, blackjackValue: 4 },
  { rank: '5', value: 5, blackjackValue: 5 },
  { rank: '6', value: 6, blackjackValue: 6 },
  { rank: '7', value: 7, blackjackValue: 7 },
  { rank: '8', value: 8, blackjackValue: 8 },
  { rank: '9', value: 9, blackjackValue: 9 },
  { rank: '10', value: 10, blackjackValue: 10 },
  { rank: 'V', value: 11, blackjackValue: 10 },
  { rank: 'D', value: 12, blackjackValue: 10 },
  { rank: 'R', value: 13, blackjackValue: 10 },
  { rank: 'A', value: 14, blackjackValue: 11 },
];

const ROULETTE_MIN_BET = 20;
const ROULETTE_MAX_BET = 1000;
const ROULETTE_RED_NUMBERS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const ROULETTE_BET_MULTIPLIERS = {
  straight: 36,
  color: 2,
  parity: 2,
  lowhigh: 2,
  dozen: 3,
  column: 3,
};

function normalizeText(value) {
  return String(value || '').trim();
}

function clampInteger(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, Math.round(numeric)));
}

function shuffleIndexes(length, randomInt) {
  const values = Array.from({ length }, (_, index) => index);
  for (let index = values.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1);
    const current = values[index];
    values[index] = values[swapIndex];
    values[swapIndex] = current;
  }
  return values;
}

function buildTreasureHuntBoard(randomInt) {
  const slots = shuffleIndexes(9, randomInt).slice(0, HUNT_PRIZES.length);
  return Array.from({ length: 9 }, (_, index) => {
    const prizeIndex = slots.indexOf(index);
    return prizeIndex >= 0 ? HUNT_PRIZES[prizeIndex].reward : 0;
  });
}

function getTreasurePrizeMeta(reward) {
  return HUNT_PRIZES.find((entry) => entry.reward === reward) || null;
}

function maskTreasureHuntBoard(board, revealed, revealAll = false) {
  const revealedSet = new Set((revealed || []).map((value) => Number(value)));
  return board.map((reward, index) => {
    const isVisible = revealAll || revealedSet.has(index);
    const prize = getTreasurePrizeMeta(reward);
    return {
      id: index,
      revealed: isVisible,
      reward: isVisible ? Number(reward || 0) : null,
      label: isVisible && prize ? prize.label : null,
    };
  });
}

function createPirateDeck(randomInt) {
  const deck = PIRATE_SUITS.flatMap((suit) =>
    PIRATE_RANKS.map((entry) => ({
      id: `${entry.rank}-${suit}`,
      suit,
      rank: entry.rank,
      rankValue: entry.value,
      blackjackValue: entry.blackjackValue,
      sortValue: entry.value,
    }))
  );

  for (let index = deck.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1);
    const current = deck[index];
    deck[index] = deck[swapIndex];
    deck[swapIndex] = current;
  }

  return deck;
}

function drawCards(deck, count) {
  const nextDeck = deck.slice();
  const cards = [];
  for (let index = 0; index < count; index += 1) {
    const nextCard = nextDeck.pop();
    if (!nextCard) break;
    cards.push(nextCard);
  }
  return { cards, deck: nextDeck };
}

function getBlackjackScore(cards) {
  let total = cards.reduce((sum, card) => sum + Number(card?.blackjackValue || 0), 0);
  let aces = cards.filter((card) => card?.rank === 'A').length;

  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }

  return {
    total,
    isSoft: cards.some((card) => card?.rank === 'A') && total <= 21 && aces > 0,
    isBlackjack: cards.length === 2 && total === 21,
    isBust: total > 21,
  };
}

function getSortedRanks(cards) {
  return cards
    .map((card) => Number(card?.rankValue || 0))
    .sort((left, right) => right - left);
}

function getStraightHigh(ranks) {
  const uniqueRanks = [...new Set(ranks)].sort((left, right) => left - right);
  if (uniqueRanks.includes(14)) uniqueRanks.unshift(1);

  let currentRun = 1;
  let bestHigh = 0;
  for (let index = 1; index < uniqueRanks.length; index += 1) {
    if (uniqueRanks[index] === uniqueRanks[index - 1] + 1) {
      currentRun += 1;
      if (currentRun >= 5) bestHigh = uniqueRanks[index];
    } else if (uniqueRanks[index] !== uniqueRanks[index - 1]) {
      currentRun = 1;
    }
  }

  return bestHigh;
}

function compareTiebreakers(left, right) {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const leftValue = Number(left[index] || 0);
    const rightValue = Number(right[index] || 0);
    if (leftValue !== rightValue) return leftValue - rightValue;
  }
  return 0;
}

function comparePokerScores(left, right) {
  if (!left && !right) return 0;
  if (!left) return -1;
  if (!right) return 1;
  if (left.category !== right.category) return left.category - right.category;
  return compareTiebreakers(left.tiebreakers || [], right.tiebreakers || []);
}

function evaluateFiveCardHand(cards) {
  const sortedRanks = getSortedRanks(cards);
  const suitBuckets = cards.reduce((bucket, card) => {
    const suit = card?.suit || 'unknown';
    bucket[suit] = bucket[suit] || [];
    bucket[suit].push(card);
    return bucket;
  }, {});
  const flushCards =
    Object.values(suitBuckets).find((bucket) => bucket.length === 5)?.sort(
      (left, right) => right.rankValue - left.rankValue
    ) || null;

  const countMap = new Map();
  sortedRanks.forEach((rank) => {
    countMap.set(rank, (countMap.get(rank) || 0) + 1);
  });
  const countEntries = [...countMap.entries()].sort(
    (left, right) => right[1] - left[1] || right[0] - left[0]
  );

  const straightHigh = getStraightHigh(sortedRanks);
  const flushStraightHigh = flushCards ? getStraightHigh(flushCards.map((card) => card.rankValue)) : 0;

  if (flushCards && flushStraightHigh) return { category: 8, label: POKER_CATEGORY_LABELS[8], tiebreakers: [flushStraightHigh] };
  if (countEntries[0]?.[1] === 4) {
    const quadRank = countEntries[0][0];
    const kicker = countEntries.find((entry) => entry[0] !== quadRank)?.[0] || 0;
    return { category: 7, label: POKER_CATEGORY_LABELS[7], tiebreakers: [quadRank, kicker] };
  }

  const tripRanks = countEntries.filter((entry) => entry[1] >= 3).map((entry) => entry[0]);
  const pairRanks = countEntries.filter((entry) => entry[1] >= 2).map((entry) => entry[0]);
  if (tripRanks.length && (pairRanks.length >= 2 || tripRanks.length >= 2)) {
    const tripRank = tripRanks[0];
    const pairRank = pairRanks.find((rank) => rank !== tripRank) || tripRanks[1];
    return { category: 6, label: POKER_CATEGORY_LABELS[6], tiebreakers: [tripRank, pairRank || 0] };
  }
  if (flushCards) return { category: 5, label: POKER_CATEGORY_LABELS[5], tiebreakers: flushCards.map((card) => card.rankValue) };
  if (straightHigh) return { category: 4, label: POKER_CATEGORY_LABELS[4], tiebreakers: [straightHigh] };
  if (tripRanks.length) {
    const tripRank = tripRanks[0];
    const kickers = sortedRanks.filter((rank) => rank !== tripRank).slice(0, 2);
    return { category: 3, label: POKER_CATEGORY_LABELS[3], tiebreakers: [tripRank, ...kickers] };
  }
  if (pairRanks.length >= 2) {
    const [highPair, lowPair] = pairRanks.slice(0, 2);
    const kicker = sortedRanks.find((rank) => rank !== highPair && rank !== lowPair) || 0;
    return { category: 2, label: POKER_CATEGORY_LABELS[2], tiebreakers: [highPair, lowPair, kicker] };
  }
  if (pairRanks.length === 1) {
    const pairRank = pairRanks[0];
    const kickers = sortedRanks.filter((rank) => rank !== pairRank).slice(0, 3);
    return { category: 1, label: POKER_CATEGORY_LABELS[1], tiebreakers: [pairRank, ...kickers] };
  }
  return { category: 0, label: POKER_CATEGORY_LABELS[0], tiebreakers: sortedRanks };
}

function evaluateBestPokerHand(cards) {
  if (cards.length < 5) {
    return {
      category: 0,
      label: 'Main incomplete',
      tiebreakers: cards.map((card) => card.rankValue).sort((left, right) => right - left),
    };
  }

  let best = evaluateFiveCardHand(cards.slice(0, 5));
  for (let first = 0; first < cards.length - 4; first += 1) {
    for (let second = first + 1; second < cards.length - 3; second += 1) {
      for (let third = second + 1; third < cards.length - 2; third += 1) {
        for (let fourth = third + 1; fourth < cards.length - 1; fourth += 1) {
          for (let fifth = fourth + 1; fifth < cards.length; fifth += 1) {
            const candidate = evaluateFiveCardHand([
              cards[first],
              cards[second],
              cards[third],
              cards[fourth],
              cards[fifth],
            ]);
            if (comparePokerScores(candidate, best) > 0) best = candidate;
          }
        }
      }
    }
  }
  return best;
}

function describeHoleCards(cards) {
  if (cards.length < 2) return 'prend place';
  const [first, second] = cards;
  if (first.rankValue === second.rankValue) return 'ouvre avec une paire';
  if (first.rankValue >= 12 && second.rankValue >= 11) return 'montre des figures';
  if (first.suit === second.suit) return 'cherche une couleur';
  if (Math.abs(first.rankValue - second.rankValue) <= 2) return 'attend une suite';
  return 'reste patient';
}

function getBlackjackPayout(cards, dealerCards, wager) {
  const playerScore = getBlackjackScore(cards);
  const dealerScore = getBlackjackScore(dealerCards);

  if (playerScore.isBust) return { amount: 0, label: 'Brule' };
  if (playerScore.isBlackjack && !dealerScore.isBlackjack) return { amount: Math.round(wager * 2.5), label: 'Blackjack' };
  if (dealerScore.isBust) return { amount: wager * 2, label: 'Le croupier saute' };
  if (dealerScore.isBlackjack && !playerScore.isBlackjack) return { amount: 0, label: 'Le croupier touche blackjack' };
  if (playerScore.total > dealerScore.total) return { amount: wager * 2, label: 'Main gagnante' };
  if (playerScore.total === dealerScore.total) return { amount: wager, label: 'Push' };
  return { amount: 0, label: 'Main perdante' };
}

function completeDealerHand(deck, cards) {
  let workingDeck = deck.slice();
  const nextCards = cards.slice();
  let score = getBlackjackScore(nextCards);

  while (score.total < 17) {
    const draw = drawCards(workingDeck, 1);
    workingDeck = draw.deck;
    if (draw.cards[0]) nextCards.push(draw.cards[0]);
    score = getBlackjackScore(nextCards);
  }

  return { cards: nextCards, deck: workingDeck };
}

function completeAiBlackjackHand(deck, seat) {
  let workingDeck = deck.slice();
  const nextSeat = {
    ...seat,
    cards: seat.cards.slice(),
  };
  let score = getBlackjackScore(nextSeat.cards);

  while (score.total < 17) {
    const draw = drawCards(workingDeck, 1);
    workingDeck = draw.deck;
    if (draw.cards[0]) nextSeat.cards.push(draw.cards[0]);
    score = getBlackjackScore(nextSeat.cards);
  }

  return { seat: nextSeat, deck: workingDeck };
}

function buildBlackjackAiSeats() {
  return BLACKJACK_AI_NAMES.map((name, index) => ({
    id: `blackjack-ai-${index}`,
    name,
    chips: 1800 + index * 220,
    wager: BLACKJACK_PLAYER_BETS[index % BLACKJACK_PLAYER_BETS.length],
    cards: [],
    mood: 'attend la prochaine donne',
    result: 'hors manche',
  }));
}

function buildPokerSeats() {
  return POKER_AI_NAMES.map((name, index) => ({
    id: `poker-ai-${index}`,
    name,
    chips: 2200 + index * 260,
    cards: [],
    hand: null,
    read: 'attend la prochaine main',
    isWinner: false,
  }));
}

function getPokerStageLabel(stage) {
  switch (stage) {
    case 'preflop':
      return 'Preflop';
    case 'flop':
      return 'Flop';
    case 'turn':
      return 'Turn';
    case 'river':
      return 'River';
    case 'showdown':
      return 'Showdown';
    default:
      return 'Table au repos';
  }
}

function getRouletteColor(number) {
  if (number === 0) return 'green';
  return ROULETTE_RED_NUMBERS.has(number) ? 'red' : 'black';
}

function normalizeRouletteBet(rawType, rawValue) {
  const betType = normalizeText(rawType).toLowerCase();
  const betValue = normalizeText(rawValue).toLowerCase();
  if (betType === 'straight') {
    const numeric = clampInteger(betValue, 0, 36, -1);
    if (numeric < 0 || String(numeric) !== betValue) return null;
    return { betType, betValue: String(numeric) };
  }
  if (betType === 'color' && ['red', 'black'].includes(betValue)) return { betType, betValue };
  if (betType === 'parity' && ['even', 'odd'].includes(betValue)) return { betType, betValue };
  if (betType === 'lowhigh' && ['low', 'high'].includes(betValue)) return { betType, betValue };
  if (betType === 'dozen' && ['first12', 'second12', 'third12'].includes(betValue)) return { betType, betValue };
  if (betType === 'column' && ['col1', 'col2', 'col3'].includes(betValue)) return { betType, betValue };
  return null;
}

function resolveRouletteBetPayout({ betType, betValue, amount, winningNumber, winningColor }) {
  const normalizedAmount = Number(amount || 0);
  if (!normalizedAmount) return 0;
  let isWinner = false;
  if (betType === 'straight') isWinner = Number(betValue) === winningNumber;
  if (betType === 'color') isWinner = winningColor !== 'green' && betValue === winningColor;
  if (betType === 'parity' && winningNumber !== 0) isWinner = betValue === (winningNumber % 2 === 0 ? 'even' : 'odd');
  if (betType === 'lowhigh' && winningNumber !== 0) isWinner = betValue === (winningNumber <= 18 ? 'low' : 'high');
  if (betType === 'dozen' && winningNumber >= 1 && winningNumber <= 12) isWinner = betValue === 'first12';
  if (betType === 'dozen' && winningNumber >= 13 && winningNumber <= 24) isWinner = betValue === 'second12';
  if (betType === 'dozen' && winningNumber >= 25 && winningNumber <= 36) isWinner = betValue === 'third12';
  if (betType === 'column' && winningNumber !== 0) isWinner = betValue === `col${((winningNumber - 1) % 3) + 1}`;
  if (!isWinner) return 0;
  return normalizedAmount * Number(ROULETTE_BET_MULTIPLIERS[betType] || 0);
}

module.exports = {
  MAP_ROOM_COST,
  MAP_REWARD,
  TREASURE_POINTS,
  HUNT_ROOM_COST,
  HUNT_SHOTS_PER_ROUND,
  HUNT_PRIZES,
  BLACKJACK_PLAYER_BETS,
  BLACKJACK_AI_NAMES,
  POKER_ANTE_PRESETS,
  POKER_AI_NAMES,
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
};
