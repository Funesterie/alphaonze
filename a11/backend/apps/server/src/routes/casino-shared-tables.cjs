function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function toIso(now) {
  return now instanceof Date ? now.toISOString() : new Date(now || Date.now()).toISOString();
}

function buildBlackjackToken(roomId, roundId) {
  return `bj:${String(roomId || "").trim()}:${Number(roundId || 0)}`;
}

function parseBlackjackToken(token) {
  const match = String(token || "").trim().match(/^bj:([^:]+):(\d+)$/);
  if (!match) return null;
  return { roomId: match[1], roundId: Number(match[2]) };
}

function buildPokerToken(roomId, handId) {
  return `pk:${String(roomId || "").trim()}:${Number(handId || 0)}`;
}

function parsePokerToken(token) {
  const match = String(token || "").trim().match(/^pk:([^:]+):(\d+)$/);
  if (!match) return null;
  return { roomId: match[1], handId: Number(match[2]) };
}

function buildWaitingBlackjackState(roomId, pendingSeats = [], message = "Table au repos. Choisis une mise pour t'asseoir.") {
  return {
    kind: "blackjack_table",
    roomId,
    roundId: 0,
    stage: "waiting",
    pendingSeats: clone(pendingSeats),
    seats: [],
    dealerCards: [],
    dealerHidden: true,
    activeSeatIndex: -1,
    message,
    updatedAt: null,
  };
}

function getBlackjackSeatStatus(cards, getBlackjackScore) {
  const score = getBlackjackScore(cards);
  if (score.isBust) return "bust";
  if (score.isBlackjack) return "blackjack";
  return "active";
}

function getNextBlackjackSeatIndex(seats, startIndex, getBlackjackScore) {
  for (let index = startIndex; index < seats.length; index += 1) {
    const seat = seats[index];
    const status = seat?.status || getBlackjackSeatStatus(seat?.cards || [], getBlackjackScore);
    if (status === "active") return index;
  }
  return -1;
}

function finalizeBlackjackState(state, deps) {
  const {
    completeDealerHand,
    getBlackjackPayout,
    getBlackjackScore,
  } = deps;
  const dealerOutcome = completeDealerHand(state.deck || [], state.dealerCards || []);
  const resolvedSeats = (state.seats || []).map((seat) => {
    const payout = getBlackjackPayout(seat.cards || [], dealerOutcome.cards || [], seat.wager || 0);
    const score = getBlackjackScore(seat.cards || []);
    return {
      ...seat,
      chips: Number(seat.chips || 0) + Number(payout.amount || 0),
      status: score.isBust ? "bust" : "resolved",
      result: payout.label,
      payoutAmount: Number(payout.amount || 0),
      lastDelta: Number(payout.amount || 0) - Number(seat.wager || 0),
      score,
    };
  });

  return {
    ...state,
    deck: dealerOutcome.deck || [],
    seats: resolvedSeats,
    dealerCards: dealerOutcome.cards || [],
    dealerHidden: false,
    activeSeatIndex: -1,
    stage: "resolved",
    updatedAt: state.updatedAt || null,
    message:
      resolvedSeats.length > 1
        ? "Le croupier retourne sa main. Les paiements tombent table par table."
        : "Le croupier retourne sa main. La manche est reglee.",
  };
}

function startBlackjackRound({ roomId, readySeats, now, createPirateDeck, drawCards, getBlackjackScore, completeDealerHand, getBlackjackPayout }) {
  let deck = createPirateDeck();
  const seats = readySeats.map((seatEntry) => {
    const dealt = drawCards(deck, 2);
    deck = dealt.deck;
    const score = getBlackjackScore(dealt.cards || []);
    return {
      userId: seatEntry.userId,
      username: seatEntry.username,
      wager: Number(seatEntry.wager || 0),
      chips: Number(seatEntry.balanceAfterBuyIn || 0),
      cards: dealt.cards || [],
      status: getBlackjackSeatStatus(dealt.cards || [], getBlackjackScore),
      result: "en jeu",
      payoutAmount: 0,
      lastDelta: -Number(seatEntry.wager || 0),
      score,
    };
  });

  const dealerOpening = drawCards(deck, 2);
  deck = dealerOpening.deck;

  let nextState = {
    kind: "blackjack_table",
    roomId,
    roundId: Number((readySeats[0]?.roundId || 0) + 1),
    stage: "player-turn",
    pendingSeats: [],
    seats,
    dealerCards: dealerOpening.cards || [],
    dealerHidden: true,
    activeSeatIndex: getNextBlackjackSeatIndex(seats, 0, getBlackjackScore),
    deck,
    message: seats.length > 1 ? "Les joueurs sont servis. Le premier a la parole." : "Le sabot est chaud. A toi de jouer.",
    updatedAt: toIso(now),
  };

  if (nextState.activeSeatIndex < 0) {
    nextState = finalizeBlackjackState(nextState, {
      completeDealerHand,
      getBlackjackPayout,
      getBlackjackScore,
    });
    nextState.updatedAt = toIso(now);
  }

  return nextState;
}

