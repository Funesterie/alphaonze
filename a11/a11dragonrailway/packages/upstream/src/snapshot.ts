import { access, open, readFile, stat } from "node:fs/promises";
import path from "node:path";

import type {
  CanonicalSource,
  DragonLogSnapshot,
  DragonLogSource,
  DragonLogTarget,
  DragonManifest,
  DragonRuntimeState,
  DragonSystemSnapshot,
  HealthState,
  UpstreamProbe
} from "@funeste38/dragon-contracts";

import {
  A11_PORT,
  CERBERE_PORT,
  QFLUSH_PORT,
  STARTING_GRACE_MS,
  findDragonRoot,
  findListeningProcessId,
  loadJsonFile,
  parsePortFromUrl,
  pathExists,
  readManagedServiceState,
  sleep
} from "./state.js";

interface RuntimeDetails {
  processId?: number;
  port?: number;
  managedByDragon?: boolean;
  managedState?: Awaited<ReturnType<typeof readManagedServiceState>>;
}

const LOG_SOURCE_DEFINITIONS: Record<
  DragonLogTarget,
  Array<{ id: string; label: string; resolvePath: (sourcePath: string) => string }>
> = {
  qflush: [
    { id: "rome.log", label: "Rome Log", resolvePath: (sourcePath) => path.join(sourcePath, ".qflush", "logs", "rome.log") },
    { id: "qflushd.out", label: "Daemon Out", resolvePath: (sourcePath) => path.join(sourcePath, ".qflush", "logs", "qflushd.out") },
    { id: "qflushd.err", label: "Daemon Err", resolvePath: (sourcePath) => path.join(sourcePath, ".qflush", "logs", "qflushd.err") },
    { id: "bat.log", label: "BAT Log", resolvePath: (sourcePath) => path.join(sourcePath, ".qflush", "logs", "bat.log") },
    { id: "envaptex.log", label: "Envaptex Log", resolvePath: (sourcePath) => path.join(sourcePath, ".qflush", "logs", "envaptex.log") },
    { id: "freeland.log", label: "Freeland Log", resolvePath: (sourcePath) => path.join(sourcePath, ".qflush", "logs", "freeland.log") },
    { id: "nezlephant.log", label: "Nezlephant Log", resolvePath: (sourcePath) => path.join(sourcePath, ".qflush", "logs", "nezlephant.log") },
    { id: "spyder.log", label: "Spyder Log", resolvePath: (sourcePath) => path.join(sourcePath, ".qflush", "logs", "spyder.log") }
  ],
  a11: [
    { id: "stdout.log", label: "A11 Stdout", resolvePath: (sourcePath) => path.join(sourcePath, "logs", "stdout.log") },
    { id: "stderr.log", label: "A11 Stderr", resolvePath: (sourcePath) => path.join(sourcePath, "logs", "stderr.log") },
    { id: "server.log", label: "Server Log", resolvePath: (sourcePath) => path.join(sourcePath, "logs", "server.log") },
    { id: "ollama.log", label: "Ollama Log", resolvePath: (sourcePath) => path.join(sourcePath, "logs", "ollama.log") },
    { id: "vite.log", label: "Vite Log", resolvePath: (sourcePath) => path.join(sourcePath, "logs", "vite.log") },
    { id: "vite.err.log", label: "Vite Err", resolvePath: (sourcePath) => path.join(sourcePath, "logs", "vite.err.log") },
    { id: "vite.out.log", label: "Vite Out", resolvePath: (sourcePath) => path.join(sourcePath, "logs", "vite.out.log") },
    { id: "a11_out.log", label: "Legacy A11 Out", resolvePath: (sourcePath) => path.join(sourcePath, "a11_out.log") },
    { id: "a11_err.log", label: "Legacy A11 Err", resolvePath: (sourcePath) => path.join(sourcePath, "a11_err.log") }
  ],
  cerbere: [
    { id: "cerbere.out.log", label: "Cerbere Out", resolvePath: (sourcePath) => path.join(sourcePath, "logs", "cerbere.out.log") },
    { id: "cerbere.err.log", label: "Cerbere Err", resolvePath: (sourcePath) => path.join(sourcePath, "logs", "cerbere.err.log") },
    {
      id: "cerbere.supervisor.log",
      label: "Cerbere Supervisor",
      resolvePath: (sourcePath) => path.join(sourcePath, "apps", "logs", "supervisor", "cerbere.log")
    }
  ]
};

