import React, { useEffect, useState } from "react";
import {
  fetchA11Capabilities,
  fetchA11HostStatus,
  fetchQflushStatus,
  fetchRuntimeModulesStatus,
  type A11CapabilitiesResponse,
  type A11HostStatusResponse,
  type QflushStatusResponse,
  type RuntimeModuleInfo,
  type RuntimeModulesStatusResponse,
} from "../lib/api";

type SnapshotState = {
  a11host: A11HostStatusResponse | null;
  capabilities: A11CapabilitiesResponse | null;
  qflush: QflushStatusResponse | null;
  runtimeModules: RuntimeModulesStatusResponse | null;
};

function statusColor(ok: boolean) {
  return ok ? "#22c55e" : "#f59e0b";
}

function cardStyle(): React.CSSProperties {
  return {
    border: "1px solid #1f2937",
    borderRadius: 10,
    background: "#0b1220",
    padding: 14,
  };
}

function monoValue(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}

function renderBooleanGrid(flags: Record<string, boolean> | undefined) {
  const entries = Object.entries(flags || {});
  if (!entries.length) {
    return <div style={{ color: "#94a3b8", fontSize: 12 }}>Aucune capacité exposée.</div>;
  }

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
        gap: 8,
        marginTop: 10,
      }}
    >
      {entries.map(([key, value]) => (
        <div
          key={key}
          style={{
            border: `1px solid ${value ? "#14532d" : "#3f3f46"}`,
            background: value ? "#052e1b" : "#111827",
            color: value ? "#bbf7d0" : "#cbd5e1",
            borderRadius: 8,
            padding: "8px 10px",
            fontSize: 12,
            display: "flex",
            justifyContent: "space-between",
            gap: 10,
          }}
        >
          <span>{key}</span>
          <strong>{value ? "on" : "off"}</strong>
        </div>
      ))}
    </div>
  );
}

function moduleStatusTone(status: string | undefined) {
  switch (status) {
    case "ready":
      return { border: "#14532d", background: "#052e1b", color: "#bbf7d0" };
    case "source-only":
      return { border: "#1d4ed8", background: "#0b1e3f", color: "#bfdbfe" };
    case "asset-only":
      return { border: "#7c2d12", background: "#2d1608", color: "#fed7aa" };
    case "raw":
      return { border: "#52525b", background: "#18181b", color: "#d4d4d8" };
    default:
      return { border: "#854d0e", background: "#2f2308", color: "#fde68a" };
  }
}

function chipStyle(tone: { border: string; background: string; color: string }): React.CSSProperties {
  return {
    borderRadius: 999,
    padding: "4px 8px",
    fontSize: 11,
    lineHeight: 1.2,
    border: `1px solid ${tone.border}`,
    background: tone.background,
    color: tone.color,
    whiteSpace: "nowrap",
  };
}

