import React, { useState } from "react";
import {
  getActiveDocument,
  getCompilationErrors,
  getCurrentSelection,
  getOpenDocuments,
  getProjectStructure,
  getSolutionInfo,
  getWorkspaceRoot,
} from "../lib/a11fs";

type DebugTarget =
  | "workspaceRoot"
  | "solutionInfo"
  | "activeDocument"
  | "currentSelection"
  | "openDocuments"
  | "compilationErrors"
  | "projectStructure";

type DebugState = {
  loading: DebugTarget | null;
  error: string;
  result: unknown;
  label: string;
};

const BUTTON_STYLE: React.CSSProperties = {
  padding: "8px 12px",
  borderRadius: 8,
  border: "1px solid #334155",
  background: "#111827",
  color: "#e2e8f0",
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 600,
};

function prettyPrint(value: unknown) {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function A11VsixDebugPanel() {
  const [state, setState] = useState<DebugState>({
    loading: null,
    error: "",
    result: null,
    label: "Aucune requête lancée.",
  });

  async function run(target: DebugTarget, label: string, task: () => Promise<unknown>) {
    setState((prev) => ({
      ...prev,
      loading: target,
      error: "",
      label,
    }));

    try {
      const result = await task();
      setState({
        loading: null,
        error: "",
        result,
        label,
      });
    } catch (err: any) {
      setState({
        loading: null,
        error: String(err?.message || err || "vsix_debug_failed"),
        result: null,
        label,
      });
    }
  }

  return (
    <div
      style={{
        marginTop: 16,
        border: "1px solid #1f2937",
        borderRadius: 10,
        background: "#0b1220",
        padding: 14,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h4 style={{ margin: 0, color: "#e2e8f0", fontSize: 15 }}>Debug VSIX / A11Host</h4>
          <div style={{ marginTop: 4, color: "#94a3b8", fontSize: 12 }}>
            Tests lecture seule pour vérifier ce qui remonte depuis Visual Studio ou le backend sécurisé.
          </div>
        </div>
        <div style={{ color: "#94a3b8", fontSize: 12 }}>
          Requête active: {state.loading ? state.loading : "aucune"}
        </div>
      </div>

      <div
        style={{
          marginTop: 12,
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        <button
          type="button"
          style={BUTTON_STYLE}
          onClick={() => run("workspaceRoot", "Workspace root", () => getWorkspaceRoot())}
        >
          Workspace root
        </button>
        <button
          type="button"
          style={BUTTON_STYLE}
          onClick={() => run("solutionInfo", "Solution info", () => getSolutionInfo())}
        >
          Solution info
        </button>
        <button
          type="button"
          style={BUTTON_STYLE}
          onClick={() => run("activeDocument", "Document actif", () => getActiveDocument())}
        >
          Document actif
        </button>
        <button
          type="button"
          style={BUTTON_STYLE}
          onClick={() => run("currentSelection", "Selection courante", () => getCurrentSelection())}
        >
          Selection
        </button>
        <button
          type="button"
          style={BUTTON_STYLE}
          onClick={() => run("openDocuments", "Documents ouverts", () => getOpenDocuments())}
        >
          Open docs
        </button>
        <button
          type="button"
          style={BUTTON_STYLE}
          onClick={() => run("compilationErrors", "Erreurs de compilation", () => getCompilationErrors())}
        >
          Compilation
        </button>
        <button
          type="button"
          style={BUTTON_STYLE}
          onClick={() => run("projectStructure", "Structure projet", () => getProjectStructure())}
        >
          Projet
        </button>
      </div>

      <div style={{ marginTop: 14, color: "#cbd5e1", fontSize: 12 }}>
        <strong style={{ color: "#e2e8f0" }}>{state.label}</strong>
      </div>

      {state.error ? (
        <div
          style={{
            marginTop: 10,
            padding: 10,
            borderRadius: 8,
            border: "1px solid #7f1d1d",
            background: "#2a0f0f",
            color: "#fecaca",
            fontSize: 12,
            whiteSpace: "pre-wrap",
          }}
        >
          {state.error}
        </div>
      ) : (
        <pre
          style={{
            marginTop: 10,
            padding: 12,
            borderRadius: 8,
            border: "1px solid #1f2937",
            background: "#111827",
            color: "#cbd5e1",
            fontSize: 12,
            overflowX: "auto",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            minHeight: 120,
          }}
        >
          {state.result === null ? "Aucun résultat pour le moment." : prettyPrint(state.result)}
        </pre>
      )}
    </div>
  );
}
