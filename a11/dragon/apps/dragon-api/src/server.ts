import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import cors from "cors";
import express, {
  type NextFunction,
  type Request,
  type Response
} from "express";
import type {
  DragonActionExecution,
  DragonDaemonPolicyPatch,
  DragonDaemonStatus,
  DragonLogSnapshot,
  DragonLogTarget,
  DragonSystemSnapshot,
  DragonTimelineEntry,
  DragonTimelineLevel,
  DragonTimelineSnapshot,
  UpstreamProbe
} from "@funeste38/dragon-contracts";

import {
  buildSystemSnapshot,
  executeIntegrationAction,
  getDragonDaemonStatus,
  listIntegrationCatalog,
  loadDragonManifest,
  patchDragonDaemonPolicy,
  readIntegrationLogs,
  resolveDragonManifestPath,
  runDragonDaemonCycle
} from "@funeste38/dragon-upstream";
import { runDragonEphemeralMemoryFlow } from "./compat-memory.js";

const port = Number(process.env.PORT ?? process.env.DRAGON_API_PORT ?? 4600);
const MAX_TIMELINE_ENTRIES = 60;
const DASHBOARD_STREAM_PULSE_MS = 5000;
const LOG_STREAM_PULSE_MS = 2500;
const FLOW_PROXY_TIMEOUT_MS = 60_000;

interface IntegrationPayload {
  generatedAt: string;
  snapshot: DragonSystemSnapshot;
  catalog: Awaited<ReturnType<typeof listIntegrationCatalog>>;
  daemon: DragonDaemonStatus;
}

interface DashboardStreamClient {
  id: string;
  res: Response;
}

interface LogStreamClient {
  id: string;
  res: Response;
  target: DragonLogTarget;
  sourceId?: string;
  timer: NodeJS.Timeout;
}

interface FlowRunRequestBody {
  flow?: unknown;
  payload?: unknown;
  admin?: unknown;
}

interface CompatFlowDispatchResult {
  status: number;
  body: unknown;
  resolvedUrl?: string;
  target?: "dragon" | "qflush" | "a11" | "cerbere";
}

type TimelineEntryInput = Omit<DragonTimelineEntry, "id" | "ts"> & {
  ts?: string;
};

