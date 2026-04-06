import React from "react";
import type { A11ConversationActivityEntry } from "../lib/api";

type ConversationActivityPanelProps = {
  conversationId?: string | null;
  entries: A11ConversationActivityEntry[];
  loading?: boolean;
  error?: string | null;
  onRefresh?: () => void;
};

function getToneStyle(tone?: string) {
  switch (tone) {
    case "mail":
      return {
        border: "#1d4ed8",
        background: "#0b1220",
        color: "#bfdbfe",
        badge: "#93c5fd",
      };
    case "artifact":
      return {
        border: "#854d0e",
        background: "#1c1917",
        color: "#fde68a",
        badge: "#fbbf24",
      };
    case "file":
      return {
        border: "#0f766e",
        background: "#071b1a",
        color: "#99f6e4",
        badge: "#5eead4",
      };
    case "agent":
      return {
        border: "#4338ca",
        background: "#0f1025",
        color: "#c7d2fe",
        badge: "#a5b4fc",
      };
    case "chat":
      return {
        border: "#334155",
        background: "#0f172a",
        color: "#e2e8f0",
        badge: "#cbd5e1",
      };
    default:
      return {
        border: "#334155",
        background: "#0b1220",
        color: "#cbd5e1",
        badge: "#94a3b8",
      };
  }
}

export function ConversationActivityPanel({
  conversationId,
  entries,
  loading,
  error,
  onRefresh,
}: ConversationActivityPanelProps) {
  return (
    <section
      style={{
        borderBottom: "1px solid #1f2937",
        background: "linear-gradient(180deg, #0d1524 0%, #09111d 100%)",
        padding: "12px 16px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div style={{ color: "#e5e7eb", fontSize: 13, fontWeight: 700 }}>Activite recente</div>
          <div style={{ color: "#94a3b8", fontSize: 12 }}>
            {conversationId ? `Conversation: ${conversationId}` : "Aucune conversation active"}
          </div>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={!conversationId || !!loading}
          className="btn ghost"
          style={{ fontSize: 12, opacity: !conversationId || loading ? 0.6 : 1 }}
        >
          {loading ? "Chargement..." : "Rafraichir"}
        </button>
      </div>

      {error ? (
        <div
          style={{
            marginTop: 10,
            padding: "8px 10px",
            borderRadius: 8,
            background: "#2a0f0f",
            border: "1px solid #7f1d1d",
            color: "#fecaca",
            fontSize: 12,
          }}
        >
          {error}
        </div>
      ) : null}

      {!error && !loading && conversationId && entries.length === 0 ? (
        <div style={{ marginTop: 10, color: "#94a3b8", fontSize: 12 }}>
          Aucune action recente tracee pour cette conversation.
        </div>
      ) : null}

      {!!entries.length && (
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
          {entries.map((entry) => {
            const tone = getToneStyle(entry.tone);
            return (
              <div
                key={entry.id}
                style={{
                  border: `1px solid ${tone.border}`,
                  background: tone.background,
                  borderRadius: 12,
                  padding: "10px 12px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        letterSpacing: 0.5,
                        textTransform: "uppercase",
                        color: tone.badge,
                        flexShrink: 0,
                      }}
                    >
                      {entry.type.replaceAll("_", " ")}
                    </span>
                    <span
                      style={{
                        color: tone.color,
                        fontSize: 13,
                        fontWeight: 600,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {entry.title}
                    </span>
                  </div>
                  <span style={{ color: "#64748b", fontSize: 11, flexShrink: 0 }}>
                    {entry.ts ? new Date(entry.ts).toLocaleString() : ""}
                  </span>
                </div>

                <div style={{ color: "#e2e8f0", fontSize: 12, lineHeight: 1.5 }}>
                  {entry.summary}
                </div>

                {entry.detail ? (
                  <div style={{ color: "#94a3b8", fontSize: 11, lineHeight: 1.5 }}>
                    {entry.detail}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
