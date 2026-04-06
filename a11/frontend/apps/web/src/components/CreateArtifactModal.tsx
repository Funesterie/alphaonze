import React, { useEffect, useMemo, useState } from "react";

type ArtifactFormat = "markdown" | "text" | "json";

type CreateArtifactModalProps = {
  open: boolean;
  submitting?: boolean;
  error?: string | null;
  conversationId?: string | null;
  messageCount?: number;
  onClose: () => void;
  onSubmit: (payload: {
    format: ArtifactFormat;
    filename: string;
    description?: string;
    openEmailAfterCreate: boolean;
    downloadAfterCreate: boolean;
  }) => void;
};

function slugifyConversationId(value: string | null | undefined) {
  const normalized = String(value || "conversation")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "conversation";
}

function getExtension(format: ArtifactFormat) {
  if (format === "markdown") return "md";
  if (format === "json") return "json";
  return "txt";
}

function buildDefaultFilename(conversationId: string | null | undefined, format: ArtifactFormat) {
  const today = new Date().toISOString().slice(0, 10);
  return `a11-${slugifyConversationId(conversationId)}-${today}.${getExtension(format)}`;
}

export function CreateArtifactModal({
  open,
  submitting,
  error,
  conversationId,
  messageCount,
  onClose,
  onSubmit,
}: CreateArtifactModalProps) {
  const [format, setFormat] = useState<ArtifactFormat>("markdown");
  const [filename, setFilename] = useState("");
  const [description, setDescription] = useState("");
  const [openEmailAfterCreate, setOpenEmailAfterCreate] = useState(false);
  const [downloadAfterCreate, setDownloadAfterCreate] = useState(false);

  const suggestedFilename = useMemo(
    () => buildDefaultFilename(conversationId, format),
    [conversationId, format]
  );

  useEffect(() => {
    if (!open) return;
    setFormat("markdown");
    setFilename(buildDefaultFilename(conversationId, "markdown"));
    setDescription(conversationId ? `Export de la conversation ${conversationId}` : "Export de conversation A11");
    setOpenEmailAfterCreate(false);
    setDownloadAfterCreate(false);
  }, [open, conversationId]);

  useEffect(() => {
    if (!open) return;
    setFilename((current) => {
      if (!current.trim() || current === suggestedFilename || /\.(md|txt|json)$/i.test(current)) {
        const stem = current.replace(/\.(md|txt|json)$/i, "").trim();
        if (!stem || current === suggestedFilename) return suggestedFilename;
        return `${stem}.${getExtension(format)}`;
      }
      return current;
    });
  }, [format, open, suggestedFilename]);

  if (!open) return null;

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
          <div style={{ color: "#e2e8f0", fontSize: 16, fontWeight: 700 }}>Creer un artefact</div>
          <div style={{ color: "#94a3b8", fontSize: 12, marginTop: 4 }}>
            {conversationId ? `Conversation: ${conversationId}` : "Conversation active"}
            {typeof messageCount === "number" ? ` · ${messageCount} message(s)` : ""}
          </div>
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            const normalizedFilename = filename.trim();
            if (!normalizedFilename) return;
            onSubmit({
              format,
              filename: normalizedFilename,
              description: description.trim() || undefined,
              openEmailAfterCreate,
              downloadAfterCreate,
            });
          }}
          style={{ padding: 18, display: "flex", flexDirection: "column", gap: 14 }}
        >
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ color: "#cbd5e1", fontSize: 12 }}>Format</span>
            <select
              value={format}
              onChange={(event) => setFormat(event.target.value as ArtifactFormat)}
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
            >
              <option value="markdown">Markdown</option>
              <option value="text">Texte brut</option>
              <option value="json">JSON</option>
            </select>
          </label>

          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ color: "#cbd5e1", fontSize: 12 }}>Nom de fichier</span>
            <input
              type="text"
              value={filename}
              onChange={(event) => setFilename(event.target.value)}
              placeholder={suggestedFilename}
              autoFocus
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
            <span style={{ color: "#cbd5e1", fontSize: 12 }}>Description</span>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              disabled={!!submitting}
              rows={3}
              style={{
                width: "100%",
                resize: "vertical",
                minHeight: 92,
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
              checked={openEmailAfterCreate}
              onChange={(event) => setOpenEmailAfterCreate(event.target.checked)}
              disabled={!!submitting}
            />
            Ouvrir l'envoi mail juste apres creation
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
              checked={downloadAfterCreate}
              onChange={(event) => setDownloadAfterCreate(event.target.checked)}
              disabled={!!submitting}
            />
            Telecharger le document juste apres creation
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
              disabled={!!submitting || !filename.trim()}
              className="btn"
              style={{ minWidth: 128 }}
            >
              {submitting ? "Creation..." : "Creer l'artefact"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