function createSseId(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function writeSse(res: Response, event: string, data: unknown): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function buildSnapshotSignature(snapshot: DragonSystemSnapshot): string {
  const focus = snapshot.upstreams
    .filter((probe) => probe.name === "qflush" || probe.name === "A11" || probe.name === "cerbere")
    .map((probe) => ({
      name: probe.name,
      runtimeState: probe.runtimeState,
      healthState: probe.healthState,
      processId: probe.processId ?? null,
      port: probe.port ?? null
    }));

  return JSON.stringify({
      healthy: snapshot.summary.healthy,
      ready: snapshot.summary.ready,
      degraded: snapshot.summary.degraded,
      dead: snapshot.summary.dead,
      focus
  });
}

function parseLogTarget(value: unknown): DragonLogTarget {
  return value === "a11" || value === "cerbere" ? value : "qflush";
}

function normalizeBaseUrl(value: unknown): string | undefined {
  const normalized = String(value || "").trim().replace(/\/+$/, "");
  return normalized || undefined;
}

function baseUrlFromHealthUrl(healthUrl: unknown): string | undefined {
  const normalized = String(healthUrl || "").trim();
  if (!normalized) {
    return undefined;
  }
  return normalized.replace(/\/health$/, "").replace(/\/+$/, "") || undefined;
}

function extractBearerToken(value: string | undefined): string | undefined {
  const match = String(value || "").match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || undefined;
}

function getCompatInboundTokens(req: Request): string[] {
  return [
    extractBearerToken(req.header("authorization") || undefined),
    req.header("x-qflush-token") || undefined,
    req.header("x-dragon-token") || undefined,
    req.header("x-nez-token") || undefined
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
}

function getCompatExpectedTokens(): string[] {
  return [
    process.env.DRAGON_API_TOKEN,
    process.env.NEZ_ADMIN_TOKEN,
    process.env.QFLUSH_TOKEN,
    process.env.NPZ_ADMIN_TOKEN
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .filter((value, index, values) => values.indexOf(value) === index);
}

function isCompatAuthorized(req: Request): boolean {
  const expectedTokens = getCompatExpectedTokens();
  if (!expectedTokens.length) {
    return true;
  }

  const inboundTokens = getCompatInboundTokens(req);
  return inboundTokens.some((token) => expectedTokens.includes(token));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getCompatOutboundToken(): string {
  return String(
    process.env.NEZ_ADMIN_TOKEN ||
    process.env.DRAGON_API_TOKEN ||
    process.env.QFLUSH_TOKEN ||
    process.env.NPZ_ADMIN_TOKEN ||
    ""
  ).trim();
}

function buildCompatA11Headers(): Record<string, string> {
  const token = getCompatOutboundToken();
  if (!token) {
    return {};
  }

  return {
    Authorization: `Bearer ${token}`,
    "x-nez-admin": token,
    "x-dragon-token": token,
    "x-qflush-token": token
  };
}

async function resolveCompatA11BaseUrl(manifestPath: string): Promise<string | undefined> {
  const explicitBaseUrl =
    normalizeBaseUrl(process.env.A11_API_BASE_URL) ||
    normalizeBaseUrl(baseUrlFromHealthUrl(process.env.A11_API_HEALTH_URL));

  if (explicitBaseUrl) {
    return explicitBaseUrl;
  }

  const snapshot = await buildSystemSnapshot(manifestPath);
  const a11Probe = snapshot.upstreams.find(
    (probe) => String(probe.name || "").trim().toLowerCase() === "a11"
  );
  return normalizeBaseUrl(baseUrlFromHealthUrl(a11Probe?.healthUrl));
}

async function postCompatJson(
  url: string,
  body: unknown
): Promise<{ status: number; body: unknown; resolvedUrl: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FLOW_PROXY_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...buildCompatA11Headers()
      },
      body: JSON.stringify(body ?? {})
    });

    const rawText = await response.text();
    let parsed: unknown = rawText;

    try {
      parsed = rawText ? JSON.parse(rawText) : {};
    } catch {
      parsed = rawText;
    }

    return {
      status: response.status,
      resolvedUrl: url,
      body:
        parsed && typeof parsed === "object"
          ? parsed
          : {
              ok: response.ok,
              raw: parsed
            }
    };
  } catch (error) {
    return {
      status: 502,
      resolvedUrl: url,
      body: {
        ok: false,
        error: "compat_flow_proxy_failed",
        message: error instanceof Error ? error.message : String(error)
      }
    };
  } finally {
    clearTimeout(timeout);
  }
}

function buildCompatChatRequestBody(payload: unknown): Record<string, unknown> {
  const payloadRecord = isRecord(payload) ? payload : {};
  const requestBody = isRecord(payloadRecord.request) ? { ...payloadRecord.request } : {};

  if (Array.isArray(payloadRecord.messages) && payloadRecord.messages.length > 0) {
    requestBody.messages = payloadRecord.messages;
  } else if (!Array.isArray(requestBody.messages) || requestBody.messages.length === 0) {
    const synthesizedMessages: Array<Record<string, unknown>> = [];
    const systemPrompt = String(payloadRecord.systemPrompt || requestBody.systemPrompt || "").trim();
    const userInput = String(
      payloadRecord.prompt ||
      payloadRecord.input ||
      requestBody.prompt ||
      requestBody.input ||
      ""
    ).trim();

    if (systemPrompt) {
      synthesizedMessages.push({
        role: "system",
        content: systemPrompt
      });
    }

    if (userInput) {
      synthesizedMessages.push({
        role: "user",
        content: userInput
      });
    }

    if (synthesizedMessages.length > 0) {
      requestBody.messages = synthesizedMessages;
    }
  }

  if (!requestBody.model && payloadRecord.model) {
    requestBody.model = payloadRecord.model;
  }

  if (!requestBody.prompt && payloadRecord.prompt) {
    requestBody.prompt = payloadRecord.prompt;
  }

  requestBody.a11SkipQflush = true;
  requestBody.dragonCompat = true;

  if (String(requestBody.provider || "").trim().toLowerCase() === "qflush") {
    requestBody.provider = "openai";
  }

  return requestBody;
}

