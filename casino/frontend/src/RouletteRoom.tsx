import * as React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import PirateInspector from "./PirateInspector";
import { ROOM_DEFINITIONS } from "./features/casino/catalog";
import type { RouletteSoundEvent } from "./features/casino/catalog";
import AtsRouletteBoard, {
  type RoulettePortOccupant,
} from "./features/roulette/components/AtsRouletteBoard";
import RouletteCinematicStage from "./features/roulette/components/RouletteCinematicStage";
import RouletteResultPreview from "./features/roulette/components/RouletteResultPreview";
import {
  BALL_INNER_RADIUS,
  BALL_OUTER_RADIUS,
  BALL_START_ANGLE,
  BALL_TARGET_ANGLE,
  HOLD_DURATION_MS,
  ROULETTE_ANNOUNCE_LEAD_IN_MS,
  ROULETTE_AMOUNT_PRESETS,
  ROULETTE_ORDER,
  ROULETTE_TIRAGE_CANNON_DELAY_MS,
  SPIN_DURATION_MS,
  WHEEL_POCKET_ANGLE,
  buildSettledAnimation,
  buildStaticAnimation,
  easeOutCubic,
  easeOutQuart,
  getNumberColor,
  getBetLabel,
  getPocketIndex,
  lerp,
  normalizeAngle,
  playVideoForward,
  playVideoReverse,
  toBallCoordinates,
  waitForMs,
  type RouletteAnimationState,
  type RouletteSequencePhase,
} from "./features/roulette/model";
import rouletteBackdropArt from "./images/casino ats.png";
import rouletteIdleImg from "./images/roulette.png";
import roulettePreviewImg from "./images/roulette-plateau-premium.png";
import rouletteTurntableImg from "./images/roulette-tournante.png";
import jetonImg from "./images/jeton.png";
import lingotImg from "./images/lingot.png";
import saphirImg from "./images/saphir.png";
import rubisImg from "./images/rubis.png";
import tapisImg from "./images/tapis.png";
import rouletteReloadVideo from "./videos/roulette-reload.mp4";
import rouletteTirageVideo from "./videos/roulette-tirage.mp4";
import { formatCredits } from "./lib/casinoRoomState";
import {
  readTableChannelSnapshot,
  subscribeTableChannel,
  writeTableChannelSnapshot,
} from "./lib/tableChannelSync";
import {
  isCasinoSessionError,
  fetchRouletteRoom,
  placeRouletteBet,
  type CasinoProfile,
  type RouletteRoom,
} from "./lib/casinoApi";

type RouletteRoomProps = {
  profile: CasinoProfile;
  onProfileChange: (profile: CasinoProfile, message?: string) => void;
  onError: (message: string) => void;
  onRouletteEvent?: (event: RouletteSoundEvent) => void;
  onAmbientPanelChange?: (panel: React.ReactNode | null) => void;
};

type RouletteInfoSection = {
  id: string;
  label: string;
  content: React.ReactNode;
};

type ActiveRouletteBet = {
  betType: string;
  betValue: string;
  label: string;
  amount: number;
};

type PendingRouletteBet = ActiveRouletteBet;

const ROULETTE_POLL_ACTIVE_INTERVAL_MS = 1200;
const ROULETTE_POLL_IDLE_INTERVAL_MS = 15000;
const ROULETTE_FALLBACK_DRAW_INTERVAL_MS = 120_000;
const ROULETTE_CELEBRATION_FLASH_MS = 3_200;
const ROULETTE_BIG_WIN_RAIN_MS = 4_600;
const ROULETTE_SYNC_ROOM_ID = "ats-live";
const ROULETTE_SYNC_LEAD_MS = 1_800;
const ROULETTE_AUTO_SUBMIT_THRESHOLD_MS = 15_000;
const ROULETTE_PORT_ORDER = ["http", "https", "app", "ssh"] as const;
const ROULETTE_PORT_TONES = ["red", "green", "amber", "blue"] as const;
const ROULETTE_PLAYER_TONES = ["amber", "red", "green", "blue"] as const;

type RouletteCelebrationTone = "win" | "big" | "mega";

type RouletteCelebration = {
  resultId: number;
  winningNumber: number;
  winningColor: string;
  payoutTotal: number;
  wageredTotal: number;
  tone: RouletteCelebrationTone;
  label: string;
};

type RoulettePrizeRainItem = {
  id: string;
  left: string;
  delay: string;
  duration: string;
  drift: string;
  scale: string;
  asset: string;
  kind: "lingot" | "diamond";
};

function getRouletteCelebrationTone(payoutTotal: number, wageredTotal: number): RouletteCelebrationTone {
  const ratio = payoutTotal / Math.max(1, wageredTotal);
  if (ratio >= 18 || payoutTotal >= 4_000) return "mega";
  if (ratio >= 8 || payoutTotal >= 1_200) return "big";
  return "win";
}

function getRouletteCelebrationLabel(tone: RouletteCelebrationTone) {
  if (tone === "mega") return "Mega Win";
  if (tone === "big") return "Big Win";
  return "Gain";
}

function buildRoulettePrizeRain(amount: number, tone: RouletteCelebrationTone): RoulettePrizeRainItem[] {
  const count =
    tone === "mega"
      ? Math.min(26, Math.max(14, Math.round(amount / 180)))
      : Math.min(18, Math.max(8, Math.round(amount / 220)));

  return Array.from({ length: count }, (_, index) => {
    const useDiamond = tone !== "win" && index % 3 === 0;
    const asset = useDiamond ? (index % 2 === 0 ? saphirImg : rubisImg) : lingotImg;
    return {
      id: `roulette-rain-${Date.now()}-${index}`,
      left: `${4 + ((index * 7.6) % 92)}%`,
      delay: `${(index % 7) * 0.1}s`,
      duration: `${2.2 + (index % 5) * 0.22}s`,
      drift: `${-24 + (index % 9) * 6}px`,
      scale: `${0.68 + (index % 4) * 0.18}`,
      asset,
      kind: useDiamond ? "diamond" : "lingot",
    };
  });
}

