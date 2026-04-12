import { useEffect, useMemo, useRef, useState } from "react";
import canonAudio from "../../audio/canon.mp3";
import entryAudio from "../../audio/entrée.mp3";
import fantomeAudio from "../../audio/fantome.mp3";
import funesterieAudio from "../../audio/funesterie.mp3";
import moussaillonAudio from "../../audio/moussaillon.mp3";
import sharedAmbientMedia from "../../videos/fresh.mp4";
import type { RoomId, RouletteSoundEvent } from "../casino/catalog";
import {
  ROULETTE_TIRAGE_CANNON_DELAY_MS,
} from "../roulette/model";

function waitForMs(durationMs: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, durationMs);
  });
}

function stopMedia(media: HTMLMediaElement | null) {
  if (!media) return;
  media.pause();
  try {
    media.currentTime = 0;
  } catch {
    // ignore reset errors
  }
}

function pauseMedia(media: HTMLMediaElement | null) {
  if (!media) return;
  media.pause();
}

type UseCasinoMediaOptions = {
  activeCasinoRoom: RoomId;
  profileLoaded: boolean;
};

const CASINO_IMMERSION_AUDIO_SESSION_KEY = "casino.immersion.funesterie.played";
const SLOT_ONE_START_DELAY_MS = 14_000;