function upsertBlackjackPendingSeat(state, seat, now) {
  const baseState = state?.kind === "blackjack_table" ? clone(state) : buildWaitingBlackjackState(seat.roomId);
  const nextPendingSeats = (baseState.pendingSeats || []).filter((entry) => entry.userId !== seat.userId);
  nextPendingSeats.push({
    userId: seat.userId,
    username: seat.username,
    wager: Number(seat.wager || 0),
    readyAt: toIso(now),
  });
  nextPendingSeats.sort((left, right) => String(left.readyAt || "").localeCompare(String(right.readyAt || "")));
  return {
    ...baseState,
    roomId: seat.roomId,
    stage: baseState.stage === "resolved" ? "waiting" : baseState.stage,
    pendingSeats: nextPendingSeats,
    updatedAt: toIso(now),
    message:
      nextPendingSeats.length > 1
        ? "Plusieurs joueurs sont prets. La prochaine manche peut demarrer."
        : "Mise enregistree. La table est prete a lancer la manche.",
  };
}

function syncBlackjackStateWithPresence(state, activeUsers, now) {
  const activeSet = new Set((activeUsers || []).map((value) => String(value || "")));
  const baseState = state?.kind === "blackjack_table" ? clone(state) : buildWaitingBlackjackState("");
  baseState.pendingSeats = (baseState.pendingSeats || []).filter((seat) => activeSet.has(String(seat.userId || "")));
  if (baseState.stage === "waiting" || baseState.stage === "resolved") {
    baseState.seats = [];
  }
  baseState.updatedAt = toIso(now);
  return baseState;
}

function applyBlackjackAction(state, { userId, action, now, drawCards, getBlackjackScore, completeDealerHand, getBlackjackPayout }) {
  const nextState = clone(state);
  if (nextState.stage !== "player-turn") {
    const error = new Error("invalid_round_token");
    error.code = "invalid_round_token";
    throw error;
  }

  const activeSeat = nextState.seats[nextState.activeSeatIndex];
  if (!activeSeat || String(activeSeat.userId || "") !== String(userId || "")) {
    const error = new Error("not_your_turn");
    error.code = "not_your_turn";
    throw error;
  }

  if (action === "hit") {
    const drawn = drawCards(nextState.deck || [], 1);
    nextState.deck = drawn.deck || [];
    activeSeat.cards = [...(activeSeat.cards || []), ...(drawn.cards || [])];
    activeSeat.score = getBlackjackScore(activeSeat.cards || []);
    activeSeat.status = activeSeat.score.isBust ? "bust" : "active";
    activeSeat.result = activeSeat.score.isBust ? "bust" : "en jeu";
    nextState.message = `${activeSeat.username} tire une carte.`;
  } else {
    activeSeat.status = "stood";
    activeSeat.score = getBlackjackScore(activeSeat.cards || []);
    activeSeat.result = "reste";
    nextState.message = `${activeSeat.username} reste sur son total.`;
  }

  const nextIndex = getNextBlackjackSeatIndex(nextState.seats, nextState.activeSeatIndex + 1, getBlackjackScore);
  nextState.activeSeatIndex = nextIndex;
  nextState.updatedAt = toIso(now);
  if (nextIndex < 0) {
    const resolvedState = finalizeBlackjackState(nextState, {
      completeDealerHand,
      getBlackjackPayout,
      getBlackjackScore,
    });
    resolvedState.updatedAt = toIso(now);
    return resolvedState;
  }
  return nextState;
}

