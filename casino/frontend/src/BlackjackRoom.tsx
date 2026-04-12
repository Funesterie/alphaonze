import * as React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTableAudio } from "./audio/useTableAudio";
import { ROOM_DEFINITIONS } from "./features/casino/catalog";
import BlackjackSidebar from "./features/blackjack/components/BlackjackSidebar";
import BlackjackTableScene from "./features/blackjack/components/BlackjackTableScene";
import blackjackCaptainArt from "./images/blackjack-captain-art.png";
import {
  actBlackjackRound,
  fetchBlackjackRoomState,
  joinBlackjackRoom,
  startBlackjackRound,
  type BlackjackState,
  type CasinoTableRoom,
  type CasinoProfile,
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
import { BLACKJACK_SALONS } from "./lib/tableSalons";

const PLAYER_BETS = [50, 100, 200, 400];
const TABLE_DEAL_STEP_MS = 96;
const LIVE_MIN_PLAYERS = 1;
const BLACKJACK_RESULT_FLASH_MS = 1800;
const LIVE_ROOM_POLL_INTERVAL_MS = 4000;
const LIVE_TURN_LIMIT_MS = 90_000;

function getBlackjackCardKeys(state: BlackjackState | null) {
  const keys: string[] = [];

  state?.dealerCards.forEach((card, index) => {
    keys.push(`dealer-${card.id}-${index}`);
  });

  state?.aiSeats.forEach((seat) => {
    seat.cards.forEach((card, index) => {
      keys.push(`${seat.id}-${card.id}-${index}`);
    });
  });

  state?.playerCards.forEach((card, index) => {
    keys.push(`player-${card.id}-${index}`);
  });

  return keys;
}

function buildBlackjackSyncSignature(state: BlackjackState | null) {
  if (!state?.token) return "";
  return JSON.stringify({
    token: state.token,
    roomId: state.roomId || null,
    stage: state.stage,
    dealerHidden: state.dealerHidden,
    playerCards: state.playerCards.map((card) => card.id),
    dealerCards: state.dealerCards.map((card) => card.id),
    aiSeats: state.aiSeats.map((seat) => ({
      id: seat.id,
      cards: seat.cards.map((card) => card.id),
      wager: seat.wager,
      result: seat.result,
    })),
    playerTotal: state.playerScore.total,
    dealerTotal: state.dealerScore.total,
    payoutAmount: state.payoutAmount,
    lastDelta: state.lastDelta,
  });
}

function formatTurnClock(remainingMs: number) {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

type BlackjackRoomProps = {
  playerName: string;
  profile: CasinoProfile;
  mediaReady: boolean;
  onProfileChange: (profile: CasinoProfile, message?: string) => void;
  onError: (message: string) => void;
};

export default function BlackjackRoom({
  playerName,
  profile,
  mediaReady,
  onProfileChange,
  onError,
}: BlackjackRoomProps) {
  const blackjackRoomMeta = ROOM_DEFINITIONS.find((roomEntry) => roomEntry.id === "blackjack");
  const [bet, setBet] = useState(PLAYER_BETS[1]);
  const [state, setState] = useState<BlackjackState | null>(null);
  const [working, setWorking] = useState(false);
  const [roomId, setRoomId] = useState(() => readSyncedTableSelection("blackjack") || BLACKJACK_SALONS[0].id);
  const [rooms, setRooms] = useState<CasinoTableRoom[]>([]);
  const [infoTab, setInfoTab] = useState<"salons" | "regles" | "joueurs">("salons");
  const [showRoomInfo, setShowRoomInfo] = useState(false);
  const [activeHeaderInfo, setActiveHeaderInfo] = useState<"table" | "mise" | "live">("table");
  const [dealtCardDelays, setDealtCardDelays] = useState<Record<string, number>>({});
  const [resultFlash, setResultFlash] = useState<{ label: string; detail?: string; tone: "win" | "lose" } | null>(null);
  const [turnDeadlineAt, setTurnDeadlineAt] = useState<number | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const previousCardKeysRef = useRef<string[]>([]);
  const previousStageRef = useRef<string>("idle");
  const clearDealAnimationTimeoutRef = useRef<number | null>(null);
  const clearResultFlashTimeoutRef = useRef<number | null>(null);
  const latestAppliedSyncAtRef = useRef(0);
  const skipNextSyncPublishRef = useRef(false);
  const lastTurnSignatureRef = useRef("");
  const lastTimedOutSignatureRef = useRef("");
  const { clearQueuedAudio, playCardBurst, playCheck } = useTableAudio(mediaReady);
  const displayState = useMemo<BlackjackState | null>(() => state, [state]);

  const stage = state?.stage || "idle";
  const lastDelta = state?.lastDelta || 0;
  const roomSwitchLocked = stage === "player-turn";
  const activeRoom = rooms.find((entry) => entry.id === roomId) || null;
  const activePlayerCount = activeRoom?.playerCount || 0;
  const autoLiveMode = activePlayerCount >= LIVE_MIN_PLAYERS;
  const currentRoundIsLive = Boolean(state?.roomId);
  const shouldSyncLiveRoom = currentRoundIsLive || (stage !== "player-turn" && autoLiveMode);
  const isDecisionPhase = stage === "player-turn";
  const turnCountdownMs = turnDeadlineAt ? Math.max(0, turnDeadlineAt - nowTick) : 0;
  const turnCountdownLabel = turnDeadlineAt ? formatTurnClock(turnCountdownMs) : "1:30";

  function applySyncedState(nextState: BlackjackState | null, syncedAt: number, nextDeadlineAt: number | null) {
    if (!nextState?.roomId) return;
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
    writeSyncedTableSelection("blackjack", roomId);
  }, [roomId]);

  useEffect(() => {
    return subscribeSyncedTableSelection("blackjack", (nextRoomId) => {
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
        const result = await joinBlackjackRoom(roomId);
        if (cancelled) return;
        setRooms(result.rooms);

        try {
          const sharedState = await fetchBlackjackRoomState(roomId);
          if (cancelled || !sharedState) return;
          applySyncedState(sharedState, Date.now(), turnDeadlineAt);
          return;
        } catch (syncError) {
          if (cancelled) return;
          if (syncError instanceof Error) {
            onError(syncError.message);
          }
        }

        const snapshot = readTableChannelSnapshot<BlackjackState>("blackjack", roomId);
        if (cancelled || !snapshot?.state) return;
        applySyncedState(snapshot.state, snapshot.syncedAt, snapshot.turnDeadlineAt);
      } catch (error_) {
        if (cancelled) return;
        onError(error_ instanceof Error ? error_.message : "Le salon blackjack ne repond pas.");
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
    const existingSnapshot = readTableChannelSnapshot<BlackjackState>("blackjack", roomId);
    if (existingSnapshot?.state) {
      applySyncedState(existingSnapshot.state, existingSnapshot.syncedAt, existingSnapshot.turnDeadlineAt);
    }

    return subscribeTableChannel<BlackjackState>("blackjack", roomId, (snapshot) => {
      if (snapshot.roomId !== roomId) return;
      applySyncedState(snapshot.state, snapshot.syncedAt, snapshot.turnDeadlineAt);
    });
  }, [roomId]);

  useEffect(() => {
    if (!state || !state.roomId) return;

    if (skipNextSyncPublishRef.current) {
      skipNextSyncPublishRef.current = false;
      return;
    }

    const signature = buildBlackjackSyncSignature(state);
    const isActionable = state.stage === "player-turn" && Boolean(state.token);
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
    writeTableChannelSnapshot<BlackjackState>({
      game: "blackjack",
      roomId,
      syncedAt,
      turnDeadlineAt: nextDeadlineAt,
      state,
    });
  }, [roomId, state, turnDeadlineAt]);

  useEffect(() => {
    if (!currentRoundIsLive || !state?.token || stage !== "player-turn" || !turnDeadlineAt || working) return;

    const signature = buildBlackjackSyncSignature(state);
    if (!signature || turnDeadlineAt > nowTick || lastTimedOutSignatureRef.current === signature) return;

    lastTimedOutSignatureRef.current = signature;
    onError("Temps ecoule: la table passe automatiquement sur Rester.");
    void act("stand");
  }, [currentRoundIsLive, nowTick, onError, stage, state, turnDeadlineAt, working]);

  useEffect(() => {
    return () => {
      if (clearDealAnimationTimeoutRef.current) {
        window.clearTimeout(clearDealAnimationTimeoutRef.current);
      }
      if (clearResultFlashTimeoutRef.current) {
        window.clearTimeout(clearResultFlashTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const previousStage = previousStageRef.current;
    previousStageRef.current = stage;

    if (stage !== "resolved" || previousStage === "resolved") {
      return;
    }

    const nextFlash =
      lastDelta > 0
        ? { label: "WIN", detail: `+${formatCredits(lastDelta)}`, tone: "win" as const }
        : lastDelta < 0
          ? { label: "LOSE", detail: `-${formatCredits(Math.abs(lastDelta))}`, tone: "lose" as const }
          : null;

    if (!nextFlash) {
      setResultFlash(null);
      return;
    }

    setResultFlash(nextFlash);
    if (clearResultFlashTimeoutRef.current) {
      window.clearTimeout(clearResultFlashTimeoutRef.current);
    }
    clearResultFlashTimeoutRef.current = window.setTimeout(() => {
      setResultFlash(null);
      clearResultFlashTimeoutRef.current = null;
    }, BLACKJACK_RESULT_FLASH_MS);
  }, [lastDelta, stage]);

  useEffect(() => {
    const currentCardKeys = getBlackjackCardKeys(displayState);
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
  }, [displayState]);

  async function startRound() {
    onError("");
    clearQueuedAudio();
    previousCardKeysRef.current = [];
    setDealtCardDelays({});
    if (clearDealAnimationTimeoutRef.current) {
      window.clearTimeout(clearDealAnimationTimeoutRef.current);
      clearDealAnimationTimeoutRef.current = null;
    }
    setWorking(true);
    try {
      const result = await startBlackjackRound(bet, roomId);
      setState(result.state);
      if (result.profile) {
        onProfileChange(result.profile);
      }
    } catch (error_) {
      onError(error_ instanceof Error ? error_.message : "La donne n'a pas pu commencer.");
    } finally {
      setWorking(false);
    }
  }

  async function act(action: "hit" | "stand") {
    if (!state?.token || stage !== "player-turn" || working) return;
    onError("");
    if (action === "hit") {
      playCheck();
    }
    setWorking(true);
    try {
      const result = await actBlackjackRound(state.token, action);
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

  function resetTableVisualState() {
    clearQueuedAudio();
    previousCardKeysRef.current = [];
    setDealtCardDelays({});
    setResultFlash(null);
    setTurnDeadlineAt(null);
    if (clearDealAnimationTimeoutRef.current) {
      window.clearTimeout(clearDealAnimationTimeoutRef.current);
      clearDealAnimationTimeoutRef.current = null;
    }
    if (clearResultFlashTimeoutRef.current) {
      window.clearTimeout(clearResultFlashTimeoutRef.current);
      clearResultFlashTimeoutRef.current = null;
    }
  }

  function handleRoomChange(nextRoomId: string) {
    if (roomSwitchLocked || working || nextRoomId === roomId) return;
    resetTableVisualState();
    setState(null);
    setRoomId(nextRoomId);
    writeSyncedTableSelection("blackjack", nextRoomId);
  }

  return (
    <section className="casino-table-layout casino-table-layout--compact casino-table-layout--cards">
      <div className="casino-stage casino-stage--cards casino-stage--cards--blackjack">
        <div
          className="casino-card-fused-stage casino-card-fused-stage--blackjack"
          style={{ ["--room-art" as string]: `url("${blackjackCaptainArt}")` }}
        >
          <div className="casino-room-hud casino-room-hud--blackjack">
            <div className="casino-room-hud__lead">
              <img className="casino-room-hud__portrait" src={blackjackCaptainArt} alt="" aria-hidden="true" />
              <div className="casino-room-hud__identity">
                <div className="casino-topdeck__chip-row">
                  <span className="casino-chip">{blackjackRoomMeta?.chip || "Table des lanternes"}</span>
                  <div className="casino-room-hud__utility-stack">
                    <button
                      type="button"
                      className={`casino-ghost-button casino-topdeck__info-toggle ${showRoomInfo ? "is-open" : ""}`}
                      onClick={() => setShowRoomInfo((value) => !value)}
                      aria-label="Informations blackjack"
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
                      className={`casino-card-turn-timer ${turnDeadlineAt ? "is-live" : ""} ${turnCountdownMs <= 10_000 && turnDeadlineAt ? "is-warning" : ""}`}
                      aria-label={turnDeadlineAt ? `Temps restant ${turnCountdownLabel}` : "Timer de table en attente"}
                    >
                      {turnDeadlineAt ? turnCountdownLabel : "Timer --:--"}
                    </span>
                  </div>
                </div>
                <strong>{blackjackRoomMeta?.title || "Blackjack pirate"}</strong>
                <p>
                  {state?.message || "Table synchronisee par salon avec mise et resultat geres cote serveur."}
                  {activeRoom ? ` Salon actif: ${BLACKJACK_SALONS.find((entry) => entry.id === activeRoom.id)?.title || activeRoom.id}.` : ""}
                </p>
              </div>
            </div>

            {showRoomInfo ? (
              <article className="casino-topdeck__info-panel" aria-label="Informations blackjack">
                <div className="casino-topdeck__info-buttons" role="tablist" aria-label="Sections blackjack">
                  <button
                    type="button"
                    role="tab"
                    className={`casino-topdeck__info-button ${activeHeaderInfo === "table" ? "is-active" : ""}`}
                    aria-selected={activeHeaderInfo === "table"}
                    onClick={() => setActiveHeaderInfo("table")}
                  >
                    Table
                  </button>
                  <button
                    type="button"
                    role="tab"
                    className={`casino-topdeck__info-button ${activeHeaderInfo === "mise" ? "is-active" : ""}`}
                    aria-selected={activeHeaderInfo === "mise"}
                    onClick={() => setActiveHeaderInfo("mise")}
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
                  {activeHeaderInfo === "table" ? (
                    <div className="casino-rule-list">
                      <p>Chaque salon vit cote serveur des qu'au moins un joueur humain est present. Le croupier complete la table si tu es seul.</p>
                      <p>Le blackjack naturel paie plus fort et le reglement passe par le wallet A11.</p>
                      <p>Les autres joueurs et leurs jetons restent visibles directement sur le tapis commun.</p>
                    </div>
                  ) : null}
                  {activeHeaderInfo === "mise" ? (
                    <div className="casino-metric-list">
                      <div>
                        <span>Presets</span>
                        <strong>50 / 100 / 200 / 400</strong>
                      </div>
                      <div>
                        <span>Mise active</span>
                        <strong>{formatCredits(state?.wager || bet)}</strong>
                      </div>
                      <div>
                        <span>Payout</span>
                        <strong>{formatCredits(state?.payoutAmount || 0)}</strong>
                      </div>
                      <div>
                        <span>Mode</span>
                        <strong>{currentRoundIsLive || autoLiveMode ? "Table partagee" : "Initialisation"}</strong>
                      </div>
                    </div>
                  ) : null}
                  {activeHeaderInfo === "live" ? (
                    <div className="casino-rule-list">
                      <p>Le salon reste actif des qu'un joueur humain est present sur la table.</p>
                      <p>Le tour actif reste synchronise entre les joueurs du meme salon.</p>
                      <p>Table en cours: {activeRoom ? BLACKJACK_SALONS.find((entry) => entry.id === activeRoom.id)?.title || activeRoom.id : "Aucune"}</p>
                      <p>Joueurs presents: {Math.max(1, activePlayerCount)}</p>
                    </div>
                  ) : null}
                </div>
              </article>
            ) : null}

            <div className="casino-salon-strip casino-salon-strip--compact" role="tablist" aria-label="Salons blackjack">
              {BLACKJACK_SALONS.map((salon) => {
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

          <div className="casino-reel-shell casino-room-shell casino-room-shell--cards casino-reel-shell--table-compact casino-reel-shell--blackjack">
            <BlackjackTableScene
              state={displayState}
              playerName={playerName}
              bet={bet}
              isDecisionPhase={isDecisionPhase}
              dealtCardDelays={dealtCardDelays}
              resultFlash={resultFlash}
            />

            <BlackjackSidebar
              profile={profile}
              state={displayState}
              bet={bet}
              working={working}
              roomId={roomId}
              rooms={rooms}
              infoTab={infoTab}
              isDecisionPhase={isDecisionPhase}
              roomSwitchLocked={roomSwitchLocked}
              onBetChange={setBet}
              onInfoTabChange={setInfoTab}
              onRoomChange={handleRoomChange}
              onHit={() => void act("hit")}
              onStand={() => void act("stand")}
              onDeal={() => void startRound()}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
