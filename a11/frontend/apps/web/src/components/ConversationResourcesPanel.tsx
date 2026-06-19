import React, { useEffect, useState } from "react";
import { loadProtectedResourceObjectUrl, type A11ConversationResource } from "../lib/api";

type ConversationResourcesPanelProps = {
  conversationId?: string | null;
  resources: A11ConversationResource[];
  loading?: boolean;
  creatingArtifact?: boolean;
  error?: string | null;
  uploadFeedback?: string | null;
  onRefresh?: () => void;
  onCreateArtifact?: () => void;
  onDownloadResource?: (resource: A11ConversationResource) => void;
  onEmailResource?: (resource: A11ConversationResource) => void;
  downloadingResourceId?: number | null;
  emailingResourceId?: number | null;
};

function formatFileSize(sizeBytes?: number) {
  const value = Number(sizeBytes || 0);
  if (!value) return "taille inconnue";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function getKindLabel(resource: A11ConversationResource) {
  if (resource.resourceKind === "artifact") {
    return resource.metadata?.kind ? `Artefact ${resource.metadata.kind}` : "Artefact";
  }
  return "Fichier";
}

function getResourcePreview(resource: A11ConversationResource) {
  const preview = String(resource.metadata?.analysis?.preview || "").trim();
  if (!preview) return "";
  if (preview.length <= 220) return preview;
  return `${preview.slice(0, 219).trimEnd()}…`;
}

function getResourceMetaLine(resource: A11ConversationResource) {
  const analysis = resource.metadata?.analysis || {};
  const parts: string[] = [];
  if (analysis.parser) parts.push(String(analysis.parser));
  if (analysis.width && analysis.height) parts.push(`${analysis.width}x${analysis.height}`);
  if (analysis.note) parts.push(String(analysis.note));
  return parts.join(" · ");
}

function resourceLooksLikeImage(resource: A11ConversationResource) {
  const contentType = String(resource.contentType || "").toLowerCase();
  const filename = String(resource.filename || "").toLowerCase();
  return contentType.startsWith("image/")
    || /\.(png|jpe?g|gif|webp|bmp|svg)$/.test(filename);
}

// Loads the image through the authenticated `/api/resources/:id/download`
// endpoint as a blob object URL, so previews never rely on a public
// `?token=secret://...` link (which 401s) and no token is exposed in the DOM.
function ResourceImagePreview({ resource }: { resource: A11ConversationResource }) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const resourceId = typeof resource.id === "number" ? resource.id : null;

  useEffect(() => {
    if (!resourceId || !resourceLooksLikeImage(resource)) {
      setObjectUrl(null);
      return;
    }
    let active = true;
    let createdUrl: string | null = null;
    void loadProtectedResourceObjectUrl(resourceId).then((url) => {
      if (!active) {
        if (url) URL.revokeObjectURL(url);
        return;
      }
      createdUrl = url;
      setObjectUrl(url);
    });
    return () => {
      active = false;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [resourceId, resource.contentType, resource.filename]);

  if (!objectUrl) return null;
  return (
    <div
      style={{
        borderRadius: 10,
        overflow: "hidden",
        border: "1px solid #1e293b",
        background: "#020617",
      }}
    >
      <img
        src={objectUrl}
        alt={resource.filename}
        style={{
          display: "block",
          width: "100%",
          maxHeight: 200,
          objectFit: "cover",
        }}
      />
    </div>
  );
}

function getLastEmailInfo(resource: A11ConversationResource) {
  const lastEmail = resource.metadata?.lastEmail;
  if (!lastEmail || typeof lastEmail !== "object") return null;
  const to = String(lastEmail.to || "").trim();
  const attached = !!lastEmail.attached;
  const mailedAt = String(resource.metadata?.lastEmailedAt || "").trim();
  return {
    to,
    attached,
    mailedAt,
  };
}

export function ConversationResourcesPanel({
  conversationId,
  resources,
  loading,
  creatingArtifact,
  error,
  uploadFeedback,
  onRefresh,
  onCreateArtifact,
  onDownloadResource,
  downloadingResourceId,
  onEmailResource,
  emailingResourceId,
}: ConversationResourcesPanelProps) {
  return (
    <section
      style={{
        borderBottom: "1px solid #1f2937",
        background: "linear-gradient(180deg, #0b1220 0%, #0a101a 100%)",
        padding: "12px 16px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div style={{ color: "#e5e7eb", fontSize: 13, fontWeight: 700 }}>Ressources de conversation</div>
          <div style={{ color: "#94a3b8", fontSize: 12 }}>
            {conversationId ? `Conversation: ${conversationId}` : "Aucune conversation active"}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            type="button"
            onClick={onCreateArtifact}
            disabled={!conversationId || !!creatingArtifact}
            className="btn"
            style={{ fontSize: 12, opacity: !conversationId || creatingArtifact ? 0.6 : 1 }}
          >
            {creatingArtifact ? "Creation..." : "Exporter"}
          </button>
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
      </div>

      {uploadFeedback && (
        <div
          style={{
            marginTop: 10,
            padding: "8px 10px",
            borderRadius: 8,
            background: "#0f172a",
            border: "1px solid #1e3a8a",
            color: "#bfdbfe",
            fontSize: 12,
          }}
        >
          {uploadFeedback}
        </div>
      )}

      {error && (
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
      )}

      {!error && !loading && conversationId && resources.length === 0 && (
        <div style={{ marginTop: 10, color: "#94a3b8", fontSize: 12 }}>
          Aucun fichier ou artefact rattache a cette conversation pour le moment.
        </div>
      )}

      {!!resources.length && (
        <div
          style={{
            marginTop: 12,
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 10,
          }}
        >
          {resources.map((resource, index) => {
            const preview = getResourcePreview(resource);
            const metaLine = getResourceMetaLine(resource);
            const lastEmail = getLastEmailInfo(resource);

            return (
              <div
                key={`${resource.storageKey || resource.url || resource.filename}-${index}`}
                style={{
                  border: "1px solid #1f2937",
                  borderRadius: 12,
                  padding: 12,
                  background: "#0f172a",
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                  <span
                    style={{
                      fontSize: 11,
                      color: resource.resourceKind === "artifact" ? "#fbbf24" : "#67e8f9",
                      textTransform: "uppercase",
                      letterSpacing: 0.6,
                      fontWeight: 700,
                    }}
                  >
                    {getKindLabel(resource)}
                  </span>
                  <span style={{ fontSize: 11, color: "#64748b" }}>
                    {formatFileSize(resource.sizeBytes)}
                  </span>
                </div>

                <div style={{ color: "#e2e8f0", fontSize: 13, fontWeight: 600, wordBreak: "break-word" }}>
                  {resource.filename}
                </div>

                <div style={{ color: "#94a3b8", fontSize: 12 }}>
                  {resource.contentType || "application/octet-stream"}
                </div>

                {metaLine && (
                  <div style={{ color: "#64748b", fontSize: 11 }}>
                    {metaLine}
                  </div>
                )}

                <ResourceImagePreview resource={resource} />

                {preview && (
                  <pre
                    style={{
                      margin: 0,
                      padding: 10,
                      borderRadius: 8,
                      background: "#0b1220",
                      border: "1px solid #1e293b",
                      color: "#cbd5e1",
                      fontSize: 11,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                    }}
                  >
                    {preview}
                  </pre>
                )}

                {resource.metadata?.description && (
                  <div style={{ color: "#cbd5e1", fontSize: 12 }}>
                    {String(resource.metadata.description)}
                  </div>
                )}

                {lastEmail ? (
                  <div
                    style={{
                      borderRadius: 8,
                      border: "1px solid #1d4ed8",
                      background: "#0b1220",
                      color: "#bfdbfe",
                      padding: "8px 10px",
                      fontSize: 11,
                      lineHeight: 1.5,
                    }}
                  >
                    {`Envoye par mail${lastEmail.to ? ` a ${lastEmail.to}` : ""}${lastEmail.attached ? " avec piece jointe" : " avec lien"}.`}
                    {lastEmail.mailedAt ? ` ${new Date(String(lastEmail.mailedAt)).toLocaleString()}` : ""}
                  </div>
                ) : null}

                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginTop: "auto" }}>
                  <span style={{ color: "#64748b", fontSize: 11 }}>
                    {resource.updatedAt ? new Date(resource.updatedAt).toLocaleString() : ""}
                  </span>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    {typeof resource.id === "number" && onDownloadResource ? (
                      <button
                        type="button"
                        onClick={() => onDownloadResource(resource)}
                        className="btn ghost"
                        style={{ fontSize: 11, padding: "4px 8px" }}
                        disabled={downloadingResourceId === resource.id}
                      >
                        {downloadingResourceId === resource.id ? "Telechargement..." : "Telecharger"}
                      </button>
                    ) : null}
                    {typeof resource.id === "number" && onEmailResource ? (
                      <button
                        type="button"
                        onClick={() => onEmailResource(resource)}
                        className="btn ghost"
                        style={{ fontSize: 11, padding: "4px 8px" }}
                        disabled={emailingResourceId === resource.id}
                      >
                        {emailingResourceId === resource.id ? "Envoi..." : "Mail"}
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