function serializeBlackjackState(state, userId, getBlackjackScore) {
  const seats = (state?.seats || []).map((seat, index) => ({
    id: seat.userId,
    userId: seat.userId,
    name: seat.username,
    username: seat.username,
    chips: Number(seat.chips || 0),
    wager: Number(seat.wager || 0),
    cards: seat.cards || [],
    score: seat.score || getBlackjackScore(seat.cards || []),
    status: seat.status || "active",
    result: seat.result || "",
    payoutAmount: Number(seat.payoutAmount || 0),
    lastDelta: Number(seat.lastDelta || 0),
    position: index,
    isSelf: String(seat.userId || "") === String(userId || ""),
    isActive: index === Number(state?.activeSeatIndex ?? -1),
  }));
  const selfSeat = seats.find((seat) => seat.isSelf) || null;
  const dealerCards = state?.dealerCards || [];
  const waiting = state?.stage === "waiting";
  const roundActive = state?.stage === "player-turn";

  return {
    token: roundActive ? buildBlackjackToken(state.roomId, state.roundId) : null,
    roomId: state?.roomId || null,
    stage: waiting ? "waiting" : state?.stage || "waiting",
    waitingForPlayers: waiting,
    roomActive: seats.length > 0 || (state?.pendingSeats || []).length > 0,
    roundId: Number(state?.roundId || 0),
    wager: Number(selfSeat?.wager || 0),
    dealerHidden: Boolean(roundActive && state?.dealerHidden),
    dealerCards,
    dealerScore: dealerCards.length ? getBlackjackScore(dealerCards) : { total: 0, isSoft: false, isBlackjack: false, isBust: false },
    playerCards: selfSeat?.cards || [],
    playerScore: selfSeat?.score || getBlackjackScore(selfSeat?.cards || []),
    payoutAmount: Number(selfSeat?.payoutAmount || 0),
    lastDelta: Number(selfSeat?.lastDelta || 0),
    message: state?.message || "",
    seats,
    aiSeats: seats.filter((seat) => !seat.isSelf),
    selfSeatId: selfSeat?.userId || null,
    activeSeatId: seats.find((seat) => seat.isActive)?.userId || null,
    pendingSeats: clone(state?.pendingSeats || []),
    seatBets: seats.map((seat) => ({
      playerId: seat.userId,
      displayName: seat.username,
      amount: seat.wager,
      position: seat.position,
    })),
    seatStacks: seats.map((seat) => ({
      playerId: seat.userId,
      displayName: seat.username,
      amount: seat.chips,
      position: seat.position,
    })),
  };
}

function buildWaitingPokerState(roomId, pendingSeats = [], message = "Table ouverte. Il faut deux joueurs prets pour lancer la main.") {
  return {
    kind: "poker_table",
    roomId,
    handId: 0,
    stage: "waiting",
    pendingSeats: clone(pendingSeats),
    seats: [],
    communityCards: [],
    communityReserve: [],
    actingSeatIndex: -1,
    dealerSeatIndex: 0,
    pot: 0,
    currentBet: 0,
    minBet: 0,
    minRaiseTo: 0,
    message,
    actionLog: [],
    updatedAt: null,
  };
}

function getPokerBlindUnit(ante) {
  return Math.max(10, Math.round(Number(ante || 0) / 2) || 10);
}

function getActivePokerSeatIndexes(state) {
  return (state.seats || [])
    .map((seat, index) => ({ seat, index }))
    .filter((entry) => !entry.seat.folded && !entry.seat.isAllIn)
    .map((entry) => entry.index);
}

function getNextPokerSeatIndex(state, startIndex) {
  const totalSeats = (state.seats || []).length;
  if (!totalSeats) return -1;
  for (let offset = 0; offset < totalSeats; offset += 1) {
    const index = (startIndex + offset) % totalSeats;
    const seat = state.seats[index];
    if (seat && !seat.folded && !seat.isAllIn) return index;
  }
  return -1;
}

function isPokerBettingRoundComplete(state) {
  const activeIndexes = getActivePokerSeatIndexes(state);
  if (!activeIndexes.length) return true;
  return activeIndexes.every((index) => {
    const seat = state.seats[index];
    return Boolean(seat.actedThisStreet) && Number(seat.streetCommitted || 0) === Number(state.currentBet || 0);
  });
}

