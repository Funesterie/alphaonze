import React, { useEffect, useMemo, useState } from "react";
import {
  fetchQflushTerminalStatus,
  runQflushTerminalCommand,
  type QflushTerminalStatusResponse,
} from "../lib/api";

type TerminalEntry = {
  id: string;
  command: string;
  output: string;
  ok: boolean;
  at: string;
};

type QflushPortableTerminalProps = {
  compact?: boolean;
};

const QUICK_COMMANDS = [
  "status",
  "tail gamepad 8",
  "tail keyboard 8",
  "pad start",
  "pad a",
  "pilot wake",
  "pilot demo_fight --loops 1",
  "keyboard-pilot demo_fight --layout azerty",
];

function badgeStyle(tone: "ok" | "warn" | "idle"): React.CSSProperties {
  const palette = tone === "ok"
    ? { border: "#14532d", bg: "#052e1b", text: "#bbf7d0" }
    : tone === "warn"
      ? { border: "#854d0e", bg: "#2b1d06", text: "#fde68a" }
      : { border: "#334155", bg: "#111827", text: "#cbd5e1" };
  return {
    borderRadius: 999,
    padding: "5px 10px",
    border: `1px solid ${palette.border}`,
    background: palette.bg,
    color: palette.text,
    fontSize: 12,
    whiteSpace: "nowrap",
  };
}