function renderModuleRow(moduleInfo: RuntimeModuleInfo) {
  const tone = moduleStatusTone(moduleInfo.state?.status);
  const capabilities = moduleInfo.capabilities || [];
  const scripts = moduleInfo.scripts || [];

  return (
    <li
      key={moduleInfo.id}
      style={{
        listStyle: "none",
        margin: 0,
        padding: "10px 0",
        borderTop: "1px solid #1f2937",
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 230px), 1fr))",
        gap: 12,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <strong style={{ color: "#e2e8f0", fontSize: 13, wordBreak: "break-word" }}>
            {moduleInfo.id}
          </strong>
          <span style={chipStyle(tone)}>{moduleInfo.state?.status || "partial"}</span>
          {moduleInfo.state?.loaded ? (
            <span style={chipStyle({ border: "#14532d", background: "#052e1b", color: "#bbf7d0" })}>
              charge
            </span>
          ) : null}
        </div>
        <div style={{ color: "#94a3b8", fontSize: 12, marginTop: 5, wordBreak: "break-word" }}>
          {moduleInfo.name}
          {moduleInfo.version ? ` @ ${moduleInfo.version}` : ""} - {moduleInfo.kind}
        </div>
        <div style={{ color: "#64748b", fontSize: 11, marginTop: 5 }}>
          fichiers {moduleInfo.state?.shallowFiles ?? 0} - dossiers {moduleInfo.state?.shallowDirectories ?? 0}
        </div>
      </div>

      <div style={{ minWidth: 0 }}>
        <div style={{ color: "#cbd5e1", fontSize: 12, lineHeight: 1.45, wordBreak: "break-word" }}>
          {moduleInfo.summary || "Module runtime local."}
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
          {capabilities.slice(0, 6).map((capability) => (
            <span
              key={capability}
              style={{
                border: "1px solid #1e3a8a",
                background: "#0b1e3f",
                color: "#bfdbfe",
                borderRadius: 999,
                padding: "3px 7px",
                fontSize: 11,
              }}
            >
              {capability}
            </span>
          ))}
          {scripts.length > 0 ? (
            <span
              style={{
                border: "1px solid #334155",
                background: "#111827",
                color: "#cbd5e1",
                borderRadius: 999,
                padding: "3px 7px",
                fontSize: 11,
              }}
            >
              scripts {scripts.length}
            </span>
          ) : null}
        </div>
      </div>
    </li>
  );
}