function buildPokerLegalActions(state, userId) {
  if (!state || state.stage === "waiting" || state.stage === "showdown") return [];
  const actingSeat = state.seats[state.actingSeatIndex];
  if (!actingSeat || String(actingSeat.userId || "") !== String(userId || "")) return [];
  const callAmount = Math.max(0, Number(state.currentBet || 0) - Number(actingSeat.streetCommitted || 0));
  const actions = ["fold"];
  if (callAmount <= 0) {
    actions.unshift("check");
    if (Number(actingSeat.chips || 0) >= Number(state.minBet || 0) && Number(state.minBet || 0) > 0) {
      actions.push("bet");
    }
    return actions;
  }

  if (Number(actingSeat.chips || 0) >= callAmount) {
    actions.unshift("call");
  }
  if (Number(actingSeat.chips || 0) + Number(actingSeat.streetCommitted || 0) >= Number(state.minRaiseTo || 0)) {
    actions.push("raise");
  }
  return actions;
}

function maybeAdvancePokerStreet(state, deps) {
  const nextState = clone(state);
  if (!isPokerBettingRoundComplete(nextState)) return nextState;

  if (nextState.stage === "river") {
    return finalizePokerShowdown(nextState, deps);
  }

  if (nextState.stage === "preflop") {
    nextState.stage = "flop";
    nextState.communityCards = nextState.communityReserve.slice(0, 3);
  } else if (nextState.stage === "flop") {
    nextState.stage = "turn";
    nextState.communityCards = nextState.communityReserve.slice(0, 4);
  } else {
    nextState.stage = "river";
    nextState.communityCards = nextState.communityReserve.slice(0, 5);
  }

  nextState.currentBet = 0;
  nextState.minBet = getPokerBlindUnit(nextState.ante);
  nextState.minRaiseTo = nextState.minBet;
  nextState.seats = nextState.seats.map((seat) => ({
    ...seat,
    streetCommitted: 0,
    actedThisStreet: false,
    lastAction: seat.folded ? "fold" : "attend",
  }));
  nextState.actingSeatIndex = getNextPokerSeatIndex(nextState, (nextState.dealerSeatIndex + 1) % Math.max(1, nextState.seats.length));
  nextState.message =
    nextState.stage === "flop"
      ? "Le flop est servi."
      : nextState.stage === "turn"
        ? "La turn tombe sur le feutre."
        : "La river est la.";
  return nextState;
}

function finalizePokerShowdown(state, deps) {
  const { evaluateBestPokerHand, comparePokerScores } = deps;
  const nextState = clone(state);
  nextState.stage = "showdown";
  nextState.communityCards = nextState.communityReserve.slice(0, 5);
  nextState.actingSeatIndex = -1;
  const contenders = [];

  nextState.seats = nextState.seats.map((seat) => {
    if (seat.folded) {
      return {
        ...seat,
        hand: null,
        isWinner: false,
        payoutAmount: 0,
        lastDelta: -Number(seat.totalCommitted || 0),
      };
    }
    const hand = evaluateBestPokerHand([...(seat.cards || []), ...(nextState.communityCards || [])]);
    contenders.push({ userId: seat.userId, hand });
    return {
      ...seat,
      hand,
      isWinner: false,
      payoutAmount: 0,
      lastDelta: -Number(seat.totalCommitted || 0),
    };
  });

  let bestHand = null;
  contenders.forEach((entry) => {
    if (!bestHand || comparePokerScores(entry.hand, bestHand) > 0) {
      bestHand = entry.hand;
    }
  });

  const winnerIds = contenders
    .filter((entry) => bestHand && comparePokerScores(entry.hand, bestHand) === 0)
    .map((entry) => entry.userId);
  const share = winnerIds.length ? Math.floor(Number(nextState.pot || 0) / winnerIds.length) : 0;
  let remainder = winnerIds.length ? Number(nextState.pot || 0) - share * winnerIds.length : 0;

  nextState.seats = nextState.seats.map((seat) => {
    if (!winnerIds.includes(seat.userId)) return seat;
    const extra = remainder > 0 ? 1 : 0;
    remainder = Math.max(0, remainder - extra);
    const payoutAmount = share + extra;
    return {
      ...seat,
      chips: Number(seat.chips || 0) + payoutAmount,
      isWinner: true,
      payoutAmount,
      lastDelta: payoutAmount - Number(seat.totalCommitted || 0),
    };
  });

  nextState.message =
    winnerIds.length > 1
      ? "Le pot est partage au showdown."
      : winnerIds.length === 1
        ? "Le showdown designe un vainqueur."
        : "La main se termine sans vainqueur declare.";
  return nextState;
}

