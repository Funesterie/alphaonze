import React, { useEffect, useMemo, useState } from "react";
import { executeShell, getWorkspaceRoot } from "../lib/a11fs";
import {
  fetchA11Capabilities,
  fetchA11HostStatus,
  type A11CapabilitiesResponse,
  type A11HostStatusResponse,
} from "../lib/api";

type A11CommandConsolePanelProps = {
  prefillCommand?: string | null;
  prefillReason?: string | null;
  prefillNonce?: number;
};

type ConsoleSnapshot = {
  status: A11HostStatusResponse | null;
  capabilities: A11CapabilitiesResponse | null;
  workspaceRoot: string;
};

type CommandRunEntry = {
  command: string;
  at: string;
  ok: boolean;
};

function pillStyle(active: boolean): React.CSSProperties {
  return {
    borderRadius: 999,
    padding: "5px 10px",
    fontSize: 12,
    border: `1px solid ${active ? "#14532d" : "#7f1d1d"}`,
    background: active ? "#052e1b" : "#2a0f0f",
    color: active ? "#bbf7d0" : "#fecaca",
  };
}

export function A11CommandConsolePanel({
  prefillCommand,
  prefillReason,
  prefillNonce,
}: A11CommandConsolePanelProps) {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [running, setRunning] = useState(false);
  const [command, setCommand] = useState("git status");
  const [output, setOutput] = useState("");
  const [error, setError] = useState("");
  const [errorTone, setErrorTone] = useState<"error" | "warning">("error");
  const [snapshot, setSnapshot] = useState<ConsoleSnapshot>({
    status: null,
    capabilities: null,
    workspaceRoot: "",
  });
  const [history, setHistory] = useState<CommandRunEntry[]>([]);

  async function loadMeta() {
    setError("");
    setErrorTone("error");
    setRefreshing(true);
    try {
      const [status, capabilities, workspaceRoot] = await Promise.all([
        fetchA11HostStatus(),
        fetchA11Capabilities(),
        getWorkspaceRoot().catch(() => ""),
      ]);
      setSnapshot({
        status,
        capabilities,
        workspaceRoot: String(workspaceRoot || "").trim(),
      });
    } catch (err: any) {
      setError(String(err?.message || err || "console_meta_failed"));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    loadMeta();
  }, []);

  useEffect(() => {
    const nextCommand = String(prefillCommand || "").trim();
    if (!nextCommand) return;
    setCommand(nextCommand);
    setOutput("");
    setError("");
    setErrorTone("error");
  }, [prefillCommand, prefillNonce]);

  const safeExamples = useMemo(() => {
    const statusExamples = snapshot.status?.shellPolicy?.defaultExamples || [];
    const capabilityExamples = snapshot.capabilities?.a11host?.shellPolicy?.defaultExamples || [];
    const extraPrefixes = snapshot.status?.shellPolicy?.extraPrefixes || snapshot.capabilities?.a11host?.shellPolicy?.extraPrefixes || [];
    const unavailableExamples =
      snapshot.status?.shellRuntime?.unavailableExamples ||
      snapshot.capabilities?.a11host?.shellRuntime?.unavailableExamples ||
      [];
    return Array.from(new Set([...statusExamples, ...capabilityExamples, ...extraPrefixes]))
      .filter(Boolean)
      .filter((example) => !unavailableExamples.includes(example))
      .slice(0, 8);
  }, [snapshot]);

  const unavailableTools = useMemo(() => {
    return (
      snapshot.status?.shellRuntime?.unavailableTools ||
      snapshot.capabilities?.a11host?.shellRuntime?.unavailableTools ||
      []
    ).filter(Boolean);
  }, [snapshot]);

  const shellPlatform =
    snapshot.status?.shellRuntime?.platform ||
    snapshot.capabilities?.a11host?.shellRuntime?.platform ||
    "—";

  const executeShellAvailable =
    !!snapshot.status?.capabilities?.executeShell ||
    !!snapshot.capabilities?.a11host?.capabilities?.executeShell;

  async function runCommand(nextCommand?: string) {
    const raw = String(nextCommand ?? command).trim();
    if (!raw || running) return;

    setRunning(true);
    setError("");
    setErrorTone("error");
    setCommand(raw);

    try {
      const shellResult = await executeShell(raw);
      const normalizedOutput = String(
        shellResult.output ||
        [shellResult.stdout, shellResult.stderr].filter(Boolean).join("\n")
      ).trim();
      const exitCode = Number.isFinite(shellResult.exitCode) ? Number(shellResult.exitCode) : 0;
      const unavailable = shellResult.unavailable === true;
      const failed = shellResult.ok === false || exitCode !== 0;
      if (failed) {
        setErrorTone(unavailable ? "warning" : "error");
        setError(
          String(
            shellResult.message ||
            normalizedOutput ||
            "shell_exec_failed"
          )
        );
        setOutput(normalizedOutput || "Aucune sortie exploitable.");
        setHistory((prev) => [
          { command: raw, at: new Date().toISOString(), ok: false },
          ...prev.filter((entry) => entry.command !== raw),
        ].slice(0, 8));
        return;
      }

      setOutput(normalizedOutput || "(commande executee sans sortie)");
      setHistory((prev) => [
        { command: raw, at: new Date().toISOString(), ok: true },
        ...prev.filter((entry) => entry.command !== raw),
      ].slice(0, 8));
    } catch (err: any) {
      const message = String(err?.message || err || "shell_exec_failed");
      setErrorTone("error");
      setError(message);
      setOutput("");
      setHistory((prev) => [
        { command: raw, at: new Date().toISOString(), ok: false },
        ...prev.filter((entry) => entry.command !== raw),
      ].slice(0, 8));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div
      style={{
        border: "1px solid #1f2937",
        borderRadius: 14,
        background: "#0b1220",
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h3 style={{ margin: 0, color: "#e2e8f0", fontSize: 18 }}>Console A11</h3>
          <p style={{ color: "#94a3b8", margin: "6px 0 0", maxWidth: 760 }}>
            Equivalent terminal, mais garde-fou: seules les commandes autorisees par la whitelist backend peuvent passer.
          </p>
        </div>
        <button type="button" onClick={loadMeta} disabled={refreshing} className="btn ghost" style={{ fontSize: 12 }}>
          {refreshing ? "Actualisation..." : "Rafraichir"}
        </button>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <span style={pillStyle(!!executeShellAvailable)}>Shell {executeShellAvailable ? "disponible" : "indisponible"}</span>
        <span style={pillStyle(!!snapshot.status?.bridgeAvailable)}>VSIX {snapshot.status?.bridgeAvailable ? "connecte" : "absent"}</span>
        <span style={pillStyle(!!snapshot.status?.headlessAvailable)}>Headless {snapshot.status?.headlessAvailable ? "actif" : "off"}</span>
      </div>

      <div style={{ display: "grid", gap: 6, color: "#cbd5e1", fontSize: 12 }}>
        <div>Workspace: {snapshot.workspaceRoot || snapshot.status?.workspaceRoot || "—"}</div>
        <div>Shell cwd: {snapshot.capabilities?.a11host?.shellCwd || "—"}</div>
        <div>Runtime shell: {shellPlatform}</div>
        <div>Build command: {snapshot.capabilities?.a11host?.buildCommand || "—"}</div>
        {unavailableTools.length ? (
          <div style={{ color: "#fcd34d" }}>Outils indisponibles sur ce runtime: {unavailableTools.join(", ")}</div>
        ) : null}
      </div>

      {prefillReason ? (
        <div
          style={{
            padding: 10,
            borderRadius: 8,
            border: "1px solid #1e3a8a",
            background: "#0f172a",
            color: "#bfdbfe",
            fontSize: 12,
          }}
        >
          Suggestion A11: {prefillReason}
        </div>
      ) : null}

      {safeExamples.length ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#8b9bb4", textTransform: "uppercase", letterSpacing: 0.8 }}>
            Commandes rapides
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {safeExamples.map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => runCommand(example)}
                disabled={!executeShellAvailable || running}
                className="btn ghost"
                style={{ fontSize: 12 }}
              >
                {example}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) auto",
          gap: 10,
          alignItems: "stretch",
        }}
      >
        <input
          type="text"
          value={command}
          onChange={(event) => setCommand(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              runCommand();
            }
          }}
          placeholder="git status"
          disabled={!executeShellAvailable || running || loading}
          style={{
            borderRadius: 10,
            border: "1px solid #334155",
            background: "#08101d",
            color: "#e2e8f0",
            padding: "10px 12px",
            fontSize: 13,
            minWidth: 0,
          }}
        />
        <button
          type="button"
          onClick={() => runCommand()}
          disabled={!executeShellAvailable || running || !command.trim() || loading}
          className="btn ghost"
          style={{ minWidth: 120, justifyContent: "center" }}
        >
          {running ? "Execution..." : "Executer"}
        </button>
      </div>

      {error ? (
        <div
          style={{
            padding: 10,
            borderRadius: 8,
            border: errorTone === "warning" ? "1px solid #854d0e" : "1px solid #7f1d1d",
            background: errorTone === "warning" ? "#2b1d06" : "#2a0f0f",
            color: errorTone === "warning" ? "#fde68a" : "#fecaca",
            fontSize: 12,
            whiteSpace: "pre-wrap",
          }}
        >
          {error}
        </div>
      ) : null}

      <div>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#8b9bb4", textTransform: "uppercase", letterSpacing: 0.8 }}>
          Sortie
        </div>
        <pre
          style={{
            marginTop: 8,
            minHeight: 180,
            maxHeight: 360,
            overflow: "auto",
            padding: 12,
            borderRadius: 10,
            border: "1px solid #1f2937",
            background: "#020617",
            color: "#cbd5e1",
            fontSize: 12,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {loading ? "Chargement de la console..." : (output || "Aucune commande executee pour le moment.")}
        </pre>
      </div>

      {history.length ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#8b9bb4", textTransform: "uppercase", letterSpacing: 0.8 }}>
            Historique rapide
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            {history.map((entry) => (
              <button
                key={`${entry.command}-${entry.at}`}
                type="button"
                onClick={() => runCommand(entry.command)}
                className="btn ghost"
                style={{
                  justifyContent: "space-between",
                  width: "100%",
                  color: entry.ok ? "#cbd5e1" : "#fecaca",
                  borderColor: entry.ok ? "#1f2937" : "#7f1d1d",
                }}
              >
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entry.command}</span>
                <span style={{ fontSize: 11, color: "#94a3b8", flexShrink: 0 }}>{new Date(entry.at).toLocaleTimeString()}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
