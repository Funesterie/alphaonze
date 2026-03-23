import React from "react";

export function A11HistoryPanel({ items, activeId, onSelect }) {
  return (
    <div>
      {items.map((item) => (
        <div
          key={item.id}
          style={{
            padding: 8,
            background: item.id === activeId ? "#22293a" : "transparent",
            cursor: "pointer",
            borderRadius: 6,
            marginBottom: 2,
          }}
          onClick={() => onSelect(item.id)}
        >
          <div style={{ fontWeight: 600 }}>{item.name || item.id}</div>
          <div style={{ fontSize: 11, color: "#888" }}>
            {item.updated ? new Date(item.updated).toLocaleString() : ""}
          </div>
        </div>
      ))}
    </div>
  );
}