function startPokerHand({ roomId, readySeats, now, createPirateDeck, drawCards }) {
  const ante = Number(readySeats[0]?.ante || 0);
  let deck = createPirateDeck();
  const seats = readySeats.map((seatEntry) => {
    const dealt = drawCards(deck, 2);
    deck = dealt.deck;
    return {
      userId: seatEntry.userId,
      username: seatEntry.username,
      cards: dealt.cards || [],
      chips: Number(seatEntry.balanceAfterBuyIn || 0),
      folded: false,
      isAllIn: false,
      actedThisStreet: false,
      totalCommitted: ante,
      streetCommitted: 0,
      lastAction: "ante",
      hand: null,
      isWinner: false,
      payoutAmount: 0,
      lastDelta: -ante,
    };
  });
  const board = drawCards(deck, 5);
  const blindUnit = getPokerBlindUnit(ante);
  return {
    kind: "poker_table",
    roomId,
    handId: Number((readySeats[0]?.handId || 0) + 1),
    stage: "preflop",
    ante,
    pendingSeats: [],
    seats,
    communityCards: [],
    communityReserve: board.cards || [],
    actingSeatIndex: seats.length ? 0 : -1,
    dealerSeatIndex: 0,
    pot: ante * seats.length,
    currentBet: 0,
    minBet: blindUnit,
    minRaiseTo: blindUnit,
    message: "Les antes sont posees, les cartes sont servies.",
    actionLog: ["Antes posees.", "Cartes privees servies."],
    updatedAt: toIso(now),
  };
}

function upsertPokerPendingSeat(state, seat, now) {
  const baseState = state?.kind === "poker_table" ? clone(state) : buildWaitingPokerState(seat.roomId);
  const nextPendingSeats = (baseState.pendingSeats || []).filter((entry) => entry.userId !== seat.userId);
  nextPendingSeats.push({
    userId: seat.userId,
    username: seat.username,
    ante: Number(seat.ante || 0),
    readyAt: toIso(now),
  });
  nextPendingSeats.sort((left, right) => String(left.readyAt || "").localeCompare(String(right.readyAt || "")));
  const sharedAnte = Number(baseState.ante || seat.ante || nextPendingSeats[0]?.ante || 0);
  return {
    ...baseState,
    roomId: seat.roomId,
    ante: sharedAnte,
    stage: "waiting",
    pendingSeats: nextPendingSeats.map((entry) => ({ ...entry, ante: sharedAnte })),
    updatedAt: toIso(now),
    message:
      nextPendingSeats.length >= 2
        ? "Deux joueurs ou plus sont prets. La prochaine main peut partir."
        : "Un seul joueur est pret. En attente d'un adversaire.",
  };
}

function syncPokerStateWithPresence(state, activeUsers, now) {
  const activeSet = new Set((activeUsers || []).map((value) => String(value || "")));
  const baseState = state?.kind === "poker_table" ? clone(state) : buildWaitingPokerState("");
  baseState.pendingSeats = (baseState.pendingSeats || []).filter((seat) => activeSet.has(String(seat.userId || "")));
  if (baseState.stage === "waiting" || baseState.stage === "showdown") {
    baseState.seats = [];
  }
  baseState.updatedAt = toIso(now);
  return baseState;
}

