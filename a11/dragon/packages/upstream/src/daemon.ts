import path from "node:path";

import type {
  DragonActionExecution,
  DragonDaemonActionRecord,
  DragonDaemonCommandOrigin,
  DragonDaemonPolicy,
  DragonDaemonPolicyPatch,
  DragonDaemonServicePolicy,
  DragonDaemonServiceStatus,
  DragonDaemonStatus,
  DragonDesiredState,
  DragonLogTarget,
  DragonRuntimeState,
  DragonSystemSnapshot,
  HealthState,
  UpstreamProbe
} from "@funeste38/dragon-contracts";

import { executeIntegrationAction } from "./actions.js";
import {
  buildSystemSnapshot,
  resolveDragonManifestPath
} from "./snapshot.js";
import {
  ensureDragonRuntimeDir,
  loadJsonFile,
  writeJsonFile
} from "./state.js";

const DAEMON_TARGETS: DragonLogTarget[] = ["qflush", "a11", "cerbere"];
const DEFAULT_POLL_INTERVAL_MS = 15_000;
const MAX_RECENT_ACTIONS = 24;

function createActionRecordId(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function toProbeName(target: DragonLogTarget): string {
  return target === "a11" ? "A11" : target;
}

function findProbe(snapshot: DragonSystemSnapshot, target: DragonLogTarget): UpstreamProbe | undefined {
  return snapshot.upstreams.find((probe) => probe.name === toProbeName(target));
}

function normalizeCooldownMs(value: number | undefined, fallback = 45_000): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(0, Math.round(Number(value)));
}

function defaultServicePolicy(target: DragonLogTarget): DragonDaemonServicePolicy {
  return {
    target,
    desiredState: "running",
    autoRecover: true,
    cooldownMs: normalizeCooldownMs(target === "qflush" ? 60_000 : 45_000)
  };
}

function normalizeDesiredState(value: DragonDesiredState | undefined): DragonDesiredState {
  return value === "stopped" ? "stopped" : "running";
}

function normalizeServicePolicy(
  target: DragonLogTarget,
  policy?: Partial<DragonDaemonServicePolicy>
): DragonDaemonServicePolicy {
  const fallback = defaultServicePolicy(target);
  return {
    target,
    desiredState: normalizeDesiredState(policy?.desiredState),
    autoRecover: typeof policy?.autoRecover === "boolean" ? policy.autoRecover : fallback.autoRecover,
    cooldownMs: normalizeCooldownMs(policy?.cooldownMs, fallback.cooldownMs)
  };
}

function normalizePolicy(policy?: Partial<DragonDaemonPolicy>): DragonDaemonPolicy {
  const existingPolicies = new Map(
    (policy?.services ?? []).map((entry) => [entry.target, entry] as const)
  );

  return {
    generatedAt: policy?.generatedAt ?? new Date().toISOString(),
    enabled: typeof policy?.enabled === "boolean" ? policy.enabled : true,
    pollIntervalMs: normalizeCooldownMs(policy?.pollIntervalMs, DEFAULT_POLL_INTERVAL_MS),
    services: DAEMON_TARGETS.map((target) =>
      normalizeServicePolicy(target, existingPolicies.get(target))
    )
  };
}

function mergePolicies(
  current: DragonDaemonPolicy,
  patch: DragonDaemonPolicyPatch
): DragonDaemonPolicy {
  const patchServices = new Map(
    (patch.services ?? []).map((entry) => [entry.target, entry] as const)
  );

  return normalizePolicy({
    generatedAt: new Date().toISOString(),
    enabled: typeof patch.enabled === "boolean" ? patch.enabled : current.enabled,
    pollIntervalMs:
      typeof patch.pollIntervalMs === "number" ? patch.pollIntervalMs : current.pollIntervalMs,
    services: current.services.map((service) => ({
      ...service,
      ...(patchServices.get(service.target) ?? {})
    }))
  });
}

