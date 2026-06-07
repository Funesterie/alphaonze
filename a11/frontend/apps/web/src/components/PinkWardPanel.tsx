import React, { useEffect, useMemo, useState } from "react";
import {
  fetchPinkWardStatus,
  type PinkWardStatusResponse,
} from "../lib/api";

function cardStyle(accent = "#7c2d62"): React.CSSProperties {
  return {
    border: `1px solid ${accent}`,
    borderRadius: 10,
    background: "linear-gradient(180deg, rgba(30, 9, 34, 0.82), rgba(9, 14, 26, 0.96))",
    padding: 14,
    minWidth: 0,
  };
}

function chipStyle(ok: boolean, active = true): React.CSSProperties {
  return {
    borderRadius: 999,
    padding: "5px 10px",
    fontSize: 12,
    border: `1px solid ${ok ? "#be185d" : "#334155"}`,
    background: ok ? "rgba(190, 24, 93, 0.18)" : "#111827",
    color: ok ? "#fbcfe8" : (active ? "#cbd5e1" : "#64748b"),
    whiteSpace: "nowrap",
  };
}

function mono(value: unknown) {
  if (value === null || value === undefined || value === "") return "-";
  return String(value);
}

function boolLabel(value: unknown) {
  return value ? "ok" : "off";
}

function formatPercent(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "-";
  return `${Math.round(numeric)}%`;
}

function formatGb(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "-";
  return `${numeric.toFixed(numeric % 1 === 0 ? 0 : 1)} GB`;
}

function VramBar({ usedGb, totalGb }: { usedGb?: number | null; totalGb?: number | null }) {
  const total = Number(totalGb || 0);
  const used = Number(usedGb || 0);
  const percent = total > 0 ? Math.max(0, Math.min(100, Math.round((used / total) * 100))) : 0;
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ height: 8, borderRadius: 999, background: "#111827", overflow: "hidden", border: "1px solid #1f2937" }}>
        <div
          style={{
            height: "100%",
            width: `${percent}%`,
            background: "linear-gradient(90deg, #ec4899, #8b5cf6)",
          }}
        />
      </div>
      <div style={{ marginTop: 5, color: "#94a3b8", fontSize: 11 }}>
        VRAM utilisee {formatGb(usedGb)} / {formatGb(totalGb)}
      </div>
    </div>
  );
}

export type PinkWardPanelProps = {
  embedded?: boolean;
  title?: string;
  subtitle?: string;
};