function applyPokerAction(state, { userId, action, amount, now }, deps) {
  const nextState = clone(state);
  if (!nextState || nextState.stage === "waiting" || nextState.stage === "showdown") {
    const error = new Error("invalid_round_token");
    error.code = "invalid_round_token";
    throw error;
  }

  const actingSeat = nextState.seats[nextState.actingSeatIndex];
  if (!actingSeat || String(actingSeat.userId || "") !== String(userId || "")) {
    const error = new Error("not_your_turn");
    error.code = "not_your_turn";
    throw error;
  }

  const blindUnit = getPokerBlindUnit(nextState.ante);
  const callAmount = Math.max(0, Number(nextState.currentBet || 0) - Number(actingSeat.streetCommitted || 0));

  if (action === "fold") {
    actingSeat.folded = true;
    actingSeat.actedThisStreet = true;
    actingSeat.lastAction = "fold";
    nextState.actionLog = [...(nextState.actionLog || []), `${actingSeat.username} fold.`].slice(-8);
    nextState.message = `${actingSeat.username} jette ses cartes.`;
  } else if (action === "check") {
    if (callAmount > 0) {
      const error = new Error("invalid_action");
      error.code = "invalid_action";
      throw error;
    }
    actingSeat.actedThisStreet = true;
    actingSeat.lastAction = "check";
    nextState.actionLog = [...(nextState.actionLog || []), `${actingSeat.username} check.`].slice(-8);
    nextState.message = `${actingSeat.username} check.`;
  } else if (action === "call") {
    if (callAmount <= 0 || Number(actingSeat.chips || 0) < callAmount) {
      const error = new Error("invalid_action");
      error.code = "invalid_action";
      throw error;
    }
    actingSeat.chips = Number(actingSeat.chips || 0) - callAmount;
    actingSeat.totalCommitted = Number(actingSeat.totalCommitted || 0) + callAmount;
    actingSeat.streetCommitted = Number(actingSeat.streetCommitted || 0) + callAmount;
    actingSeat.actedThisStreet = true;
    actingSeat.lastAction = `call ${callAmount}`;
    nextState.pot = Number(nextState.pot || 0) + callAmount;
    nextState.actionLog = [...(nextState.actionLog || []), `${actingSeat.username} call ${callAmount}.`].slice(-8);
    nextState.message = `${actingSeat.username} paie ${callAmount}.`;
  } else if (action === "bet" || action === "raise") {
    const targetBet = Math.max(0, Number(amount || 0));
    const minTarget = action === "bet"
      ? Math.max(Number(nextState.minBet || blindUnit), blindUnit)
      : Math.max(Number(nextState.minRaiseTo || (Number(nextState.currentBet || 0) + blindUnit)), Number(nextState.currentBet || 0) + blindUnit);
    const maxTarget = Number(actingSeat.streetCommitted || 0) + Number(actingSeat.chips || 0);
    if (targetBet < minTarget || targetBet > maxTarget || (action === "bet" && Number(nextState.currentBet || 0) > 0)) {
      const error = new Error("invalid_action");
      error.code = "invalid_action";
      throw error;
    }
    const wagerAmount = targetBet - Number(actingSeat.streetCommitted || 0);
    actingSeat.chips = Number(actingSeat.chips || 0) - wagerAmount;
    actingSeat.totalCommitted = Number(actingSeat.totalCommitted || 0) + wagerAmount;
    actingSeat.streetCommitted = targetBet;
    actingSeat.actedThisStreet = true;
    actingSeat.lastAction = `${action} ${targetBet}`;
    if (Number(actingSeat.chips || 0) <= 0) actingSeat.isAllIn = true;
    nextState.pot = Number(nextState.pot || 0) + wagerAmount;
    const previousCurrentBet = Number(nextState.currentBet || 0);
    nextState.currentBet = targetBet;
    nextState.minBet = blindUnit;
    nextState.minRaiseTo = targetBet + Math.max(blindUnit, targetBet - previousCurrentBet || blindUnit);
    nextState.seats = nextState.seats.map((seat, index) => (
      index === nextState.actingSeatIndex || seat.folded || seat.isAllIn
        ? seat
        : { ...seat, actedThisStreet: false }
    ));
    nextState.actionLog = [...(nextState.actionLog || []), `${actingSeat.username} ${action} ${targetBet}.`].slice(-8);
    nextState.message = `${actingSeat.username} ${action === "bet" ? "ouvre" : "relance"} a ${targetBet}.`;
  } else {
    const error = new Error("invalid_action");
    error.code = "invalid_action";
    throw error;
  }

  const liveSeats = nextState.seats.filter((seat) => !seat.folded);
  if (liveSeats.length <= 1) {
    const winner = liveSeats[0] || null;
    nextState.stage = "showdown";
    nextState.communityCards = nextState.communityReserve.slice(0, 5);
    nextState.actingSeatIndex = -1;
    nextState.seats = nextState.seats.map((seat) => {
      if (!winner || seat.userId !== winner.userId) {
        return {
          ...seat,
          hand: seat.folded ? null : seat.hand,
          isWinner: false,
          payoutAmount: 0,
          lastDelta: -Number(seat.totalCommitted || 0),
        };
      }
      return {
        ...seat,
        chips: Number(seat.chips || 0) + Number(nextState.pot || 0),
        isWinner: true,
        payoutAmount: Number(nextState.pot || 0),
        lastDelta: Number(nextState.pot || 0) - Number(seat.totalCommitted || 0),
      };
    });
    nextState.message = winner ? `${winner.username} ramasse le pot sans showdown.` : "La main se termine.";
    nextState.updatedAt = toIso(now);
    return nextState;
  }

  nextState.actingSeatIndex = getNextPokerSeatIndex(nextState, (nextState.actingSeatIndex + 1) % nextState.seats.length);
  const progressedState = maybeAdvancePokerStreet(nextState, deps);
  progressedState.updatedAt = toIso(now);
  return progressedState;
}