function buildActionRecord(
  result: DragonActionExecution,
  origin: DragonDaemonCommandOrigin
): DragonDaemonActionRecord {
  const derivedTarget: DragonLogTarget | "dragon" =
    result.target !== "dragon"
      ? result.target
      : result.actionId.startsWith("qflush.")
        ? "qflush"
        : result.actionId.startsWith("a11.")
          ? "a11"
          : result.actionId.startsWith("cerbere.")
            ? "cerbere"
            : "dragon";

  return {
    id: createActionRecordId(),
    ts: result.ranAt,
    origin,
    target: derivedTarget,
    actionId: result.actionId,
    ok: result.ok,
    detail: result.detail
  };
}

function pushRecentActions(
  current: DragonDaemonActionRecord[],
  incoming: DragonDaemonActionRecord[]
): DragonDaemonActionRecord[] {
  return [...incoming.reverse(), ...current].slice(0, MAX_RECENT_ACTIONS);
}

function shouldRecover(
  policy: DragonDaemonServicePolicy,
  probe: UpstreamProbe | undefined
): boolean {
  if (!policy.autoRecover || !probe?.exists) {
    return false;
  }

  return policy.desiredState === "running";
}

function getCooldownUntil(
  previous: DragonDaemonServiceStatus | undefined,
  currentTimeMs: number,
  policy: DragonDaemonServicePolicy,
  actionExecuted: boolean
): string | undefined {
  if (actionExecuted) {
    return new Date(currentTimeMs + policy.cooldownMs).toISOString();
  }

  if (!previous?.cooldownUntil) {
    return undefined;
  }

  const parsed = Date.parse(previous.cooldownUntil);
  if (!Number.isFinite(parsed) || parsed <= currentTimeMs) {
    return undefined;
  }

  return previous.cooldownUntil;
}

function isInCooldown(
  previous: DragonDaemonServiceStatus | undefined,
  currentTimeMs: number
): boolean {
  if (!previous?.cooldownUntil) {
    return false;
  }

  const parsed = Date.parse(previous.cooldownUntil);
  return Number.isFinite(parsed) && parsed > currentTimeMs;
}

function planActionsForTarget(
  target: DragonLogTarget,
  policy: DragonDaemonServicePolicy,
  probe: UpstreamProbe | undefined,
  previous: DragonDaemonServiceStatus | undefined,
  enabled: boolean,
  currentTimeMs: number
): string[] {
  if (!enabled || !probe?.exists) {
    return [];
  }

  if (isInCooldown(previous, currentTimeMs)) {
    return [];
  }

  if (policy.desiredState === "stopped") {
    if (
      probe.healthState === "available" ||
      probe.runtimeState === "ready" ||
      probe.runtimeState === "starting" ||
      probe.runtimeState === "degraded"
    ) {
      return [`${target}.stop`];
    }

    return [];
  }

  if (!shouldRecover(policy, probe)) {
    return [];
  }

  if (target === "qflush") {
    if (probe.runtimeState === "dead") {
      return ["qflush.build", "qflush.start"];
    }

    if (probe.runtimeState === "degraded") {
      return ["qflush.restart"];
    }

    return [];
  }

  if (probe.runtimeState === "dead") {
    return [`${target}.start`];
  }

  if (probe.runtimeState === "degraded") {
    return [`${target}.restart`];
  }

  return [];
}

function computeConsecutiveFailures(
  policy: DragonDaemonServicePolicy,
  probe: UpstreamProbe | undefined,
  previous: DragonDaemonServiceStatus | undefined
): number {
  if (!probe?.exists) {
    return 0;
  }

  const previousValue = previous?.consecutiveFailures ?? 0;

  if (policy.desiredState === "running") {
    if (probe.runtimeState === "ready") {
      return 0;
    }

    if (probe.runtimeState === "starting") {
      return previousValue;
    }

    return previousValue + 1;
  }

  if (probe.runtimeState === "dead" || probe.runtimeState === "unknown") {
    return 0;
  }

  return previousValue + 1;
}

