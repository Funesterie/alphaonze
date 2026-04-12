export type SyncedTableGame = "blackjack" | "poker" | "roulette";

export type TableChannelSnapshot<TState> = {
  game: SyncedTableGame;
  roomId: string;
  syncedAt: number;
  turnDeadlineAt: number | null;
  state: TState | null;
};

const TABLE_CHANNEL_STORAGE_PREFIX = "funesterie-casino-table-sync";
const TABLE_CHANNEL_BROADCAST_PREFIX = "funesterie-casino-table-sync";
const TABLE_SELECTION_STORAGE_PREFIX = "funesterie-casino-table-selection";
const TABLE_SELECTION_BROADCAST_PREFIX = "funesterie-casino-table-selection";

function getTableChannelStorageKey(game: SyncedTableGame, roomId: string) {
  return `${TABLE_CHANNEL_STORAGE_PREFIX}:${game}:${String(roomId || "").trim()}`;
}

function getTableChannelBroadcastName(game: SyncedTableGame, roomId: string) {
  return `${TABLE_CHANNEL_BROADCAST_PREFIX}:${game}:${String(roomId || "").trim()}`;
}

function getTableSelectionStorageKey(game: SyncedTableGame) {
  return `${TABLE_SELECTION_STORAGE_PREFIX}:${game}`;
}

function getTableSelectionBroadcastName(game: SyncedTableGame) {
  return `${TABLE_SELECTION_BROADCAST_PREFIX}:${game}`;
}

function isTableChannelSnapshot(value: unknown): value is TableChannelSnapshot<unknown> {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Record<string, unknown>;
  return (
    (snapshot.game === "blackjack" || snapshot.game === "poker" || snapshot.game === "roulette")
    && typeof snapshot.roomId === "string"
    && typeof snapshot.syncedAt === "number"
    && ("turnDeadlineAt" in snapshot)
  );
}

export function readTableChannelSnapshot<TState>(game: SyncedTableGame, roomId: string) {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(getTableChannelStorageKey(game, roomId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return isTableChannelSnapshot(parsed) ? (parsed as TableChannelSnapshot<TState>) : null;
  } catch {
    return null;
  }
}

export function writeTableChannelSnapshot<TState>(snapshot: TableChannelSnapshot<TState>) {
  if (typeof window === "undefined") return;

  const storageKey = getTableChannelStorageKey(snapshot.game, snapshot.roomId);
  const broadcastName = getTableChannelBroadcastName(snapshot.game, snapshot.roomId);

  try {
    window.localStorage.setItem(storageKey, JSON.stringify(snapshot));
  } catch {
    // Ignore storage failures to keep multiplayer tables usable in restrictive browsers.
  }

  if (typeof BroadcastChannel === "undefined") {
    return;
  }

  const channel = new BroadcastChannel(broadcastName);
  channel.postMessage(snapshot);
  channel.close();
}

export function subscribeTableChannel<TState>(
  game: SyncedTableGame,
  roomId: string,
  listener: (snapshot: TableChannelSnapshot<TState>) => void,
) {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  const storageKey = getTableChannelStorageKey(game, roomId);
  const broadcastName = getTableChannelBroadcastName(game, roomId);

  function notify(rawValue: string | null) {
    if (!rawValue) return;

    try {
      const parsed = JSON.parse(rawValue);
      if (isTableChannelSnapshot(parsed)) {
        listener(parsed as TableChannelSnapshot<TState>);
      }
    } catch {
      // Ignore malformed payloads from older clients.
    }
  }

  function handleStorage(event: StorageEvent) {
    if (event.key !== storageKey) return;
    notify(event.newValue);
  }

  window.addEventListener("storage", handleStorage);

  const channel =
    typeof BroadcastChannel !== "undefined"
      ? new BroadcastChannel(broadcastName)
      : null;

  if (channel) {
    channel.addEventListener("message", (event) => {
      const parsed = event.data;
      if (isTableChannelSnapshot(parsed)) {
        listener(parsed as TableChannelSnapshot<TState>);
      }
    });
  }

  return () => {
    window.removeEventListener("storage", handleStorage);
    channel?.close();
  };
}

export function readSyncedTableSelection(game: SyncedTableGame) {
  if (typeof window === "undefined") return "";

  try {
    return String(window.localStorage.getItem(getTableSelectionStorageKey(game)) || "").trim();
  } catch {
    return "";
  }
}

export function writeSyncedTableSelection(game: SyncedTableGame, roomId: string) {
  if (typeof window === "undefined") return;

  const normalizedRoomId = String(roomId || "").trim();
  if (!normalizedRoomId) return;

  try {
    window.localStorage.setItem(getTableSelectionStorageKey(game), normalizedRoomId);
  } catch {
    // Ignore storage failures to preserve table switching.
  }

  if (typeof BroadcastChannel === "undefined") {
    return;
  }

  const channel = new BroadcastChannel(getTableSelectionBroadcastName(game));
  channel.postMessage(normalizedRoomId);
  channel.close();
}

export function subscribeSyncedTableSelection(
  game: SyncedTableGame,
  listener: (roomId: string) => void,
) {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  const storageKey = getTableSelectionStorageKey(game);
  const broadcastName = getTableSelectionBroadcastName(game);

  function notify(rawValue: string | null) {
    const normalizedRoomId = String(rawValue || "").trim();
    if (!normalizedRoomId) return;
    listener(normalizedRoomId);
  }

  function handleStorage(event: StorageEvent) {
    if (event.key !== storageKey) return;
    notify(event.newValue);
  }

  window.addEventListener("storage", handleStorage);

  const channel =
    typeof BroadcastChannel !== "undefined"
      ? new BroadcastChannel(broadcastName)
      : null;

  if (channel) {
    channel.addEventListener("message", (event) => {
      notify(typeof event.data === "string" ? event.data : null);
    });
  }

  return () => {
    window.removeEventListener("storage", handleStorage);
    channel?.close();
  };
}
