import React from "react";

type ConfirmModalProps = {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmTone?: "danger" | "primary";
  loading?: boolean;
  onConfirm: () => void;
  onClose: () => void;
};

export function ConfirmModal({
  open,
  title,
  message,
  confirmLabel = "Confirmer",
  cancelLabel = "Annuler",
  confirmTone = "primary",
  loading,
  onConfirm,
  onClose,
}: ConfirmModalProps) {
  if (!open) return null;

  const confirmStyle = confirmTone === "danger"
    ? { background: "#7f1d1d", color: "#fecaca", border: "1px solid #991b1b" }
    : { background: "#1d4ed8", color: "#dbeafe", border: "1px solid #2563eb" };

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
      onClick={() => {
        if (!loading) onClose();
      }}
    >
      <div
        style={{
          width: "min(420px, 100%)",
          borderRadius: 18,
          border: "1px solid #1f2937",
          background: "linear-gradient(180deg, #0f172a 0%, #0b1220 100%)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.45)",
          overflow: "hidden",
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <div style={{ padding: "16px 18px", borderBottom: "1px solid #1f2937" }}>
          <div style={{ color: "#e2e8f0", fontSize: 16, fontWeight: 700 }}>{title}</div>
        </div>
        <div style={{ padding: 18, color: "#cbd5e1", fontSize: 14, lineHeight: 1.6 }}>
          {message}
        </div>
        <div style={{ padding: "0 18px 18px 18px", display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button type="button" onClick={onClose} disabled={!!loading} className="btn ghost" style={{ minWidth: 96 }}>
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!!loading}
            className="btn"
            style={{ minWidth: 120, ...confirmStyle }}
          >
            {loading ? "En cours..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
