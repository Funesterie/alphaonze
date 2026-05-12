/**
 * A11ActivityConsole.tsx
 *
 * Console visuelle temps réel pour A11.
 * Affiche les activités en cours : recherche web, génération image/vidéo,
 * outils, Janus (analyse d'image), checkpoints, etc.
 *
 * Usage :
 *   <A11ActivityConsole events={activityEvents} isActive={isLoading} />
 *
 * Les events sont poussés depuis le pipeline chat via le hook useA11Activity.
 */

import React, { useEffect, useRef, useState } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

export type A11ActivityEventKind =
  | "web_search"
  | "web_image_search"
  | "image_generate"
  | "video_generate"
  | "audio_generate"
  | "janus_vision"
  | "checkpoint"
  | "tool_call"
  | "llm_thinking"
  | "memory_read"
  | "memory_write"
  | "knowledge_resolve"
  | "self_rewrite"
  | "info"
  | "error"
  | "success";

export type A11ActivityEvent = {
  id: string;
  kind: A11ActivityEventKind;
  label: string;
  detail?: string;
  imageUrl?: string | null;
  query?: string | null;
  status: "pending" | "running" | "done" | "error";
  startedAt: number;
  endedAt?: number;
};

// ─── Config visuelle par type d'activité ─────────────────────────────────────

const KIND_CONFIG: Record<
  A11ActivityEventKind,
  { icon: string; color: string; bg: string; border: string; label: string }
> = {
  web_search:       { icon: "🌐", color: "#93c5fd", bg: "#0c1a2e", border: "#1e3a5f", label: "Recherche web" },
  web_image_search: { icon: "🖼️", color: "#c4b5fd", bg: "#130c2e", border: "#2d1b5f", label: "Recherche image" },
  image_generate:   { icon: "🎨", color: "#86efac", bg: "#0a1f12", border: "#14532d", label: "Génération image" },
  video_generate:   { icon: "🎬", color: "#fca5a5", bg: "#1f0a0a", border: "#7f1d1d", label: "Génération vidéo" },
  audio_generate:   { icon: "🎵", color: "#fde68a", bg: "#1f1a0a", border: "#78350f", label: "Synthèse vocale" },
  janus_vision:     { icon: "👁️", color: "#f0abfc", bg: "#1a0a1f", border: "#6b21a8", label: "Analyse Janus" },
  checkpoint:       { icon: "📍", color: "#94a3b8", bg: "#0f172a", border: "#1e293b", label: "Checkpoint" },
  tool_call:        { icon: "⚙️", color: "#fdba74", bg: "#1f1208", border: "#7c2d12", label: "Outil" },
  llm_thinking:     { icon: "🧠", color: "#a5f3fc", bg: "#0a1f1f", border: "#164e63", label: "Réflexion" },
  memory_read:      { icon: "📖", color: "#6ee7b7", bg: "#0a1f14", border: "#065f46", label: "Mémoire" },
  memory_write:     { icon: "💾", color: "#6ee7b7", bg: "#0a1f14", border: "#065f46", label: "Mémoire" },
  knowledge_resolve:{ icon: "⚖️", color: "#fbbf24", bg: "#1f1a08", border: "#92400e", label: "Résolution KG" },
  self_rewrite:     { icon: "✍️", color: "#f9a8d4", bg: "#1f0a14", border: "#9d174d", label: "Auto-réécriture" },
  info:             { icon: "ℹ️", color: "#94a3b8", bg: "#0f172a", border: "#1e293b", label: "Info" },
  error:            { icon: "❌", color: "#fca5a5", bg: "#1f0a0a", border: "#7f1d1d", label: "Erreur" },
  success:          { icon: "✅", color: "#86efac", bg: "#0a1f12", border: "#14532d", label: "Succès" },
};

// ─── Spinner animé ────────────────────────────────────────────────────────────

function Spinner({ color }: { color: string }) {
  return (
    <span
      style={{
        display: "inline-block",
        width: 12,
        height: 12,
        border: `2px solid ${color}33`,
        borderTop: `2px solid ${color}`,
        borderRadius: "50%",
        animation: "a11-spin 0.7s linear infinite",
        flexShrink: 0,
      }}
      aria-hidden="true"
    />
  );
}

// ─── Durée formatée ──────────────────────────────────────────────────────────