function buildServiceStatus(
  policy: DragonDaemonServicePolicy,
  probe: UpstreamProbe | undefined,
  previous: DragonDaemonServiceStatus | undefined,
  latestAction: DragonDaemonActionRecord | undefined,
  currentTimeMs: number,
  actionExecuted: boolean
): DragonDaemonServiceStatus {
  const runtimeState: DragonRuntimeState = probe?.runtimeState ?? "unknown";
  const healthState: HealthState = probe?.healthState ?? "unknown";
  const detail = probe?.healthDetail ?? "No probe available";

  return {
    target: policy.target,
    desiredState: policy.desiredState,
    autoRecover: policy.autoRecover,
    runtimeState,
    healthState,
    detail,
    processId: probe?.processId,
    port: probe?.port,
    consecutiveFailures: computeConsecutiveFailures(policy, probe, previous),
    cooldownUntil: getCooldownUntil(previous, currentTimeMs, policy, actionExecuted),
    lastObservedAt: probe?.lastCheckedAt ?? new Date(currentTimeMs).toISOString(),
    lastActionAt: latestAction?.ts ?? previous?.lastActionAt,
    lastActionId: latestAction?.actionId ?? previous?.lastActionId,
    lastActionOk: latestAction?.ok ?? previous?.lastActionOk
  };
}

async function getDaemonStatePaths(manifestPath?: string): Promise<{
  runtimeDir: string;
  policyPath: string;
  statusPath: string;
}> {
  const resolvedManifestPath = manifestPath ?? (await resolveDragonManifestPath());
  const runtimeDir = path.join(await ensureDragonRuntimeDir(resolvedManifestPath), "daemon");
  return {
    runtimeDir,
    policyPath: path.join(runtimeDir, "policy.json"),
    statusPath: path.join(runtimeDir, "status.json")
  };
}

export async function loadDragonDaemonPolicy(
  manifestPath?: string
): Promise<DragonDaemonPolicy> {
  const { policyPath } = await getDaemonStatePaths(manifestPath);
  const existing = await loadJsonFile<DragonDaemonPolicy>(policyPath);
  const normalized = normalizePolicy(existing);
  await writeJsonFile(policyPath, normalized);
  return normalized;
}

export async function saveDragonDaemonPolicy(
  policy: DragonDaemonPolicy,
  manifestPath?: string
): Promise<DragonDaemonPolicy> {
  const { policyPath } = await getDaemonStatePaths(manifestPath);
  const normalized = normalizePolicy(policy);
  normalized.generatedAt = new Date().toISOString();
  await writeJsonFile(policyPath, normalized);
  return normalized;
}

export async function patchDragonDaemonPolicy(
  patch: DragonDaemonPolicyPatch,
  manifestPath?: string
): Promise<DragonDaemonPolicy> {
  const current = await loadDragonDaemonPolicy(manifestPath);
  const next = mergePolicies(current, patch);
  return await saveDragonDaemonPolicy(next, manifestPath);
}

export async function loadDragonDaemonStatus(
  manifestPath?: string
): Promise<DragonDaemonStatus | undefined> {
  const { statusPath } = await getDaemonStatePaths(manifestPath);
  return await loadJsonFile<DragonDaemonStatus>(statusPath);
}

export async function saveDragonDaemonStatus(
  status: DragonDaemonStatus,
  manifestPath?: string
): Promise<DragonDaemonStatus> {
  const { statusPath } = await getDaemonStatePaths(manifestPath);
  await writeJsonFile(statusPath, status);
  return status;
}

async function buildDaemonStatusFromSnapshot(
  manifestPath: string,
  snapshot: DragonSystemSnapshot,
  policy: DragonDaemonPolicy,
  previousStatus?: DragonDaemonStatus,
  latestActions: DragonDaemonActionRecord[] = [],
  cycleCount = previousStatus?.cycleCount ?? 0
): Promise<DragonDaemonStatus> {
  const currentTimeMs = Date.now();
  const previousServices = new Map(
    (previousStatus?.services ?? []).map((service) => [service.target, service] as const)
  );
  const latestActionsByTarget = new Map(
    latestActions.map((action) => [
      action.target === "dragon" ? undefined : (action.target as DragonLogTarget),
      action
    ])
  );

  const services = policy.services.map((servicePolicy) => {
    const probe = findProbe(snapshot, servicePolicy.target);
    const previous = previousServices.get(servicePolicy.target);
    const latestAction = latestActionsByTarget.get(servicePolicy.target);

    return buildServiceStatus(
      servicePolicy,
      probe,
      previous,
      latestAction,
      currentTimeMs,
      Boolean(latestAction)
    );
  });

  return {
    generatedAt: new Date().toISOString(),
    manifestPath,
    enabled: policy.enabled,
    pollIntervalMs: policy.pollIntervalMs,
    cycleCount,
    lastCycleAt: new Date().toISOString(),
    summary: snapshot.summary,
    services,
    recentActions: pushRecentActions(previousStatus?.recentActions ?? [], latestActions)
  };
}

