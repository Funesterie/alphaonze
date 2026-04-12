import { useEffect, useState } from "react";

export function formatCredits(value: number) {
  return new Intl.NumberFormat("fr-FR").format(Math.round(Number(value || 0)));
}

function readStoredNumber(storageKey: string, fallback: number) {
  try {
    const raw = Number(localStorage.getItem(storageKey));
    return Number.isFinite(raw) ? raw : fallback;
  } catch {
    return fallback;
  }
}

export function usePersistentRoomChips(
  roomId: string,
  playerName: string,
  initialChips: number,
) {
  const storageKey = `funesterie-casino-room:${String(playerName || "guest").trim()}:${roomId}`;
  const [chips, setChips] = useState(() => readStoredNumber(storageKey, initialChips));

  useEffect(() => {
    setChips(readStoredNumber(storageKey, initialChips));
  }, [initialChips, storageKey]);

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, String(Math.round(chips)));
    } catch {
      // Ignore storage failures to keep the games playable in private mode.
    }
  }, [chips, storageKey]);

  return [chips, setChips] as const;
}