export async function resolveDragonManifestPath(
  explicitPath = process.env.DRAGON_MANIFEST_PATH
): Promise<string> {
  if (explicitPath) {
    return path.resolve(explicitPath);
  }

  const rootDir = await findDragonRoot();
  return path.join(rootDir, "DRAGON_MANIFEST.json");
}

export async function loadDragonManifest(manifestPath?: string): Promise<DragonManifest> {
  const resolvedPath = manifestPath ?? (await resolveDragonManifestPath());
  const raw = await readFile(resolvedPath, "utf8");
  return JSON.parse(raw) as DragonManifest;
}

async function readPackageName(projectPath: string): Promise<string | undefined> {
  const packagePath = path.join(projectPath, "package.json");
  if (!(await pathExists(packagePath))) {
    return undefined;
  }

  try {
    const raw = await readFile(packagePath, "utf8");
    const parsed = JSON.parse(raw) as { name?: string };
    return parsed.name;
  } catch {
    return undefined;
  }
}

export function deriveNameFromPath(projectPath: string): string {
  const normalized = projectPath.replace(/[\\/]+$/, "");
  return path.basename(normalized);
}

export function findCanonicalSourceByTarget(
  manifest: DragonManifest,
  target: DragonLogTarget
): CanonicalSource | undefined {
  return manifest.canonical_sources.find((source) => deriveNameFromPath(source.path).toLowerCase() === target);
}

export function findBackingSourceByTarget(
  manifest: DragonManifest,
  target: DragonLogTarget
): CanonicalSource | undefined {
  if (target === "cerbere") {
    return findCanonicalSourceByTarget(manifest, "a11");
  }

  return findCanonicalSourceByTarget(manifest, target);
}

export function getCerbereScriptPath(sourcePath: string): string {
  return path.join(sourcePath, "apps", "server", "llm-router.mjs");
}

function getHealthCandidatesForTarget(target: DragonLogTarget): string[] {
  if (target === "qflush") {
    return [
      process.env.QFLUSH_HEALTH_URL,
      process.env.QFLUSH_BASE_URL ? `${process.env.QFLUSH_BASE_URL.replace(/\/$/, "")}/health` : undefined,
      `http://127.0.0.1:${QFLUSH_PORT}/health`,
      "http://127.0.0.1:4500/health"
    ].filter(Boolean) as string[];
  }

  if (target === "a11") {
    return [
      process.env.A11_API_HEALTH_URL,
      process.env.A11_API_BASE_URL ? `${process.env.A11_API_BASE_URL.replace(/\/$/, "")}/health` : undefined,
      `http://127.0.0.1:${A11_PORT}/health`
    ].filter(Boolean) as string[];
  }

  return [
    process.env.CERBERE_HEALTH_URL,
    process.env.CERBERE_BASE_URL ? `${process.env.CERBERE_BASE_URL.replace(/\/$/, "")}/health` : undefined,
    process.env.LLM_ROUTER_URL ? `${process.env.LLM_ROUTER_URL.replace(/\/$/, "")}/health` : undefined,
    `http://127.0.0.1:${CERBERE_PORT}/health`
  ].filter(Boolean) as string[];
}