function serializePokerState(state, userId) {
  const seats = (state?.seats || []).map((seat, index) => ({
    id: seat.userId,
    userId: seat.userId,
    name: seat.username,
    username: seat.username,
    chips: Number(seat.chips || 0),
    cards: seat.cards || [],
    folded: Boolean(seat.folded),
    lastAction: seat.lastAction || "",
    totalCommitted: Number(seat.totalCommitted || 0),
    streetCommitted: Number(seat.streetCommitted || 0),
    hand: seat.hand || null,
    isWinner: Boolean(seat.isWinner),
    payoutAmount: Number(seat.payoutAmount || 0),
    lastDelta: Number(seat.lastDelta || 0),
    position: index,
    isSelf: String(seat.userId || "") === String(userId || ""),
    isActive: index === Number(state?.actingSeatIndex ?? -1),
  }));
  const selfSeat = seats.find((seat) => seat.isSelf) || null;
  const legalActions = buildPokerLegalActions(state, userId);
  const selfCall = selfSeat ? Math.max(0, Number(state?.currentBet || 0) - Number(selfSeat.streetCommitted || 0)) : 0;

  return {
    token: state?.stage && state.stage !== "waiting" && state.stage !== "showdown" ? buildPokerToken(state.roomId, state.handId) : null,
    roomId: state?.roomId || null,
    stage: state?.stage || "waiting",
    stageLabel:
      state?.stage === "waiting"
        ? "En attente"
        : state?.stage === "preflop"
          ? "Preflop"
          : state?.stage === "flop"
            ? "Flop"
            : state?.stage === "turn"
              ? "Turn"
              : state?.stage === "river"
                ? "River"
                : "Showdown",
    waitingForPlayers: state?.stage === "waiting",
    handId: Number(state?.handId || 0),
    ante: Number(state?.ante || (state?.pendingSeats?.[0]?.ante || 0)),
    pot: Number(state?.pot || 0),
    tablePot: Number(state?.pot || 0),
    playerCards: selfSeat?.cards || [],
    communityCards: state?.communityCards || [],
    seats,
    aiSeats: seats.filter((seat) => !seat.isSelf),
    selfSeatId: selfSeat?.userId || null,
    activeSeatId: seats.find((seat) => seat.isActive)?.userId || null,
    playerFolded: Boolean(selfSeat?.folded),
    playerHand: selfSeat?.hand || null,
    playerChips: Number(selfSeat?.chips || 0),
    playerCommitted: Number(selfSeat?.totalCommitted || 0),
    playerStreetCommitted: Number(selfSeat?.streetCommitted || 0),
    currentBet: Number(state?.currentBet || 0),
    toCall: selfCall,
    minBet: Number(state?.minBet || 0),
    minRaiseTo: Number(state?.minRaiseTo || 0),
    legalActions,
    actionLog: clone(state?.actionLog || []),
    payoutAmount: Number(selfSeat?.payoutAmount || 0),
    lastDelta: Number(selfSeat?.lastDelta || 0),
    message: state?.message || "",
    pendingSeats: clone(state?.pendingSeats || []),
    seatBets: seats.map((seat) => ({
      playerId: seat.userId,
      displayName: seat.username,
      amount: seat.totalCommitted,
      position: seat.position,
    })),
    seatStacks: seats.map((seat) => ({
      playerId: seat.userId,
      displayName: seat.username,
      amount: seat.chips,
      position: seat.position,
    })),
  };
}

module.exports = {
  applyBlackjackAction,
  applyPokerAction,
  buildBlackjackToken,
  buildPokerToken,
  buildWaitingBlackjackState,
  buildWaitingPokerState,
  finalizeBlackjackState,
  getPokerBlindUnit,
  parseBlackjackToken,
  parsePokerToken,
  serializeBlackjackState,
  serializePokerState,
  startBlackjackRound,
  startPokerHand,
  syncBlackjackStateWithPresence,
  syncPokerStateWithPresence,
  upsertBlackjackPendingSeat,
  upsertPokerPendingSeat,
};
