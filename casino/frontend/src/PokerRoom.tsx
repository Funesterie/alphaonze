import * as React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTableAudio } from "./audio/useTableAudio";
import { ROOM_DEFINITIONS } from "./features/casino/catalog";
import PokerSidebar from "./features/poker/components/PokerSidebar";
import PokerTableScene from "./features/poker/components/PokerTableScene";
import pokerCaptainArt from "./images/poker-captain-art.png";
import {
  actPokerRound,
  fetchPokerRoomState,
  joinPokerRoom,
  startPokerRound,
  type CasinoTableRoom,
  type CasinoTableRoomParticipant,
  type CasinoProfile,
  type PokerState,
} from "./lib/casinoApi";
import { formatCredits } from "./lib/casinoRoomState";
import {
  readTableChannelSnapshot,
  readSyncedTableSelection,
  subscribeTableChannel,
  subscribeSyncedTableSelection,
  writeSyncedTableSelection,
  writeTableChannelSnapshot,
} from "./lib/tableChannelSync";
import { POKER_SALONS } from "./lib/tableSalons";

const ANTE_PRESETS = [60, 120, 200, 320];
const TABLE_DEAL_STEP_MS = 92;
const LIVE_MIN_OPPONENTS = 1;
const LIVE_ROOM_POLL_INTERVAL_MS = 4000;
const LIVE_TURN_LIMIT_MS = 90_000;

type PokerAction = "reveal" | "showdown" | "check" | "call" | "bet" | "raise" | "fold";

type PokerRoomProps = {
  playerName: string;
  profile: CasinoProfile;
  mediaReady: boolean;
  onProfileChange: (profile: CasinoProfile, message?: string) => void;
  onError: (message: string) => void;
};

function getPokerCardKeys(state: PokerState | null) {
  const keys: string[] = [];

  state?.aiSeats.forEach((seat) => {
    seat.cards.forEach((card, index) => {
      keys.push(`${seat.id}-${card.id}-${index}`);
    });
  });

  state?.communityCards.forEach((card, index) => {
    keys.push(`community-${card.id}-${index}`);
  });

  state?.playerCards.forEach((card, index) => {
    keys.push(`poker-player-${card.id}-${index}`);
  });

  return keys;
}

function normalizeAggressionTarget(rawValue: number, minValue: number, maxValue: number, step: number) {
  if (!maxValue) return 0;
  const safeStep = Math.max(1, step);
  const snapped = Math.round(rawValue / safeStep) * safeStep;
  return Math.max(minValue, Math.min(maxValue, snapped));
}

function buildAggressionPresets(state: PokerState | null, blindUnit: number) {
  if (!state) return [];
  const minValue = state.legalActions.includes("raise") ? state.minRaiseTo : state.minBet;
  const maxValue = state.playerStreetCommitted + state.playerChips;
  if (!minValue || !maxValue || maxValue < minValue) return [];

  const referencePot = Math.max(state.pot + state.toCall, minValue);
  const rawCandidates = [
    minValue,
    referencePot * 0.5,
    referencePot * 0.75,
    referencePot,
    maxValue,
  ];

  return rawCandidates
    .map((value) => normalizeAggressionTarget(value, minValue, maxValue, blindUnit))
    .filter((value, index, array) => value >= minValue && value <= maxValue && array.indexOf(value) === index)
    .slice(0, 5);
}

function buildPokerSyncSignature(state: PokerState | null) {
  if (!state?.token) return "";
  return JSON.stringify({
    token: state.token,
    roomId: state.roomId || null,
    stage: state.stage,
    pot: state.pot,
    currentBet: state.currentBet,
    toCall: state.toCall,
    playerFolded: state.playerFolded,
    playerCards: state.playerCards.map((card) => card.id),
    communityCards: state.communityCards.map((card) => card.id),
    aiSeats: state.aiSeats.map((seat) => ({
      id: seat.id,
      folded: Boolean(seat.folded),
      lastAction: seat.lastAction || "",
      committed: seat.totalCommitted || 0,
      cards: seat.cards.map((card) => card.id),
      winner: seat.isWinner,
    })),
    actionLogSize: state.actionLog.length,
    lastDelta: state.lastDelta,
  });
}