export function QflushPortableTerminal({ compact = false }: QflushPortableTerminalProps) {
  const [status, setStatus] = useState<QflushTerminalStatusResponse | null>(null);
  const [statusError, setStatusError] = useState("");
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [command, setCommand] = useState("status");
  const [entries, setEntries] = useState<TerminalEntry[]>([]);
  const [detached, setDetached] = useState(false);

  async function refreshStatus() {
    setStatusError("");
    try {
      const nextStatus = await fetchQflushTerminalStatus();
      setStatus(nextStatus);
    } catch (error: any) {
      setStatusError(String(error?.message || error || "qflush_terminal_status_failed"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refreshStatus();
  }, []);

  const helpLines = useMemo(() => {
    return String(status?.terminal?.help || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  }, [status]);

  const lastOutput = entries[0]?.output || (loading ? "Chargement Qflush..." : "Pret. Tape `help` pour les commandes.");

  async function run(nextCommand?: string) {
    const raw = String(nextCommand ?? command).trim();
    if (!raw || running) return;
    if (raw.toLowerCase() === "clear") {
      setEntries([]);
      setCommand("");
      return;
    }

    setRunning(true);
    setCommand(raw);
    try {
      const result = await runQflushTerminalCommand(raw);
      setEntries((current) => [{
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        command: raw,
        output: String(result.output || JSON.stringify(result, null, 2)),
        ok: result.ok !== false,
        at: new Date().toISOString(),
      }, ...current].slice(0, 20));
    } catch (error: any) {
      setEntries((current) => [{
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        command: raw,
        output: String(error?.message || error || "qflush_terminal_command_failed"),
        ok: false,
        at: new Date().toISOString(),
      }, ...current].slice(0, 20));
    } finally {
      setRunning(false);
    }
  }

  const shellBadgeTone = status?.terminal?.shell === false ? "ok" : "warn";
  const localBadgeTone = status?.terminal?.localOnly === false ? "warn" : "ok";

  const panel = (
    <section
      style={{
        border: "1px solid #1f2937",
        borderRadius: 14,
        background: "#07111f",
        padding: compact ? 12 : 16,
        display: "flex",
        flexDirection: "column",
        gap: 12,
        boxShadow: detached ? "0 18px 55px rgba(0,0,0,0.45)" : "none",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ color: "#8b9bb4", fontSize: 11, fontWeight: 800, letterSpacing: 0.8, textTransform: "uppercase" }}>
            Qflush
          </div>
          <h3 style={{ margin: "4px 0 0", color: "#e2e8f0", fontSize: 18 }}>Terminal portable</h3>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}>
          <button type="button" className="btn ghost" onClick={refreshStatus} disabled={loading} style={{ fontSize: 12 }}>
            Rafraichir
          </button>
          <button type="button" className="btn ghost" onClick={() => setDetached((value) => !value)} style={{ fontSize: 12 }}>
            {detached ? "Ancrer" : "Detacher"}
          </button>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <span style={badgeStyle(statusError ? "warn" : "ok")}>{statusError ? "Qflush indisponible" : "Qflush pret"}</span>
        <span style={badgeStyle(shellBadgeTone)}>Shell {status?.terminal?.shell === false ? "off" : "inconnu"}</span>
        <span style={badgeStyle(localBadgeTone)}>{status?.terminal?.localOnly === false ? "remote autorise" : "local only"}</span>
        <span style={badgeStyle("idle")}>Append-only bus</span>
      </div>

      {statusError ? (
        <div style={{
          padding: 10,
          borderRadius: 8,
          border: "1px solid #7f1d1d",
          background: "#2a0f0f",
          color: "#fecaca",
          fontSize: 12,
        }}>
          {statusError}
        </div>
      ) : null}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {QUICK_COMMANDS.map((item) => (
          <button
            key={item}
            type="button"
            className="btn ghost"
            onClick={() => run(item)}
            disabled={running || !!statusError}
            style={{ fontSize: 12 }}
          >
            {item}
          </button>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: compact ? "1fr" : "minmax(0, 1fr) auto", gap: 10 }}>
        <input
          value={command}
          onChange={(event) => setCommand(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              run();
            }
          }}
          disabled={running || !!statusError}
          placeholder="pad start"
          style={{
            minWidth: 0,
            borderRadius: 10,
            border: "1px solid #334155",
            background: "#020617",
            color: "#e2e8f0",
            padding: "10px 12px",
            fontSize: 13,
            fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace",
          }}
        />
        <button
          type="button"
          className="btn ghost"
          onClick={() => run()}
          disabled={running || !!statusError || !command.trim()}
          style={{ justifyContent: "center", minWidth: compact ? "auto" : 120 }}
        >
          {running ? "Envoi..." : "Executer"}
        </button>
      </div>

      <pre style={{
        margin: 0,
        minHeight: 170,
        maxHeight: detached ? 320 : 240,
        overflow: "auto",
        borderRadius: 10,
        border: "1px solid #1f2937",
        background: "#020617",
        color: entries[0]?.ok === false ? "#fecaca" : "#cbd5e1",
        padding: 12,
        fontSize: 12,
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
      }}>
        {entries[0] ? `$ ${entries[0].command}\n${lastOutput}` : lastOutput}
      </pre>

      {helpLines.length ? (
        <details style={{ color: "#94a3b8", fontSize: 12 }}>
          <summary style={{ cursor: "pointer", color: "#cbd5e1" }}>Commandes disponibles</summary>
          <pre style={{ margin: "8px 0 0", whiteSpace: "pre-wrap", color: "#94a3b8" }}>
            {helpLines.join("\n")}
          </pre>
        </details>
      ) : null}

      {entries.length > 1 ? (
        <div style={{ display: "grid", gap: 6 }}>
          {entries.slice(1, 6).map((entry) => (
            <button
              key={entry.id}
              type="button"
              className="btn ghost"
              onClick={() => setCommand(entry.command)}
              style={{
                justifyContent: "space-between",
                borderColor: entry.ok ? "#1f2937" : "#7f1d1d",
                color: entry.ok ? "#cbd5e1" : "#fecaca",
                fontSize: 12,
              }}
            >
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>$ {entry.command}</span>
              <span style={{ color: "#64748b", flexShrink: 0 }}>{new Date(entry.at).toLocaleTimeString()}</span>
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );

  if (!detached) return panel;

  return (
    <div style={{
      position: "fixed",
      right: compact ? 10 : 20,
      bottom: compact ? 10 : 20,
      width: compact ? "calc(100vw - 20px)" : 520,
      maxWidth: "calc(100vw - 24px)",
      zIndex: 120,
    }}>
      {panel}
    </div>
  );
}