export function useCasinoMedia({ activeCasinoRoom, profileLoaded }: UseCasinoMediaOptions) {
  const [showImmersion, setShowImmersion] = useState(false);
  const [immersionLine, setImmersionLine] = useState("Ouverture du pont prive...");
  const [ambientVideoAudible, setAmbientVideoAudible] = useState(false);
  const [mediaReady, setMediaReady] = useState(false);
  const [slotsIntroDelayActive, setSlotsIntroDelayActive] = useState(false);

  const introAudioRef = useRef<HTMLAudioElement | null>(null);
  const cueAudioRef = useRef<HTMLAudioElement | null>(null);
  const cannonAudioRef = useRef<HTMLAudioElement | null>(null);
  const rouletteAmbientAudioRef = useRef<HTMLAudioElement | null>(null);
  const ambientVideoRef = useRef<HTMLVideoElement | null>(null);
  const introHideTimeoutRef = useRef<number | null>(null);
  const slotsIntroDelayTimeoutRef = useRef<number | null>(null);
  const mediaUnlockedRef = useRef(false);
  const rouletteQueueRef = useRef(Promise.resolve());
  const rouletteEntryPlayedRef = useRef(false);
  const immersionAudioPlayedRef = useRef(
    (() => {
      try {
        return sessionStorage.getItem(CASINO_IMMERSION_AUDIO_SESSION_KEY) === "1";
      } catch {
        return false;
      }
    })(),
  );

  const controls = useMemo(() => ({
    showImmersion,
    immersionLine,
    ambientVideoAudible,
    mediaReady,
    slotsIntroDelayActive,
    ambientVideoRef,
  }), [ambientVideoAudible, immersionLine, mediaReady, showImmersion, slotsIntroDelayActive]);

  const shouldPlayHeaderVideo = profileLoaded && activeCasinoRoom !== "slots";

  useEffect(() => {
    return () => {
      clearImmersionTimers();
      stopMedia(introAudioRef.current);
      stopMedia(cueAudioRef.current);
      stopMedia(cannonAudioRef.current);
      stopMedia(rouletteAmbientAudioRef.current);
      stopMedia(ambientVideoRef.current);
    };
  }, []);

  useEffect(() => {
    const unlockOnFirstGesture = () => {
      void requestMediaPlayback();
    };

    window.addEventListener("pointerdown", unlockOnFirstGesture, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlockOnFirstGesture);
    };
  }, []);

  useEffect(() => {
    if (mediaUnlockedRef.current) {
      void syncAmbientVideo(true, shouldPlayHeaderVideo);
    } else {
      const video = ambientVideoRef.current;
      if (!shouldPlayHeaderVideo) {
        stopMedia(video);
      } else if (video) {
        video.muted = true;
        video.volume = 0;
      }
      setAmbientVideoAudible(false);
    }
  }, [activeCasinoRoom, profileLoaded, shouldPlayHeaderVideo]);

  useEffect(() => {
    if (!mediaUnlockedRef.current || !profileLoaded) {
      pauseMedia(rouletteAmbientAudioRef.current);
      return;
    }

    if (activeCasinoRoom !== "roulette") {
      pauseMedia(rouletteAmbientAudioRef.current);
      return;
    }

    const ambient = getAudio(rouletteAmbientAudioRef, sharedAmbientMedia);
    ambient.loop = true;
    ambient.volume = 0.14;
    ambient.muted = false;
    void ambient.play().catch(() => undefined);

    if (!rouletteEntryPlayedRef.current) {
      rouletteEntryPlayedRef.current = true;
      queueRouletteAudio(async () => {
        const previousAmbientVolume = ambient.volume;
        pauseMedia(ambient);
        ambient.volume = 0.02;
        await playAudioClip(cueAudioRef, entryAudio, 0.84, true);
        ambient.volume = previousAmbientVolume;
        void ambient.play().catch(() => undefined);
      });
    }
  }, [activeCasinoRoom, profileLoaded, mediaReady]);

  function getAudio(ref: React.MutableRefObject<HTMLAudioElement | null>, src: string) {
    if (!ref.current) {
      ref.current = new Audio(src);
      ref.current.preload = "auto";
    }
    if (ref.current.src !== src) {
      ref.current.src = src;
    }
    return ref.current;
  }

  function clearImmersionTimers() {
    if (introHideTimeoutRef.current) {
      window.clearTimeout(introHideTimeoutRef.current);
      introHideTimeoutRef.current = null;
    }
    if (slotsIntroDelayTimeoutRef.current) {
      window.clearTimeout(slotsIntroDelayTimeoutRef.current);
      slotsIntroDelayTimeoutRef.current = null;
    }
  }

  function scheduleSlotsIntroDelay() {
    if (!mediaUnlockedRef.current) {
      setSlotsIntroDelayActive(false);
      return;
    }

    if (slotsIntroDelayTimeoutRef.current) {
      window.clearTimeout(slotsIntroDelayTimeoutRef.current);
      slotsIntroDelayTimeoutRef.current = null;
    }

    setSlotsIntroDelayActive(true);
    slotsIntroDelayTimeoutRef.current = window.setTimeout(() => {
      setSlotsIntroDelayActive(false);
      slotsIntroDelayTimeoutRef.current = null;
    }, SLOT_ONE_START_DELAY_MS);
  }

  async function playAudioClip(
    ref: React.MutableRefObject<HTMLAudioElement | null>,
    src: string,
    volume: number,
    waitUntilEnd = false,
  ) {
    if (!mediaUnlockedRef.current) return false;
    const audio = getAudio(ref, src);
    audio.pause();
    try {
      audio.currentTime = 0;
    } catch {
      // ignore reset errors
    }
    audio.volume = volume;
    audio.muted = false;

    try {
      await audio.play();
    } catch {
      return false;
    }

    if (!waitUntilEnd) return true;

    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        audio.removeEventListener("ended", finish);
        audio.removeEventListener("error", finish);
        resolve();
      };

      audio.addEventListener("ended", finish, { once: true });
      audio.addEventListener("error", finish, { once: true });
      window.setTimeout(finish, Math.max(1800, Math.ceil((audio.duration || 0) * 1000) + 300));
    });

    return true;
  }

  async function syncAmbientVideo(withSound: boolean, shouldPlay = true) {
    const video = ambientVideoRef.current;
    if (!video) return;

    if (!shouldPlay) {
      stopMedia(video);
      setAmbientVideoAudible(false);
      return;
    }

    video.volume = withSound ? 0.14 : 0;
    video.muted = !withSound;

    try {
      await video.play();
      setAmbientVideoAudible(withSound);
    } catch {
      setAmbientVideoAudible(false);
    }
  }

  async function requestMediaPlayback() {
    if (mediaUnlockedRef.current) {
      setMediaReady(true);
      await syncAmbientVideo(true, shouldPlayHeaderVideo);
      return;
    }

    const intro = getAudio(introAudioRef, funesterieAudio);
    intro.volume = 0.01;
    intro.muted = false;
    try {
      await intro.play();
      intro.pause();
      intro.currentTime = 0;
      mediaUnlockedRef.current = true;
      setMediaReady(true);
    } catch {
      mediaUnlockedRef.current = false;
      setMediaReady(false);
    }

    await syncAmbientVideo(mediaUnlockedRef.current, shouldPlayHeaderVideo);

    if (mediaUnlockedRef.current && profileLoaded && activeCasinoRoom === "roulette") {
      const ambient = getAudio(rouletteAmbientAudioRef, sharedAmbientMedia);
      ambient.loop = true;
      ambient.volume = 0.14;
      ambient.muted = false;
      void ambient.play().catch(() => undefined);
    }
  }

  async function startConnectionImmersion(playerName: string) {
    clearImmersionTimers();
    setSlotsIntroDelayActive(false);
    setImmersionLine(`Pont prive en preparation pour ${playerName || "le capitaine"}...`);
    setShowImmersion(true);
    await syncAmbientVideo(mediaUnlockedRef.current, shouldPlayHeaderVideo);
    if (mediaUnlockedRef.current && !immersionAudioPlayedRef.current) {
      const didPlay = await playAudioClip(introAudioRef, funesterieAudio, 0.56);
      if (didPlay) {
        scheduleSlotsIntroDelay();
        immersionAudioPlayedRef.current = true;
        try {
          sessionStorage.setItem(CASINO_IMMERSION_AUDIO_SESSION_KEY, "1");
        } catch {
          // ignore storage failures
        }
      }
    }

    introHideTimeoutRef.current = window.setTimeout(() => {
      setShowImmersion(false);
      introHideTimeoutRef.current = null;
    }, 5200);
  }

  function queueRouletteAudio(task: () => Promise<void>) {
    rouletteQueueRef.current = rouletteQueueRef.current.then(task).catch(() => undefined);
  }

  function handleRouletteEvent(event: RouletteSoundEvent) {
    if (!mediaUnlockedRef.current) return;
    if (event.type !== "spin") {
      return;
    }

    queueRouletteAudio(async () => {
      const introVoice = Math.random() > 0.5 ? fantomeAudio : moussaillonAudio;
      const cannonDelayMs = event.canonDelayMs || ROULETTE_TIRAGE_CANNON_DELAY_MS;
      const ambient = rouletteAmbientAudioRef.current;
      const previousAmbientVolume = ambient?.volume ?? 0.14;
      const shouldResumeAmbient = Boolean(ambient && activeCasinoRoom === "roulette");

      stopMedia(cueAudioRef.current);
      stopMedia(cannonAudioRef.current);
      if (ambient) {
        pauseMedia(ambient);
        ambient.volume = 0.02;
      }

      await playAudioClip(cueAudioRef, introVoice, 0.92, true);
      await waitForMs(cannonDelayMs);
      await playAudioClip(cannonAudioRef, canonAudio, 1, false);

      if (ambient && shouldResumeAmbient) {
        ambient.volume = previousAmbientVolume;
        void ambient.play().catch(() => undefined);
      }
    });
  }

  function resetMediaSession() {
    clearImmersionTimers();
    setShowImmersion(false);
    setAmbientVideoAudible(false);
    setMediaReady(false);
    setSlotsIntroDelayActive(false);
    mediaUnlockedRef.current = false;
    stopMedia(introAudioRef.current);
    stopMedia(cueAudioRef.current);
    stopMedia(cannonAudioRef.current);
    stopMedia(rouletteAmbientAudioRef.current);
    stopMedia(ambientVideoRef.current);
    rouletteEntryPlayedRef.current = false;
    immersionAudioPlayedRef.current = false;
    try {
      sessionStorage.removeItem(CASINO_IMMERSION_AUDIO_SESSION_KEY);
    } catch {
      // ignore storage failures
    }
  }

  return {
    ...controls,
    requestMediaPlayback,
    startConnectionImmersion,
    handleRouletteEvent,
    resetMediaSession,
  };
}