export async function getDragonDaemonStatus(
  manifestPath?: string
): Promise<DragonDaemonStatus> {
  const resolvedManifestPath = manifestPath ?? (await resolveDragonManifestPath());
  const policy = await loadDragonDaemonPolicy(resolvedManifestPath);
  const existing = await loadDragonDaemonStatus(resolvedManifestPath);

  if (existing) {
    return {
      ...existing,
      enabled: policy.enabled,
      pollIntervalMs: policy.pollIntervalMs,
      services: policy.services.map((servicePolicy) => {
        const current = existing.services.find((entry) => entry.target === servicePolicy.target);
        return {
          target: servicePolicy.target,
          desiredState: servicePolicy.desiredState,
          autoRecover: servicePolicy.autoRecover,
          runtimeState: current?.runtimeState ?? "unknown",
          healthState: current?.healthState ?? "unknown",
          detail: current?.detail ?? "No daemon cycle yet.",
          processId: current?.processId,
          port: current?.port,
          consecutiveFailures: current?.consecutiveFailures ?? 0,
          cooldownUntil: current?.cooldownUntil,
          lastObservedAt: current?.lastObservedAt ?? existing.generatedAt,
          lastActionAt: current?.lastActionAt,
          lastActionId: current?.lastActionId,
          lastActionOk: current?.lastActionOk
        };
      })
    };
  }

  const snapshot = await buildSystemSnapshot(resolvedManifestPath);
  const status = await buildDaemonStatusFromSnapshot(
    resolvedManifestPath,
    snapshot,
    policy,
    undefined,
    [],
    0
  );
  status.lastCycleAt = undefined;
  await saveDragonDaemonStatus(status, resolvedManifestPath);
  return status;
}

export async function runDragonDaemonCycle(
  origin: DragonDaemonCommandOrigin = "auto",
  manifestPath?: string
): Promise<DragonDaemonStatus> {
  const resolvedManifestPath = manifestPath ?? (await resolveDragonManifestPath());
  const policy = await loadDragonDaemonPolicy(resolvedManifestPath);
  const previousStatus = await loadDragonDaemonStatus(resolvedManifestPath);
  const beforeSnapshot = await buildSystemSnapshot(resolvedManifestPath);
  const actionRecords: DragonDaemonActionRecord[] = [];

  for (const servicePolicy of policy.services) {
    const probe = findProbe(beforeSnapshot, servicePolicy.target);
    const previousService = previousStatus?.services.find(
      (service) => service.target === servicePolicy.target
    );
    const plannedActions = planActionsForTarget(
      servicePolicy.target,
      servicePolicy,
      probe,
      previousService,
      policy.enabled,
      Date.now()
    );

    for (const actionId of plannedActions) {
      const result = await executeIntegrationAction(actionId, resolvedManifestPath);
      actionRecords.push(buildActionRecord(result, origin));
    }
  }

  const afterSnapshot =
    actionRecords.length > 0 ? await buildSystemSnapshot(resolvedManifestPath) : beforeSnapshot;

  const status = await buildDaemonStatusFromSnapshot(
    resolvedManifestPath,
    afterSnapshot,
    policy,
    previousStatus,
    actionRecords,
    (previousStatus?.cycleCount ?? 0) + 1
  );
  await saveDragonDaemonStatus(status, resolvedManifestPath);
  return status;
}