export function A11OpsStatusPanel() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string>("");
  const [lastUpdated, setLastUpdated] = useState<string>("");
  const [snapshot, setSnapshot] = useState<SnapshotState>({
    a11host: null,
    capabilities: null,
    qflush: null,
    runtimeModules: null,
  });

  async function loadStatus() {
    setError("");
    setRefreshing(true);
    try {
      const [a11host, capabilities, qflush, runtimeModules] = await Promise.all([
        fetchA11HostStatus(),
        fetchA11Capabilities(),
        fetchQflushStatus(),
        fetchRuntimeModulesStatus().catch((err: any) => ({
          ok: false,
          error: String(err?.message || err || "runtime_modules_unavailable"),
          modules: [],
          summary: { total: 0 },
        } as RuntimeModulesStatusResponse)),
      ]);
      setSnapshot({ a11host, capabilities, qflush, runtimeModules });
      setLastUpdated(new Date().toISOString());
    } catch (err: any) {
      setError(String(err?.message || err || "status_load_failed"));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    loadStatus();
  }, []);

  const a11host = snapshot.a11host;
  const capabilities = snapshot.capabilities;
  const qflush = snapshot.qflush;
  const runtimeModules = snapshot.runtimeModules;
  const moduleSummary = runtimeModules?.summary || {};
  const modules = runtimeModules?.modules || [];
  const qflushProcesses = Object.entries(qflush?.processes || capabilities?.qflush?.processes || {});

  return (
    <div style={{ marginTop: 24 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
          marginBottom: 12,
        }}
      >
        <div>
          <h3 style={{ margin: 0, color: "#e2e8f0", fontSize: 16 }}>Diagnostic runtime</h3>
          <p style={{ margin: "4px 0 0", color: "#94a3b8", fontSize: 12 }}>
            A11Host, capacites outillees et etat local.
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          {lastUpdated && (
            <span style={{ color: "#94a3b8", fontSize: 12 }}>
              Mis à jour: {new Date(lastUpdated).toLocaleString()}
            </span>
          )}
          <button
            type="button"
            onClick={loadStatus}
            disabled={refreshing}
            className="btn ghost"
            style={{ fontSize: 12 }}
          >
            {refreshing ? "Actualisation..." : "Rafraichir"}
          </button>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <span
          style={{
            borderRadius: 999,
            padding: "5px 10px",
            fontSize: 12,
            border: `1px solid ${statusColor(!!a11host?.available)}`,
            color: a11host?.available ? "#bbf7d0" : "#fde68a",
            background: a11host?.available ? "#052e1b" : "#3f2a08",
          }}
        >
          A11Host {a11host?.mode || "inconnu"}
        </span>
        {qflush?.available ? (
          <span
            style={{
              borderRadius: 999,
              padding: "5px 10px",
              fontSize: 12,
              border: `1px solid ${statusColor(true)}`,
              color: "#bbf7d0",
              background: "#052e1b",
            }}
          >
            Memoire etendue disponible
          </span>
        ) : null}
        <span
          style={{
            borderRadius: 999,
            padding: "5px 10px",
            fontSize: 12,
            border: `1px solid ${statusColor(!!a11host?.bridgeAvailable)}`,
            color: a11host?.bridgeAvailable ? "#bbf7d0" : "#cbd5e1",
            background: a11host?.bridgeAvailable ? "#052e1b" : "#111827",
          }}
        >
          VSIX {a11host?.bridgeAvailable ? "connecte" : "absent"}
        </span>
        <span
          style={{
            borderRadius: 999,
            padding: "5px 10px",
            fontSize: 12,
            border: `1px solid ${statusColor((moduleSummary.total || 0) > 0)}`,
            color: (moduleSummary.total || 0) > 0 ? "#bbf7d0" : "#cbd5e1",
            background: (moduleSummary.total || 0) > 0 ? "#052e1b" : "#111827",
          }}
        >
          Modules {moduleSummary.total || 0}
        </span>
      </div>

      {error && (
        <div
          style={{
            marginBottom: 12,
            padding: 10,
            borderRadius: 8,
            border: "1px solid #7f1d1d",
            background: "#2a0f0f",
            color: "#fecaca",
            fontSize: 12,
          }}
        >
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ color: "#94a3b8", fontSize: 13 }}>Chargement du diagnostic…</div>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          <section style={cardStyle()}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <div>
                <h4 style={{ margin: 0, color: "#e2e8f0", fontSize: 15 }}>A11Host</h4>
                <div style={{ marginTop: 4, color: "#94a3b8", fontSize: 12 }}>
                  Mode {monoValue(a11host?.mode)} · Workspace {monoValue(a11host?.workspaceRoot)}
                </div>
              </div>
              <div style={{ color: "#cbd5e1", fontSize: 12, textAlign: "right" }}>
                <div>Bridge: {a11host?.bridgeAvailable ? "oui" : "non"}</div>
                <div>Headless: {a11host?.headlessAvailable ? "oui" : "non"}</div>
                <div>Build config: {a11host?.buildCommandConfigured ? "oui" : "non"}</div>
              </div>
            </div>

            <div style={{ marginTop: 10, display: "grid", gap: 6, color: "#cbd5e1", fontSize: 12 }}>
              <div>Methodes actives: {monoValue(a11host?.methods?.length || 0)}</div>
              <div>Bridge methods: {monoValue(a11host?.bridgeMethods?.length || 0)}</div>
              <div>Headless methods: {monoValue(a11host?.headlessMethods?.length || 0)}</div>
            </div>

            {renderBooleanGrid(a11host?.capabilities)}

            <div style={{ marginTop: 10, color: "#94a3b8", fontSize: 12 }}>
              Shell safe:
              {" "}
              {a11host?.shellPolicy?.defaultExamples?.join(", ") || "aucune info"}
            </div>
          </section>

          <section style={cardStyle()}>
            <h4 style={{ margin: 0, color: "#e2e8f0", fontSize: 15 }}>Capacites agent</h4>
            <div style={{ marginTop: 6, color: "#94a3b8", fontSize: 12 }}>
              Vue backend agregee pour A11Host et les briques locales actives.
            </div>

            <div style={{ marginTop: 10, display: "grid", gap: 6, color: "#cbd5e1", fontSize: 12 }}>
              <div>Shell cwd: {monoValue(capabilities?.a11host?.shellCwd)}</div>
              <div>Build command: {monoValue(capabilities?.a11host?.buildCommand)}</div>
              <div>Methodes bridge: {monoValue(capabilities?.a11host?.methods?.bridge?.length || 0)}</div>
              <div>Methodes headless: {monoValue(capabilities?.a11host?.methods?.headless?.length || 0)}</div>
            </div>

            {renderBooleanGrid(capabilities?.a11host?.capabilities)}
          </section>

          <section style={cardStyle()}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <div>
                <h4 style={{ margin: 0, color: "#e2e8f0", fontSize: 15 }}>Modules Funesterie</h4>
                <div style={{ marginTop: 6, color: "#94a3b8", fontSize: 12, wordBreak: "break-word" }}>
                  Inventaire famille-only de {monoValue(runtimeModules?.modulesRoot)}.
                </div>
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                <span style={chipStyle({ border: "#14532d", background: "#052e1b", color: "#bbf7d0" })}>
                  ready {moduleSummary.ready || 0}
                </span>
                <span style={chipStyle({ border: "#1d4ed8", background: "#0b1e3f", color: "#bfdbfe" })}>
                  packages {moduleSummary.packages || 0}
                </span>
                <span style={chipStyle({ border: "#52525b", background: "#18181b", color: "#d4d4d8" })}>
                  charges {moduleSummary.loaded || 0}
                </span>
              </div>
            </div>

            {modules.length === 0 ? (
              <div style={{ color: "#94a3b8", fontSize: 12, marginTop: 12 }}>
                {runtimeModules?.error || "Aucun module runtime detecte sur ce serveur."}
              </div>
            ) : (
              <ul style={{ margin: "12px 0 0", padding: 0 }}>
                {modules.map(renderModuleRow)}
              </ul>
            )}
          </section>

          {qflush?.available || qflushProcesses.length > 0 ? (
            <section style={cardStyle()}>
              <h4 style={{ margin: 0, color: "#e2e8f0", fontSize: 15 }}>Memoire etendue</h4>
              <div style={{ marginTop: 6, color: "#94a3b8", fontSize: 12 }}>
                URL: {monoValue(qflush?.remoteUrl)} · Chat flow: {monoValue(qflush?.chatFlow)}
              </div>
              <div style={{ marginTop: 6, color: "#94a3b8", fontSize: 12 }}>
                Memory flow: {monoValue(qflush?.memorySummaryFlow)} · Built-in: {qflush?.memorySummaryBuiltIn ? "oui" : "non"}
              </div>

              {qflush?.message && (
                <div style={{ marginTop: 10, color: "#fde68a", fontSize: 12 }}>{qflush.message}</div>
              )}
              {qflush?.error && (
                <div style={{ marginTop: 10, color: "#fecaca", fontSize: 12 }}>{qflush.error}</div>
              )}

              <div style={{ marginTop: 12 }}>
                <h5 style={{ margin: "0 0 8px", color: "#cbd5e1", fontSize: 13 }}>Processus supervises</h5>
                {qflushProcesses.length === 0 ? (
                  <div style={{ color: "#94a3b8", fontSize: 12 }}>Aucun processus supervise expose.</div>
                ) : (
                  <div style={{ display: "grid", gap: 8 }}>
                    {qflushProcesses.map(([name, processInfo]) => (
                      <div
                        key={name}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          gap: 10,
                          padding: "8px 10px",
                          borderRadius: 8,
                          background: "#111827",
                          border: "1px solid #1f2937",
                          color: "#cbd5e1",
                          fontSize: 12,
                          flexWrap: "wrap",
                        }}
                      >
                        <strong style={{ color: "#e2e8f0" }}>{name}</strong>
                        <span>status {monoValue(processInfo?.status)}</span>
                        <span>pid {monoValue(processInfo?.pid)}</span>
                        <span>restarts {monoValue(processInfo?.restarts ?? 0)}</span>
                        <span>uptime {monoValue(processInfo?.uptime)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}
