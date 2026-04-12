export type PirateSuit = "flintlock" | "elephant" | "bat" | "legion";
export type PirateRank =
  | "2"
  | "3"
  | "4"
  | "5"
  | "6"
  | "7"
  | "8"
  | "9"
  | "10"
  | "V"
  | "D"
  | "R"
  | "A";

export type PiratePlayingCard = {
  id: string;
  suit: PirateSuit;
  rank: PirateRank;
  rankValue: number;
  blackjackValue: number;
  sortValue: number;
};

export type PokerScore = {
  category: number;
  label: string;
  tiebreakers: number[];
};

const SUITS: PirateSuit[] = ["flintlock", "elephant", "bat", "legion"];
const RANKS: Array<{ rank: PirateRank; value: number; blackjackValue: number }> = [
  { rank: "2", value: 2, blackjackValue: 2 },
  { rank: "3", value: 3, blackjackValue: 3 },
  { rank: "4", value: 4, blackjackValue: 4 },
  { rank: "5", value: 5, blackjackValue: 5 },
  { rank: "6", value: 6, blackjackValue: 6 },
  { rank: "7", value: 7, blackjackValue: 7 },
  { rank: "8", value: 8, blackjackValue: 8 },
  { rank: "9", value: 9, blackjackValue: 9 },
  { rank: "10", value: 10, blackjackValue: 10 },
  { rank: "V", value: 11, blackjackValue: 10 },
  { rank: "D", value: 12, blackjackValue: 10 },
  { rank: "R", value: 13, blackjackValue: 10 },
  { rank: "A", value: 14, blackjackValue: 11 },
];

const POKER_CATEGORY_LABELS = [
  "Carte haute",
  "Une paire",
  "Deux paires",
  "Brelan",
  "Suite",
  "Couleur",
  "Full",
  "Carre",
  "Quinte flush",
];

const SUIT_META: Record<PirateSuit, { label: string; glyph: string; accent: string }> = {
  flintlock: { label: "Flintlock", glyph: "✦", accent: "#ff8f5c" },
  elephant: { label: "Elephant", glyph: "◈", accent: "#caf6ff" },
  bat: { label: "Bat", glyph: "✶", accent: "#ff6f91" },
  legion: { label: "Legion", glyph: "✷", accent: "#8dc0d5" },
};

export function getPirateSuitMeta(suit: PirateSuit) {
  return SUIT_META[suit];
}

export function createShuffledDeck(randomFn: () => number = Math.random) {
  const deck = SUITS.flatMap((suit) =>
    RANKS.map((entry) => ({
      id: `${entry.rank}-${suit}`,
      suit,
      rank: entry.rank,
      rankValue: entry.value,
      blackjackValue: entry.blackjackValue,
      sortValue: entry.value,
    })),
  );

  for (let index = deck.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(randomFn() * (index + 1));
    const temp = deck[index];
    deck[index] = deck[swapIndex];
    deck[swapIndex] = temp;
  }

  return deck;
}

export function drawCards(
  deck: PiratePlayingCard[],
  count: number,
): { cards: PiratePlayingCard[]; deck: PiratePlayingCard[] } {
  const nextDeck = deck.slice();
  const cards: PiratePlayingCard[] = [];

  for (let index = 0; index < count; index += 1) {
    const nextCard = nextDeck.pop();
    if (!nextCard) break;
    cards.push(nextCard);
  }

  return { cards, deck: nextDeck };
}

export function getBlackjackScore(cards: PiratePlayingCard[]) {
  let total = cards.reduce((sum, card) => sum + card.blackjackValue, 0);
  let aces = cards.filter((card) => card.rank === "A").length;

  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }

  return {
    total,
    isSoft: cards.some((card) => card.rank === "A") && total <= 21 && aces > 0,
    isBlackjack: cards.length === 2 && total === 21,
    isBust: total > 21,
  };
}

function getSortedRanks(cards: PiratePlayingCard[]) {
  return cards
    .map((card) => card.rankValue)
    .sort((left, right) => right - left);
}

function getStraightHigh(ranks: number[]) {
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

function compareTiebreakers(left: number[], right: number[]) {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const leftValue = left[index] || 0;
    const rightValue = right[index] || 0;
    if (leftValue !== rightValue) return leftValue - rightValue;
  }
  return 0;
}

export function comparePokerScores(left: PokerScore, right: PokerScore) {
  if (left.category !== right.category) return left.category - right.category;
  return compareTiebreakers(left.tiebreakers, right.tiebreakers);
}

