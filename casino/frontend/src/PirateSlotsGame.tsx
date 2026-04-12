import * as React from "react";
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import alerteSound from "./audio/alerte.mp3";
import BlackjackRoom from "./BlackjackRoom";
import CarteMiniGame from "./CarteMiniGame";
import MiniTreasureGame from "./MiniTreasureGame";
import PokerRoom from "./PokerRoom";
import RouletteRoom from "./RouletteRoom";
import lingotImg from "./images/lingot.png";
import opaleImg from "./images/opale.png";
import rubisImg from "./images/rubis.png";
import saphirImg from "./images/saphir.png";
import {
  BET_PRESETS,
  CASINO_DISTRICT_ARTWORK,
  SPIN_ANIMATION_INTERVAL_MS,
  SPIN_ANIMATION_STEPS,
  ROOM_DEFINITIONS,
  SLOT_AMBIENT_MEDIA,
  SLOT_FEATURE_MEDIA,
  SLOT_INTRO_MEDIA,
  SLOT_VIDEO_INTRO_SESSION_KEY,
  buildPlaceholderGrid,
  chooseSlotFeature,
  getSlotFeatureForBonusGrid,
  formatTransactionLabel,
  formatTransactionTime,
  getBonusNarration,
  getJokerIndexes,
  getSlotDisplaySymbolId,
  getSlotFeatureForBonusFeature,
  getSlotGridSymbolAtIndex,
  getSlotSymbolMeta,
  resolveRoomArtwork,
  waitForMs,
  type RoomId,
  type RouletteSoundEvent,
  type SlotFeatureKey,
} from "./features/casino/catalog";
import CasinoFloorShell from "./features/casino/components/CasinoFloorShell";
import SlotsSideRail from "./features/casino/components/SlotsSideRail";
import { formatCredits } from "./lib/casinoRoomState";
import {
  spinCasinoSlots,
  type CasinoProfile,
  type CasinoSpinBonusStage,
  type CasinoSpin,
  type CasinoTransaction,
} from "./lib/casinoApi";

type PirateSlotsGameProps = {
  activeRoom: RoomId;
  profile: CasinoProfile;
  busy: boolean;
  mediaReady: boolean;
  immersionActive: boolean;
  connectionImmersionPending?: boolean;
  slotsIntroDelayActive?: boolean;
  ambientVideoAudible: boolean;
  ambientVideoRef: MutableRefObject<HTMLVideoElement | null>;
  freshVideo: string;
  onAmbientPanelChange?: (panel: React.ReactNode | null) => void;
  onProfileChange: (profile: CasinoProfile, message?: string) => void;
  onError: (message: string) => void;
  onRequestMediaPlayback?: () => void;
  onRouletteEvent?: (event: RouletteSoundEvent) => void;
  onRoomChange?: (roomId: RoomId) => void;
};

function getRecentTransactions(profile: CasinoProfile): CasinoTransaction[] {
  return profile.recentTransactions.slice(0, 8);
}