export function PinkWardPanel({
  embedded = false,
  title = "Pink Ward",
  subtitle = "Vision Janus Pro, budget GPU, fallback CPU, QFlush et A11Host dans une seule vue de controle.",
}: PinkWardPanelProps = {}) {
  const [status, setStatus] = useState<PinkWardStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  async function loadStatus() {
    setRefreshing(true);
    setError("");
    try {
      const next = await fetchPinkWardStatus();
      setStatus(next);
    } catch (err: any) {
      setError(String(err?.message || err || "pink_ward_unavailable"));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    loadStatus();
    const timer = window.setInterval(loadStatus, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const primaryGpu = status?.gpu?.gpus?.[0] || null;
  const processCount = useMemo(() => Object.keys(status?.qflush?.processes || {}).length, [status]);
  const janusEnabled = Boolean(status?.janus?.enabled);
  const gpuReady = Boolean(status?.gpu?.available && status?.janus?.requestedGpu);
  const a11HostReady = Boolean(status?.a11host?.available);
  const qflushReady = Boolean(status?.qflush?.available);
  const workerReady = Boolean(status?.janus?.worker?.alive || status?.janus?.worker?.ready);

  return (
    <section style={{ marginTop: embedded ? 0 : 24 }}>
      <div
        style={{
          border: "1px solid rgba(236, 72, 153, 0.42)",
          borderRadius: embedded ? 8 : 14,
          background: "radial-gradient(circle at top right, rgba(236, 72, 153, 0.15), transparent 35%), #070b14",
          padding: embedded ? 12 : 16,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div style={{ color: "#f0abfc", fontSize: 11, fontWeight: 800, letterSpacing: 1, textTransform: "uppercase" }}>
              Multimodal runtime
            </div>
            <h3 style={{ margin: "5px 0 0", color: "#fdf2f8", fontSize: 18 }}>{title}</h3>
            <p style={{ margin: "6px 0 0", color: "#94a3b8", fontSize: 12, maxWidth: 760 }}>
              {subtitle}
            </p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={chipStyle(janusEnabled)}>Janus {janusEnabled ? "actif" : "off"}</span>
            <span style={chipStyle(gpuReady)}>GPU {gpuReady ? "pret" : "fallback"}</span>
            <span style={chipStyle(qflushReady)}>QFlush {boolLabel(qflushReady)}</span>
            <button
              type="button"
              onClick={loadStatus}
              disabled={refreshing}
              className="btn ghost"
              style={{ fontSize: 12 }}
            >
              {refreshing ? "Scan..." : "Rafraichir"}
            </button>
          </div>
        </div>

        {error ? (
          <div style={{ marginTop: 12, padding: 10, borderRadius: 8, border: "1px solid #7f1d1d", background: "#2a0f0f", color: "#fecaca", fontSize: 12 }}>
            {error}
          </div>
        ) : null}

        {loading ? (
          <div style={{ marginTop: 14, color: "#94a3b8", fontSize: 13 }}>Scan Pink Ward en cours...</div>
        ) : (
          <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 260px), 1fr))", gap: 12 }}>
            <div style={cardStyle("#831843")}>
              <h4 style={{ margin: 0, color: "#fdf2f8", fontSize: 14 }}>Janus Pro</h4>
              <div style={{ marginTop: 10, display: "grid", gap: 6, color: "#cbd5e1", fontSize: 12 }}>
                <div>Provider: {mono(status?.janus?.provider)}</div>
                <div>Modele: {mono(status?.janus?.config?.model?.label)}</div>
                <div>Device: {mono(status?.janus?.config?.device)} / {mono(status?.janus?.config?.torchDtype)}</div>
                <div>Worker: {workerReady ? "pret" : "au repos"} / pending {mono(status?.janus?.worker?.pending ?? 0)}</div>
                <div>Fallback 1B: {boolLabel(status?.janus?.fallback?.enabled)}</div>
              </div>
              <div style={{ marginTop: 10, color: status?.janus?.config?.workerScriptExists ? "#bbf7d0" : "#fde68a", fontSize: 12 }}>
                Worker script: {boolLabel(status?.janus?.config?.workerScriptExists)}
              </div>
            </div>

            <div style={cardStyle("#6d28d9")}>
              <h4 style={{ margin: 0, color: "#ede9fe", fontSize: 14 }}>GPU / VRAM</h4>
              <div style={{ marginTop: 10, display: "grid", gap: 6, color: "#cbd5e1", fontSize: 12 }}>
                <div>Carte: {mono(primaryGpu?.name || status?.gpu?.message || status?.gpu?.error)}</div>
                <div>Lane: {mono(status?.budget?.lane)}</div>
                <div>Utilisation GPU: {formatPercent(primaryGpu?.utilizationGpuPercent)}</div>
                <div>Recommandation: {mono(status?.budget?.recommendation)}</div>
              </div>
              <VramBar usedGb={status?.budget?.usedGb} totalGb={status?.budget?.totalGb} />
            </div>

            <div style={cardStyle("#155e75")}>
              <h4 style={{ margin: 0, color: "#cffafe", fontSize: 14 }}>Nerve routing</h4>
              <div style={{ marginTop: 10, display: "grid", gap: 6, color: "#cbd5e1", fontSize: 12 }}>
                <div>A11Host: {a11HostReady ? "connecte" : "degrade"} ({mono(status?.a11host?.mode)})</div>
                <div>Bridge VSIX: {boolLabel(status?.a11host?.bridgeAvailable)}</div>
                <div>Headless: {boolLabel(status?.a11host?.headlessAvailable)}</div>
                <div>QFlush flow: {mono(status?.qflush?.chatFlow)}</div>
                <div>Process supervises: {processCount}</div>
              </div>
            </div>

            <div style={cardStyle("#334155")}>
              <h4 style={{ margin: 0, color: "#e2e8f0", fontSize: 14 }}>Safety lane</h4>
              <div style={{ marginTop: 10, display: "grid", gap: 6, color: "#cbd5e1", fontSize: 12 }}>
                <div>Fallback CPU: {boolLabel(status?.fallback?.cpu)}</div>
                <div>Raison: {mono(status?.fallback?.reason)}</div>
                <div>Python: {status?.janus?.config?.pythonBinExists === null ? "system path" : boolLabel(status?.janus?.config?.pythonBinExists)}</div>
                <div>Modele local: {boolLabel(status?.janus?.config?.model?.local)}</div>
                <div>Dernier scan: {status?.timestamp ? new Date(status.timestamp).toLocaleTimeString() : "-"}</div>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
