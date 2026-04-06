import React, { useEffect, useState } from "react";
import type { A11ConversationResource } from "../lib/api";

type EmailResourceModalProps = {
  resource: A11ConversationResource | null;
  open: boolean;
  submitting?: boolean;
  error?: string | null;
  onClose: () => void;
  onSubmit: (payload: {
    to: string;
    subject?: string;
    message?: string;
    attachToEmail: boolean;
  }) => void;
};

function buildDefaultSubject(resource: A11ConversationResource | null) {
  if (!resource) return "A11 — ressource";
  if (resource.resourceKind === "artifact") {
    const kind = String(resource.metadata?.kind || "").trim();
    return kind ? `A11 — artefact ${kind}` : `A11 — artefact ${resource.filename}`;
  }
  return `A11 — fichier ${resource.filename}`;
}

function buildDefaultMessage(resource: A11ConversationResource | null) {
  if (!resource) return "";
  const lines = ["Voici une ressource depuis A11."];
  if (resource.conversationId) lines.push(`Conversation: ${resource.conversationId}`);
  if (resource.metadata?.description) lines.push(`Description: ${String(resource.metadata.description)}`);
  return lines.join("\n\n");
}

export function EmailResourceModal({
  resource,
  open,
  submitting,
  error,
  onClose,
  onSubmit,
}: EmailResourceModalProps) {
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [attachToEmail, setAttachToEmail] = useState(true);

  useEffect(() => {
    if (!open || !resource) return;
    setTo("");
    setSubject(buildDefaultSubject(resource));
    setMessage(buildDefaultMessage(resource));
    setAttachToEmail(true);
  }, [open, resource]);

  if (!open || !resource) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(2, 6, 23, 0.76)",
        backdropFilter: "blur(8px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        zIndex: 1200,
      }}
      onClick={() => {
        if (!submitting) onClose();
      }}
    >
      <div
        style={{
          width: "min(560px, 100%)",
          borderRadius: 18,
          border: "1px solid #1f2937",
          background: "linear-gradient(180deg, #0f172a 0%, #0b1220 100%)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.45)",
          overflow: "hidden",
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <div style={{ padding: "16px 18px", borderBottom: "1px solid #1f2937" }}>
          <div style={{ color: "#e2e8f0", fontSize: 16, fontWeight: 700 }}>Envoyer par mail</div>
          <div style={{ color: "#94a3b8", fontSize: 12, marginTop: 4 }}>
            {resource.filename}
            {resource.conversationId ? ` · ${resource.conversationId}` : ""}
          </div>
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            const normalizedTo = to.trim();
            if (!normalizedTo) return;
            onSubmit({
              to: normalizedTo,
              subject: subject.trim() || undefined,
              message: message.trim() || undefined,
              attachToEmail,
            });
          }}
          style={{ padding: 18, display: "flex", flexDirection: "column", gap: 14 }}
        >
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ color: "#cbd5e1", fontSize: 12 }}>Destinataire</span>
            <input
              type="email"
              value={to}
              onChange={(event) => setTo(event.target.value)}
              placeholder="email@exemple.com"
              autoFocus
              disabled={!!submitting}
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
          </label>

          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ color: "#cbd5e1", fontSize: 12 }}>Sujet</span>
            <input
              type="text"
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              disabled={!!submitting}
              style={{
                width: "100%",
                borderRadius: 10,
                border: "1px solid #334155",
                background: "#0b1220",
                color: "#e2e8f0",
                padding: "12px 14px",
                fontSize: 14,
              }}
            />
          </label>

          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ color: "#cbd5e1", fontSize: 12 }}>Message</span>
            <textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              disabled={!!submitting}
              rows={5}
              style={{
                width: "100%",
                resize: "vertical",
                minHeight: 120,
                borderRadius: 12,
                border: "1px solid #334155",
                background: "#0b1220",
                color: "#e2e8f0",
                padding: "12px 14px",
                fontSize: 14,
                lineHeight: 1.5,
              }}
            />
          </label>

          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              color: "#cbd5e1",
              fontSize: 13,
              background: "#0b1220",
              border: "1px solid #1e293b",
              borderRadius: 10,
              padding: "10px 12px",
            }}
          >
            <input
              type="checkbox"
              checked={attachToEmail}
              onChange={(event) => setAttachToEmail(event.target.checked)}
              disabled={!!submitting}
            />
            Joindre le fichier au mail si disponible
          </label>

          {error ? (
            <div
              style={{
                borderRadius: 10,
                border: "1px solid #7f1d1d",
                background: "#2a0f0f",
                color: "#fecaca",
                padding: "10px 12px",
                fontSize: 12,
              }}
            >
              {error}
            </div>
          ) : null}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 4 }}>
            <button
              type="button"
              onClick={onClose}
              disabled={!!submitting}
              className="btn ghost"
              style={{ minWidth: 96 }}
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={!!submitting || !to.trim()}
              className="btn"
              style={{ minWidth: 120 }}
            >
              {submitting ? "Envoi..." : "Envoyer"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
