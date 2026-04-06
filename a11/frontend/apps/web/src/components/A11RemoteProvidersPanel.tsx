import React, { useMemo, useState } from "react";
import type { RemoteProviderProfile } from "../lib/api";

type RemoteProviderDraft = {
  label: string;
  baseUrl: string;
  model: string;
  apiKey: string;
};

type Props = {
  profiles: RemoteProviderProfile[];
  loading: boolean;
  saving: boolean;
  deletingId: string | null;
  error?: string;
  selectedProfileId?: string | null;
  onRefresh: () => void;
  onSave: (draft: RemoteProviderDraft) => Promise<void> | void;
  onDelete: (profileId: string) => Promise<void> | void;
  onSelect: (profileId: string) => void;
};

const emptyDraft: RemoteProviderDraft = {
  label: "",
  baseUrl: "",
  model: "",
  apiKey: "",
};

export function A11RemoteProvidersPanel({
  profiles,
  loading,
  saving,
  deletingId,
  error,
  selectedProfileId,
  onRefresh,
  onSave,
  onDelete,
  onSelect,
}: Props) {
  const [draft, setDraft] = useState<RemoteProviderDraft>(emptyDraft);
  const [feedback, setFeedback] = useState("");

  const hasProfiles = profiles.length > 0;
  const selectedLabel = useMemo(
    () => profiles.find((entry) => entry.id === selectedProfileId)?.label || "",
    [profiles, selectedProfileId]
  );

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback("");
    await onSave(draft);
    setDraft(emptyDraft);
    setFeedback("Profil ajoute. Il est maintenant selectionnable dans le menu modele.");
  }

  return (
    <section style={{ display: "grid", gap: 18 }}>
      <div
        style={{
          border: "1px solid #1f2937",
          borderRadius: 18,
          background: "#0b1220",
          padding: 18,
          display: "grid",
          gap: 14,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, color: "#f8fafc" }}>Profils IA distants</div>
            <div style={{ color: "#94a3b8", fontSize: 14 }}>
              Ajoute plusieurs fournisseurs compatibles OpenAI, puis choisis-les directement dans le chat A11.
            </div>
          </div>
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="btn ghost"
            style={{ minWidth: 120 }}
          >
            {loading ? "Actualisation..." : "Actualiser"}
          </button>
        </div>

        <form onSubmit={(event) => void handleSubmit(event)} style={{ display: "grid", gap: 12 }}>
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ color: "#cbd5e1", fontSize: 13, fontWeight: 700 }}>Nom du profil</span>
              <input
                value={draft.label}
                onChange={(event) => setDraft((prev) => ({ ...prev, label: event.target.value }))}
                placeholder="Grok perso"
                style={inputStyle}
              />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ color: "#cbd5e1", fontSize: 13, fontWeight: 700 }}>Base URL</span>
              <input
                value={draft.baseUrl}
                onChange={(event) => setDraft((prev) => ({ ...prev, baseUrl: event.target.value }))}
                placeholder="https://api.x.ai/v1"
                style={inputStyle}
              />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ color: "#cbd5e1", fontSize: 13, fontWeight: 700 }}>Modele</span>
              <input
                value={draft.model}
                onChange={(event) => setDraft((prev) => ({ ...prev, model: event.target.value }))}
                placeholder="grok-3-mini-beta"
                style={inputStyle}
              />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ color: "#cbd5e1", fontSize: 13, fontWeight: 700 }}>Cle API</span>
              <input
                type="password"
                value={draft.apiKey}
                onChange={(event) => setDraft((prev) => ({ ...prev, apiKey: event.target.value }))}
                placeholder="sk-..."
                style={inputStyle}
              />
            </label>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <button type="submit" disabled={saving} className="btn">
              {saving ? "Enregistrement..." : "Ajouter ce profil"}
            </button>
            {feedback ? <span style={{ color: "#86efac", fontSize: 13 }}>{feedback}</span> : null}
            {error ? <span style={{ color: "#fca5a5", fontSize: 13 }}>{error}</span> : null}
          </div>
        </form>
      </div>

      <div
        style={{
          border: "1px solid #1f2937",
          borderRadius: 18,
          background: "#0b1220",
          padding: 18,
          display: "grid",
          gap: 12,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: "#f8fafc" }}>
            Profils disponibles
          </div>
          <div style={{ color: "#94a3b8", fontSize: 13 }}>
            {selectedLabel ? `Profil actif dans le chat: ${selectedLabel}` : "Aucun profil distant actif dans le chat."}
          </div>
        </div>

        {!hasProfiles ? (
          <div style={{ color: "#94a3b8", fontSize: 14 }}>
            Aucun profil distant enregistre pour l’instant.
          </div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {profiles.map((profile) => {
              const selected = profile.id === selectedProfileId;
              return (
                <article
                  key={profile.id}
                  style={{
                    border: `1px solid ${selected ? "#7c3aed" : "#1f2937"}`,
                    background: selected ? "rgba(76, 29, 149, 0.18)" : "#0f172a",
                    borderRadius: 14,
                    padding: 14,
                    display: "grid",
                    gap: 10,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                    <div style={{ display: "grid", gap: 4 }}>
                      <div style={{ color: "#f8fafc", fontSize: 16, fontWeight: 800 }}>{profile.label}</div>
                      <div style={{ color: "#cbd5e1", fontSize: 13 }}>{profile.model}</div>
                      <div style={{ color: "#94a3b8", fontSize: 12 }}>{profile.baseUrl}</div>
                    </div>
                    <div style={{ color: profile.apiKeyPresent ? "#86efac" : "#fca5a5", fontSize: 12, fontWeight: 700 }}>
                      {profile.apiKeyPresent ? "Cle API enregistree" : "Cle API manquante"}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <button
                      type="button"
                      className="btn ghost"
                      onClick={() => onSelect(profile.id)}
                    >
                      {selected ? "Selectionne" : "Choisir dans le chat"}
                    </button>
                    <button
                      type="button"
                      className="btn ghost"
                      onClick={() => void onDelete(profile.id)}
                      disabled={deletingId === profile.id}
                      style={{ color: "#fca5a5", borderColor: "#7f1d1d" }}
                    >
                      {deletingId === profile.id ? "Suppression..." : "Supprimer"}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  borderRadius: 12,
  border: "1px solid #334155",
  background: "#020617",
  color: "#f8fafc",
  padding: "10px 12px",
  minHeight: 44,
};
