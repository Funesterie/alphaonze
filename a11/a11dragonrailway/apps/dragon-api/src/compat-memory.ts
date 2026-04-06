import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

interface DragonEphemeralMemoryItem {
  namespace: string;
  scope: string;
  key: string;
  value: unknown;
  metadata: unknown;
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
}

interface DragonEphemeralMemoryStore {
  version: 1;
  items: Record<string, DragonEphemeralMemoryItem>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function buildStoreKey(namespace: string, scope: string, key: string): string {
  return [namespace, scope, key].join("\u0000");
}

function normalizeNamespace(payload: Record<string, unknown>): string {
  return String(payload.namespace || "a11").trim() || "a11";
}

function normalizeScope(payload: Record<string, unknown>): string {
  return String(payload.scope || "shared").trim() || "shared";
}

function normalizeKey(payload: Record<string, unknown>): string {
  return String(payload.key || "").trim();
}

function normalizeLimit(value: unknown, fallback = 100): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(1, Math.min(500, Math.round(parsed)));
}

function normalizeTtlSeconds(value: unknown): number | undefined {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }
  return Math.round(parsed);
}

function getTtlRemainingSec(item: DragonEphemeralMemoryItem): number | null {
  if (!item.expiresAt) {
    return null;
  }

  const expiresAtMs = Date.parse(item.expiresAt);
  if (!Number.isFinite(expiresAtMs)) {
    return null;
  }

  return Math.max(0, Math.ceil((expiresAtMs - Date.now()) / 1000));
}

function serializeItem(item: DragonEphemeralMemoryItem): Record<string, unknown> {
  return {
    namespace: item.namespace,
    scope: item.scope,
    key: item.key,
    value: item.value ?? null,
    metadata: item.metadata ?? null,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    expiresAt: item.expiresAt,
    ttlRemainingSec: getTtlRemainingSec(item)
  };
}

async function readStore(storePath: string): Promise<DragonEphemeralMemoryStore> {
  try {
    const raw = await readFile(storePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<DragonEphemeralMemoryStore>;
    if (parsed && parsed.version === 1 && parsed.items && typeof parsed.items === "object") {
      return {
        version: 1,
        items: parsed.items as Record<string, DragonEphemeralMemoryItem>
      };
    }
  } catch {
  }

  return {
    version: 1,
    items: {}
  };
}

async function writeStore(storePath: string, store: DragonEphemeralMemoryStore): Promise<void> {
  await mkdir(path.dirname(storePath), { recursive: true });
  await writeFile(storePath, JSON.stringify(store, null, 2), "utf8");
}

function purgeExpiredItems(store: DragonEphemeralMemoryStore): number {
  let removed = 0;
  const now = Date.now();

  for (const [storeKey, item] of Object.entries(store.items)) {
    if (!item?.expiresAt) {
      continue;
    }

    const expiresAtMs = Date.parse(item.expiresAt);
    if (Number.isFinite(expiresAtMs) && expiresAtMs <= now) {
      delete store.items[storeKey];
      removed += 1;
    }
  }

  return removed;
}

export async function runDragonEphemeralMemoryFlow(
  storePath: string,
  rawPayload: unknown
): Promise<{ status: number; body: Record<string, unknown> }> {
  const payload = isRecord(rawPayload) ? rawPayload : {};
  const op = String(payload.op ?? payload.operation ?? "status").trim().toLowerCase();
  const namespace = normalizeNamespace(payload);
  const scope = normalizeScope(payload);
  const key = normalizeKey(payload);
  const prefix = String(payload.prefix || "").trim();
  const limit = normalizeLimit(payload.limit, 100);
  const ttlSec = normalizeTtlSeconds(payload.ttlSec ?? payload.ttl ?? payload.expiresInSec);
  const store = await readStore(storePath);
  const expiredRemoved = purgeExpiredItems(store);
  const nowIso = new Date().toISOString();

  if (op === "status") {
    if (expiredRemoved > 0) {
      await writeStore(storePath, store);
    }

    const allItems = Object.values(store.items);
    return {
      status: 200,
      body: {
        ok: true,
        source: "dragon",
        backend: "dragon-ephemeral-v1",
        totalItems: allItems.length,
        namespaceCount: new Set(allItems.map((item) => item.namespace)).size,
        scopeCount: new Set(allItems.map((item) => `${item.namespace}:${item.scope}`)).size,
        expiredRemoved
      }
    };
  }

  if ((op === "set" || op === "get" || op === "delete") && !key) {
    return {
      status: 400,
      body: {
        ok: false,
        error: "missing_key",
        message: 'Champ "key" requis.'
      }
    };
  }

  const storeKey = key ? buildStoreKey(namespace, scope, key) : "";

  if (op === "set") {
    const existing = store.items[storeKey];
    const nextItem: DragonEphemeralMemoryItem = {
      namespace,
      scope,
      key,
      value: payload.value ?? null,
      metadata: payload.metadata ?? null,
      createdAt: existing?.createdAt || nowIso,
      updatedAt: nowIso,
      expiresAt: ttlSec ? new Date(Date.now() + ttlSec * 1000).toISOString() : null
    };

    store.items[storeKey] = nextItem;
    await writeStore(storePath, store);
    return {
      status: 200,
      body: {
        ok: true,
        item: serializeItem(nextItem)
      }
    };
  }

  if (op === "get") {
    const item = store.items[storeKey];
    if (!item) {
      if (expiredRemoved > 0) {
        await writeStore(storePath, store);
      }
      return {
        status: 200,
        body: {
          ok: true,
          found: false,
          item: null
        }
      };
    }

    return {
      status: 200,
      body: {
        ok: true,
        found: true,
        item: serializeItem(item)
      }
    };
  }

  if (op === "list") {
    const items = Object.values(store.items)
      .filter((item) => item.namespace === namespace)
      .filter((item) => !payload.scope || item.scope === scope)
      .filter((item) => !prefix || item.key.startsWith(prefix))
      .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))
      .slice(0, limit)
      .map((item) => serializeItem(item));

    if (expiredRemoved > 0) {
      await writeStore(storePath, store);
    }

    return {
      status: 200,
      body: {
        ok: true,
        count: items.length,
        items
      }
    };
  }

  if (op === "delete") {
    const removed = store.items[storeKey] ? 1 : 0;
    if (removed) {
      delete store.items[storeKey];
    }
    if (removed || expiredRemoved > 0) {
      await writeStore(storePath, store);
    }
    return {
      status: 200,
      body: {
        ok: true,
        removed
      }
    };
  }

  if (op === "clear") {
    let removed = 0;
    for (const [entryKey, item] of Object.entries(store.items)) {
      if (item.namespace !== namespace) {
        continue;
      }
      if (payload.scope && item.scope !== scope) {
        continue;
      }
      if (prefix && !item.key.startsWith(prefix)) {
        continue;
      }
      delete store.items[entryKey];
      removed += 1;
    }

    if (removed || expiredRemoved > 0) {
      await writeStore(storePath, store);
    }

    return {
      status: 200,
      body: {
        ok: true,
        removed
      }
    };
  }

  return {
    status: 400,
    body: {
      ok: false,
      error: "unsupported_op",
      message: `Operation non supportee: ${op}`
    }
  };
}