function getHealthCandidates(source: CanonicalSource): string[] {
  const normalizedPath = source.path.replace(/\//g, "\\").toLowerCase();

  if (normalizedPath.endsWith("\\qflush")) {
    return getHealthCandidatesForTarget("qflush");
  }

  if (normalizedPath.endsWith("\\a11")) {
    return getHealthCandidatesForTarget("a11");
  }

  if (normalizedPath.endsWith("\\a11ba")) {
    return [
      process.env.A11BA_API_HEALTH_URL,
      process.env.A11BA_API_BASE_URL ? `${process.env.A11BA_API_BASE_URL.replace(/\/$/, "")}/health` : undefined,
      `http://127.0.0.1:${A11_PORT}/health`
    ].filter(Boolean) as string[];
  }

  if (normalizedPath.endsWith("\\a11frontend")) {
    return [
      process.env.A11FRONTEND_HEALTH_URL,
      process.env.A11FRONTEND_BASE_URL ? `${process.env.A11FRONTEND_BASE_URL.replace(/\/$/, "")}/health` : undefined
    ].filter(Boolean) as string[];
  }

  if (normalizedPath.endsWith("\\a11-mcp-server")) {
    return [
      process.env.A11_MCP_HEALTH_URL,
      process.env.A11_MCP_BASE_URL ? `${process.env.A11_MCP_BASE_URL.replace(/\/$/, "")}/health` : undefined
    ].filter(Boolean) as string[];
  }

  return [];
}

async function probeHttpHealth(
  healthUrl?: string
): Promise<{ healthState: HealthState; healthDetail: string; resolvedUrl?: string }> {
  if (!healthUrl) {
    return { healthState: "unknown", healthDetail: "No health URL configured" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1_500);

  try {
    const response = await fetch(healthUrl, { signal: controller.signal });
    return {
      healthState: response.ok ? "available" : "unavailable",
      healthDetail: `HTTP ${response.status} ${response.statusText}`,
      resolvedUrl: healthUrl
    };
  } catch (error) {
    return {
      healthState: "unavailable",
      healthDetail: error instanceof Error ? error.message : String(error),
      resolvedUrl: healthUrl
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function probeHealthCandidates(
  healthUrls: string[]
): Promise<{ healthState: HealthState; healthDetail: string; resolvedUrl?: string }> {
  if (!healthUrls.length) {
    return { healthState: "unknown", healthDetail: "No health URL configured" };
  }

  let lastResult: { healthState: HealthState; healthDetail: string; resolvedUrl?: string } | null = null;

  for (const candidate of healthUrls) {
    const result = await probeHttpHealth(candidate);
    if (result.healthState === "available") {
      return result;
    }
    lastResult = result;
  }

  if (!lastResult) {
    return { healthState: "unknown", healthDetail: "No health URL configured" };
  }

  return {
    ...lastResult,
    resolvedUrl: healthUrls[0]
  };
}

async function resolveRuntimeDetails(
  source: CanonicalSource,
  resolvedHealthUrl: string | undefined,
  manifestPath?: string
): Promise<RuntimeDetails> {
  const normalizedPath = source.path.replace(/\//g, "\\").toLowerCase();
  const healthPort = parsePortFromUrl(resolvedHealthUrl);

  if (normalizedPath.endsWith("\\qflush")) {
    const daemonState = await loadJsonFile<{ pid?: number; port?: number }>(
      path.join(source.path, ".qflush", "daemon.json")
    );
    const port = daemonState?.port ?? healthPort ?? QFLUSH_PORT;
    return { processId: daemonState?.pid ?? (await findListeningProcessId(port)), port };
  }

  if (normalizedPath.endsWith("\\a11")) {
    const managedState = await readManagedServiceState("a11", manifestPath);
    const port = managedState?.port ?? healthPort ?? A11_PORT;
    return {
      processId: managedState?.pid ?? (await findListeningProcessId(port)),
      port,
      managedByDragon: Boolean(managedState),
      managedState
    };
  }

  if (normalizedPath.endsWith("\\a11ba") || normalizedPath.endsWith("\\a11frontend")) {
    const port = healthPort ?? A11_PORT;
    return { processId: await findListeningProcessId(port), port };
  }

  return { port: healthPort };
}

async function resolveCerbereRuntimeDetails(
  source: CanonicalSource,
  resolvedHealthUrl: string | undefined,
  manifestPath?: string
): Promise<RuntimeDetails> {
  const managedState = await readManagedServiceState("cerbere", manifestPath);
  const port = managedState?.port ?? parsePortFromUrl(resolvedHealthUrl) ?? CERBERE_PORT;
  return {
    processId: managedState?.pid ?? (await findListeningProcessId(port)),
    port,
    managedByDragon: Boolean(managedState),
    managedState
  };
}

function deriveRuntimeState(healthState: HealthState, runtime: RuntimeDetails, exists: boolean): DragonRuntimeState {
  if (!exists) {
    return "unknown";
  }

  if (healthState === "available") {
    return "ready";
  }

  if (healthState === "unknown") {
    return "unknown";
  }

  if (runtime.managedState?.status === "starting") {
    const updatedAt = Date.parse(runtime.managedState.updatedAt);
    if (Number.isFinite(updatedAt) && Date.now() - updatedAt < STARTING_GRACE_MS) {
      return "starting";
    }
  }

  return typeof runtime.processId === "number" ? "degraded" : "dead";
}

export async function probeCanonicalSource(
  source: CanonicalSource,
  manifestPath?: string
): Promise<UpstreamProbe> {
  const exists = await pathExists(source.path);
  const hasPackageJson = exists && (await pathExists(path.join(source.path, "package.json")));
  const hasGit = exists && (await pathExists(path.join(source.path, ".git")));
  const packageName = exists ? await readPackageName(source.path) : undefined;
  const healthCandidates = getHealthCandidates(source);
  const health = exists
    ? await probeHealthCandidates(healthCandidates)
    : { healthState: "unavailable" as const, healthDetail: "Path not found" };
  const runtime = exists
    ? await resolveRuntimeDetails(source, health.resolvedUrl ?? healthCandidates[0], manifestPath)
    : {};

  return {
    name: deriveNameFromPath(source.path),
    path: source.path,
    role: source.role,
    lifecycle: source.status,
    exists,
    hasPackageJson,
    hasGit,
    packageName,
    healthUrl: health.resolvedUrl ?? healthCandidates[0],
    healthState: health.healthState,
    runtimeState: deriveRuntimeState(health.healthState, runtime, exists),
    healthDetail: health.healthDetail,
    processId: runtime.processId,
    port: runtime.port,
    lastCheckedAt: new Date().toISOString(),
    managedByDragon: runtime.managedByDragon
  };
}

export async function probeCerbereSource(
  manifest: DragonManifest,
  manifestPath?: string
): Promise<UpstreamProbe | undefined> {
  const source = findBackingSourceByTarget(manifest, "cerbere");
  if (!source) {
    return undefined;
  }

  const scriptPath = getCerbereScriptPath(source.path);
  const sourceExists = await pathExists(source.path);
  const exists = sourceExists && (await pathExists(scriptPath));
  const hasPackageJson = sourceExists && (await pathExists(path.join(source.path, "package.json")));
  const hasGit = sourceExists && (await pathExists(path.join(source.path, ".git")));
  const packageName = sourceExists ? await readPackageName(source.path) : undefined;
  const healthCandidates = getHealthCandidatesForTarget("cerbere");
  const health = exists
    ? await probeHealthCandidates(healthCandidates)
    : { healthState: "unavailable" as const, healthDetail: "Cerbere script not found" };
  const runtime = exists
    ? await resolveCerbereRuntimeDetails(source, health.resolvedUrl ?? healthCandidates[0], manifestPath)
    : {};

  return {
    name: "cerbere",
    path: scriptPath,
    role: "llm_router",
    lifecycle: "managed_runtime",
    exists,
    hasPackageJson,
    hasGit,
    packageName,
    healthUrl: health.resolvedUrl ?? healthCandidates[0],
    healthState: health.healthState,
    runtimeState: deriveRuntimeState(health.healthState, runtime, exists),
    healthDetail: health.healthDetail,
    processId: runtime.processId,
    port: runtime.port,
    lastCheckedAt: new Date().toISOString(),
    managedByDragon: runtime.managedByDragon
  };
}

export async function waitForCanonicalSourceHealth(
  source: CanonicalSource,
  targetState: HealthState,
  timeoutMs: number,
  manifestPath?: string,
  intervalMs = 500
): Promise<UpstreamProbe> {
  const startedAt = Date.now();
  let lastProbe = await probeCanonicalSource(source, manifestPath);

  while (Date.now() - startedAt < timeoutMs) {
    if (lastProbe.healthState === targetState) {
      return lastProbe;
    }

    await sleep(intervalMs);
    lastProbe = await probeCanonicalSource(source, manifestPath);
  }

  return lastProbe;
}

export async function buildSystemSnapshot(manifestPath?: string): Promise<DragonSystemSnapshot> {
  const resolvedManifestPath = manifestPath ?? (await resolveDragonManifestPath());
  const manifest = await loadDragonManifest(resolvedManifestPath);
  const upstreams = await Promise.all(
    manifest.canonical_sources.map((source) => probeCanonicalSource(source, resolvedManifestPath))
  );
  const cerbereProbe = await probeCerbereSource(manifest, resolvedManifestPath);
  if (cerbereProbe) {
    upstreams.push(cerbereProbe);
  }

  return {
    manifest,
    upstreams,
    generatedAt: new Date().toISOString(),
    summary: {
      total: upstreams.length,
      existing: upstreams.filter((entry) => entry.exists).length,
      healthy: upstreams.filter((entry) => entry.healthState === "available").length,
      ready: upstreams.filter((entry) => entry.runtimeState === "ready").length,
      degraded: upstreams.filter((entry) => entry.exists && entry.runtimeState === "degraded").length,
      dead: upstreams.filter((entry) => entry.exists && entry.runtimeState === "dead").length
    }
  };
}

async function buildLogSourcesForTarget(manifest: DragonManifest, target: DragonLogTarget): Promise<DragonLogSource[]> {
  const source = findBackingSourceByTarget(manifest, target);
  if (!source) {
    return [];
  }

  return await Promise.all(
    LOG_SOURCE_DEFINITIONS[target].map(async (entry) => {
      const resolvedPath = entry.resolvePath(source.path);
      const exists = await pathExists(resolvedPath);
      if (!exists) {
        return { id: entry.id, target, label: entry.label, path: resolvedPath, exists };
      }

      try {
        const fileStats = await stat(resolvedPath);
        return {
          id: entry.id,
          target,
          label: entry.label,
          path: resolvedPath,
          exists,
          sizeBytes: fileStats.size,
          lastModifiedAt: fileStats.mtime.toISOString()
        };
      } catch {
        return { id: entry.id, target, label: entry.label, path: resolvedPath, exists };
      }
    })
  );
}

function pickLogSource(sources: DragonLogSource[], requestedSourceId?: string): DragonLogSource | undefined {
  if (requestedSourceId) {
    const requested = sources.find((source) => source.id === requestedSourceId && source.exists);
    if (requested) {
      return requested;
    }
  }

  return (
    sources.find((source) => source.exists && (source.sizeBytes ?? 0) > 0) ??
    sources.find((source) => source.exists) ??
    sources[0]
  );
}

async function readLogTail(
  targetPath: string,
  maxBytes = 64 * 1024,
  maxLines = 180
): Promise<{ content: string; truncated: boolean }> {
  const fileStats = await stat(targetPath);
  if (fileStats.size === 0) {
    return { content: "", truncated: false };
  }

  const bytesToRead = Math.min(fileStats.size, maxBytes);
  const fileHandle = await open(targetPath, "r");

  try {
    const buffer = Buffer.alloc(bytesToRead);
    await fileHandle.read(buffer, 0, bytesToRead, Math.max(fileStats.size - bytesToRead, 0));

    let content = buffer.toString("utf8");
    let truncated = fileStats.size > maxBytes;
    if (truncated) {
      const firstLineBreak = content.indexOf("\n");
      if (firstLineBreak >= 0) {
        content = content.slice(firstLineBreak + 1);
      }
    }

    const lines = content.split(/\r?\n/);
    if (lines.length > maxLines) {
      content = lines.slice(-maxLines).join("\n");
      truncated = true;
    }

    return { content: content.trimEnd(), truncated };
  } finally {
    await fileHandle.close();
  }
}

export async function readIntegrationLogs(
  target: DragonLogTarget,
  requestedSourceId?: string,
  manifestPath?: string
): Promise<DragonLogSnapshot> {
  const resolvedManifestPath = manifestPath ?? (await resolveDragonManifestPath());
  const manifest = await loadDragonManifest(resolvedManifestPath);
  const sources = await buildLogSourcesForTarget(manifest, target);
  const selectedSource = pickLogSource(sources, requestedSourceId);

  if (!selectedSource || !selectedSource.exists) {
    return {
      target,
      generatedAt: new Date().toISOString(),
      selectedSourceId: selectedSource?.id,
      sources,
      content: "",
      truncated: false
    };
  }

  const tail = await readLogTail(selectedSource.path);
  return {
    target,
    generatedAt: new Date().toISOString(),
    selectedSourceId: selectedSource.id,
    sources,
    content: tail.content,
    truncated: tail.truncated
  };
}

export function getBaseUrlFromHealthUrl(healthUrl?: string): string | undefined {
  return healthUrl ? healthUrl.replace(/\/health$/, "").replace(/\/$/, "") : undefined;
}

export async function fetchJson(
  url: string,
  init?: RequestInit
): Promise<{ ok: boolean; detail: string; data?: unknown }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers ?? {})
      }
    });
    const text = await response.text();
    let parsed: unknown = text;

    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }

    return {
      ok: response.ok,
      detail: `HTTP ${response.status} ${response.statusText}`,
      data: parsed
    };
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : String(error)
    };
  } finally {
    clearTimeout(timeout);
  }
}