function formatTurnClock(remainingMs: number) {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export default function PokerRoom({
  playerName,
  profile,
  mediaReady,
  onProfileChange,
  onError,
}: PokerRoomProps) {
  const pokerRoomMeta = ROOM_DEFINITIONS.find((roomEntry) => roomEntry.id === "poker");
  const [ante, setAnte] = useState(ANTE_PRESETS[1]);
  const [state, setState] = useState<PokerState | null>(null);
  const [working, setWorking] = useState(false);
  const [roomId, setRoomId] = useState(() => readSyncedTableSelection("poker") || POKER_SALONS[0].id);
  const [rooms, setRooms] = useState<CasinoTableRoom[]>([]);
  const [infoTab, setInfoTab] = useState<"journal" | "lecture" | "salons" | "joueurs">("journal");
  const [showRoomInfo, setShowRoomInfo] = useState(false);
  const [activeHeaderInfo, setActiveHeaderInfo] = useState<"structure" | "mises" | "live">("structure");
  const [dealtCardDelays, setDealtCardDelays] = useState<Record<string, number>>({});
  const [betTarget, setBetTarget] = useState(0);
  const [turnDeadlineAt, setTurnDeadlineAt] = useState<number | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const displayState = useMemo<PokerState | null>(() => state, [state]);

  const previousCardKeysRef = useRef<string[]>([]);
  const clearDealAnimationTimeoutRef = useRef<number | null>(null);
  const latestAppliedSyncAtRef = useRef(0);
  const skipNextSyncPublishRef = useRef(false);
  const lastTurnSignatureRef = useRef("");
  const lastTimedOutSignatureRef = useRef("");
  const { clearQueuedAudio, playCardBurst, playCheck } = useTableAudio(mediaReady);

  const stage = state?.stage || "idle";
  const lastDelta = state?.lastDelta || 0;
  const roomSwitchLocked = !(stage === "idle" || stage === "waiting" || stage === "showdown");
  const activeRoom = rooms.find((entry) => entry.id === roomId) || null;
  const tableParticipants = useMemo<Array<CasinoTableRoomParticipant & { isSelf: boolean }>>(() => {
    const deduped = new Map<string, CasinoTableRoomParticipant & { isSelf: boolean }>();

    (activeRoom?.participants || []).forEach((participant) => {
      deduped.set(participant.userId, {
        ...participant,
        isSelf: participant.userId === profile.user.id,
      });
    });

    if (!deduped.has(profile.user.id)) {
      deduped.set(profile.user.id, {
        userId: profile.user.id,
        username: String(playerName || profile.user.username || "Toi").trim(),
        updatedAt: null,
        isSelf: true,
      });
    }

    return [...deduped.values()];
  }, [activeRoom?.participants, playerName, profile.user.id, profile.user.username]);
  const activePlayerCount = activeRoom?.playerCount || tableParticipants.length;
  const connectedOpponentCount = tableParticipants.filter((participant) => !participant.isSelf).length;
  const isLiveMultiplayerReady = connectedOpponentCount >= LIVE_MIN_OPPONENTS;
  const activeAnte = state?.ante || ante;
  const smallBlind = Math.max(10, Math.round(activeAnte / 2));
  const blindUnit = Math.max(10, Math.round(activeAnte / 2));
  const communityCards = state?.communityCards || [];
  const toCall = state?.toCall || 0;
  const isDecisionPhase = Boolean(state && stage !== "showdown" && stage !== "waiting" && !state.playerFolded);
  const playerChips = state?.playerChips || 0;
  const playerCommitted = state?.playerCommitted || activeAnte;
  const playerStreetCommitted = state?.playerStreetCommitted || 0;
  const canCheck = Boolean(state?.legalActions.includes("check"));
  const canCall = Boolean(state?.legalActions.includes("call"));
  const canBet = Boolean(state?.legalActions.includes("bet"));
  const canRaise = Boolean(state?.legalActions.includes("raise"));
  const aggressionMin = canRaise ? state?.minRaiseTo || 0 : canBet ? state?.minBet || 0 : 0;
  const aggressionMax = state ? playerStreetCommitted + playerChips : 0;
  const aggressionPresets = buildAggressionPresets(state, blindUnit);
  const normalizedBetTarget =
    canBet || canRaise ? normalizeAggressionTarget(betTarget || aggressionMin, aggressionMin, aggressionMax, blindUnit) : 0;
  const turnCountdownMs = turnDeadlineAt ? Math.max(0, turnDeadlineAt - nowTick) : 0;
  const turnCountdownLabel = turnDeadlineAt ? formatTurnClock(turnCountdownMs) : "1:30";

  function applySyncedState(nextState: PokerState | null, syncedAt: number, nextDeadlineAt: number | null) {
    if (!nextState) return;
    if (syncedAt <= latestAppliedSyncAtRef.current) return;
    latestAppliedSyncAtRef.current = syncedAt;
    skipNextSyncPublishRef.current = true;
    setState(nextState);
    setTurnDeadlineAt(nextDeadlineAt);
  }

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNowTick(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    latestAppliedSyncAtRef.current = 0;
    skipNextSyncPublishRef.current = false;
    lastTurnSignatureRef.current = "";
    lastTimedOutSignatureRef.current = "";
    setTurnDeadlineAt(null);
  }, [roomId]);

  useEffect(() => {
    writeSyncedTableSelection("poker", roomId);
  }, [roomId]);

  useEffect(() => {
    return subscribeSyncedTableSelection("poker", (nextRoomId) => {
      if (!nextRoomId || nextRoomId === roomId || roomSwitchLocked || working) return;
      resetTableVisualState();
      setState(null);
      setRoomId(nextRoomId);
    });
  }, [roomId, roomSwitchLocked, working]);

  useEffect(() => {
    let cancelled = false;

    async function syncRoom() {
      try {
        const result = await joinPokerRoom(roomId);
        if (cancelled) return;
        setRooms(result.rooms);

        try {
          const sharedState = await fetchPokerRoomState(roomId);
          if (cancelled || !sharedState) return;
          applySyncedState(sharedState, Date.now(), turnDeadlineAt);
          return;
        } catch (syncError) {
          if (cancelled) return;
          if (syncError instanceof Error) {
            onError(syncError.message);
          }
        }

        const snapshot = readTableChannelSnapshot<PokerState>("poker", roomId);
        if (cancelled || !snapshot?.state) return;
        applySyncedState(snapshot.state, snapshot.syncedAt, snapshot.turnDeadlineAt);
      } catch (error_) {
        if (cancelled) return;
        onError(error_ instanceof Error ? error_.message : "Le salon poker ne repond pas.");
      }
    }

    void syncRoom();
    const intervalId = window.setInterval(() => void syncRoom(), LIVE_ROOM_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [onError, roomId, turnDeadlineAt]);

  useEffect(() => {
    const existingSnapshot = readTableChannelSnapshot<PokerState>("poker", roomId);
    if (existingSnapshot?.state) {
      applySyncedState(existingSnapshot.state, existingSnapshot.syncedAt, existingSnapshot.turnDeadlineAt);
    }

    return subscribeTableChannel<PokerState>("poker", roomId, (snapshot) => {
      if (snapshot.roomId !== roomId) return;
      applySyncedState(snapshot.state, snapshot.syncedAt, snapshot.turnDeadlineAt);
    });
  }, [roomId]);

  useEffect(() => {
    if (!state) return;

    if (skipNextSyncPublishRef.current) {
      skipNextSyncPublishRef.current = false;
      return;
    }

    const signature = buildPokerSyncSignature(state);
    const isActionable = stage !== "showdown" && !state.playerFolded && Boolean(state.token);
    const shouldResetTurnClock = Boolean(
      isActionable && (!turnDeadlineAt || signature !== lastTurnSignatureRef.current || turnDeadlineAt <= Date.now()),
    );
    const nextDeadlineAt = isActionable
      ? shouldResetTurnClock
        ? Date.now() + LIVE_TURN_LIMIT_MS
        : turnDeadlineAt
      : null;

    if (signature !== lastTurnSignatureRef.current) {
      lastTimedOutSignatureRef.current = "";
    }
    lastTurnSignatureRef.current = signature;

    if (nextDeadlineAt !== turnDeadlineAt) {
      setTurnDeadlineAt(nextDeadlineAt);
    }

    const syncedAt = Date.now();
    latestAppliedSyncAtRef.current = syncedAt;
    writeTableChannelSnapshot<PokerState>({
      game: "poker",
      roomId,
      syncedAt,
      turnDeadlineAt: nextDeadlineAt,
      state,
    });
  }, [roomId, stage, state, turnDeadlineAt]);

  useEffect(() => {
    if (!state?.token || stage === "showdown" || state.playerFolded || !turnDeadlineAt || working) return;

    const signature = buildPokerSyncSignature(state);
    if (!signature || turnDeadlineAt > nowTick || lastTimedOutSignatureRef.current === signature) return;

    lastTimedOutSignatureRef.current = signature;
    onError(
      canCheck
        ? "Temps ecoule: la table check automatiquement."
        : "Temps ecoule: la table couche automatiquement la main.",
    );
    void act(canCheck ? "check" : "fold");
  }, [act, canCheck, nowTick, onError, stage, state, turnDeadlineAt, working]);

  useEffect(() => {
    return () => {
      if (clearDealAnimationTimeoutRef.current) {
        window.clearTimeout(clearDealAnimationTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const currentCardKeys = getPokerCardKeys(displayState);
    const previousCardKeys = new Set(previousCardKeysRef.current);
    const nextFreshKeys = currentCardKeys.filter((key) => !previousCardKeys.has(key));
    previousCardKeysRef.current = currentCardKeys;

    if (!nextFreshKeys.length) return;

    const nextDelays = nextFreshKeys.reduce<Record<string, number>>((accumulator, key, index) => {
      accumulator[key] = index * TABLE_DEAL_STEP_MS;
      return accumulator;
    }, {});

    setDealtCardDelays((current) => ({ ...current, ...nextDelays }));
    playCardBurst(nextFreshKeys.length, { stepMs: TABLE_DEAL_STEP_MS, volume: 0.7 });

    if (clearDealAnimationTimeoutRef.current) {
      window.clearTimeout(clearDealAnimationTimeoutRef.current);
    }

    clearDealAnimationTimeoutRef.current = window.setTimeout(() => {
      setDealtCardDelays((current) => {
        const remaining = { ...current };
        nextFreshKeys.forEach((key) => {
          delete remaining[key];
        });
        return remaining;
      });
      clearDealAnimationTimeoutRef.current = null;
    }, 1100 + nextFreshKeys.length * TABLE_DEAL_STEP_MS);
  }, [displayState, playCardBurst]);

  useEffect(() => {
    if (!(canBet || canRaise)) {
      setBetTarget(0);
      return;
    }

    const suggested =
      aggressionPresets[1] || aggressionPresets[0] || normalizeAggressionTarget(aggressionMin, aggressionMin, aggressionMax, blindUnit);

    setBetTarget((current) => {
      if (current >= aggressionMin && current <= aggressionMax) {
        return normalizeAggressionTarget(current, aggressionMin, aggressionMax, blindUnit);
      }
      return suggested;
    });
  }, [aggressionMax, aggressionMin, aggressionPresets, blindUnit, canBet, canRaise]);

  async function joinHand() {
    onError("");
    clearQueuedAudio();
    previousCardKeysRef.current = [];
    setDealtCardDelays({});
    setBetTarget(0);
    if (clearDealAnimationTimeoutRef.current) {
      window.clearTimeout(clearDealAnimationTimeoutRef.current);
      clearDealAnimationTimeoutRef.current = null;
    }
    setWorking(true);
    try {
      const result = await startPokerRound(ante, roomId);
      setState(result.state);
      if (result.profile) {
        onProfileChange(result.profile);
      }
    } catch (error_) {
      onError(error_ instanceof Error ? error_.message : "L'entree a la table a echoue.");
    } finally {
      setWorking(false);
    }
  }

  async function act(action: PokerAction, amount?: number) {
    if (!state?.token || stage === "showdown" || working) return;
    onError("");
    setWorking(true);
    try {
      const result = await actPokerRound(state.token, action, amount);
      setState(result.state);
      if (result.profile) {
        onProfileChange(result.profile);
      }
    } catch (error_) {
      onError(error_ instanceof Error ? error_.message : "La table n'a pas accepte cette action.");
    } finally {
      setWorking(false);
    }
  }

  async function handleCheckOrCall() {
    if (working) return;
    if (canCheck) {
      playCheck();
      await act("check");
      return;
    }
    if (canCall) {
      await act("call");
    }
  }

  async function handleCheckOrFold() {
    if (working || stage === "idle" || stage === "waiting" || stage === "showdown") return;
    if (canCheck) {
      playCheck();
      await act("check");
      return;
    }
    await act("fold");
  }

  async function handleAggression() {
    if (working || !(canBet || canRaise) || !normalizedBetTarget) return;
    await act(canRaise ? "raise" : "bet", normalizedBetTarget);
  }

  async function handleAllIn() {
    if (working || !(canBet || canRaise) || !aggressionMax) return;
    setBetTarget(aggressionMax);
    await act(canRaise ? "raise" : "bet", aggressionMax);
  }

  function resetTableVisualState() {
    clearQueuedAudio();
    previousCardKeysRef.current = [];
    setDealtCardDelays({});
    setBetTarget(0);
    setTurnDeadlineAt(null);
    if (clearDealAnimationTimeoutRef.current) {
      window.clearTimeout(clearDealAnimationTimeoutRef.current);
      clearDealAnimationTimeoutRef.current = null;
    }
  }

  function handleRoomChange(nextRoomId: string) {
    if (roomSwitchLocked || working || nextRoomId === roomId) return;
    resetTableVisualState();
    setState(null);
    setRoomId(nextRoomId);
    writeSyncedTableSelection("poker", nextRoomId);
  }

  return (
    <section className="casino-table-layout casino-table-layout--compact casino-table-layout--cards">
      <div className="casino-stage casino-stage--cards casino-stage--cards--poker">
        <div
          className="casino-card-fused-stage casino-card-fused-stage--poker"
          style={{ ["--room-art" as string]: `url("${pokerCaptainArt}")` }}
        >
          <div className="casino-room-hud casino-room-hud--poker">
            <div className="casino-room-hud__lead">
              <img className="casino-room-hud__portrait" src={pokerCaptainArt} alt="" aria-hidden="true" />
              <div className="casino-room-hud__identity">
                <div className="casino-topdeck__chip-row">
                  <span className="casino-chip">{pokerRoomMeta?.chip || "Salon hold'em"}</span>
                  <div className="casino-room-hud__utility-stack">
                    <button
                      type="button"
                      className={`casino-ghost-button casino-topdeck__info-toggle ${showRoomInfo ? "is-open" : ""}`}
                      onClick={() => setShowRoomInfo((value) => !value)}
                      aria-label="Informations poker"
                      aria-expanded={showRoomInfo}
                    >
                      <span className="casino-button-icon" aria-hidden="true">
                        <svg viewBox="0 0 24 24">
                          <path d="M4 7h16" />
                          <path d="M4 12h16" />
                          <path d="M4 17h16" />
                        </svg>
                      </span>
                    </button>
                    <span
                      className={`casino-poker-turn-timer ${turnDeadlineAt ? "is-live" : ""} ${turnCountdownMs <= 10_000 && turnDeadlineAt ? "is-warning" : ""}`}
                      aria-label={turnDeadlineAt ? `Temps restant ${turnCountdownLabel}` : "Timer de table en attente"}
                    >
                      {turnDeadlineAt ? turnCountdownLabel : "Timer --:--"}
                    </span>
                  </div>
                </div>
                <strong>{pokerRoomMeta?.title || "Texas hold'em rapide"}</strong>
                <p>
                  {state?.message || "Table partagee par salon avec etat synchronise et actions gerees cote serveur."}
                  {" "}
                  {activeRoom ? `Salon actif: ${POKER_SALONS.find((entry) => entry.id === activeRoom.id)?.title || activeRoom.id}.` : ""}
                </p>
              </div>
            </div>

            {showRoomInfo ? (
              <article className="casino-topdeck__info-panel" aria-label="Informations poker">
                <div className="casino-topdeck__info-buttons" role="tablist" aria-label="Sections poker">
                  <button
                    type="button"
                    role="tab"
                    className={`casino-topdeck__info-button ${activeHeaderInfo === "structure" ? "is-active" : ""}`}
                    aria-selected={activeHeaderInfo === "structure"}
                    onClick={() => setActiveHeaderInfo("structure")}
                  >
                    Structure
                  </button>
                  <button
                    type="button"
                    role="tab"
                    className={`casino-topdeck__info-button ${activeHeaderInfo === "mises" ? "is-active" : ""}`}
                    aria-selected={activeHeaderInfo === "mises"}
                    onClick={() => setActiveHeaderInfo("mises")}
                  >
                    Mises
                  </button>
                  <button
                    type="button"
                    role="tab"
                    className={`casino-topdeck__info-button ${activeHeaderInfo === "live" ? "is-active" : ""}`}
                    aria-selected={activeHeaderInfo === "live"}
                    onClick={() => setActiveHeaderInfo("live")}
                  >
                    Live
                  </button>
                </div>
                <div className="casino-topdeck__info-body" role="tabpanel">
                  {activeHeaderInfo === "structure" ? (
                    <div className="casino-rule-list">
                      <p>Texas hold'em rapide avec preflop, flop, turn, river et showdown.</p>
                      <p>Le backend gere les vraies decisions de check, call, bet, raise et fold.</p>
                      <p>Le journal detaille et la lecture du spot restent disponibles dans le dock de table, sans rajout visuel de bots cote front.</p>
                    </div>
                  ) : null}
                  {activeHeaderInfo === "mises" ? (
                    <div className="casino-metric-list">
                      <div>
                        <span>Ante presets</span>
                        <strong>60 / 120 / 200 / 320</strong>
                      </div>
                      <div>
                        <span>Blind unit</span>
                        <strong>{formatCredits(blindUnit)}</strong>
                      </div>
                      <div>
                        <span>A payer</span>
                        <strong>{formatCredits(toCall)}</strong>
                      </div>
                      <div>
                        <span>Pot</span>
                        <strong>{formatCredits(state?.pot || 0)}</strong>
                      </div>
                    </div>
                  ) : null}
                  {activeHeaderInfo === "live" ? (
                    <div className="casino-rule-list">
                      <p>Le salon reste actif des qu'un joueur humain est present, mais une main ne demarre qu'a partir de deux joueurs assis.</p>
                      <p>Le tour actif reste synchronise entre les joueurs du meme salon.</p>
                      <p>Table en cours: {activeRoom ? POKER_SALONS.find((entry) => entry.id === activeRoom.id)?.title || activeRoom.id : "Aucune"}</p>
                      <p>Joueurs presents: {activePlayerCount}</p>
                      <p>Adversaires reels disponibles: {connectedOpponentCount}</p>
                    </div>
                  ) : null}
                </div>
              </article>
            ) : null}

            <div className="casino-salon-strip casino-salon-strip--compact" role="tablist" aria-label="Salons poker">
              {POKER_SALONS.map((salon) => {
                const room = rooms.find((entry) => entry.id === salon.id);
                return (
                  <button
                    key={salon.id}
                    type="button"
                    className={`casino-salon-pill ${salon.id === roomId ? "is-active" : ""}`}
                    onClick={() => handleRoomChange(salon.id)}
                    disabled={roomSwitchLocked || working}
                    role="tab"
                    aria-selected={salon.id === roomId}
                  >
                    <div>
                      <strong>{salon.title}</strong>
                      <span>{salon.chip}</span>
                    </div>
                    <b>{room?.playerCount || 0}</b>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="casino-reel-shell casino-room-shell casino-room-shell--cards casino-reel-shell--table-compact casino-reel-shell--poker">
            <PokerTableScene
              state={displayState}
              stage={stage}
              playerName={playerName}
              activeAnte={activeAnte}
              smallBlind={smallBlind}
              isDecisionPhase={isDecisionPhase}
              dealtCardDelays={dealtCardDelays}
            />

            <PokerSidebar
              profile={profile}
              state={state}
              stage={stage}
              working={working}
              roomId={roomId}
              rooms={rooms}
              infoTab={infoTab}
              isDecisionPhase={isDecisionPhase}
              roomSwitchLocked={roomSwitchLocked}
              ante={ante}
              playerChips={playerChips}
              playerCommitted={playerCommitted}
              playerStreetCommitted={playerStreetCommitted}
              toCall={toCall}
              canCheck={canCheck}
              canCall={canCall}
              canBet={canBet}
              canRaise={canRaise}
              isLiveMultiplayerReady={isLiveMultiplayerReady}
              normalizedBetTarget={normalizedBetTarget}
              aggressionMin={aggressionMin}
              aggressionMax={aggressionMax}
              blindUnit={blindUnit}
              onInfoTabChange={setInfoTab}
              onRoomChange={handleRoomChange}
              onBetTargetChange={setBetTarget}
              onFold={() => void act("fold")}
              onCheckOrCall={() => void handleCheckOrCall()}
              onCheckOrFold={() => void handleCheckOrFold()}
              onAggression={() => void handleAggression()}
              onAllIn={() => void handleAllIn()}
              onJoin={() => void joinHand()}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
