import type { MutableRefObject } from "react";
import { useEffect, useRef } from "react";
import cardSound from "./carte.mp3";
import checkSound from "./check.mp3";

function startPlayback(audio: HTMLAudioElement, volume: number) {
  audio.volume = volume;
  void audio.play().catch(() => undefined);
}

export function useTableAudio(enabled = true) {
  const cardAudioRef = useRef<HTMLAudioElement | null>(null);
  const checkAudioRef = useRef<HTMLAudioElement | null>(null);
  const timeoutIdsRef = useRef<number[]>([]);
  const activeAudiosRef = useRef<Set<HTMLAudioElement>>(new Set());
  const enabledRef = useRef(enabled);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  useEffect(() => {
    return () => {
      timeoutIdsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
      timeoutIdsRef.current = [];
      activeAudiosRef.current.forEach((audio) => {
        audio.pause();
      });
      activeAudiosRef.current.clear();
      cardAudioRef.current?.pause();
      checkAudioRef.current?.pause();
    };
  }, []);

  function getAudio(ref: MutableRefObject<HTMLAudioElement | null>, src: string) {
    if (!ref.current) {
      ref.current = new Audio(src);
      ref.current.preload = "auto";
    }
    if (ref.current.src !== src) {
      ref.current.src = src;
    }
    return ref.current;
  }

  function playFromSource(ref: MutableRefObject<HTMLAudioElement | null>, src: string, volume: number) {
    const baseAudio = getAudio(ref, src);
    const audio = baseAudio.cloneNode(true) as HTMLAudioElement;
    audio.preload = "auto";
    activeAudiosRef.current.add(audio);

    const release = () => {
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
      activeAudiosRef.current.delete(audio);
    };

    audio.onended = release;
    audio.onerror = release;
    startPlayback(audio, volume);
  }

  function trackTimeout(timeoutId: number) {
    timeoutIdsRef.current.push(timeoutId);
    return timeoutId;
  }

  function clearTrackedTimeout(timeoutId: number) {
    timeoutIdsRef.current = timeoutIdsRef.current.filter((entry) => entry !== timeoutId);
  }

  function clearQueuedAudio() {
    timeoutIdsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
    timeoutIdsRef.current = [];
    activeAudiosRef.current.forEach((audio) => {
      audio.pause();
    });
    activeAudiosRef.current.clear();
  }

  function playCard(volume = 0.72, delayMs = 0) {
    if (!enabledRef.current) return;
    if (delayMs <= 0) {
      playFromSource(cardAudioRef, cardSound, volume);
      return;
    }

    const timeoutId = trackTimeout(window.setTimeout(() => {
      clearTrackedTimeout(timeoutId);
      if (!enabledRef.current) return;
      playFromSource(cardAudioRef, cardSound, volume);
    }, delayMs));
  }

  function playCardBurst(
    count: number,
    options?: {
      startDelayMs?: number;
      stepMs?: number;
      volume?: number;
    },
  ) {
    if (!enabledRef.current) return;
    const burstCount = Math.max(0, Math.floor(count));
    const startDelayMs = options?.startDelayMs ?? 0;
    const stepMs = options?.stepMs ?? 110;
    const volume = options?.volume ?? 0.7;

    for (let index = 0; index < burstCount; index += 1) {
      playCard(volume, startDelayMs + index * stepMs);
    }
  }

  function playCheck(volume = 0.68) {
    if (!enabledRef.current) return;
    playFromSource(checkAudioRef, checkSound, volume);
  }

  return {
    clearQueuedAudio,
    playCard,
    playCardBurst,
    playCheck,
  };
}