function getRoulettePortChipCount(totalAmount: number, betCount: number) {
  const sanitizedAmount = Math.max(0, Number(totalAmount || 0));
  const sanitizedBetCount = Math.max(0, Number(betCount || 0));

  let stack = 1;
  if (sanitizedAmount >= 2_000) stack = 6;
  else if (sanitizedAmount >= 1_200) stack = 5;
  else if (sanitizedAmount >= 500) stack = 4;
  else if (sanitizedAmount >= 200) stack = 3;
  else if (sanitizedAmount >= 80) stack = 2;

  if (sanitizedBetCount >= 3) {
    stack += 1;
  }

  return Math.min(7, stack);
}

export default function RouletteRoom({
  profile,
  onProfileChange,
  onError,
  onRouletteEvent,
  onAmbientPanelChange,
}: RouletteRoomProps) {
  const rouletteRoomMeta = ROOM_DEFINITIONS.find((roomEntry) => roomEntry.id === "roulette");
  const [room, setRoom] = useState<RouletteRoom | null>(null);
  const [amount, setAmount] = useState(ROULETTE_AMOUNT_PRESETS[2]);
  const [selectedBet, setSelectedBet] = useState<{ betType: string; betValue: string; label: string } | null>(null);
  const [pendingBets, setPendingBets] = useState<PendingRouletteBet[]>([]);
  const [working, setWorking] = useState(false);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [infoTab, setInfoTab] = useState<"mises" | "participants" | "historique">("mises");
  const [sequencePhase, setSequencePhase] = useState<RouletteSequencePhase>("idle");
  const [animation, setAnimation] = useState<RouletteAnimationState>(() => buildStaticAnimation());
  const [showRoomInfo, setShowRoomInfo] = useState(false);
  const [celebration, setCelebration] = useState<RouletteCelebration | null>(null);
  const [prizeRain, setPrizeRain] = useState<RoulettePrizeRainItem[]>([]);
  const [isDocumentVisible, setIsDocumentVisible] = useState(() => {
    if (typeof document === "undefined") return true;
    return document.visibilityState !== "hidden";
  });

  const onProfileChangeRef = useRef(onProfileChange);
  const onErrorRef = useRef(onError);
  const onRouletteEventRef = useRef(onRouletteEvent);
  const previousParticipantCountRef = useRef<number | null>(null);
  const latestResolvedIdRef = useRef<number | null>(null);
  const announcedRoomEntryRef = useRef(false);
  const animationFrameRef = useRef<number | null>(null);
  const animationRef = useRef<RouletteAnimationState>(buildStaticAnimation());
  const mountedRef = useRef(true);
  const sequenceTokenRef = useRef(0);
  const introVideoRef = useRef<HTMLVideoElement | null>(null);
  const reloadVideoRef = useRef<HTMLVideoElement | null>(null);
  const profileSignatureRef = useRef<string>("");
  const pollTimeoutRef = useRef<number | null>(null);
  const syncInFlightRef = useRef(false);
  const drawTimeoutRef = useRef<number | null>(null);
  const celebrationTimeoutRef = useRef<number | null>(null);
  const prizeRainTimeoutRef = useRef<number | null>(null);
  const lastDrawStartedAtRef = useRef(0);
  const pendingDrawRef = useRef<{
    winningNumber: number;
    roundId: number;
    resultId: number;
    startAt: number;
  } | null>(null);
  const documentVisibleRef = useRef(isDocumentVisible);
  const latestAppliedSyncAtRef = useRef(0);
  const skipNextSyncPublishRef = useRef(false);
  const lastAutoSubmitKeyRef = useRef("");

  function applySyncedRouletteRoom(nextRoom: RouletteRoom | null, syncedAt: number) {
    if (!nextRoom) return;
    if (syncedAt <= latestAppliedSyncAtRef.current) return;
    latestAppliedSyncAtRef.current = syncedAt;
    skipNextSyncPublishRef.current = true;
    setRoom(nextRoom);
  }

  function getRoulettePollDelay(nextRoom: RouletteRoom | null) {
    const participantCount = Number(nextRoom?.round.playerCount || 0);
    const hasMyBets = Boolean(nextRoom?.round.myBets?.length);
    const hasVisibleAction = Boolean(nextRoom?.roomActive || nextRoom?.round.visibleBetsBySpot?.length);
    return participantCount > 0 || hasMyBets || hasVisibleAction
      ? ROULETTE_POLL_ACTIVE_INTERVAL_MS
      : ROULETTE_POLL_IDLE_INTERVAL_MS;
  }

  useEffect(() => {
    onProfileChangeRef.current = onProfileChange;
  }, [onProfileChange]);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    onRouletteEventRef.current = onRouletteEvent;
  }, [onRouletteEvent]);

  useEffect(() => {
    animationRef.current = animation;
  }, [animation]);

  useEffect(() => {
    documentVisibleRef.current = isDocumentVisible;
    if (isDocumentVisible || syncInFlightRef.current) return;
    if (pollTimeoutRef.current) {
      window.clearTimeout(pollTimeoutRef.current);
      pollTimeoutRef.current = null;
    }
  }, [isDocumentVisible]);

  useEffect(() => {
    if (typeof document === "undefined") return undefined;

    function updateVisibility() {
      setIsDocumentVisible(document.visibilityState !== "hidden");
    }

    updateVisibility();
    document.addEventListener("visibilitychange", updateVisibility);
    window.addEventListener("focus", updateVisibility);

    return () => {
      document.removeEventListener("visibilitychange", updateVisibility);
      window.removeEventListener("focus", updateVisibility);
    };
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      sequenceTokenRef.current += 1;
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      if (introVideoRef.current) {
        introVideoRef.current.pause();
      }
      if (reloadVideoRef.current) {
        reloadVideoRef.current.pause();
      }
      if (pollTimeoutRef.current) {
        window.clearTimeout(pollTimeoutRef.current);
        pollTimeoutRef.current = null;
      }
      if (drawTimeoutRef.current) {
        window.clearTimeout(drawTimeoutRef.current);
        drawTimeoutRef.current = null;
      }
      if (celebrationTimeoutRef.current) {
        window.clearTimeout(celebrationTimeoutRef.current);
        celebrationTimeoutRef.current = null;
      }
      if (prizeRainTimeoutRef.current) {
        window.clearTimeout(prizeRainTimeoutRef.current);
        prizeRainTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const existingSnapshot = readTableChannelSnapshot<RouletteRoom>("roulette", ROULETTE_SYNC_ROOM_ID);
    if (existingSnapshot?.state) {
      applySyncedRouletteRoom(existingSnapshot.state, existingSnapshot.syncedAt);
    }

    return subscribeTableChannel<RouletteRoom>("roulette", ROULETTE_SYNC_ROOM_ID, (snapshot) => {
      if (snapshot.roomId !== ROULETTE_SYNC_ROOM_ID) return;
      applySyncedRouletteRoom(snapshot.state, snapshot.syncedAt);
    });
  }, []);

  useEffect(() => {
    if (!isDocumentVisible) return undefined;

    let mounted = true;
    let tickId = 0;

    function buildProfileSignature(nextProfile: CasinoProfile) {
      return JSON.stringify({
        balance: nextProfile.wallet.balance,
        canClaimDailyBonus: nextProfile.wallet.canClaimDailyBonus,
        nextDailyBonusAt: nextProfile.wallet.nextDailyBonusAt,
        gamesPlayed: nextProfile.wallet.gamesPlayed,
        lifetimeWon: nextProfile.wallet.lifetimeWon,
        lifetimeWagered: nextProfile.wallet.lifetimeWagered,
        transactionIds: nextProfile.recentTransactions.slice(0, 5).map((entry) => entry.id),
      });
    }

    function syncProfileIfChanged(nextProfile: CasinoProfile) {
      const nextSignature = buildProfileSignature(nextProfile);
      if (nextSignature === profileSignatureRef.current) return;
      profileSignatureRef.current = nextSignature;
      onProfileChangeRef.current(nextProfile);
    }

    async function syncRoom() {
      if (syncInFlightRef.current) return;
      syncInFlightRef.current = true;
      let nextRoom: RouletteRoom | null = null;
      try {
        const result = await fetchRouletteRoom();
        if (!mounted) return;
        nextRoom = result.room;
        setRoom(result.room);
        syncProfileIfChanged(result.profile);
      } catch (error_) {
        if (!mounted) return;
        onErrorRef.current(
          isCasinoSessionError(error_)
            ? "La session roulette a expire. Recharge le salon pour te reconnecter."
            : error_ instanceof Error
              ? error_.message
              : "La salle roulette est indisponible.",
        );
      } finally {
        syncInFlightRef.current = false;
        if (mounted && documentVisibleRef.current) {
          pollTimeoutRef.current = window.setTimeout(() => {
            void syncRoom();
          }, getRoulettePollDelay(nextRoom));
        }
      }
    }

    void syncRoom();
    tickId = window.setInterval(() => setNowTick(Date.now()), 1000);

    return () => {
      mounted = false;
      window.clearInterval(tickId);
      if (pollTimeoutRef.current) {
        window.clearTimeout(pollTimeoutRef.current);
        pollTimeoutRef.current = null;
      }
    };
  }, [isDocumentVisible]);

  useEffect(() => {
    if (!room) return;

    if (skipNextSyncPublishRef.current) {
      skipNextSyncPublishRef.current = false;
      return;
    }

    const syncedAt = Date.now();
    latestAppliedSyncAtRef.current = syncedAt;
    writeTableChannelSnapshot<RouletteRoom>({
      game: "roulette",
      roomId: ROULETTE_SYNC_ROOM_ID,
      syncedAt,
      turnDeadlineAt: room.round.closesAt ? new Date(room.round.closesAt).getTime() : null,
      state: room,
    });
  }, [room]);

  const remainingMs = useMemo(() => {
    const closesAt = room?.round.closesAt ? new Date(room.round.closesAt).getTime() : 0;
    if (!closesAt) return 0;
    return Math.max(0, closesAt - nowTick);
  }, [nowTick, room?.round.closesAt]);
  const countdownLabel = useMemo(() => {
    if (remainingMs <= 0) return "Fermee";
    const totalSeconds = Math.ceil(remainingMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  }, [remainingMs]);

  const wheelPockets = useMemo(
    () =>
      ROULETTE_ORDER.map((number, index) => ({
        number,
        color: getNumberColor(number),
        angle: index * WHEEL_POCKET_ANGLE - 90,
      })),
    [],
  );

  const rouletteVisualAssets = useMemo(
    () => ({
      chip: jetonImg,
      felt: tapisImg,
      wheelBase: roulettePreviewImg,
      turntable: rouletteTurntableImg,
    }),
    [],
  );

  const joinedSalon = useMemo(() => {
    const pirateChannels = [
      "Mouillage du Kraken",
      "Crique des Sabres",
      "Pont des Corsaires",
      "Passe du Crabe Noir",
      "Baie des Flibustiers",
      "Anse du Gouvernail",
      "Rade des Galions",
      "Brume du Pavillon Noir",
    ] as const;

    const roundId = Number(room?.round.id || 0);
    if (!roundId) {
      return {
        eyebrow: "Canal pirate",
        title: "Mouillage des Deniers Noirs",
      };
    }

    const channelNumber = ((roundId - 1) % pirateChannels.length) + 1;
    return {
      eyebrow: `Canal ${channelNumber}`,
      title: pirateChannels[channelNumber - 1],
    };
  }, [room?.round.id]);
  const activeBets = useMemo<ActiveRouletteBet[]>(() => {
    const nextActiveBets: ActiveRouletteBet[] = [];
    const activeBetAmounts = new Map<string, number>();

    for (const bet of room?.round.myBets || []) {
      const key = `${bet.betType}::${bet.betValue}`;
      activeBetAmounts.set(key, (activeBetAmounts.get(key) || 0) + bet.amount);
    }

    for (const [key, totalAmount] of activeBetAmounts.entries()) {
      const [betType, betValue] = key.split("::");
      nextActiveBets.push({
        betType,
        betValue,
        label: getBetLabel(betType, betValue),
        amount: totalAmount,
      });
    }

    return nextActiveBets;
  }, [room?.round.myBets]);
  const pendingTotal = useMemo(
    () => pendingBets.reduce((sum, bet) => sum + bet.amount, 0),
    [pendingBets],
  );
  const portOccupants = useMemo<RoulettePortOccupant[]>(() => {
    const participants = room?.round.participants || [];
    return participants.slice(0, 4).map((participant, index) => ({
      port: ROULETTE_PORT_ORDER[index] || ROULETTE_PORT_ORDER[0],
      userId: participant.userId,
      username: participant.username,
      totalAmount: participant.totalAmount,
      chipCount: getRoulettePortChipCount(participant.totalAmount, participant.betCount),
      tone: ROULETTE_PORT_TONES[index] || ROULETTE_PORT_TONES[0],
      isSelf: participant.userId === profile.user.id,
    }));
  }, [profile.user.id, room?.round.participants]);
  const selfPortTone = portOccupants.find((entry) => entry.isSelf)?.tone || "amber";
  const playerToneMap = useMemo(() => {
    const toneMap = new Map<string, (typeof ROULETTE_PLAYER_TONES)[number]>();
    toneMap.set(profile.user.id, selfPortTone as (typeof ROULETTE_PLAYER_TONES)[number]);
    (room?.round.visibleBetsByPlayer || []).forEach((entry, index) => {
      if (!toneMap.has(entry.playerId)) {
        toneMap.set(entry.playerId, ROULETTE_PLAYER_TONES[index % ROULETTE_PLAYER_TONES.length]);
      }
    });
    return toneMap;
  }, [profile.user.id, room?.round.visibleBetsByPlayer, selfPortTone]);
  const boardPlacedBets = useMemo(() => {
    const confirmedStacks = (room?.round.visibleBetsBySpot || []).flatMap((spot) =>
      (spot.players || []).map((player, playerIndex) => ({
        stackId: `${spot.betType}:${spot.betValue}:${player.playerId}`,
        betType: spot.betType,
        betValue: spot.betValue,
        amount: player.amount,
        tone: playerToneMap.get(player.playerId) || selfPortTone,
        offsetIndex: playerIndex,
      })),
    );

    const pendingPreviewStacks = pendingBets.map((bet, index) => ({
      stackId: `pending:${bet.betType}:${bet.betValue}:${index}`,
      betType: bet.betType,
      betValue: bet.betValue,
      amount: bet.amount,
      tone: selfPortTone,
      offsetIndex: index,
      isPreview: true,
    }));

    return [...confirmedStacks, ...pendingPreviewStacks];
  }, [pendingBets, playerToneMap, room?.round.visibleBetsBySpot, selfPortTone]);
  const activeTotal = activeBets.reduce((sum, bet) => sum + bet.amount, 0);
  const hasPendingBets = pendingBets.length > 0;
  const rouletteSummaryTitle = hasPendingBets
    ? `${pendingBets.length} mise${pendingBets.length > 1 ? "s" : ""} en attente`
    : selectedBet
      ? `Cible: ${selectedBet.label}`
      : joinedSalon.title;
  const latestResult = room?.recentResults?.[0] || null;
  const latestResolvedResult = room?.latestResolved || latestResult;

  const rouletteInfoSections = useMemo<RouletteInfoSection[]>(
    () => [
      {
        id: "salle",
        label: "Apercu",
        content: (
          <div className="casino-topdeck__info-stack">
            <div className="casino-topdeck__info-meta">
              <span>{rouletteRoomMeta?.label || "Roulette"}</span>
              <span>Mode: {room?.roomActive ? "table partagee active" : "table en veille"}</span>
              <span>Wallet: backend A11</span>
            </div>
            <p className="casino-topdeck__info-copy">
              Une salle commune, un compte a rebours partage et un tir serveur unique toutes les deux minutes quand au moins un joueur est present.
            </p>
          </div>
        ),
      },
      {
        id: "canal",
        label: "Canal",
        content: (
          <div className="casino-metric-list">
            <div>
              <span>Canal</span>
              <strong>{joinedSalon.title}</strong>
            </div>
            <div>
              <span>Joueurs</span>
              <strong>{room?.round.playerCount || 0}</strong>
            </div>
            <div>
              <span>Pot</span>
              <strong>{room?.round.totalPot || 0}</strong>
            </div>
            <div>
              <span>Cloture</span>
              <strong>{remainingMs > 0 ? `${Math.ceil(remainingMs / 1000)}s` : "Fermee"}</strong>
            </div>
          </div>
        ),
      },
      {
        id: "historique",
        label: "Historique",
        content: (
          <div className="casino-chip-row">
            {(room?.recentResults || []).length ? (
              room?.recentResults.map((entry) => (
                <span key={entry.id} className={`casino-roulette-history-chip is-${entry.winningColor}`}>
                  {entry.winningNumber}
                </span>
              ))
            ) : (
              <p className="casino-history-empty">Aucun numero resolu pour le moment.</p>
            )}
          </div>
        ),
      },
      {
        id: "carnet",
        label: "Carnet de tir",
        content: (
          <PirateInspector
            title="Carnet de tir"
            eyebrow="Roulette"
            activeTab={infoTab}
            onChange={(tabId) => setInfoTab(tabId as typeof infoTab)}
            tabs={[
              {
                id: "mises",
                label: "Mes mises",
                badge: room?.round.myBets?.length || 0,
                caption: "Lecture compacte du tour courant.",
                content: (
                  <div className="casino-history-list">
                    {(room?.round.myBets || []).length ? (
                      room?.round.myBets.map((bet) => (
                        <article key={bet.id} className="casino-history-entry">
                          <div>
                            <span>{getBetLabel(bet.betType, bet.betValue)}</span>
                            <strong className="casino-token-inline"><img src={rouletteVisualAssets.chip} alt="" />{formatCredits(bet.amount)}</strong>
                          </div>
                          <div className={bet.payout > 0 ? "is-positive" : ""}>
                            {bet.payout > 0 ? `+${formatCredits(bet.payout)}` : "en attente"}
                          </div>
                        </article>
                      ))
                    ) : (
                      <p className="casino-history-empty">Aucune mise active sur le tour courant.</p>
                    )}
                  </div>
                ),
              },
              {
                id: "participants",
                label: "Participants",
                badge: room?.round.visibleBetsByPlayer?.length || 0,
                caption: "Marins presents sur le tir.",
                content: (
                  <div className="casino-prize-stack">
                    {(room?.round.visibleBetsByPlayer || []).length ? (
                      room?.round.visibleBetsByPlayer?.map((entry) => (
                        <article key={entry.playerId} className="casino-prize-card">
                          <div className="casino-prize-card__glyph"><img src={rouletteVisualAssets.chip} alt="" /></div>
                          <div>
                            <strong>{entry.displayName}</strong>
                            <span>{formatCredits(entry.totalAmount)} sur {entry.bets.length} position{entry.bets.length > 1 ? "s" : ""}</span>
                          </div>
                        </article>
                      ))
                    ) : (
                      <p className="casino-history-empty">Aucun joueur n'a encore verrouille de mise sur ce tour.</p>
                    )}
                  </div>
                ),
              },
              {
                id: "historique",
                label: "Historique",
                badge: room?.recentResults?.length || 0,
                caption: "Derniers numeros tombes.",
                content: (
                  <div className="casino-roulette-history-panel">
                    {latestResult ? (
                      <RouletteResultPreview
                        winningNumber={latestResult.winningNumber}
                        winningColor={latestResult.winningColor}
                        previewImageSrc={rouletteVisualAssets.wheelBase}
                      />
                    ) : null}

                    <div className="casino-chip-row">
                      {(room?.recentResults || []).map((entry) => (
                        <span key={entry.id} className={`casino-roulette-history-chip is-${entry.winningColor}`}>
                          {entry.winningNumber}
                        </span>
                      ))}
                    </div>
                  </div>
                ),
              },
            ]}
          />
        ),
      },
    ],
    [
      infoTab,
      joinedSalon.title,
      latestResult,
      remainingMs,
      room?.recentResults,
      room?.round.myBets,
      room?.roomActive,
      room?.round.participants,
      room?.round.visibleBetsByPlayer,
      room?.round.playerCount,
      room?.round.totalPot,
      rouletteRoomMeta?.label,
      rouletteVisualAssets.chip,
      rouletteVisualAssets.wheelBase,
    ],
  );
  const [activeRouletteInfoSectionId, setActiveRouletteInfoSectionId] = useState(rouletteInfoSections[0]?.id ?? "salle");
  const activeRouletteInfoSection =
    rouletteInfoSections.find((section) => section.id === activeRouletteInfoSectionId) ?? rouletteInfoSections[0];
  const ambientRoulettePanel = useMemo(
    () => (
      <RouletteCinematicStage
        sequencePhase={sequencePhase}
        latestResolved={latestResolvedResult || null}
        introVideoRef={introVideoRef}
        reloadVideoRef={reloadVideoRef}
        introVideoSrc={rouletteTirageVideo}
        reloadVideoSrc={rouletteReloadVideo}
        idleImageSrc={rouletteIdleImg}
      />
    ),
    [latestResolvedResult, sequencePhase],
  );

  useEffect(() => {
    setActiveRouletteInfoSectionId((currentId) =>
      rouletteInfoSections.some((section) => section.id === currentId)
        ? currentId
        : (rouletteInfoSections[0]?.id ?? "salle"));
  }, [rouletteInfoSections]);

  useEffect(() => {
    onAmbientPanelChange?.(ambientRoulettePanel);
    return () => {
      onAmbientPanelChange?.(null);
    };
  }, [ambientRoulettePanel, onAmbientPanelChange]);

  function cancelSpinAnimation() {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
  }

  async function playWheelAnimation(winningNumber: number, token: number) {
    cancelSpinAnimation();
    const currentWheel = animationRef.current.wheelRotation;
    const winningIndex = getPocketIndex(winningNumber);
    if (winningIndex === -1) return;

    const targetNormalized = normalizeAngle(-(winningIndex * WHEEL_POCKET_ANGLE));
    const currentNormalized = normalizeAngle(currentWheel);
    const counterClockwiseDelta = normalizeAngle(currentNormalized - targetNormalized);
    const wheelTarget = currentWheel - (7 * 360 + counterClockwiseDelta);
    const ballTravel = 8 * 360 + normalizeAngle(BALL_TARGET_ANGLE - BALL_START_ANGLE);
    const startedAt = performance.now();

    await new Promise<void>((resolve) => {
      const tick = (now: number) => {
        if (!mountedRef.current || token !== sequenceTokenRef.current) {
          cancelSpinAnimation();
          resolve();
          return;
        }

        const progress = Math.min(1, (now - startedAt) / SPIN_DURATION_MS);
        const wheelProgress = easeOutQuart(progress);
        const settleProgress = progress <= 0.65 ? 0 : easeOutCubic((progress - 0.65) / 0.35);
        const wheelRotation = lerp(currentWheel, wheelTarget, wheelProgress);
        const ballAngle = BALL_START_ANGLE + ballTravel * easeOutCubic(progress);
        const ballRadius = lerp(BALL_OUTER_RADIUS, BALL_INNER_RADIUS, settleProgress);
        const bounce = Math.sin(progress * 28) * (1.8 - settleProgress);
        const ball = toBallCoordinates(ballAngle, ballRadius, bounce);

        const nextState: RouletteAnimationState = {
          wheelRotation,
          ballAngle,
          ballRadius,
          ballX: ball.x,
          ballY: ball.y,
          highlightedNumber: progress > 0.88 ? winningNumber : null,
          fireRotation: progress * 900,
          fireScale: 1 + Math.sin(progress * Math.PI * 4) * 0.08,
        };

        animationRef.current = nextState;
        setAnimation(nextState);

        if (progress < 1) {
          animationFrameRef.current = requestAnimationFrame(tick);
          return;
        }

        const settled = buildSettledAnimation(winningNumber);
        animationRef.current = settled;
        setAnimation(settled);
        animationFrameRef.current = null;
        resolve();
      };

      animationFrameRef.current = requestAnimationFrame(tick);
    });
  }

  async function runSpinSequence(
    winningNumber: number,
    context: { roundId: number; resultId: number },
  ) {
    const token = ++sequenceTokenRef.current;
    const introVideo = introVideoRef.current;
    const reloadVideo = reloadVideoRef.current;

    onRouletteEventRef.current?.({
      type: "spin",
      roundId: context.roundId,
      resultId: context.resultId,
      winningNumber,
      canonDelayMs: ROULETTE_TIRAGE_CANNON_DELAY_MS,
    });

    await waitForMs(ROULETTE_ANNOUNCE_LEAD_IN_MS);
    if (!mountedRef.current || token !== sequenceTokenRef.current) return;

    if (introVideo) {
      setSequencePhase("intro");
      await playVideoForward(introVideo, 2200);
      if (!mountedRef.current || token !== sequenceTokenRef.current) return;
    }

    setSequencePhase("spin");
    await playWheelAnimation(winningNumber, token);
    if (!mountedRef.current || token !== sequenceTokenRef.current) return;

    setSequencePhase("hold");
    await waitForMs(HOLD_DURATION_MS);
    if (!mountedRef.current || token !== sequenceTokenRef.current) return;

    if (reloadVideo) {
      setSequencePhase("reload");
      await playVideoReverse(reloadVideo, token, () => mountedRef.current && token === sequenceTokenRef.current);
      if (!mountedRef.current || token !== sequenceTokenRef.current) return;
    }

    const settled = buildSettledAnimation(winningNumber);
    animationRef.current = settled;
    setAnimation(settled);
    setSequencePhase("idle");
  }

  function flushPendingDraw() {
    if (!mountedRef.current) return;
    const nextDraw = pendingDrawRef.current;
    if (!nextDraw) return;
    pendingDrawRef.current = null;
    lastDrawStartedAtRef.current = Date.now();
    void runSpinSequence(nextDraw.winningNumber, {
      roundId: nextDraw.roundId,
      resultId: nextDraw.resultId,
    });
  }

  function scheduleDraw(payload: { winningNumber: number; roundId: number; resultId: number; startAt: number }) {
    pendingDrawRef.current = payload;
    if (drawTimeoutRef.current) {
      window.clearTimeout(drawTimeoutRef.current);
      drawTimeoutRef.current = null;
    }

    const waitMs = Math.max(0, payload.startAt - Date.now());

    if (waitMs === 0) {
      flushPendingDraw();
      return;
    }

    drawTimeoutRef.current = window.setTimeout(() => {
      drawTimeoutRef.current = null;
      flushPendingDraw();
    }, waitMs);
  }

  function triggerCelebration(nextCelebration: RouletteCelebration) {
    setCelebration(nextCelebration);
    if (celebrationTimeoutRef.current) {
      window.clearTimeout(celebrationTimeoutRef.current);
    }
    celebrationTimeoutRef.current = window.setTimeout(() => {
      setCelebration((current) => (current?.resultId === nextCelebration.resultId ? null : current));
      celebrationTimeoutRef.current = null;
    }, ROULETTE_CELEBRATION_FLASH_MS);

    if (nextCelebration.tone === "win") {
      setPrizeRain([]);
      if (prizeRainTimeoutRef.current) {
        window.clearTimeout(prizeRainTimeoutRef.current);
        prizeRainTimeoutRef.current = null;
      }
      return;
    }

    const rain = buildRoulettePrizeRain(nextCelebration.payoutTotal, nextCelebration.tone);
    setPrizeRain(rain);
    if (prizeRainTimeoutRef.current) {
      window.clearTimeout(prizeRainTimeoutRef.current);
    }
    prizeRainTimeoutRef.current = window.setTimeout(() => {
      setPrizeRain([]);
      prizeRainTimeoutRef.current = null;
    }, ROULETTE_BIG_WIN_RAIN_MS);
  }

  useEffect(() => {
    if (!room) return;

    const participantCount = Number(room.round.playerCount || 0);
    if (!announcedRoomEntryRef.current) {
      announcedRoomEntryRef.current = true;
      onRouletteEventRef.current?.({
        type: "enter",
        roundId: room.round.id,
        participants: participantCount,
      });
    } else if (
      previousParticipantCountRef.current !== null
      && participantCount > previousParticipantCountRef.current
    ) {
      onRouletteEventRef.current?.({
        type: "join",
        roundId: room.round.id,
        participants: participantCount,
      });
    }
    previousParticipantCountRef.current = participantCount;

    const resolved = room.latestResolved || room.recentResults?.[0] || null;
    const resolvedId = resolved?.id ?? null;
    if (latestResolvedIdRef.current === null) {
      latestResolvedIdRef.current = resolvedId;
      if (typeof resolved?.winningNumber === "number") {
        const settled = buildSettledAnimation(resolved.winningNumber);
        animationRef.current = settled;
        setAnimation(settled);
      }
      return;
    }

    if (resolvedId && resolvedId !== latestResolvedIdRef.current) {
      latestResolvedIdRef.current = resolvedId;
      const payoutTotal = (room.round.myBets || []).reduce((sum, bet) => sum + Math.max(0, Number(bet.payout || 0)), 0);
      const wageredTotal = (room.round.myBets || []).reduce((sum, bet) => sum + Math.max(0, Number(bet.amount || 0)), 0);
      if (payoutTotal > 0 && typeof resolved?.winningNumber === "number") {
        const tone = getRouletteCelebrationTone(payoutTotal, wageredTotal);
        triggerCelebration({
          resultId: resolvedId,
          winningNumber: resolved.winningNumber,
          winningColor: resolved.winningColor,
          payoutTotal,
          wageredTotal,
          tone,
          label: getRouletteCelebrationLabel(tone),
        });
      }
      if (typeof resolved?.winningNumber === "number") {
        const resolvedAtMs = resolved.resolvedAt ? new Date(resolved.resolvedAt).getTime() : Number.NaN;
        const syncedStartAt = Number.isFinite(resolvedAtMs)
          ? resolvedAtMs + ROULETTE_SYNC_LEAD_MS
          : Date.now() + ROULETTE_FALLBACK_DRAW_INTERVAL_MS;
        scheduleDraw({
          winningNumber: resolved.winningNumber,
          roundId: room.round.id,
          resultId: resolvedId,
          startAt: syncedStartAt,
        });
      }
    }
  }, [room]);

  async function submitPendingBets(mode: "manual" | "auto" = "manual") {
    if (!pendingBets.length || working) return;
    onError("");
    setWorking(true);
    const queue = [...pendingBets];
    let placedCount = 0;
    let lastProfile: CasinoProfile | null = null;
    try {
      for (const [index, bet] of queue.entries()) {
        const result = await placeRouletteBet(bet.betType, bet.betValue, bet.amount);
        placedCount = index + 1;
        lastProfile = result.profile;
        setRoom(result.room);
        setPendingBets(queue.slice(index + 1));
      }

      setSelectedBet(null);
      if (lastProfile) {
        onProfileChange(
          lastProfile,
          mode === "auto"
            ? queue.length === 1
              ? `Mise auto-validee sur ${queue[0].label} avant le tirage.`
              : `${queue.length} mises auto-validees avant le tirage.`
            : queue.length === 1
              ? `Mise placee sur ${queue[0].label}.`
              : `${queue.length} mises placees sur le tapis.`,
        );
      }
    } catch (error_) {
      if (lastProfile) {
        onProfileChange(
          lastProfile,
          mode === "auto"
            ? `${placedCount} mise${placedCount > 1 ? "s" : ""} auto-validee${placedCount > 1 ? "s" : ""}, le reste attend encore.`
            : `${placedCount} mise${placedCount > 1 ? "s" : ""} envoyee${placedCount > 1 ? "s" : ""}, le reste attend encore.`,
        );
      }
      const fallbackMessage = "La mise roulette a echoue.";
      const detail = error_ instanceof Error ? error_.message : fallbackMessage;
      onError(
        placedCount
          ? `${detail} Les mises restantes sont encore sur le tapis.`
          : detail,
      );
    } finally {
      setWorking(false);
    }
  }

  useEffect(() => {
    if (!room?.round.id || !pendingBets.length || working) return;
    if (remainingMs <= 0 || remainingMs > ROULETTE_AUTO_SUBMIT_THRESHOLD_MS) return;

    const pendingSignature = pendingBets
      .map((bet) => `${bet.betType}:${bet.betValue}:${bet.amount}`)
      .join("|");
    const autoSubmitKey = `${room.round.id}::${pendingSignature}`;
    if (lastAutoSubmitKeyRef.current === autoSubmitKey) return;

    lastAutoSubmitKeyRef.current = autoSubmitKey;
    void submitPendingBets("auto");
  }, [pendingBets, remainingMs, room?.round.id, working]);

  function clearPendingBets() {
    if (working) return;
    setSelectedBet(null);
    setPendingBets([]);
  }

  function handleBoardBetChange(nextBet: { betType: string; betValue: string; label: string }) {
    setSelectedBet(nextBet);
    if (working) return;

    if (pendingTotal + amount > profile.wallet.balance) {
      onError("Solde insuffisant pour ajouter cette mise.");
      return;
    }

    onError("");
    setPendingBets((current) => {
      const existingIndex = current.findIndex(
        (entry) => entry.betType === nextBet.betType && entry.betValue === nextBet.betValue,
      );

      if (existingIndex === -1) {
        return [...current, { ...nextBet, amount }];
      }

      const nextPendingBets = [...current];
      nextPendingBets[existingIndex] = {
        ...nextPendingBets[existingIndex],
        amount: nextPendingBets[existingIndex].amount + amount,
      };
      return nextPendingBets;
    });
  }

  return (
    <section className="casino-table-layout casino-table-layout--roulette casino-table-layout--roulette-ats">
      <div className="casino-stage casino-stage--cards casino-stage--roulette-ats">
        <div
          className="casino-roulette-fused-stage"
          style={{
            ["--roulette-chip-art" as string]: `url("${rouletteVisualAssets.chip}")`,
            ["--room-art" as string]: `url("${rouletteBackdropArt}")`,
          }}
        >
          {prizeRain.length ? (
            <div className="casino-roulette-prize-rain" aria-hidden="true">
              {prizeRain.map((item) => (
                <span
                  key={item.id}
                  className={`casino-roulette-prize-rain__item is-${item.kind}`}
                  style={{
                    left: item.left,
                    animationDelay: item.delay,
                    animationDuration: item.duration,
                    ["--rain-drift" as string]: item.drift,
                    ["--rain-scale" as string]: item.scale,
                  }}
                >
                  <img src={item.asset} alt="" />
                </span>
              ))}
            </div>
          ) : null}

          {celebration ? (
            <div className={`casino-roulette-win-overlay is-${celebration.tone}`} aria-live="polite">
              <div className="casino-roulette-win-overlay__burst" aria-hidden="true" />
              <div className={`casino-roulette-win-overlay__card is-${celebration.winningColor}`}>
                <span className="casino-roulette-win-overlay__eyebrow">{celebration.label}</span>
                <strong>+{formatCredits(celebration.payoutTotal)}</strong>
                <p>
                  Numero {celebration.winningNumber}
                  {celebration.wageredTotal > 0 ? ` • mise ${formatCredits(celebration.wageredTotal)}` : ""}
                </p>
              </div>
            </div>
          ) : null}

          <div className="casino-roulette-fused-stage__header">
            <div className="casino-topdeck__chip-row">
              <span className="casino-chip">{rouletteRoomMeta?.chip || "ATS live"}</span>
              <div className="casino-room-hud__utility-stack casino-room-hud__utility-stack--roulette">
                <button
                  type="button"
                  className={`casino-ghost-button casino-topdeck__info-toggle ${showRoomInfo ? "is-open" : ""}`}
                  onClick={() => setShowRoomInfo((value) => !value)}
                  aria-label="Informations roulette"
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
                  className={`casino-roulette-topdeck__timer ${remainingMs <= 0 ? "is-closed" : ""}`}
                  aria-label={remainingMs > 0 ? `Cloture des mises dans ${countdownLabel}` : "Mises fermees"}
                >
                  {countdownLabel}
                </span>
              </div>
            </div>

            {showRoomInfo ? (
              <article className="casino-topdeck__info-panel" aria-label="Informations roulette">
                <div className="casino-topdeck__info-buttons" role="tablist" aria-label="Sections roulette">
                  {rouletteInfoSections.map((section) => (
                    <button
                      key={section.id}
                      type="button"
                      role="tab"
                      className={`casino-topdeck__info-button ${activeRouletteInfoSection?.id === section.id ? "is-active" : ""}`}
                      aria-selected={activeRouletteInfoSection?.id === section.id}
                      onClick={() => setActiveRouletteInfoSectionId(section.id)}
                    >
                      {section.label}
                    </button>
                  ))}
                </div>

                <div className="casino-topdeck__info-body" role="tabpanel">
                  {activeRouletteInfoSection?.content}
                </div>
              </article>
              ) : null}
            </div>

          <div className="casino-roulette-fused-stage__body">
            <div className="casino-roulette-fused-stage__left">
              <div className="casino-roulette-main-board casino-roulette-board casino-roulette-board--compact casino-roulette-board--ats">
                <AtsRouletteBoard
                  feltImageSrc={rouletteVisualAssets.felt}
                  chipImageSrc={rouletteVisualAssets.chip}
                  amount={amount}
                  onAmountChange={setAmount}
                  selectedBet={selectedBet}
                  selectedBetTone={selfPortTone}
                  placedBets={boardPlacedBets}
                  onBetChange={handleBoardBetChange}
                  onClearBets={clearPendingBets}
                  clearDisabled={!hasPendingBets && !selectedBet}
                  portOccupants={portOccupants}
                  onPortClick={(port) => {
                    void port;
                  }}
                  disabled={working}
                />
              </div>

              <div className="casino-bet-pills casino-bet-pills--roulette casino-bet-pills--roulette-embedded">
                {ROULETTE_AMOUNT_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    className={`casino-bet-pill casino-bet-pill--dubloon casino-bet-pill--roulette ${amount === preset ? "is-active" : ""}`}
                    onClick={() => setAmount(preset)}
                    disabled={working}
                  >
                    <img src={rouletteVisualAssets.chip} alt="" aria-hidden="true" />
                    <span className="casino-bet-pill__content">
                      <small>Mise</small>
                      <strong>{preset}</strong>
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className="casino-roulette-fused-stage__right">
              <div
                className="casino-roulette-console"
                style={{
                  ["--roulette-chip-art" as string]: `url("${rouletteVisualAssets.chip}")`,
                }}
              >
                <div className="casino-roulette-console__wheel-shell">
                  <img
                    className="casino-roulette-console__wheel-base"
                    src={rouletteVisualAssets.wheelBase}
                    alt=""
                    aria-hidden="true"
                  />
                  <div
                    className="casino-roulette-console__wheel"
                    style={{ transform: `translate(-50%, -50%) rotate(${animation.wheelRotation}deg)` }}
                  >
                    <img
                      className="casino-roulette-wheel__plateau casino-roulette-wheel__plateau--turntable"
                      src={rouletteVisualAssets.turntable}
                      alt=""
                      aria-hidden="true"
                    />
                    {wheelPockets.map((pocket) => (
                      <div
                        key={`console-${pocket.number}`}
                        className={`casino-roulette-pocket is-${pocket.color} ${animation.highlightedNumber === pocket.number ? "is-winning" : ""}`}
                        style={{ ["--pocket-angle" as string]: `${pocket.angle}deg` }}
                      >
                        <span>{pocket.number}</span>
                      </div>
                    ))}
                  </div>
                  <span className="casino-roulette-console__pointer" aria-hidden="true" />

                  <div
                    className="casino-roulette-orb casino-roulette-orb--console"
                    style={{
                      left: `${animation.ballX}%`,
                      top: `${animation.ballY}%`,
                      transform: `translate(-50%, -50%) scale(${0.94 + (animation.fireScale - 1) * 0.4})`,
                    }}
                  >
                    <span
                      className="casino-roulette-orb__trail"
                      style={{ transform: `translate(-50%, -50%) rotate(${animation.fireRotation}deg)` }}
                    />
                  </div>

                  <div className="casino-roulette-console__chip-stack" aria-hidden="true">
                    <img src={rouletteVisualAssets.chip} alt="" />
                    <img src={rouletteVisualAssets.chip} alt="" />
                  </div>
                </div>

                <div className="casino-roulette-console__summary">
                  <span className="casino-chip">{joinedSalon.eyebrow}</span>
                  <strong>{rouletteSummaryTitle}</strong>
                  <div className="casino-roulette-console__stats">
                    <span>
                      <small>Dernier tir</small>
                      <b className={latestResult ? `is-${latestResult.winningColor}` : ""}>
                        {latestResult ? latestResult.winningNumber : "--"}
                      </b>
                    </span>
                    <span>
                      <small>Joueurs</small>
                      <b>{room?.round.playerCount || 0}</b>
                    </span>
                  </div>
                </div>
              </div>

              <div className="casino-chip-row">
                <span className="casino-chip">
                  {hasPendingBets ? `${pendingBets.length} mise${pendingBets.length > 1 ? "s" : ""} en attente` : "Aucune mise en attente"}
                </span>
                <span className="casino-chip casino-chip--token">
                  <img src={rouletteVisualAssets.chip} alt="" />
                  {formatCredits(pendingTotal)}
                </span>
                <span className="casino-chip">{selectedBet ? selectedBet.label : "Choisis une cible"}</span>
              </div>

              <div className="casino-command-dock__actions casino-command-dock__actions--roulette">
                <button
                  type="button"
                  className="casino-primary-button"
                  onClick={() => void submitPendingBets()}
                  disabled={!hasPendingBets || working}
                >
                  Valider {hasPendingBets ? `${pendingBets.length} mise${pendingBets.length > 1 ? "s" : ""}` : "les mises"}
                </button>
                <button
                  type="button"
                  className="casino-ghost-button"
                  onClick={clearPendingBets}
                  disabled={working || (!hasPendingBets && !selectedBet)}
                >
                  Effacer le tapis
                </button>
              </div>

              <div className="casino-roulette-bet-recap" aria-live="polite">
                <div className="casino-roulette-bet-recap__header">
                  <span className="casino-chip">Mises confirmees</span>
                  <strong>{activeBets.length ? `${activeBets.length} position(s)` : "Aucune mise"}</strong>
                </div>
                <div className="casino-roulette-bet-recap__list">
                  {activeBets.length ? (
                    activeBets.map((bet) => (
                      <article key={`${bet.betType}-${bet.betValue}`} className="casino-roulette-bet-recap__entry">
                        <span>{bet.label}</span>
                        <strong>{formatCredits(bet.amount)}</strong>
                      </article>
                    ))
                  ) : (
                    <p className="casino-history-empty">Ajoute puis valide des mises depuis le tapis.</p>
                  )}
                </div>
                <div className="casino-roulette-bet-recap__footer">
                  <span>Total</span>
                  <strong>{formatCredits(activeTotal)}</strong>
                </div>
              </div>

            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