async function runCompatA11ChatFlow(
  payload: unknown,
  manifestPath: string
): Promise<CompatFlowDispatchResult> {
  const a11BaseUrl = await resolveCompatA11BaseUrl(manifestPath);
  if (!a11BaseUrl) {
    return {
      status: 502,
      body: {
        ok: false,
        error: "a11_unavailable",
        message: "Dragon ne trouve pas de base URL A11 pour executer le chat."
      },
      target: "a11"
    };
  }

  return {
    ...(await postCompatJson(
      `${a11BaseUrl}/api/admin/dragon/chat-completions`,
      buildCompatChatRequestBody(payload)
    )),
    target: "a11"
  };
}

async function runCompatA11MemorySummaryFlow(
  payload: unknown,
  manifestPath: string
): Promise<CompatFlowDispatchResult> {
  const a11BaseUrl = await resolveCompatA11BaseUrl(manifestPath);
  if (!a11BaseUrl) {
    return {
      status: 502,
      body: {
        ok: false,
        error: "a11_unavailable",
        message: "Dragon ne trouve pas de base URL A11 pour executer le resume memoire."
      },
      target: "a11"
    };
  }

  return {
    ...(await postCompatJson(
      `${a11BaseUrl}/api/admin/dragon/memory-summary`,
      isRecord(payload) ? payload : {}
    )),
    target: "a11"
  };
}

async function dispatchCompatFlowRun(
  flow: string,
  payload: unknown,
  manifestPath: string,
  ephemeralStorePath: string
): Promise<CompatFlowDispatchResult> {
  switch (String(flow || "").trim()) {
    case "a11.chat.v1":
      return runCompatA11ChatFlow(payload, manifestPath);
    case "a11.memory.summary.v1":
      return runCompatA11MemorySummaryFlow(payload, manifestPath);
    case "a11.memory.ephemeral.v1":
      return {
        ...(await runDragonEphemeralMemoryFlow(ephemeralStorePath, payload)),
        target: "dragon"
      };
    default:
      return {
        status: 404,
        body: {
          ok: false,
          error: "unsupported_flow",
          message: `Flow non supporte par Dragon: ${flow}`
        },
        target: "dragon"
      };
  }
}

function describeProbeRuntime(probe?: UpstreamProbe): string {
  if (!probe) {
    return "inconnu";
  }

  const parts: string[] = [probe.runtimeState];
  if (typeof probe.processId === "number") {
    parts.push(`pid ${probe.processId}`);
  }
  if (typeof probe.port === "number") {
    parts.push(`port ${probe.port}`);
  }
  return parts.join(" • ");
}

function describeDaemonCycle(status: DragonDaemonStatus): string {
  const latestActions = status.recentActions.slice(0, 3);
  if (!latestActions.length) {
    return `Aucune recovery action. Guard ${status.enabled ? "actif" : "pause"}.`;
  }

  return latestActions
    .map((action) => `${action.actionId}: ${action.ok ? "ok" : "ko"}`)
    .join(" | ");
}

function buildSnapshotTimelineEntry(
  previousSnapshot: DragonSystemSnapshot | null,
  nextSnapshot: DragonSystemSnapshot
): TimelineEntryInput {
  if (!previousSnapshot) {
    return {
      kind: "system",
      level: "info",
      title: "Dragon live watcher actif",
      detail: `Etat initial: ${nextSnapshot.summary.healthy}/${nextSnapshot.summary.total} sources healthy.`
    };
  }

  const focusNames = ["qflush", "A11", "cerbere"];
  const changes: string[] = [];

  for (const focusName of focusNames) {
    const before = previousSnapshot.upstreams.find((probe) => probe.name === focusName);
    const after = nextSnapshot.upstreams.find((probe) => probe.name === focusName);

    if (!before || !after) {
      continue;
    }

    if (
      before.healthState !== after.healthState ||
      before.processId !== after.processId ||
      before.port !== after.port
    ) {
      changes.push(`${focusName}: ${describeProbeRuntime(before)} -> ${describeProbeRuntime(after)}`);
    }
  }

  const healthyDiff = nextSnapshot.summary.healthy - previousSnapshot.summary.healthy;
  if (healthyDiff !== 0) {
    changes.push(`Readiness: ${previousSnapshot.summary.healthy} -> ${nextSnapshot.summary.healthy}`);
  }

  const detail =
    changes.join(" | ") ||
    `Etat rafraichi: ${nextSnapshot.summary.healthy}/${nextSnapshot.summary.total} sources healthy.`;

  const level: DragonTimelineLevel =
    changes.some((change) => change.includes("dead") || change.includes("degraded")) || healthyDiff < 0
      ? "warning"
      : "success";

  return {
    kind: "snapshot",
    level,
    title: "Runtime update detecte",
    detail
  };
}