function formatDuration(startedAt: number, endedAt?: number) {
  const ms = (endedAt ?? Date.now()) - startedAt;
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// ─── Ligne d'activité ────────────────────────────────────────────────────────

function ActivityRow({
  event,
  now,
}: {
  event: A11ActivityEvent;
  now: number;
}) {
  const cfg = KIND_CONFIG[event.kind] ?? KIND_CONFIG.info;
  const isRunning = event.status === "running" || event.status === "pending";
  const isError = event.status === "error";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        padding: "8px 12px",
        borderRadius: 8,
        background: cfg.bg,
        border: `1px solid ${isError ? "#7f1d1d" : cfg.border}`,
        transition: "opacity 0.3s",
        opacity: event.status === "done" ? 0.75 : 1,
      }}
    >
      {/* Icône + spinner */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, paddingTop: 1, flexShrink: 0 }}>
        <span style={{ fontSize: 14 }}>{cfg.icon}</span>
        {isRunning && <Spinner color={cfg.color} />}
      </div>

      {/* Contenu */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ color: cfg.color, fontSize: 12, fontWeight: 600 }}>
            {cfg.label}
          </span>
          <span style={{ color: "#e2e8f0", fontSize: 12 }}>{event.label}</span>
          <span style={{ color: "#475569", fontSize: 11, marginLeft: "auto", flexShrink: 0 }}>
            {formatDuration(event.startedAt, event.endedAt)}
          </span>
        </div>

        {event.query && (
          <div
            style={{
              marginTop: 3,
              color: "#94a3b8",
              fontSize: 11,
              fontFamily: "monospace",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {event.query}
          </div>
        )}

        {event.detail && (
          <div style={{ marginTop: 3, color: "#64748b", fontSize: 11 }}>
            {event.detail}
          </div>
        )}

        {/* Aperçu image Janus */}
        {event.imageUrl && (
          <div style={{ marginTop: 6 }}>
            <img
              src={event.imageUrl}
              alt="Aperçu"
              style={{
                maxWidth: 120,
                maxHeight: 80,
                borderRadius: 6,
                border: "1px solid #1e293b",
                objectFit: "cover",
              }}
            />
          </div>
        )}
      </div>

      {/* Badge statut */}
      <div style={{ flexShrink: 0, paddingTop: 1 }}>
        {event.status === "done" && (
          <span style={{ color: "#22c55e", fontSize: 11 }}>✓</span>
        )}
        {event.status === "error" && (
          <span style={{ color: "#ef4444", fontSize: 11 }}>✗</span>
        )}
      </div>
    </div>
  );
}

// ─── Composant principal ──────────────────────────────────────────────────────

export type A11ActivityConsoleProps = {
  events: A11ActivityEvent[];
  isActive: boolean;
  productLabel?: string;
  maxVisible?: number;
  onClear?: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
};

