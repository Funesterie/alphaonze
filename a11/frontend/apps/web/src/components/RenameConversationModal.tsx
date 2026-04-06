import React, { useEffect, useState } from "react";

type RenameConversationModalProps = {
  open: boolean;
  currentName: string;
  onClose: () => void;
  onSubmit: (name: string) => void;
};

export function RenameConversationModal({
  open,
  currentName,
  onClose,
  onSubmit,
}: RenameConversationModalProps) {
  const [value, setValue] = useState(currentName);

  useEffect(() => {
    if (!open) return;
    setValue(currentName);
  }, [open, currentName]);

  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(2, 6, 23, 0.74)",
        backdropFilter: "blur(8px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        zIndex: 1180,
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: "min(460px, 100%)",
          borderRadius: 18,
          border: "1px solid #1f2937",
          background: "linear-gradient(180deg, #0f172a 0%, #0b1220 100%)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.45)",
          overflow: "hidden",
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <div style={{ padding: "16px 18px", borderBottom: "1px solid #1f2937" }}>
          <div style={{ color: "#e2e8f0", fontSize: 16, fontWeight: 700 }}>Renommer la conversation</div>
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const normalized = value.trim();
            if (!normalized) return;
            onSubmit(normalized);
          }}
          style={{ padding: 18, display: "flex", flexDirection: "column", gap: 14 }}
        >
          <input
            type="text"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            autoFocus
            placeholder="Nom de la conversation"
            style={{
              width: "100%",
              borderRadius: 10,
              border: "1px solid #334155",
              background: "#0b1220",
              color: "#e2e8f0",
              padding: "12px 14px",
              fontSize: 16,
            }}
          />
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
            <button type="button" onClick={onClose} className="btn ghost" style={{ minWidth: 96 }}>
              Annuler
            </button>
            <button type="submit" disabled={!value.trim()} className="btn" style={{ minWidth: 120 }}>
              Renommer
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