async function readJsonFile<T>(targetPath: string): Promise<T | undefined> {
  try {
    const raw = await readFile(targetPath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

async function writeJsonFile(targetPath: string, data: unknown): Promise<void> {
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, JSON.stringify(data, null, 2), "utf8");
}

async function main(): Promise<void> {
  const manifestPath = await resolveDragonManifestPath();
  const apiRuntimeDir = path.join(path.dirname(manifestPath), ".dragon", "runtime", "api");
  const timelineStatePath = path.join(apiRuntimeDir, "timeline.json");
  const integrationStatePath = path.join(apiRuntimeDir, "integration.json");
  const ephemeralMemoryStatePath = path.join(apiRuntimeDir, "ephemeral-memory.json");
  const app = express();
  const dashboardClients = new Map<string, DashboardStreamClient>();
  const logClients = new Map<string, LogStreamClient>();
  const timelineEntries: DragonTimelineEntry[] = [];
  let cachedIntegrationPayload: IntegrationPayload | null = null;
  let lastSnapshot: DragonSystemSnapshot | null = null;
  let lastSnapshotSignature = "";
  let persistChain = Promise.resolve();

  function schedulePersist(targetPath: string, data: unknown): void {
    persistChain = persistChain
      .catch(() => undefined)
      .then(async () => {
        await writeJsonFile(targetPath, data);
      })
      .catch((error) => {
        console.error(`[dragon-api] persist failed for ${targetPath}`, error);
      });
  }

  try {
    await mkdir(apiRuntimeDir, { recursive: true });
    const persistedTimeline = await readJsonFile<DragonTimelineSnapshot>(timelineStatePath);
    if (persistedTimeline?.entries?.length) {
      timelineEntries.push(...persistedTimeline.entries.slice(0, MAX_TIMELINE_ENTRIES));
    }

    const persistedIntegration = await readJsonFile<IntegrationPayload>(integrationStatePath);
    if (persistedIntegration?.snapshot) {
      cachedIntegrationPayload = persistedIntegration;
      lastSnapshot = persistedIntegration.snapshot;
      lastSnapshotSignature = buildSnapshotSignature(persistedIntegration.snapshot);
    }
  } catch (error) {
    console.error("[dragon-api] failed to load persisted runtime state", error);
  }

  function buildTimelineSnapshot(): DragonTimelineSnapshot {
    return {
      generatedAt: new Date().toISOString(),
      entries: timelineEntries
    };
  }

  function recordTimelineEntry(input: TimelineEntryInput): DragonTimelineEntry {
    const entry: DragonTimelineEntry = {
      id: createSseId(),
      ts: input.ts ?? new Date().toISOString(),
      kind: input.kind,
      level: input.level,
      title: input.title,
      detail: input.detail,
      target: input.target,
      actionId: input.actionId
    };

    timelineEntries.unshift(entry);
    if (timelineEntries.length > MAX_TIMELINE_ENTRIES) {
      timelineEntries.length = MAX_TIMELINE_ENTRIES;
    }

    schedulePersist(timelineStatePath, buildTimelineSnapshot());

    for (const client of dashboardClients.values()) {
      writeSse(client.res, "timeline", entry);
    }

    return entry;
  }

  async function buildIntegrationPayload(): Promise<IntegrationPayload> {
    const [snapshot, catalog, daemon] = await Promise.all([
      buildSystemSnapshot(manifestPath),
      listIntegrationCatalog(manifestPath),
      getDragonDaemonStatus(manifestPath)
    ]);

    return {
      generatedAt: new Date().toISOString(),
      snapshot,
      catalog,
      daemon
    };
  }

  async function publishIntegrationPayload(payload?: IntegrationPayload): Promise<void> {
    const integrationPayload = payload ?? (await buildIntegrationPayload());
    cachedIntegrationPayload = integrationPayload;
    schedulePersist(integrationStatePath, integrationPayload);

    for (const client of dashboardClients.values()) {
      writeSse(client.res, "integration", integrationPayload);
    }
  }

  async function pulseLogs(client: LogStreamClient): Promise<void> {
    try {
      const snapshot: DragonLogSnapshot = await readIntegrationLogs(
        client.target,
        client.sourceId,
        manifestPath
      );
      writeSse(client.res, "log_snapshot", snapshot);
    } catch (error) {
      writeSse(client.res, "log_error", {
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  async function refreshSnapshotTimeline(): Promise<void> {
    const integrationPayload = await buildIntegrationPayload();
    const nextSignature = buildSnapshotSignature(integrationPayload.snapshot);

    if (!lastSnapshot || nextSignature !== lastSnapshotSignature) {
      const timelineEntry = buildSnapshotTimelineEntry(lastSnapshot, integrationPayload.snapshot);
      recordTimelineEntry(timelineEntry);
      lastSnapshot = integrationPayload.snapshot;
      lastSnapshotSignature = nextSignature;
      await publishIntegrationPayload(integrationPayload);
      return;
    }

    cachedIntegrationPayload = integrationPayload;
    schedulePersist(integrationStatePath, integrationPayload);
  }

  app.use(cors());
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({
      service: "dragon-api",
      status: "ok",
      port,
      manifestPath,
      timestamp: new Date().toISOString()
    });
  });

  app.post("/api/admin/run", async (req, res, next) => {
    try {
      if (!isCompatAuthorized(req)) {
        return res.status(403).json({
          ok: false,
          error: "admin_required",
          message: "Dragon compat route requires a valid admin token."
        });
      }

      const body = (req.body || {}) as FlowRunRequestBody;
      const flow = String(body.flow || "").trim();
      if (!flow) {
        return res.status(400).json({
          ok: false,
          error: "missing_flow",
          message: 'Champ "flow" requis.'
        });
      }

      const proxied = await dispatchCompatFlowRun(
        flow,
        body.payload ?? {},
        manifestPath,
        ephemeralMemoryStatePath
      );

      recordTimelineEntry({
        kind: "action",
        level: proxied.status < 400 ? "success" : "warning",
        title: proxied.status < 400 ? "Compat flow execute" : "Compat flow en echec",
        detail: `${flow} -> ${proxied.resolvedUrl || "dragon-native"} • HTTP ${proxied.status}`,
        target: proxied.target || "dragon",
        actionId: flow
      });

      return res.status(proxied.status).json(proxied.body);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/manifest", async (_req, res, next) => {
    try {
      res.json(await loadDragonManifest(manifestPath));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/upstreams", async (_req, res, next) => {
    try {
      res.json(await buildSystemSnapshot(manifestPath));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/targets", async (_req, res, next) => {
    try {
      const manifest = await loadDragonManifest(manifestPath);
      res.json({
        generatedAt: new Date().toISOString(),
        targets: manifest.target_stack
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/integrations", async (_req, res, next) => {
    try {
      const payload = cachedIntegrationPayload ?? (await buildIntegrationPayload());
      cachedIntegrationPayload = payload;
      res.json(payload);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/timeline", (_req, res) => {
    res.json(buildTimelineSnapshot());
  });

  app.get("/api/daemon", async (_req, res, next) => {
    try {
      res.json(await getDragonDaemonStatus(manifestPath));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/daemon/policy", async (req, res, next) => {
    try {
      const patch = req.body as DragonDaemonPolicyPatch;
      const policy = await patchDragonDaemonPolicy(patch, manifestPath);
      const status = await getDragonDaemonStatus(manifestPath);

      recordTimelineEntry({
        kind: "system",
        level: "info",
        title: "Dragon guard mis a jour",
        detail: `Guard ${policy.enabled ? "actif" : "pause"} • poll ${policy.pollIntervalMs} ms`
      });

      await publishIntegrationPayload();
      res.json({ policy, status });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/daemon/cycle", async (_req, res, next) => {
    try {
      const status = await runDragonDaemonCycle("manual", manifestPath);

      recordTimelineEntry({
        kind: "system",
        level: status.recentActions[0]?.ok === false ? "warning" : "success",
        title: "Cycle guard lance",
        detail: describeDaemonCycle(status)
      });

      await refreshSnapshotTimeline();
      await publishIntegrationPayload();
      res.json(status);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/events", async (req, res, next) => {
    try {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders?.();

      const clientId = createSseId();
      dashboardClients.set(clientId, { id: clientId, res });

      writeSse(res, "hello", {
        clientId,
        service: "dragon-api",
        generatedAt: new Date().toISOString()
      });

      const payload = cachedIntegrationPayload ?? (await buildIntegrationPayload());
      cachedIntegrationPayload = payload;
      writeSse(res, "integration", payload);
      writeSse(res, "timeline_snapshot", buildTimelineSnapshot());

      req.on("close", () => {
        dashboardClients.delete(clientId);
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/logs", async (req, res, next) => {
    try {
      const target = parseLogTarget(req.query.target);
      const sourceId =
        typeof req.query.sourceId === "string" && req.query.sourceId.trim().length > 0
          ? req.query.sourceId.trim()
          : undefined;

      res.json(await readIntegrationLogs(target, sourceId, manifestPath));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/logs/stream", async (req, res, next) => {
    try {
      const target = parseLogTarget(req.query.target);
      const sourceId =
        typeof req.query.sourceId === "string" && req.query.sourceId.trim().length > 0
          ? req.query.sourceId.trim()
          : undefined;

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders?.();

      const clientId = createSseId();
      const timer = setInterval(() => {
        const client = logClients.get(clientId);
        if (client) {
          void pulseLogs(client);
        }
      }, LOG_STREAM_PULSE_MS);

      const client: LogStreamClient = {
        id: clientId,
        res,
        target,
        sourceId,
        timer
      };

      logClients.set(clientId, client);

      writeSse(res, "hello", {
        clientId,
        target,
        sourceId,
        generatedAt: new Date().toISOString()
      });
      await pulseLogs(client);

      req.on("close", () => {
        const existing = logClients.get(clientId);
        if (existing) {
          clearInterval(existing.timer);
        }
        logClients.delete(clientId);
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/integrations/actions/:actionId", async (req, res, next) => {
    try {
      const actionId = String(req.params.actionId || "").trim();
      const result = await executeIntegrationAction(actionId, manifestPath);
      res.json(result);

      recordTimelineEntry({
        kind: "action",
        level: result.ok ? "success" : "error",
        title: result.ok ? "Action executee" : "Action en echec",
        detail: `${result.actionId}: ${result.detail}`,
        target: result.target,
        actionId: result.actionId
      });

      for (const client of dashboardClients.values()) {
        writeSse(client.res, "action_result", result);
      }

      await refreshSnapshotTimeline();
    } catch (error) {
      next(error);
    }
  });

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({
      service: "dragon-api",
      status: "error",
      message
    });
  });

  app.listen(port, () => {
    console.log(`[dragon-api] listening on http://127.0.0.1:${port}`);
  });

  recordTimelineEntry({
    kind: "system",
    level: "info",
    title: "dragon-api en ligne",
    detail: `SSE, timeline et logs live disponibles sur le port ${port}.`
  });

  try {
    await refreshSnapshotTimeline();
  } catch (error) {
    recordTimelineEntry({
      kind: "system",
      level: "error",
      title: "Echec du snapshot initial",
      detail: error instanceof Error ? error.message : String(error)
    });
  }

  setInterval(() => {
    void refreshSnapshotTimeline().catch((error) => {
      recordTimelineEntry({
        kind: "system",
        level: "error",
        title: "Echec du watcher live",
        detail: error instanceof Error ? error.message : String(error)
      });
    });
  }, DASHBOARD_STREAM_PULSE_MS);
}

void main();
