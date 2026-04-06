export type CanonicalSourceLifecycle =
  | "primary"
  | "reference"
  | "preferred_extraction"
  | "keep"
  | string;

export interface CanonicalSource {
  path: string;
  role: string;
  status: CanonicalSourceLifecycle;
}

export interface DragonManifest {
  generated_at: string;
  workspace: string;
  scope: string;
  canonical_sources: CanonicalSource[];
  snapshots_or_mirrors: string[];
  deployment_wrappers: string[];
  target_stack: Record<string, string>;
}

export type HealthState = "available" | "unavailable" | "unknown";
export type DragonRuntimeState = "ready" | "starting" | "degraded" | "dead" | "unknown";

export interface UpstreamProbe {
  name: string;
  path: string;
  role: string;
  lifecycle: string;
  exists: boolean;
  hasPackageJson: boolean;
  hasGit: boolean;
  packageName?: string;
  healthUrl?: string;
  healthState: HealthState;
  runtimeState: DragonRuntimeState;
  healthDetail: string;
  processId?: number;
  port?: number;
  lastCheckedAt: string;
  managedByDragon?: boolean;
}

export interface DragonSystemSummary {
  total: number;
  existing: number;
  healthy: number;
  ready: number;
  degraded: number;
  dead: number;
}

export interface DragonSystemSnapshot {
  manifest: DragonManifest;
  upstreams: UpstreamProbe[];
  generatedAt: string;
  summary: DragonSystemSummary;
}

export type DragonLogTarget = "qflush" | "a11" | "cerbere";
export type DragonIntegrationTarget = "dragon" | DragonLogTarget;

export type DragonIntegrationActionKind = "command" | "http" | "workflow";
export type DragonTimelineKind = "system" | "snapshot" | "action";
export type DragonTimelineLevel = "info" | "success" | "warning" | "error";

export interface DragonLogSource {
  id: string;
  target: DragonLogTarget;
  label: string;
  path: string;
  exists: boolean;
  sizeBytes?: number;
  lastModifiedAt?: string;
}

export interface DragonLogSnapshot {
  target: DragonLogTarget;
  generatedAt: string;
  selectedSourceId?: string;
  sources: DragonLogSource[];
  content: string;
  truncated: boolean;
}

export interface DragonTimelineEntry {
  id: string;
  ts: string;
  kind: DragonTimelineKind;
  level: DragonTimelineLevel;
  title: string;
  detail: string;
  target?: DragonIntegrationTarget;
  actionId?: string;
}

export interface DragonTimelineSnapshot {
  generatedAt: string;
  entries: DragonTimelineEntry[];
}

export interface DragonIntegrationAction {
  id: string;
  target: DragonIntegrationTarget;
  kind: DragonIntegrationActionKind;
  label: string;
  description: string;
}

export interface DragonIntegrationCatalogEntry extends DragonIntegrationAction {
  available: boolean;
  path?: string;
}

export interface DragonIntegrationCatalog {
  generatedAt: string;
  actions: DragonIntegrationCatalogEntry[];
}

export interface DragonActionExecution {
  actionId: string;
  target: DragonIntegrationTarget;
  ok: boolean;
  ranAt: string;
  detail: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  resolvedUrl?: string;
  data?: unknown;
  steps?: DragonActionExecution[];
}

export type DragonDesiredState = "running" | "stopped";
export type DragonDaemonCommandOrigin = "auto" | "manual" | "policy";

export interface DragonDaemonServicePolicy {
  target: DragonLogTarget;
  desiredState: DragonDesiredState;
  autoRecover: boolean;
  cooldownMs: number;
}

export interface DragonDaemonPolicy {
  generatedAt: string;
  enabled: boolean;
  pollIntervalMs: number;
  services: DragonDaemonServicePolicy[];
}

export interface DragonDaemonPolicyPatch {
  enabled?: boolean;
  pollIntervalMs?: number;
  services?: Array<
    Partial<Omit<DragonDaemonServicePolicy, "target">> & Pick<DragonDaemonServicePolicy, "target">
  >;
}

export interface DragonDaemonActionRecord {
  id: string;
  ts: string;
  origin: DragonDaemonCommandOrigin;
  target: DragonIntegrationTarget;
  actionId: string;
  ok: boolean;
  detail: string;
}

export interface DragonDaemonServiceStatus {
  target: DragonLogTarget;
  desiredState: DragonDesiredState;
  autoRecover: boolean;
  runtimeState: DragonRuntimeState;
  healthState: HealthState;
  detail: string;
  processId?: number;
  port?: number;
  consecutiveFailures: number;
  cooldownUntil?: string;
  lastObservedAt: string;
  lastActionAt?: string;
  lastActionId?: string;
  lastActionOk?: boolean;
}

export interface DragonDaemonStatus {
  generatedAt: string;
  manifestPath: string;
  enabled: boolean;
  pollIntervalMs: number;
  cycleCount: number;
  lastCycleAt?: string;
  summary: DragonSystemSummary;
  services: DragonDaemonServiceStatus[];
  recentActions: DragonDaemonActionRecord[];
}
