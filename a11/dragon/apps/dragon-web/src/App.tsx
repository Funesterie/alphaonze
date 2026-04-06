import { useEffect, useMemo, useState } from "react";

import type {
  DragonActionExecution,
  DragonDaemonPolicyPatch,
  DragonDaemonStatus,
  DragonIntegrationCatalog,
  DragonIntegrationCatalogEntry,
  DragonLogSnapshot,
  DragonLogTarget,
  DragonSystemSnapshot,
  DragonTimelineEntry,
  DragonTimelineSnapshot,
  UpstreamProbe
} from "@funeste38/dragon-contracts";

interface IntegrationPayload {
  generatedAt: string;
  snapshot: DragonSystemSnapshot;
  catalog: DragonIntegrationCatalog;
  daemon: DragonDaemonStatus;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; payload: IntegrationPayload };

type LogLoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; payload: DragonLogSnapshot };

type StreamStatus = "connecting" | "live" | "offline";
type CockpitSection = "overview" | "guard" | "actions" | "logs" | "sources";

const QUICK_ACTIONS: Record<string, string[]> = {
  qflush: ["qflush.start", "qflush.stop", "qflush.restart", "qflush.status", "qflush.rome-index"],
  A11: ["a11.start", "a11.stop", "a11.restart", "a11.llm-stats", "a11.memo-list"],
  cerbere: ["cerbere.start", "cerbere.stop", "cerbere.restart", "cerbere.health", "cerbere.stats"]
};