function evaluateFiveCardHand(cards: PiratePlayingCard[]) {
  const sortedRanks = getSortedRanks(cards);
  const suitBuckets = cards.reduce<Record<string, PiratePlayingCard[]>>((bucket, card) => {
    bucket[card.suit] = bucket[card.suit] || [];
    bucket[card.suit].push(card);
    return bucket;
  }, {});
  const flushCards =
    Object.values(suitBuckets).find((bucket) => bucket.length === 5)?.sort(
      (left, right) => right.rankValue - left.rankValue,
    ) || null;

  const countMap = new Map<number, number>();
  sortedRanks.forEach((rank) => {
    countMap.set(rank, (countMap.get(rank) || 0) + 1);
  });
  const countEntries = [...countMap.entries()].sort(
    (left, right) => right[1] - left[1] || right[0] - left[0],
  );

  const straightHigh = getStraightHigh(sortedRanks);
  const flushStraightHigh = flushCards
    ? getStraightHigh(flushCards.map((card) => card.rankValue))
    : 0;

  if (flushCards && flushStraightHigh) {
    return {
      category: 8,
      label: POKER_CATEGORY_LABELS[8],
      tiebreakers: [flushStraightHigh],
    };
  }

  if (countEntries[0]?.[1] === 4) {
    const quadRank = countEntries[0][0];
    const kicker = countEntries.find((entry) => entry[0] !== quadRank)?.[0] || 0;
    return {
      category: 7,
      label: POKER_CATEGORY_LABELS[7],
      tiebreakers: [quadRank, kicker],
    };
  }

  const tripRanks = countEntries.filter((entry) => entry[1] >= 3).map((entry) => entry[0]);
  const pairRanks = countEntries.filter((entry) => entry[1] >= 2).map((entry) => entry[0]);
  if (tripRanks.length && (pairRanks.length >= 2 || tripRanks.length >= 2)) {
    const tripRank = tripRanks[0];
    const pairRank = pairRanks.find((rank) => rank !== tripRank) || tripRanks[1];
    return {
      category: 6,
      label: POKER_CATEGORY_LABELS[6],
      tiebreakers: [tripRank, pairRank || 0],
    };
  }

  if (flushCards) {
    return {
      category: 5,
      label: POKER_CATEGORY_LABELS[5],
      tiebreakers: flushCards.map((card) => card.rankValue),
    };
  }

  if (straightHigh) {
    return {
      category: 4,
      label: POKER_CATEGORY_LABELS[4],
      tiebreakers: [straightHigh],
    };
  }

  if (tripRanks.length) {
    const tripRank = tripRanks[0];
    const kickers = sortedRanks.filter((rank) => rank !== tripRank).slice(0, 2);
    return {
      category: 3,
      label: POKER_CATEGORY_LABELS[3],
      tiebreakers: [tripRank, ...kickers],
    };
  }

  if (pairRanks.length >= 2) {
    const [highPair, lowPair] = pairRanks.slice(0, 2);
    const kicker = sortedRanks.find((rank) => rank !== highPair && rank !== lowPair) || 0;
    return {
      category: 2,
      label: POKER_CATEGORY_LABELS[2],
      tiebreakers: [highPair, lowPair, kicker],
    };
  }

  if (pairRanks.length === 1) {
    const pairRank = pairRanks[0];
    const kickers = sortedRanks.filter((rank) => rank !== pairRank).slice(0, 3);
    return {
      category: 1,
      label: POKER_CATEGORY_LABELS[1],
      tiebreakers: [pairRank, ...kickers],
    };
  }

  return {
    category: 0,
    label: POKER_CATEGORY_LABELS[0],
    tiebreakers: sortedRanks,
  };
}

export function evaluateBestPokerHand(cards: PiratePlayingCard[]) {
  if (cards.length < 5) {
    return {
      category: 0,
      label: "Main incomplete",
      tiebreakers: cards
        .map((card) => card.rankValue)
        .sort((left, right) => right - left),
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

export function describeHoleCards(cards: PiratePlayingCard[]) {
  if (cards.length < 2) return "prend place";
  const [first, second] = cards;
  if (first.rankValue === second.rankValue) return "ouvre avec une paire";
  if (first.rankValue >= 12 && second.rankValue >= 11) return "montre des figures";
  if (first.suit === second.suit) return "cherche une couleur";
  if (Math.abs(first.rankValue - second.rankValue) <= 2) return "attend une suite";
  return "reste patient";
}