function SlotsRoom({
  profile,
  busy,
  mediaReady,
  immersionActive,
  connectionImmersionPending,
  slotsIntroDelayActive,
  ambientVideoRef,
  onProfileChange,
  onError,
  onRequestMediaPlayback,
}: PirateSlotsGameProps) {
  const BIG_WIN_MULTIPLIER = 8;
  const SLOT_CELEBRATION_FLASH_MS = 3_400;
  const SLOT_BIG_RAIN_MS = 4_800;
  const SLOT_EPIC_RAIN_MS = 6_000;

  type SlotCelebrationTone = "win" | "big" | "epic";

  type PendingBonusFlow = {
    holdDurationMs: number;
    stageDurationMs: number;
    stages: CasinoSpinBonusStage[];
    totalStages: number;
  };

  type BonusHeldTurns = Partial<Record<number, number>>;

  type SlotCelebration = {
    id: string;
    amount: number;
    tone: SlotCelebrationTone;
    label: string;
    caption: string;
  };

  type SlotPrizeRainItem = {
    id: string;
    left: string;
    delay: string;
    duration: string;
    drift: string;
    scale: string;
    asset: string;
    kind: "lingot" | "diamond";
  };

  const [bet, setBet] = useState(() => Math.max(profile.wallet.minBet, BET_PRESETS[1]));
  const [displayGrid, setDisplayGrid] = useState<string[][]>(() => buildPlaceholderGrid());
  const [spinState, setSpinState] = useState<"idle" | "spinning" | "bonus">("idle");
  const [lastSpin, setLastSpin] = useState<CasinoSpin | null>(null);
  const [lastMessage, setLastMessage] = useState("Pret a lancer les reels.");
  const [activeFeature, setActiveFeature] = useState<SlotFeatureKey>("idle");
  const [slotIntroPlayed, setSlotIntroPlayed] = useState(() => {
    try {
      return sessionStorage.getItem(SLOT_VIDEO_INTRO_SESSION_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [bonusHeldTurns, setBonusHeldTurns] = useState<BonusHeldTurns>({});
  const [goldRain, setGoldRain] = useState<SlotPrizeRainItem[]>([]);
  const [celebration, setCelebration] = useState<SlotCelebration | null>(null);
  const [pendingBonusFlow, setPendingBonusFlow] = useState<PendingBonusFlow | null>(null);
  const [autoSpinCount, setAutoSpinCount] = useState(0);
  const [autoSpinPreset, setAutoSpinPreset] = useState(10);
  const [featurePlaybackNonce, setFeaturePlaybackNonce] = useState(0);
  const intervalRef = useRef<number | null>(null);
  const goldRainTimeoutRef = useRef<number | null>(null);
  const celebrationTimeoutRef = useRef<number | null>(null);
  const autoSpinTimeoutRef = useRef<number | null>(null);
  const spinRunIdRef = useRef(0);
  const alertAudioRef = useRef<HTMLAudioElement | null>(null);
  const featureVideoRef = ambientVideoRef;
  const ambientResumeTimeRef = useRef(0);
  const ambientResumePendingRef = useRef(false);
  const lastAppliedFeaturePlaybackNonceRef = useRef(-1);
  const jokerFeaturePlayedForBonusRef = useRef(false);
  const powerFeaturePlayedForBonusRef = useRef(false);

  useEffect(() => {
    setBet((current) => {
      if (current < profile.wallet.minBet) return profile.wallet.minBet;
      if (current > profile.wallet.maxBet) return profile.wallet.maxBet;
      return current;
    });
  }, [profile.wallet.maxBet, profile.wallet.minBet]);

  useEffect(() => {
    return () => {
      spinRunIdRef.current += 1;
      if (intervalRef.current) window.clearInterval(intervalRef.current);
      if (goldRainTimeoutRef.current) window.clearTimeout(goldRainTimeoutRef.current);
      if (celebrationTimeoutRef.current) window.clearTimeout(celebrationTimeoutRef.current);
      if (autoSpinTimeoutRef.current) window.clearTimeout(autoSpinTimeoutRef.current);
      alertAudioRef.current?.pause();
    };
  }, []);

  const highlightedIndexes = useMemo(() => {
    if (!lastSpin?.wins?.length) return new Set<number>();
    const flattenedIndexes = lastSpin.wins.reduce<number[]>((accumulator, entry) => {
      accumulator.push(...entry.indexes);
      return accumulator;
    }, []);
    return new Set(flattenedIndexes);
  }, [lastSpin]);
  const highlightedWildIndexes = useMemo(() => {
    const wildIndexes = new Set<number>();
    if (!lastSpin?.wins?.length) return wildIndexes;

    lastSpin.wins.forEach((entry) => {
      if (entry.symbol === "JOKER") return;
      entry.indexes.forEach((index) => {
        if (getSlotGridSymbolAtIndex(lastSpin.grid, lastSpin.reelCount, index) === "JOKER") {
          wildIndexes.add(index);
        }
      });
    });

    return wildIndexes;
  }, [lastSpin]);

  const canSpin = spinState !== "spinning" && !busy && profile.wallet.balance >= bet;

  const netChangeTone = useMemo(() => {
    if (!lastSpin) return "neutral";
    if (lastSpin.netChange > 0) return "positive";
    if (lastSpin.netChange < 0) return "negative";
    return "neutral";
  }, [lastSpin]);

  const reelColumns = useMemo(() => {
    const columnCount = displayGrid[0]?.length || 0;
    return Array.from({ length: columnCount }, (_, columnIndex) =>
      displayGrid.map((row) => row[columnIndex]),
    );
  }, [displayGrid]);
  const autoSpinActive = autoSpinCount > 0;
  const isAlertFeatureActive = activeFeature !== "idle";
  const featureMedia = isAlertFeatureActive
    ? SLOT_FEATURE_MEDIA[activeFeature]
    : slotIntroPlayed
      ? SLOT_AMBIENT_MEDIA
      : SLOT_INTRO_MEDIA;

  useEffect(() => {
    const video = featureVideoRef.current;
    if (!video || !featureMedia.video) return;
    let removeRestoreListener = () => undefined;
    let removeAmbientTimeListener = () => undefined;

    const shouldLoop = !isAlertFeatureActive && slotIntroPlayed;
    video.loop = shouldLoop;

    const currentSrc = video.currentSrc || video.src;
    if (isAlertFeatureActive && slotIntroPlayed) {
      ambientResumePendingRef.current = true;
      if (currentSrc && currentSrc.includes(SLOT_AMBIENT_MEDIA.video)) {
        try {
          ambientResumeTimeRef.current = video.currentTime;
        } catch {
          // ignore seek read failures
        }
      }
    }

    const isAmbientVideo = !isAlertFeatureActive && slotIntroPlayed && featureMedia.video === SLOT_AMBIENT_MEDIA.video;
    if (isAmbientVideo) {
      const syncAmbientTime = () => {
        try {
          ambientResumeTimeRef.current = video.currentTime;
        } catch {
          // ignore seek read failures
        }
      };
      syncAmbientTime();
      video.addEventListener("timeupdate", syncAmbientTime);
      removeAmbientTimeListener = () => {
        video.removeEventListener("timeupdate", syncAmbientTime);
      };
    }

    const shouldReloadAlertVideo =
      isAlertFeatureActive && lastAppliedFeaturePlaybackNonceRef.current !== featurePlaybackNonce;

    if (!currentSrc || !currentSrc.includes(featureMedia.video) || shouldReloadAlertVideo) {
      video.src = featureMedia.video;
      video.poster = featureMedia.image;
      video.load();
      if (isAlertFeatureActive) {
        lastAppliedFeaturePlaybackNonceRef.current = featurePlaybackNonce;
      } else {
        lastAppliedFeaturePlaybackNonceRef.current = -1;
      }

      if (!isAlertFeatureActive && slotIntroPlayed && ambientResumePendingRef.current) {
        const resumeTime = ambientResumeTimeRef.current;
        const restoreAmbientPosition = () => {
          ambientResumePendingRef.current = false;
          try {
            const maxResumeTime = Number.isFinite(video.duration) && video.duration > 0
              ? Math.max(0, video.duration - 0.15)
              : resumeTime;
            video.currentTime = Math.min(resumeTime, maxResumeTime);
          } catch {
            // ignore seek failures
          }
        };

        if (video.readyState >= 1) {
          restoreAmbientPosition();
        } else {
          video.addEventListener("loadedmetadata", restoreAmbientPosition, { once: true });
          removeRestoreListener = () => {
            video.removeEventListener("loadedmetadata", restoreAmbientPosition);
          };
        }
      }
    }

    const handleEnded = () => {
      if (isAlertFeatureActive) {
        setActiveFeature("idle");
        return;
      }
      if (!isAlertFeatureActive && !slotIntroPlayed) {
        markSlotsIntroPlayed();
      }
    };
    video.addEventListener("ended", handleEnded);

    if (connectionImmersionPending || slotsIntroDelayActive || immersionActive) {
      video.pause();
      if (!slotIntroPlayed) {
        try {
          video.currentTime = 0;
        } catch {
          // ignore seek failures
        }
      }
      return () => {
        removeAmbientTimeListener();
        removeRestoreListener();
        video.removeEventListener("ended", handleEnded);
      };
    }

    const shouldUseAudio = mediaReady;
    const volume = isAlertFeatureActive ? 0.5 : slotIntroPlayed ? 0.34 : 0.42;
    video.muted = !shouldUseAudio;
    video.volume = shouldUseAudio ? volume : 0;
    void video.play().catch(() => undefined);
    return () => {
      removeAmbientTimeListener();
      removeRestoreListener();
      video.removeEventListener("ended", handleEnded);
    };
  }, [connectionImmersionPending, featureMedia.image, featureMedia.video, featurePlaybackNonce, immersionActive, isAlertFeatureActive, mediaReady, slotIntroPlayed, slotsIntroDelayActive]);

  useEffect(() => {
    if (!autoSpinActive || spinState !== "idle" || busy) return;
    if (profile.wallet.balance < bet) {
      setAutoSpinCount(0);
      return;
    }

    autoSpinTimeoutRef.current = window.setTimeout(() => {
      setAutoSpinCount((current) => Math.max(0, current - 1));
      void handleSpin();
    }, 680);

    return () => {
      if (autoSpinTimeoutRef.current) {
        window.clearTimeout(autoSpinTimeoutRef.current);
        autoSpinTimeoutRef.current = null;
      }
    };
  }, [autoSpinActive, bet, busy, profile.wallet.balance, spinState]);

  function markSlotsIntroPlayed() {
    setSlotIntroPlayed((current) => {
      if (current) return current;
      try {
        sessionStorage.setItem(SLOT_VIDEO_INTRO_SESSION_KEY, "1");
      } catch {
        // ignore storage failures
      }
      return true;
    });
  }

  function playCue(ref: React.MutableRefObject<HTMLAudioElement | null>, src: string, volume: number) {
    if (!mediaReady) return;
    if (!ref.current) {
      ref.current = new Audio(src);
      ref.current.preload = "auto";
    }
    ref.current.pause();
    try {
      ref.current.currentTime = 0;
    } catch {
      // ignore
    }
    ref.current.volume = volume;
    void ref.current.play().catch(() => undefined);
  }

  function buildBonusHeldTurns(indexes: number[], previous: BonusHeldTurns = {}) {
    const nextHeldTurns: BonusHeldTurns = {};

    Object.entries(previous).forEach(([indexKey, turnsLeft]) => {
      const nextTurnsLeft = Number(turnsLeft || 0) - 1;
      if (nextTurnsLeft > 0) {
        nextHeldTurns[Number(indexKey)] = nextTurnsLeft;
      }
    });

    indexes.forEach((index) => {
      if (!Number.isFinite(index) || index < 0) return;
      if (!(index in previous) || Number(previous[index] || 0) <= 0) {
        nextHeldTurns[index] = 3;
        return;
      }

      nextHeldTurns[index] = Math.max(Number(nextHeldTurns[index] || 0), Number(previous[index] || 0) - 1);
    });

    return nextHeldTurns;
  }

  function triggerGoldRain(spin: CasinoSpin) {
    if (goldRainTimeoutRef.current) {
      window.clearTimeout(goldRainTimeoutRef.current);
      goldRainTimeoutRef.current = null;
    }

    const tone = getSlotCelebrationTone(spin);
    if (tone === "win" || spin.totalPayout <= 0) {
      setGoldRain([]);
      return;
    }

    const nextDrops = buildSlotPrizeRain(spin.totalPayout, spin.bet, tone);
    setGoldRain(nextDrops);
    if (!nextDrops.length) return;

    goldRainTimeoutRef.current = window.setTimeout(() => {
      setGoldRain([]);
      goldRainTimeoutRef.current = null;
    }, tone === "epic" ? SLOT_EPIC_RAIN_MS : SLOT_BIG_RAIN_MS);
  }

  function getSlotCelebrationTone(spin: CasinoSpin): SlotCelebrationTone {
    const payoutRatio = spin.totalPayout / Math.max(1, spin.bet);
    const isEpicWin = Boolean(spin.bonus?.fullJoker) || spin.bonus?.feature === "joker_full";
    if (isEpicWin) return "epic";
    if (payoutRatio >= BIG_WIN_MULTIPLIER || spin.totalPayout >= 1_200 || Boolean(spin.bonus?.triggered)) return "big";
    return "win";
  }

  function getSlotCelebrationLabel(tone: SlotCelebrationTone) {
    if (tone === "epic") return "EEEPIIIC WIIIIIN";
    if (tone === "big") return "BIG WIIIN";
    return "GAIN";
  }

  function getSlotCelebrationCaption(spin: CasinoSpin, tone: SlotCelebrationTone) {
    if (tone === "epic") return "Jackpot full wild";
    if (tone === "big") return "La cale deborde d'or et de diamants";
    if (spin.wins.length > 1) return `${spin.wins.length} lignes payeuses`;
    return "Gain encaisse";
  }

  function buildSlotPrizeRain(totalPayout: number, betAmount: number, tone: SlotCelebrationTone): SlotPrizeRainItem[] {
    const ratio = totalPayout / Math.max(1, betAmount);
    const count =
      tone === "epic"
        ? Math.min(36, Math.max(18, Math.round(ratio * 3.4)))
        : Math.min(22, Math.max(10, Math.round(ratio * 2.4)));

    return Array.from({ length: count }, (_, index) => {
      const useDiamond = tone === "epic" ? index % 2 === 0 : index % 3 === 0;
      const asset = useDiamond
        ? [saphirImg, rubisImg, opaleImg][index % 3] || saphirImg
        : lingotImg;

      return {
        id: `slots-rain-${Date.now()}-${index}`,
        left: `${4 + ((index * 7.8) % 92)}%`,
        delay: `${(index % 8) * 0.1}s`,
        duration: `${2.1 + (index % 5) * 0.2}s`,
        drift: `${-22 + (index % 9) * 6}px`,
        scale: `${0.7 + (index % 4) * 0.16}`,
        asset,
        kind: useDiamond ? "diamond" : "lingot",
      };
    });
  }

  function triggerCelebration(spin: CasinoSpin) {
    if (celebrationTimeoutRef.current) {
      window.clearTimeout(celebrationTimeoutRef.current);
      celebrationTimeoutRef.current = null;
    }

    if (spin.totalPayout <= 0) {
      setCelebration(null);
      return;
    }

    const tone = getSlotCelebrationTone(spin);
    const nextCelebration = {
      id: `${spin.generatedAt}-${spin.totalPayout}-${spin.bet}`,
      amount: spin.totalPayout,
      tone,
      label: getSlotCelebrationLabel(tone),
      caption: getSlotCelebrationCaption(spin, tone),
    };

    setCelebration(nextCelebration);
    celebrationTimeoutRef.current = window.setTimeout(() => {
      setCelebration((current) => (current?.id === nextCelebration.id ? null : current));
      celebrationTimeoutRef.current = null;
    }, tone === "epic" ? SLOT_EPIC_RAIN_MS : SLOT_CELEBRATION_FLASH_MS);
  }

  function activateFeature(nextFeature: SlotFeatureKey, options?: { isBonusFeature?: boolean }) {
    if (nextFeature === "idle") return;
    if (options?.isBonusFeature && nextFeature === "joker-line") {
      if (jokerFeaturePlayedForBonusRef.current) {
        return;
      }
      jokerFeaturePlayedForBonusRef.current = true;
    }
    if (options?.isBonusFeature && nextFeature === "joker-cross") {
      if (powerFeaturePlayedForBonusRef.current) {
        return;
      }
      powerFeaturePlayedForBonusRef.current = true;
    }
    markSlotsIntroPlayed();
    setActiveFeature(nextFeature);
    setFeaturePlaybackNonce((current) => current + 1);
    if (SLOT_FEATURE_MEDIA[nextFeature].video) {
      playCue(alertAudioRef, alerteSound, 0.78);
    }
  }

  function triggerSlotFeedback(spin: CasinoSpin) {
    const nextFeature = chooseSlotFeature(spin);
    activateFeature(nextFeature);
  }

  async function animateResolvedSpin(result: Awaited<ReturnType<typeof spinCasinoSlots>>, runId: number) {
    const bonus = result.spin.bonus;

    if (bonus?.triggered) {
      setDisplayGrid(bonus.openingGrid);
      setBonusHeldTurns(
        getJokerIndexes(bonus.openingGrid).reduce<BonusHeldTurns>((accumulator, index) => {
          accumulator[index] = 3;
          return accumulator;
        }, {}),
      );
      setLastSpin(result.spin);
      activateFeature(chooseSlotFeature(result.spin), { isBonusFeature: true });
      triggerCelebration(result.spin);
      triggerGoldRain(result.spin);
      setPendingBonusFlow({
        holdDurationMs: bonus.holdDurationMs,
        stageDurationMs: bonus.stageDurationMs,
        stages: bonus.stages,
        totalStages: bonus.stages.length,
      });
      if (!bonus.stages.length) {
        jokerFeaturePlayedForBonusRef.current = false;
        powerFeaturePlayedForBonusRef.current = false;
      }
      setAutoSpinCount(0);
      if (autoSpinTimeoutRef.current) {
        window.clearTimeout(autoSpinTimeoutRef.current);
        autoSpinTimeoutRef.current = null;
      }
      const bonusMessage =
        bonus.trigger === "joker_count"
          ? `Bonus joker arme avec ${bonus.initialJokerCount} wilds. Relance la machine pour declencher chaque coup bonus.`
          : "Alignement joker detecte. Relance manuellement pour derouler le bonus.";
      setLastMessage(bonusMessage);
      onProfileChange(result.profile, bonusMessage);
      await waitForMs(Math.min(1800, Math.max(480, bonus.holdDurationMs || 0)));
      if (spinRunIdRef.current !== runId) return;
      setSpinState(bonus.stages.length ? "bonus" : "idle");
      return;
    }

    if (spinRunIdRef.current !== runId) return;

    setDisplayGrid(result.spin.grid);
    setBonusHeldTurns({});
    setLastSpin(result.spin);
    jokerFeaturePlayedForBonusRef.current = false;
    powerFeaturePlayedForBonusRef.current = false;
    triggerSlotFeedback(result.spin);
    triggerCelebration(result.spin);
    triggerGoldRain(result.spin);
    setSpinState("idle");
    setLastMessage(getBonusNarration(result.spin));
    onProfileChange(result.profile);
  }

  async function playPendingBonusStage(runId: number) {
    const bonusFlow = pendingBonusFlow;
    if (!bonusFlow?.stages.length) {
      setPendingBonusFlow(null);
      setSpinState("idle");
      return;
    }

    const [stage, ...restStages] = bonusFlow.stages;
    let step = 0;
    intervalRef.current = window.setInterval(() => {
      step += 1;
      setDisplayGrid(buildPlaceholderGrid(lastSpin?.rowCount || 3, lastSpin?.reelCount || 5));
      if (step >= SPIN_ANIMATION_STEPS && intervalRef.current) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }, SPIN_ANIMATION_INTERVAL_MS);

    await waitForMs(Math.max(SPIN_ANIMATION_INTERVAL_MS * (SPIN_ANIMATION_STEPS + 1), bonusFlow.stageDurationMs || 0));
    if (spinRunIdRef.current !== runId) return;
    if (intervalRef.current) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    setDisplayGrid(stage.grid);
    setBonusHeldTurns((current) =>
      buildBonusHeldTurns(stage.heldIndexes.length ? stage.heldIndexes : getJokerIndexes(stage.grid), current),
    );
    const stageFeature = getSlotFeatureForBonusGrid(stage.grid);
    activateFeature(
      stageFeature !== "idle"
        ? stageFeature
        : getSlotFeatureForBonusFeature(lastSpin?.bonus?.feature),
      { isBonusFeature: true },
    );

    const nextStageNumber = bonusFlow.totalStages - restStages.length;
    setPendingBonusFlow(
      restStages.length
        ? {
            ...bonusFlow,
            stages: restStages,
          }
        : null,
    );
    if (!restStages.length) {
      jokerFeaturePlayedForBonusRef.current = false;
      powerFeaturePlayedForBonusRef.current = false;
    }
    setSpinState(restStages.length ? "bonus" : "idle");
    setLastMessage(
      restStages.length
        ? `Bonus joker ${nextStageNumber}/${bonusFlow.totalStages}. Relance pour la prochaine vollee.`
        : "Bonus joker resolu. Les gains sont verrouilles sur ton coffre.",
    );
  }

  async function handleSpin() {
    if (!canSpin) return;
    onError("");
    spinRunIdRef.current += 1;
    const runId = spinRunIdRef.current;
    setSpinState("spinning");
    setGoldRain([]);
    setCelebration(null);
    setLastMessage(pendingBonusFlow ? "La vollee bonus se prepare..." : "Les tambours roulent...");

    try {
      if (pendingBonusFlow?.stages.length) {
        await playPendingBonusStage(runId);
        return;
      }

      setPendingBonusFlow(null);
      setBonusHeldTurns({});
      const result = await spinCasinoSlots(bet);
      let step = 0;
      intervalRef.current = window.setInterval(() => {
        step += 1;
        setDisplayGrid(buildPlaceholderGrid(result.spin.rowCount, result.spin.reelCount));
        if (step >= SPIN_ANIMATION_STEPS && intervalRef.current) {
          window.clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      }, SPIN_ANIMATION_INTERVAL_MS);

      await waitForMs(SPIN_ANIMATION_INTERVAL_MS * (SPIN_ANIMATION_STEPS + 1));
      if (spinRunIdRef.current !== runId) return;
      if (intervalRef.current) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      await animateResolvedSpin(result, runId);
    } catch (error_) {
      setSpinState("idle");
      setAutoSpinCount(0);
      onError(error_ instanceof Error ? error_.message : "Le spin a echoue.");
    }
  }

  function startAutoSpin(count: number) {
    if (!canSpin || spinState !== "idle" || pendingBonusFlow) return;
    setAutoSpinCount(count);
    setLastMessage(`Auto spin arme: ${count} tours en attente.`);
  }

  function stopAutoSpin() {
    setAutoSpinCount(0);
    if (autoSpinTimeoutRef.current) {
      window.clearTimeout(autoSpinTimeoutRef.current);
      autoSpinTimeoutRef.current = null;
    }
  }

  function renderCell(symbolId: string, cellIndex: number, key: string) {
    const effectiveSymbolId = Number(bonusHeldTurns[cellIndex] || 0) > 0 ? "JOKER" : symbolId;
    const displaySymbolId = getSlotDisplaySymbolId(effectiveSymbolId);
    const meta = getSlotSymbolMeta(effectiveSymbolId);
    const isHighlighted = highlightedIndexes.has(cellIndex);
    const isHeldJoker = Number(bonusHeldTurns[cellIndex] || 0) > 0;
    const isWildHighlight = highlightedWildIndexes.has(cellIndex) && effectiveSymbolId === "JOKER";

    return (
      <div
        key={key}
        className={`casino-reel-cell ${isHighlighted ? "is-highlighted" : ""} ${isHeldJoker ? "is-bonus-held" : ""} ${isWildHighlight ? "is-wild-highlight" : ""}`}
        style={{ ["--cell-accent" as string]: meta.accent }}
      >
        <img className={`casino-reel-cell__art casino-reel-cell__art--${displaySymbolId.toLowerCase()}`} src={meta.image} alt="" aria-hidden="true" />
        {isWildHighlight ? <span className="casino-reel-cell__badge">Wild</span> : null}
        <span className="casino-reel-cell__label">{meta.label}</span>
      </div>
    );
  }

  return (
    <section className="casino-table-layout casino-table-layout--slots">
      <div className="casino-stage">
        <div className="casino-reel-shell casino-room-shell casino-reel-shell--slots is-tight-reels">
          <div className="casino-reel-shell__header">
            <p>{lastMessage}</p>
          </div>

          <div className="casino-slot-grid-stage">
            {goldRain.length ? (
              <div className="casino-gold-rain" aria-hidden="true">
                {goldRain.map((drop) => (
                  <span
                    key={drop.id}
                    className={`casino-gold-rain__bar is-${drop.kind}`}
                    style={{
                      left: drop.left,
                      animationDelay: drop.delay,
                      animationDuration: drop.duration,
                      ["--rain-drift" as string]: drop.drift,
                      ["--rain-scale" as string]: drop.scale,
                    }}
                  >
                    <img src={drop.asset} alt="" />
                  </span>
                ))}
              </div>
            ) : null}

            {celebration ? (
              <div className={`casino-slot-win-overlay is-${celebration.tone}`} aria-live="polite">
                <div className="casino-slot-win-overlay__burst" aria-hidden="true" />
                <div className="casino-slot-win-overlay__card">
                  <span className="casino-slot-win-overlay__eyebrow">{celebration.label}</span>
                  <strong>+{formatCredits(celebration.amount)}</strong>
                  <p>{celebration.caption}</p>
                </div>
              </div>
            ) : null}

            <div className={`casino-reel-grid ${spinState === "spinning" ? "is-spinning" : ""} ${spinState === "bonus" ? "is-bonus" : ""} is-tight`}>
              {reelColumns.map((column, columnIndex) => {
                const strip = spinState === "spinning" ? [...column, ...column, ...column] : column;

                return (
                  <div
                    key={`reel-${columnIndex}`}
                    className={`casino-reel-column ${spinState === "spinning" ? "is-spinning" : ""}`}
                    style={{ ["--reel-order" as string]: `${columnIndex}` }}
                  >
                    <div className="casino-reel-column__viewport">
                      <div className="casino-reel-column__track">
                        {strip.map((symbolId, rowIndex) => {
                          const visibleRowIndex = rowIndex % column.length;
                          const cellIndex = visibleRowIndex * reelColumns.length + columnIndex;
                          return renderCell(symbolId, cellIndex, `${columnIndex}-${rowIndex}-${symbolId}`);
                        })}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="casino-controls">
            <div className="casino-action-row__buttons">
              {autoSpinActive ? (
                <>
                  <button
                    type="button"
                    className="casino-primary-button casino-primary-button--auto-spin"
                    disabled
                  >
                    Auto Spin: {autoSpinCount} restants
                  </button>
                  <button
                    type="button"
                    className="casino-ghost-button"
                    onClick={stopAutoSpin}
                  >
                    Arreter
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="casino-primary-button casino-primary-button--spin"
                    onClick={handleSpin}
                    disabled={!canSpin}
                  >
                    {spinState === "spinning" ? "Reels en cours..." : "Lancer le spin"}
                  </button>
                  <button
                    type="button"
                    className="casino-ghost-button"
                    onClick={() => startAutoSpin(autoSpinPreset)}
                    disabled={!canSpin || spinState !== "idle" || Boolean(pendingBonusFlow)}
                  >
                    Auto Spin x{autoSpinPreset}
                  </button>
                  <select
                    className="casino-auto-spin-select"
                    value={autoSpinPreset}
                    onChange={(e) => setAutoSpinPreset(Number(e.target.value))}
                    disabled={spinState !== "idle" || Boolean(pendingBonusFlow)}
                  >
                    <option value={5}>5 spins</option>
                    <option value={10}>10 spins</option>
                    <option value={25}>25 spins</option>
                    <option value={50}>50 spins</option>
                  </select>
                </>
              )}
            </div>

            <div className="casino-bet-controls">
              <div className="casino-bet-pills">
                {BET_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    className={`casino-bet-pill ${bet === preset ? "is-active" : ""}`}
                    disabled={spinState === "spinning" || Boolean(pendingBonusFlow) || preset < profile.wallet.minBet || preset > profile.wallet.maxBet}
                    onClick={() => setBet(preset)}
                  >
                    {preset}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {profile.wallet.balance < bet ? (
            <div className="casino-low-balance">
              Ton solde est trop bas pour cette mise. Baisse la mise ou recupere ton bonus journalier.
            </div>
          ) : null}
        </div>
      </div>

      <div className="casino-mobile-widget">
        <SlotsSideRail
          profile={profile}
          mediaReady={mediaReady}
          featureMedia={featureMedia}
          slotIntroPlayed={slotIntroPlayed}
          isAlertFeatureActive={isAlertFeatureActive}
          featureVideoRef={featureVideoRef}
          lastSpin={lastSpin}
          recapGrid={spinState === "spinning" ? null : displayGrid}
          onMarkSlotsIntroPlayed={markSlotsIntroPlayed}
          onRequestMediaPlayback={onRequestMediaPlayback}
        />
      </div>
    </section>
  );
}

export default function PirateSlotsGame(props: PirateSlotsGameProps) {
  const [activeRoom, setActiveRoom] = useState<RoomId>(props.activeRoom || "slots");
  const recentTransactions = useMemo(() => getRecentTransactions(props.profile), [props.profile]);
  const currentRoom = useMemo(
    () => ROOM_DEFINITIONS.find((room) => room.id === activeRoom) || ROOM_DEFINITIONS[0],
    [activeRoom],
  );
  const currentRoomArtwork = resolveRoomArtwork(activeRoom);

  useEffect(() => {
    props.onRoomChange?.(activeRoom);
  }, [activeRoom, props.onRoomChange]);

  useEffect(() => {
    if (props.activeRoom && props.activeRoom !== activeRoom) {
      setActiveRoom(props.activeRoom);
    }
  }, [activeRoom, props.activeRoom]);

  useEffect(() => {
    if (activeRoom !== "roulette") {
      props.onAmbientPanelChange?.(null);
    }
  }, [activeRoom, props.onAmbientPanelChange]);

  function renderRoom() {
    switch (activeRoom) {
      case "treasure-map":
        return <CarteMiniGame profile={props.profile} mediaReady={props.mediaReady} onProfileChange={props.onProfileChange} onError={props.onError} />;
      case "treasure-hunt":
        return <MiniTreasureGame profile={props.profile} mediaReady={props.mediaReady} onProfileChange={props.onProfileChange} onError={props.onError} />;
      case "blackjack":
        return <BlackjackRoom playerName={props.profile.user.username} profile={props.profile} mediaReady={props.mediaReady} onProfileChange={props.onProfileChange} onError={props.onError} />;
      case "poker":
        return <PokerRoom playerName={props.profile.user.username} profile={props.profile} mediaReady={props.mediaReady} onProfileChange={props.onProfileChange} onError={props.onError} />;
      case "roulette":
        return <RouletteRoom profile={props.profile} onProfileChange={props.onProfileChange} onError={props.onError} onRouletteEvent={props.onRouletteEvent} onAmbientPanelChange={props.onAmbientPanelChange} />;
      default:
        return <SlotsRoom {...props} />;
    }
  }

  return (
    <CasinoFloorShell
      currentRoom={currentRoom}
      profile={props.profile}
      recentTransactions={recentTransactions}
      districtArtwork={CASINO_DISTRICT_ARTWORK}
      currentRoomArtwork={currentRoomArtwork}
    >
      {renderRoom()}
    </CasinoFloorShell>
  );
}
