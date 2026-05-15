import React from "react";
import type { A11HistoryItem } from "../lib/api";

type A11HistoryPanelProps = {
  items: A11HistoryItem[];
  activeId?: string | null;
  onSelect: (id: string) => void;
  onDelete?: (id: string) => void;
  deletingId?: string | null;
};

export function A11HistoryPanel({ items, activeId, onSelect, onDelete, deletingId }: A11HistoryPanelProps) {
  return (
    <div>
      {items.map((item) => (
        <div
          key={item.id}
          role="button"
          tabIndex={0}
          style={{
            padding: 8,
            background: item.id === activeId ? "#22293a" : "transparent",
            cursor: "pointer",
            borderRadius: 6,
            marginBottom: 2,
          }}
          onClick={() => onSelect(item.id)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            onSelect(item.id);
          }}
        >
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {item.name || item.id}
              </div>
              <div style={{ fontSize: 11, color: "#888" }}>
                {item.updated ? new Date(item.updated).toLocaleString() : ""}
                {typeof item.messageCount === "number" ? ` - ${item.messageCount} msg` : ""}
              </div>
            </div>
            {onDelete ? (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onDelete(item.id);
                }}
                title="Supprimer cette conversation de l'historique A11"
                style={{
                  padding: "4px 8px",
                  minWidth: 44,
                  minHeight: 36,
                  borderRadius: 8,
                  border: "1px solid #7f1d1d",
                  background: "transparent",
                  color: "#fca5a5",
                  cursor: "pointer",
                  fontSize: 11,
                  fontWeight: 700,
                  flexShrink: 0,
                  opacity: deletingId === item.id ? 0.7 : 1,
                }}
                disabled={deletingId === item.id}
              >
                {deletingId === item.id ? "..." : "Suppr."}
              </button>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}