export function A11ActivityConsole({
  events,
  isActive,
  productLabel = "A11",
  maxVisible = 12,
  onClear,
  collapsed = false,
  onToggleCollapse,
}: A11ActivityConsoleProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(Date.now());

  // Tick pour mettre à jour les durées des événements en cours
  useEffect(() => {
    if (!isActive) return;
    const interval = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(interval);
  }, [isActive]);

  // Auto-scroll vers le bas
  useEffect(() => {
    if (scrollRef.current && !collapsed) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events, collapsed]);

  const visibleEvents = events.slice(-maxVisible);
  const runningCount = events.filter((e) => e.status === "running" || e.status === "pending").length;
  const hasEvents = events.length > 0;

  if (!hasEvents && !isActive) return null;

  return (
    <>
      {/* Keyframe CSS injecté une seule fois */}
      <style>{`
        @keyframes a11-spin {
          to { transform: rotate(360deg); }
        }
        @keyframes a11-pulse-border {
          0%, 100% { border-color: #1e3a5f; }
          50% { border-color: #3b82f6; }
        }
      `}</style>

      <div
        style={{
          border: `1px solid ${isActive ? "#1e3a5f" : "#1e293b"}`,
          borderRadius: 10,
          background: "#080f1a",
          overflow: "hidden",
          animation: isActive ? "a11-pulse-border 2s ease-in-out infinite" : "none",
          marginBottom: 8,
        }}
        role="log"
        aria-label={`Console d'activite ${productLabel}`}
        aria-live="polite"
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "8px 12px",
            borderBottom: collapsed ? "none" : "1px solid #0f172a",
            background: "#0b1220",
            cursor: onToggleCollapse ? "pointer" : "default",
            userSelect: "none",
          }}
          onClick={onToggleCollapse}
          role={onToggleCollapse ? "button" : undefined}
          aria-expanded={!collapsed}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 13 }}>
              {isActive ? "⚡" : "📋"}
            </span>
            <span style={{ color: "#e2e8f0", fontSize: 12, fontWeight: 600 }}>
              Console {productLabel}
            </span>
            {runningCount > 0 && (
              <span
                style={{
                  background: "#1e3a5f",
                  color: "#93c5fd",
                  borderRadius: 999,
                  padding: "1px 7px",
                  fontSize: 11,
                  fontWeight: 600,
                }}
              >
                {runningCount} en cours
              </span>
            )}
            {events.length > 0 && runningCount === 0 && (
              <span style={{ color: "#475569", fontSize: 11 }}>
                {events.length} action{events.length > 1 ? "s" : ""}
              </span>
            )}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {onClear && events.length > 0 && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onClear(); }}
                style={{
                  background: "none",
                  border: "none",
                  color: "#475569",
                  cursor: "pointer",
                  fontSize: 11,
                  padding: "2px 6px",
                  borderRadius: 4,
                }}
                aria-label="Effacer la console"
              >
                Effacer
              </button>
            )}
            {onToggleCollapse && (
              <span style={{ color: "#475569", fontSize: 12 }}>
                {collapsed ? "▼" : "▲"}
              </span>
            )}
          </div>
        </div>

        {/* Corps */}
        {!collapsed && (
          <div
            ref={scrollRef}
            style={{
              maxHeight: 280,
              overflowY: "auto",
              padding: "8px",
              display: "flex",
              flexDirection: "column",
              gap: 6,
              scrollbarWidth: "thin",
              scrollbarColor: "#1e293b #080f1a",
            }}
          >
            {visibleEvents.length === 0 && isActive && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "10px 12px",
                  color: "#475569",
                  fontSize: 12,
                }}
              >
                <Spinner color="#475569" />
                <span>{productLabel} traite la demande...</span>
              </div>
            )}

            {visibleEvents.map((event) => (
              <ActivityRow key={event.id} event={event} now={now} />
            ))}

            {events.length > maxVisible && (
              <div style={{ color: "#475569", fontSize: 11, textAlign: "center", padding: "4px 0" }}>
                +{events.length - maxVisible} actions précédentes masquées
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}

// ─── Hook useA11Activity ──────────────────────────────────────────────────────

/**
 * Hook pour gérer les événements d'activité A11.
 * Utilisé dans App.tsx pour pousser des événements depuis le pipeline chat.
 *
 * Exemple d'utilisation :
 *   const { events, isActive, pushEvent, updateEvent, clearEvents, startActivity, stopActivity } = useA11Activity();
 *
 *   // Avant l'appel API :
 *   const eventId = pushEvent({ kind: "web_search", label: "Recherche en cours", query: userQuery });
 *
 *   // Après l'appel API :
 *   updateEvent(eventId, { status: "done" });
 */
export function useA11Activity() {
  const [events, setEvents] = useState<A11ActivityEvent[]>([]);
  const [isActive, setIsActive] = useState(false);
  const counterRef = useRef(0);

  function pushEvent(
    partial: Omit<A11ActivityEvent, "id" | "startedAt" | "status"> & { status?: A11ActivityEvent["status"] }
  ): string {
    const id = `a11-evt-${Date.now()}-${++counterRef.current}`;
    const event: A11ActivityEvent = {
      id,
      status: "running",
      startedAt: Date.now(),
      ...partial,
    };
    setEvents((prev) => [...prev, event]);
    return id;
  }

  function updateEvent(id: string, updates: Partial<A11ActivityEvent>) {
    setEvents((prev) =>
      prev.map((e) =>
        e.id === id
          ? { ...e, ...updates, endedAt: updates.status === "done" || updates.status === "error" ? Date.now() : e.endedAt }
          : e
      )
    );
  }

  function clearEvents() {
    setEvents([]);
  }

  function startActivity() {
    setIsActive(true);
  }

  function stopActivity() {
    setIsActive(false);
    // Marquer tous les événements encore en cours comme terminés
    setEvents((prev) =>
      prev.map((e) =>
        e.status === "running" || e.status === "pending"
          ? { ...e, status: "done", endedAt: Date.now() }
          : e
      )
    );
  }

  /**
   * Analyse la réponse A11 pour détecter automatiquement les activités
   * et pousser les événements correspondants.
   */
  function detectAndPushFromResponse(response: any) {
    if (!response || typeof response !== "object") return;

    const agent = response?.a11Agent || response;
    const actions = Array.isArray(agent?.actions) ? agent.actions : [];
    const results = Array.isArray(agent?.results) ? agent.results : [];
    const allEntries = [...actions, ...results];

    for (const entry of allEntries) {
      const tool = String(entry?.name || entry?.tool || entry?.action || "").toLowerCase();
      const result = entry?.result || entry;

      if (tool.includes("web_search") || tool.includes("search_web")) {
        const query = String(entry?.arguments?.query || entry?.query || "").trim();
        pushEvent({
          kind: "web_search",
          label: "Recherche web",
          query: query || null,
          status: "done",
        });
      }

      if (tool.includes("image_search") || tool.includes("web_image")) {
        const query = String(entry?.arguments?.query || entry?.query || "").trim();
        pushEvent({
          kind: "web_image_search",
          label: "Recherche image",
          query: query || null,
          imageUrl: result?.image_url || result?.imageUrl || null,
          status: "done",
        });
      }

      if (tool.includes("generate_image") || tool.includes("generate_visual") || tool.includes("generate_png")) {
        pushEvent({
          kind: "image_generate",
          label: "Image générée",
          imageUrl: result?.image_url || result?.imageUrl || result?.url || null,
          status: "done",
        });
      }

      if (tool.includes("generate_video")) {
        pushEvent({
          kind: "video_generate",
          label: "Vidéo générée",
          status: "done",
        });
      }

      if (tool.includes("tts") || tool.includes("audio") || tool.includes("synthesize")) {
        pushEvent({
          kind: "audio_generate",
          label: "Audio synthétisé",
          status: "done",
        });
      }

      if (tool.includes("janus") || tool.includes("vision") || tool.includes("inspect")) {
        pushEvent({
          kind: "janus_vision",
          label: "Analyse visuelle Janus",
          imageUrl: entry?.arguments?.imageUrl || entry?.imageUrl || null,
          status: "done",
        });
      }

      if (tool.includes("checkpoint") || tool.includes("save_checkpoint")) {
        pushEvent({
          kind: "checkpoint",
          label: "Checkpoint sauvegardé",
          status: "done",
        });
      }

      if (tool.includes("memory") || tool.includes("vector") || tool.includes("episodic")) {
        pushEvent({
          kind: tool.includes("write") ? "memory_write" : "memory_read",
          label: tool.includes("write") ? "Mémoire mise à jour" : "Mémoire consultée",
          status: "done",
        });
      }

      if (tool.includes("knowledge") || tool.includes("kg")) {
        pushEvent({
          kind: "knowledge_resolve",
          label: "Résolution Knowledge Graph",
          status: "done",
        });
      }

      if (tool.includes("self_rewrite") || tool.includes("rewrite")) {
        pushEvent({
          kind: "self_rewrite",
          label: "Réécriture Nindo",
          status: "done",
        });
      }
    }

    // Détecter depuis le mode de réponse
    const mode = String(response?.mode || agent?.mode || "").toLowerCase();
    if (mode === "web_search" || mode === "search") {
      pushEvent({ kind: "web_search", label: "Recherche web", status: "done" });
    }
    if (mode === "image_generate" || mode === "generate") {
      pushEvent({
        kind: "image_generate",
        label: "Image générée",
        imageUrl: response?.imageUrl || response?.image_url || null,
        status: "done",
      });
    }
    if (mode === "video_generate") {
      pushEvent({ kind: "video_generate", label: "Vidéo générée", status: "done" });
    }
  }

  return {
    events,
    isActive,
    pushEvent,
    updateEvent,
    clearEvents,
    startActivity,
    stopActivity,
    detectAndPushFromResponse,
  };
}