function toTitleCase(value: string): string {
  return value
    .split(/[-_]/g)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function badgeClass(state: string): string {
  if (state === "available") {
    return "badge badge-ok";
  }

  if (state === "unavailable") {
    return "badge badge-bad";
  }

  return "badge badge-unknown";
}

function runtimeBadgeClass(state: UpstreamProbe["runtimeState"]): string {
  if (state === "ready") {
    return "badge badge-ok";
  }

  if (state === "starting") {
    return "badge badge-focus";
  }

  if (state === "degraded") {
    return "badge badge-warn";
  }

  if (state === "dead") {
    return "badge badge-bad";
  }

  return "badge badge-unknown";
}

function lifecycleClass(value: string): string {
  if (value === "primary") {
    return "badge badge-focus";
  }

  if (value === "preferred_extraction") {
    return "badge badge-good";
  }

  return "badge badge-soft";
}

function getApiBase(): string {
  const raw = import.meta.env.VITE_DRAGON_API_URL;
  return raw ? raw.replace(/\/$/, "") : "";
}

function metricLabel(probe: UpstreamProbe): string {
  if (!probe.exists) {
    return "absent";
  }

  if (probe.runtimeState === "ready") {
    return "ready";
  }

  if (probe.runtimeState === "degraded") {
    return "degraded";
  }

  if (probe.runtimeState === "dead") {
    return "dead";
  }

  return "known";
}

function formatTimestamp(value?: string): string {
  if (!value) {
    return "n/a";
  }

  return new Date(value).toLocaleString("fr-FR");
}

function labelForProbeName(value: string): string {
  if (value === "cerbere") {
    return "Cerbere";
  }

  return value;
}

function probeNameToLogTarget(value: string): DragonLogTarget {
  if (value === "A11") {
    return "a11";
  }

  if (value === "cerbere") {
    return "cerbere";
  }

  return "qflush";
}

function runtimeSummary(probe: UpstreamProbe): string {
  const parts: string[] = [];

  if (typeof probe.processId === "number") {
    parts.push(`pid ${probe.processId}`);
  }

  if (typeof probe.port === "number") {
    parts.push(`port ${probe.port}`);
  }

  return parts.length ? parts.join(" • ") : "runtime inconnu";
}

function streamBadgeClass(status: StreamStatus): string {
  if (status === "live") {
    return "badge badge-ok";
  }

  if (status === "offline") {
    return "badge badge-bad";
  }

  return "badge badge-unknown";
}

function timelineBadgeClass(level: DragonTimelineEntry["level"]): string {
  if (level === "success") {
    return "badge badge-ok";
  }

  if (level === "error") {
    return "badge badge-bad";
  }

  if (level === "warning") {
    return "badge badge-focus";
  }

  return "badge badge-soft";
}

function desiredStateBadgeClass(value: "running" | "stopped"): string {
  return value === "running" ? "badge badge-ok" : "badge badge-bad";
}

function formatCooldown(value?: string): string {
  if (!value) {
    return "ready";
  }

  const diffMs = Date.parse(value) - Date.now();
  if (!Number.isFinite(diffMs) || diffMs <= 0) {
    return "ready";
  }

  if (diffMs >= 60_000) {
    return `${Math.ceil(diffMs / 60_000)} min`;
  }

  return `${Math.ceil(diffMs / 1000)} s`;
}

export function App() {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [logState, setLogState] = useState<LogLoadState>({ kind: "loading" });
  const [timelineEntries, setTimelineEntries] = useState<DragonTimelineEntry[]>([]);
  const [runningActionId, setRunningActionId] = useState<string | null>(null);
  const [daemonBusy, setDaemonBusy] = useState<string | null>(null);
  const [actionResult, setActionResult] = useState<DragonActionExecution | null>(null);
  const [selectedLogTarget, setSelectedLogTarget] = useState<DragonLogTarget>("qflush");
  const [selectedLogSourceId, setSelectedLogSourceId] = useState<string>("");
  const [cockpitSection, setCockpitSection] = useState<CockpitSection>("overview");
  const [dashboardStreamStatus, setDashboardStreamStatus] = useState<StreamStatus>("connecting");
  const [logStreamStatus, setLogStreamStatus] = useState<StreamStatus>("connecting");
  const apiBase = getApiBase();

  async function load() {
    setState((current) => (current.kind === "ready" ? current : { kind: "loading" }));

    try {
      const response = await fetch(`${apiBase}/api/integrations`);
      if (!response.ok) {
        throw new Error(`API responded with ${response.status}`);
      }

      const payload = (await response.json()) as IntegrationPayload;
      setState({ kind: "ready", payload });
    } catch (error) {
      setState({
        kind: "error",
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  async function loadTimeline() {
    try {
      const response = await fetch(`${apiBase}/api/timeline`);
      if (!response.ok) {
        throw new Error(`Timeline API responded with ${response.status}`);
      }

      const payload = (await response.json()) as DragonTimelineSnapshot;
      setTimelineEntries(payload.entries);
    } catch {
      // SSE remains the primary source for timeline updates.
    }
  }

  async function loadLogs(target = selectedLogTarget, sourceId = selectedLogSourceId || undefined) {
    setLogState((current) => (current.kind === "ready" ? current : { kind: "loading" }));

    try {
      const searchParams = new URLSearchParams({ target });
      if (sourceId) {
        searchParams.set("sourceId", sourceId);
      }

      const response = await fetch(`${apiBase}/api/logs?${searchParams.toString()}`);
      if (!response.ok) {
        throw new Error(`Logs API responded with ${response.status}`);
      }

      const payload = (await response.json()) as DragonLogSnapshot;
      setLogState({ kind: "ready", payload });

      if ((sourceId ?? "") !== (payload.selectedSourceId ?? "")) {
        setSelectedLogSourceId(payload.selectedSourceId ?? "");
      }
    } catch (error) {
      setLogState({
        kind: "error",
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  useEffect(() => {
    void load();
    void loadTimeline();
  }, [apiBase]);

  useEffect(() => {
    const stream = new EventSource(`${apiBase}/api/events`);
    setDashboardStreamStatus("connecting");

    stream.addEventListener("hello", () => {
      setDashboardStreamStatus("live");
    });

    stream.addEventListener("integration", (event) => {
      const payload = JSON.parse((event as MessageEvent).data) as IntegrationPayload;
      setState({ kind: "ready", payload });
      setDashboardStreamStatus("live");
    });

    stream.addEventListener("timeline_snapshot", (event) => {
      const payload = JSON.parse((event as MessageEvent).data) as DragonTimelineSnapshot;
      setTimelineEntries(payload.entries);
    });

    stream.addEventListener("timeline", (event) => {
      const payload = JSON.parse((event as MessageEvent).data) as DragonTimelineEntry;
      setTimelineEntries((current) => [payload, ...current.filter((entry) => entry.id !== payload.id)].slice(0, 40));
    });

    stream.addEventListener("action_result", (event) => {
      const payload = JSON.parse((event as MessageEvent).data) as DragonActionExecution;
      setActionResult(payload);
    });

    stream.onerror = () => {
      setDashboardStreamStatus("offline");
    };

    return () => {
      stream.close();
    };
  }, [apiBase]);

  useEffect(() => {
    void loadLogs(selectedLogTarget, selectedLogSourceId || undefined);
  }, [apiBase, selectedLogTarget, selectedLogSourceId]);

  useEffect(() => {
    const searchParams = new URLSearchParams({ target: selectedLogTarget });
    if (selectedLogSourceId) {
      searchParams.set("sourceId", selectedLogSourceId);
    }

    const stream = new EventSource(`${apiBase}/api/logs/stream?${searchParams.toString()}`);
    setLogStreamStatus("connecting");

    stream.addEventListener("hello", () => {
      setLogStreamStatus("live");
    });

    stream.addEventListener("log_snapshot", (event) => {
      const payload = JSON.parse((event as MessageEvent).data) as DragonLogSnapshot;
      setLogState({ kind: "ready", payload });
      setLogStreamStatus("live");

      if ((payload.selectedSourceId ?? "") !== selectedLogSourceId) {
        setSelectedLogSourceId(payload.selectedSourceId ?? "");
      }
    });

    stream.addEventListener("log_error", (event) => {
      const payload = JSON.parse((event as MessageEvent).data) as { message: string };
      setLogState({ kind: "error", message: payload.message });
      setLogStreamStatus("offline");
    });

    stream.onerror = () => {
      setLogStreamStatus("offline");
    };

    return () => {
      stream.close();
    };
  }, [apiBase, selectedLogTarget, selectedLogSourceId]);

  async function runAction(actionId: string) {
    setRunningActionId(actionId);
    setActionResult(null);

    try {
      const response = await fetch(`${apiBase}/api/integrations/actions/${encodeURIComponent(actionId)}`, {
        method: "POST"
      });
      const result = (await response.json()) as DragonActionExecution;
      setActionResult(result);
      await load();
      await loadLogs(selectedLogTarget, selectedLogSourceId || undefined);
    } catch (error) {
        setActionResult({
          actionId,
          target: actionId.startsWith("a11.")
            ? "a11"
            : actionId.startsWith("cerbere.")
              ? "cerbere"
            : actionId.startsWith("qflush.")
              ? "qflush"
              : "dragon",
        ok: false,
        ranAt: new Date().toISOString(),
        detail: error instanceof Error ? error.message : String(error)
      });
    } finally {
      setRunningActionId(null);
    }
  }

  async function updateDaemonPolicy(patch: DragonDaemonPolicyPatch, busyKey: string) {
    setDaemonBusy(busyKey);

    try {
      const response = await fetch(`${apiBase}/api/daemon/policy`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(patch)
      });

      if (!response.ok) {
        throw new Error(`Daemon policy API responded with ${response.status}`);
      }

      await load();
      await loadTimeline();
    } catch (error) {
      setActionResult({
        actionId: "dragon.daemon.policy",
        target: "dragon",
        ok: false,
        ranAt: new Date().toISOString(),
        detail: error instanceof Error ? error.message : String(error)
      });
    } finally {
      setDaemonBusy(null);
    }
  }

  async function runDaemonCycleNow() {
    setDaemonBusy("cycle");

    try {
      const response = await fetch(`${apiBase}/api/daemon/cycle`, {
        method: "POST"
      });

      if (!response.ok) {
        throw new Error(`Daemon cycle API responded with ${response.status}`);
      }

      await load();
      await loadTimeline();
    } catch (error) {
      setActionResult({
        actionId: "dragon.daemon.cycle",
        target: "dragon",
        ok: false,
        ranAt: new Date().toISOString(),
        detail: error instanceof Error ? error.message : String(error)
      });
    } finally {
      setDaemonBusy(null);
    }
  }

  const content = useMemo(() => {
    if (state.kind === "loading") {
      return <div className="panel status-panel">Scan Dragon en cours...</div>;
    }

    if (state.kind === "error") {
      return (
        <div className="panel status-panel">
          <p className="eyebrow">Connexion API impossible</p>
          <h2>Le cockpit n'a pas encore trouve `dragon-api`.</h2>
          <p>{state.message}</p>
          <p className="subtle">Le flux live attend que `dragon-api` soit disponible.</p>
        </div>
      );
    }

    const { snapshot, catalog } = state.payload;
    const daemon = state.payload.daemon;
    const readiness =
      snapshot.summary.total > 0 ? Math.round((snapshot.summary.ready / snapshot.summary.total) * 100) : 0;
    const focusProbes = snapshot.upstreams.filter(
      (probe) => probe.name === "qflush" || probe.name === "A11" || probe.name === "cerbere"
    );
    const actionLookup = new Map(catalog.actions.map((action) => [action.id, action]));
    const groupedActions = [
      {
        key: "qflush",
        label: "Qflush + Rome",
        items: catalog.actions.filter((action) => action.target === "qflush")
      },
      {
        key: "a11",
        label: "A11",
        items: catalog.actions.filter((action) => action.target === "a11")
      },
      {
        key: "cerbere",
        label: "Cerbere",
        items: catalog.actions.filter((action) => action.target === "cerbere")
      },
      {
        key: "dragon",
        label: "Dragon Ops",
        items: catalog.actions.filter((action) => action.target === "dragon")
      }
    ];
    const activeLogSource =
      logState.kind === "ready"
        ? logState.payload.sources.find((source) => source.id === logState.payload.selectedSourceId)
        : undefined;

    return (
      <>
        <section className="summary-grid">
          <article className="panel metric-card">
            <p className="metric-label">Sources connues</p>
            <strong>{snapshot.summary.total}</strong>
            <span>cibles canoniques dans Dragon</span>
          </article>
          <article className="panel metric-card">
            <p className="metric-label">Runtime ready</p>
            <strong>{snapshot.summary.ready}</strong>
            <span>{readiness}% de readiness immediate</span>
          </article>
          <article className="panel metric-card">
            <p className="metric-label">Runtime degrade</p>
            <strong>{snapshot.summary.degraded}</strong>
            <span>processus detectes mais non sains</span>
          </article>
          <article className="panel metric-card">
            <p className="metric-label">Runtime dead</p>
            <strong>{snapshot.summary.dead}</strong>
            <span>services attendus mais indisponibles</span>
          </article>
        </section>

        <section className="panel section-panel cockpit-nav-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Vue cockpit</p>
              <h2>Sections admin</h2>
              <p className="section-copy">
                Le cockpit Dragon reste une vue admin, mais on n'affiche plus tout d'un seul bloc.
              </p>
            </div>
          </div>
          <div className="cockpit-tabs">
            {[
              ["overview", "Overview"],
              ["guard", "Guard"],
              ["actions", "Actions"],
              ["logs", "Logs"],
              ["sources", "Sources"]
            ].map(([key, label]) => (
              <button
                className={cockpitSection === key ? "quick-action-button is-active" : "quick-action-button"}
                key={key}
                onClick={() => setCockpitSection(key as CockpitSection)}
                type="button"
              >
                {label}
              </button>
            ))}
          </div>
        </section>

        {cockpitSection === "guard" ? (
        <section className="daemon-grid">
          <article className="panel section-panel daemon-panel">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Dragon Guard</p>
                <h2>Desired state et auto-heal</h2>
                <p className="section-copy">
                  Le daemon maintient `qflush`, `A11` et `Cerbere` selon une policy persistante.
                </p>
              </div>
              <div className="stream-statuses">
                <span className={daemon.enabled ? "badge badge-ok" : "badge badge-bad"}>
                  {daemon.enabled ? "guard actif" : "guard pause"}
                </span>
                <span className="badge badge-soft">{Math.round(daemon.pollIntervalMs / 1000)}s cadence</span>
                <span className="badge badge-soft">{daemon.cycleCount} cycles</span>
              </div>
            </div>
            <div className="daemon-controls">
              <button
                className="action-button"
                disabled={daemonBusy !== null}
                onClick={() => void runDaemonCycleNow()}
                type="button"
              >
                {daemonBusy === "cycle" ? "Cycle..." : "Lancer un cycle"}
              </button>
              <button
                className="action-button action-button-ghost"
                disabled={daemonBusy !== null}
                onClick={() =>
                  void updateDaemonPolicy(
                    { enabled: !daemon.enabled },
                    daemon.enabled ? "guard-pause" : "guard-resume"
                  )
                }
                type="button"
              >
                {daemonBusy === "guard-pause" || daemonBusy === "guard-resume"
                  ? "..."
                  : daemon.enabled
                    ? "Mettre en pause"
                    : "Reprendre le guard"}
              </button>
              <p className="subtle">
                Dernier cycle: {daemon.lastCycleAt ? formatTimestamp(daemon.lastCycleAt) : "pas encore"}
              </p>
            </div>
            <div className="daemon-service-grid">
              {daemon.services.map((service) => (
                <article className="daemon-service-card" key={service.target}>
                  <div className="source-topline">
                    <span className={runtimeBadgeClass(service.runtimeState)}>{service.runtimeState}</span>
                    <span className={desiredStateBadgeClass(service.desiredState)}>{service.desiredState}</span>
                    <span className={service.autoRecover ? "badge badge-focus" : "badge badge-soft"}>
                      {service.autoRecover ? "auto-heal" : "manual"}
                    </span>
                  </div>
                  <h3>{labelForProbeName(service.target === "a11" ? "A11" : service.target)}</h3>
                  <p className="role">{service.detail}</p>
                  <div className="source-meta">
                    <span>fails {service.consecutiveFailures}</span>
                    {typeof service.processId === "number" ? <span>pid {service.processId}</span> : null}
                    {typeof service.port === "number" ? <span>port {service.port}</span> : null}
                    <span>cooldown {formatCooldown(service.cooldownUntil)}</span>
                  </div>
                  <div className="quick-actions">
                    <button
                      className={service.desiredState === "running" ? "quick-action-button is-active" : "quick-action-button"}
                      disabled={daemonBusy !== null}
                      onClick={() =>
                        void updateDaemonPolicy(
                          { services: [{ target: service.target, desiredState: "running" }] },
                          `desired-${service.target}-running`
                        )
                      }
                      type="button"
                    >
                      Keep running
                    </button>
                    <button
                      className={service.desiredState === "stopped" ? "quick-action-button is-active" : "quick-action-button"}
                      disabled={daemonBusy !== null}
                      onClick={() =>
                        void updateDaemonPolicy(
                          { services: [{ target: service.target, desiredState: "stopped" }] },
                          `desired-${service.target}-stopped`
                        )
                      }
                      type="button"
                    >
                      Keep stopped
                    </button>
                    <button
                      className="quick-action-button"
                      disabled={daemonBusy !== null}
                      onClick={() =>
                        void updateDaemonPolicy(
                          {
                            services: [{ target: service.target, autoRecover: !service.autoRecover }]
                          },
                          `autofix-${service.target}`
                        )
                      }
                      type="button"
                    >
                      {service.autoRecover ? "Auto-heal on" : "Auto-heal off"}
                    </button>
                  </div>
                </article>
              ))}
            </div>
            <div className="daemon-recent-list">
              {daemon.recentActions.length > 0 ? (
                daemon.recentActions.slice(0, 8).map((entry) => (
                  <article className="timeline-item" key={entry.id}>
                    <div className="source-topline">
                      <span className={entry.ok ? "badge badge-ok" : "badge badge-bad"}>
                        {entry.ok ? "ok" : "ko"}
                      </span>
                      <span className="badge badge-soft">{entry.origin}</span>
                      <span className="badge badge-soft">{entry.target}</span>
                      <span className="timeline-ts">{formatTimestamp(entry.ts)}</span>
                    </div>
                    <h3>{entry.actionId}</h3>
                    <p className="role">{entry.detail}</p>
                  </article>
                ))
              ) : (
                <p className="subtle">Aucune action daemon enregistree pour le moment.</p>
              )}
            </div>
          </article>
        </section>
        ) : null}

        {cockpitSection === "overview" || cockpitSection === "guard" ? (
        <section className="focus-grid">
          {focusProbes.map((probe) => (
            <article className="panel focus-card" key={probe.path}>
              <div className="source-topline">
                <span className={lifecycleClass(probe.lifecycle)}>{probe.lifecycle}</span>
                <span className={runtimeBadgeClass(probe.runtimeState)}>{probe.runtimeState}</span>
                <span className={badgeClass(probe.healthState)}>health {probe.healthState}</span>
              </div>
              <div className="focus-head">
                <div>
                  <p className="eyebrow">Live runtime</p>
                  <h2>{labelForProbeName(probe.name)}</h2>
                </div>
                <p className="focus-runtime">{runtimeSummary(probe)}</p>
              </div>
              <p className="role">{probe.role}</p>
              <div className="runtime-meta">
                <span>{probe.packageName || "package inconnu"}</span>
                <span>{probe.healthUrl || "pas d'URL"}</span>
                <span>{probe.managedByDragon ? "managed by dragon" : "observed only"}</span>
                <span>Maj {formatTimestamp(probe.lastCheckedAt)}</span>
              </div>
              <p className="health-detail">{probe.healthDetail}</p>
              <div className="quick-actions">
                {(QUICK_ACTIONS[probe.name] || [])
                  .map((actionId) => actionLookup.get(actionId))
                  .filter(Boolean)
                  .map((action) => {
                    const entry = action as DragonIntegrationCatalogEntry;
                    return (
                      <button
                        className="quick-action-button"
                        disabled={!entry.available || runningActionId === entry.id}
                        key={entry.id}
                        onClick={() => void runAction(entry.id)}
                        type="button"
                      >
                        {runningActionId === entry.id ? "..." : entry.label}
                      </button>
                    );
                  })}
                <button
                  className="quick-action-button"
                  onClick={() => {
                    setSelectedLogTarget(probeNameToLogTarget(probe.name));
                    setSelectedLogSourceId("");
                  }}
                  type="button"
                >
                  Ouvrir logs
                </button>
              </div>
            </article>
          ))}
        </section>
        ) : null}

        {cockpitSection === "overview" ? (
        <section className="layout-grid">
          <div className="stack">
            <div className="panel section-panel">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Stack cible</p>
                  <h2>Ce que Dragon doit piloter</h2>
                  <p className="section-copy">
                    Snapshot API du {formatTimestamp(state.payload.generatedAt)}. Les streams live reprennent ensuite.
                  </p>
                </div>
                <button className="action-button action-button-ghost" onClick={() => void load()} type="button">
                  Rafraichir
                </button>
              </div>
              <div className="target-list">
                {Object.entries(snapshot.manifest.target_stack).map(([key, value]) => (
                  <div className="target-row" key={key}>
                    <div>
                      <p className="target-key">{toTitleCase(key)}</p>
                      <p className="target-path">{value}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="panel section-panel">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Timeline live</p>
                  <h2>Actions et transitions</h2>
                  <p className="section-copy">
                    Le watcher SSE pousse les changements runtime et les actions au fil de l’eau.
                  </p>
                </div>
                <div className="stream-statuses">
                  <span className={streamBadgeClass(dashboardStreamStatus)}>dashboard {dashboardStreamStatus}</span>
                  <span className={streamBadgeClass(logStreamStatus)}>logs {logStreamStatus}</span>
                </div>
              </div>
              <div className="timeline-list">
                {timelineEntries.length > 0 ? (
                  timelineEntries.slice(0, 18).map((entry) => (
                    <article className="timeline-item" key={entry.id}>
                      <div className="source-topline">
                        <span className={timelineBadgeClass(entry.level)}>{entry.level}</span>
                        <span className="badge badge-soft">{entry.kind}</span>
                        {entry.target ? <span className="badge badge-soft">{entry.target}</span> : null}
                        <span className="timeline-ts">{formatTimestamp(entry.ts)}</span>
                      </div>
                      <h3>{entry.title}</h3>
                      <p className="role">{entry.detail}</p>
                    </article>
                  ))
                ) : (
                  <p className="subtle">Aucune activite capturee pour le moment.</p>
                )}
              </div>
            </div>

          </div>

          <aside className="panel side-panel">
            <p className="eyebrow">Lecture rapide</p>
            <h2>Dragon pilote deja du concret.</h2>
            <p>
              Le cockpit ne se contente plus d'afficher une carte: il peut maintenant sonder `qflush`,
              lire et regenerer ses artefacts Rome, lancer ses commandes de daemon, piloter `A11`,
              relancer `Cerbere`, suivre les logs, et rejouer la timeline live des transitions.
            </p>
            <p className="subtle">
              Snapshot genere le {new Date(snapshot.generatedAt).toLocaleString("fr-FR")}.
            </p>
          </aside>
        </section>
        ) : null}

        {cockpitSection === "actions" ? (
        <section className="stack">
          <div className="panel section-panel">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Actions reelles</p>
                <h2>Commandes allowlistees pour l'ecosysteme</h2>
                <p className="section-copy">
                  Dragon expose maintenant des workflows d'ops, du lifecycle service et les probes utiles.
                </p>
              </div>
            </div>
            <div className="action-groups">
              {groupedActions.map((group) => (
                <div className="action-group" key={group.key}>
                  <div className="status-line">
                    <p className="target-key">{group.label}</p>
                    <span className="badge badge-soft">{group.items.length} actions</span>
                  </div>
                  <div className="actions-grid">
                    {group.items.map((action) => (
                      <article className="action-card" key={action.id}>
                        <div className="source-topline">
                          <span className="badge badge-soft">{action.target}</span>
                          <span className={action.available ? "badge badge-ok" : "badge badge-unknown"}>
                            {action.available ? "ready" : "missing"}
                          </span>
                        </div>
                        <h3>{action.label}</h3>
                        <p className="role">{action.description}</p>
                        <p className="source-path">{action.path || "No source path available"}</p>
                        <button
                          className="action-button"
                          disabled={!action.available || runningActionId === action.id}
                          onClick={() => void runAction(action.id)}
                          type="button"
                        >
                          {runningActionId === action.id ? "Execution..." : "Executer"}
                        </button>
                      </article>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="result-panel">
              <p className="eyebrow">Dernier resultat</p>
              {actionResult ? (
                <>
                  <div className="source-topline">
                    <span className="badge badge-soft">{actionResult.actionId}</span>
                    <span className={actionResult.ok ? "badge badge-ok" : "badge badge-bad"}>
                      {actionResult.ok ? "success" : "failed"}
                    </span>
                    <span className="badge badge-soft">{actionResult.target}</span>
                  </div>
                  <p className="role">{actionResult.detail}</p>
                  <p className="result-meta">
                    Cible {actionResult.target} • lance le {formatTimestamp(actionResult.ranAt)}
                  </p>
                  {actionResult.resolvedUrl ? <p className="source-path">{actionResult.resolvedUrl}</p> : null}
                  {actionResult.steps?.length ? (
                    <div className="workflow-steps">
                      {actionResult.steps.map((step) => (
                        <p className="workflow-step" key={`${actionResult.actionId}-${step.actionId}-${step.ranAt}`}>
                          <span className={step.ok ? "badge badge-ok" : "badge badge-bad"}>
                            {step.ok ? "ok" : "ko"}
                          </span>{" "}
                          {step.actionId} - {step.detail}
                        </p>
                      ))}
                    </div>
                  ) : null}
                  {actionResult.stdout ? <pre>{actionResult.stdout}</pre> : null}
                  {actionResult.stderr ? <pre>{actionResult.stderr}</pre> : null}
                  {actionResult.data ? <pre>{JSON.stringify(actionResult.data, null, 2)}</pre> : null}
                </>
              ) : (
                <p className="subtle">Aucune action executee pour le moment.</p>
              )}
            </div>
          </div>
        </section>
        ) : null}

        {cockpitSection === "logs" ? (
        <section className="stack">
          <div className="panel section-panel">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Logs live</p>
                <h2>Ce qui se passe vraiment</h2>
                <p className="section-copy">
                  Flux SSE dedie cote API. La source selectionnee suit la cible choisie en direct.
                </p>
              </div>
            </div>
            <div className="log-toolbar">
              <div className="log-targets">
                <button
                  className={selectedLogTarget === "qflush" ? "quick-action-button is-active" : "quick-action-button"}
                  onClick={() => {
                    setSelectedLogTarget("qflush");
                    setSelectedLogSourceId("");
                  }}
                  type="button"
                >
                  Qflush
                </button>
                <button
                  className={selectedLogTarget === "a11" ? "quick-action-button is-active" : "quick-action-button"}
                  onClick={() => {
                    setSelectedLogTarget("a11");
                    setSelectedLogSourceId("");
                  }}
                  type="button"
                >
                  A11
                </button>
                <button
                  className={selectedLogTarget === "cerbere" ? "quick-action-button is-active" : "quick-action-button"}
                  onClick={() => {
                    setSelectedLogTarget("cerbere");
                    setSelectedLogSourceId("");
                  }}
                  type="button"
                >
                  Cerbere
                </button>
              </div>
              <label className="log-select-wrap">
                <span className="metric-label">Source</span>
                <select
                  className="log-select"
                  disabled={logState.kind !== "ready" || logState.payload.sources.length === 0}
                  onChange={(event) => setSelectedLogSourceId(event.target.value)}
                  value={logState.kind === "ready" ? logState.payload.selectedSourceId ?? "" : ""}
                >
                  {(logState.kind === "ready" ? logState.payload.sources : []).map((source) => (
                    <option disabled={!source.exists} key={source.id} value={source.id}>
                      {source.label}
                      {source.exists ? "" : " (missing)"}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {logState.kind === "error" ? (
              <p className="subtle">{logState.message}</p>
            ) : logState.kind === "loading" ? (
              <p className="subtle">Chargement des logs...</p>
            ) : (
              <>
                <div className="log-meta">
                  <span>{activeLogSource?.path || "Aucune source"}</span>
                  <span>
                    {activeLogSource?.lastModifiedAt
                      ? `Maj ${formatTimestamp(activeLogSource.lastModifiedAt)}`
                      : "Pas de date"}
                  </span>
                  <span>
                    {typeof activeLogSource?.sizeBytes === "number"
                      ? `${Math.round(activeLogSource.sizeBytes / 1024)} KB`
                      : "tail vide"}
                  </span>
                  <span>{logState.payload.truncated ? "tail tronque" : "tail complet"}</span>
                </div>
                <pre className="log-output">
                  {logState.payload.content || "Aucune ligne disponible pour cette source."}
                </pre>
              </>
            )}
          </div>
        </section>
        ) : null}

        {cockpitSection === "sources" ? (
        <section className="layout-grid">
          <div className="stack">
            <div className="panel section-panel">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Stack cible</p>
                  <h2>Ce que Dragon doit piloter</h2>
                  <p className="section-copy">
                    Snapshot API du {formatTimestamp(state.payload.generatedAt)}. Les chemins restent visibles ici, pas dans une vue publique.
                  </p>
                </div>
                <button className="action-button action-button-ghost" onClick={() => void load()} type="button">
                  Rafraichir
                </button>
              </div>
              <div className="target-list">
                {Object.entries(snapshot.manifest.target_stack).map(([key, value]) => (
                  <div className="target-row" key={key}>
                    <div>
                      <p className="target-key">{toTitleCase(key)}</p>
                      <p className="target-path">{value}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="panel section-panel">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Sources canoniques</p>
                  <h2>Les briques qui comptent vraiment</h2>
                </div>
              </div>
              <div className="source-grid">
                {snapshot.upstreams.map((probe) => (
                  <article className="source-card" key={probe.path}>
                    <div className="source-topline">
                      <span className={lifecycleClass(probe.lifecycle)}>{probe.lifecycle}</span>
                      <span className={runtimeBadgeClass(probe.runtimeState)}>{probe.runtimeState}</span>
                      <span className={badgeClass(probe.healthState)}>health {probe.healthState}</span>
                    </div>
                    <h3>{labelForProbeName(probe.name)}</h3>
                    <p className="role">{probe.role}</p>
                    <p className="source-path">{probe.path}</p>
                    <div className="source-meta">
                      <span>{metricLabel(probe)}</span>
                      {typeof probe.processId === "number" ? <span>pid {probe.processId}</span> : null}
                      {typeof probe.port === "number" ? <span>port {probe.port}</span> : null}
                      <span>{probe.hasGit ? "git" : "no-git"}</span>
                      <span>{probe.hasPackageJson ? "package.json" : "no-package"}</span>
                    </div>
                    <p className="health-detail">{probe.healthDetail}</p>
                    {probe.healthUrl ? <p className="source-path">{probe.healthUrl}</p> : null}
                    <p className="package-name">Derniere verification: {formatTimestamp(probe.lastCheckedAt)}</p>
                    {probe.packageName ? <p className="package-name">package: {probe.packageName}</p> : null}
                  </article>
                ))}
              </div>
            </div>
          </div>

          <aside className="panel side-panel">
            <p className="eyebrow">Inventaire</p>
            <h2>La vue infra reste separee.</h2>
            <p>
              Cette section regroupe les chemins, probes et détails de runtime qui n'ont rien à faire dans une interface utilisateur normale.
            </p>
            <p className="subtle">
              Snapshot genere le {new Date(snapshot.generatedAt).toLocaleString("fr-FR")}.
            </p>
          </aside>
        </section>
        ) : null}
      </>
    );
  }, [
    actionResult,
    cockpitSection,
    daemonBusy,
    dashboardStreamStatus,
    logState,
    logStreamStatus,
    runningActionId,
    selectedLogTarget,
    state,
    timelineEntries
  ]);

  return (
    <div className="app-shell">
      <div className="backdrop backdrop-one" />
      <div className="backdrop backdrop-two" />
      <main className="page">
        <header className="hero panel">
          <p className="eyebrow">Dragon Phase 1</p>
          <h1>Control Deck pour une giga app modulaire</h1>
          <p className="hero-copy">
            Ce cockpit agrege le manifeste Dragon, repere les sources reelles sur `D:\`, et expose la
            base de convergence entre `qflush`, `A11` et les bibliotheques Funesterie.
          </p>
        </header>
        {content}
      </main>
    </div>
  );
}
