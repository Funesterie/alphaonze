// apps/web/src/components/HistoryPanel.tsx
import React, { useEffect, useState } from "react";

type MemoryEntry = {
  ts?: string;
  type?: "chat_turn" | "agent_actions" | string;
  conversationId?: string;
  request?: any;
  response?: any;
  explanation?: string;
};

type HistoryPanelProps = {
  onClose: () => void;
};

export const HistoryPanel: React.FC<HistoryPanelProps> = ({ onClose }) => {
  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/a11/memory/conversations");
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const json = await res.json();
        if (!json || !json.ok || !Array.isArray(json.entries)) {
          throw new Error("Payload invalide");
        }
        if (!cancelled) {
          setEntries(json.entries as MemoryEntry[]);
        }
      } catch (e: any) {
        if (!cancelled) {
          setError(String(e?.message || e));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = entries.filter((e) => {
    if (!filter.trim()) return true;
    const cid = (e.conversationId || "").toLowerCase();
    return cid.includes(filter.toLowerCase());
  });

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/80">
      <div className="w-[900px] max-h-[80vh] bg-slate-900 text-slate-100 rounded-2xl shadow-xl border border-slate-700 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700 bg-slate-800/70">
          <div className="flex flex-col">
            <span className="text-sm font-semibold text-slate-200">
              Historique des conversations
            </span>
            <span className="text-xs text-slate-400">
              Chargé depuis <code>a11_memory</code> (JSONL)
            </span>
          </div>
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs rounded-md bg-slate-700 hover:bg-slate-600"
          >
            Fermer
          </button>
        </div>

        {/* Barre filtre + état */}
        <div className="px-4 py-3 border-b border-slate-800 flex items-center gap-3">
          <div className="flex-1">
            <label className="block text-[11px] text-slate-400 mb-1">
              Filtrer par <code>conversationId</code> (ex: VSIX, Funesterie,
              DebugQFlush)
            </label>
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="VSIX, Funesterie, DebugQFlush..."
              className="w-full text-xs px-2 py-1.5 rounded-md bg-slate-800 border border-slate-700 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </div>
          <div className="text-[11px] text-slate-400 min-w-[120px] text-right">
            {loading && <span>Chargement…</span>}
            {!loading && !error && (
              <span>{filtered.length} entrée(s) filtrée(s)</span>
            )}
            {error && (
              <span className="text-rose-400">
                Erreur chargement : {error}
              </span>
            )}
          </div>
        </div>

        {/* Liste */}
        <div className="flex-1 overflow-auto text-xs">
          {filtered.length === 0 && !loading && !error && (
            <div className="p-4 text-slate-400">
              Aucun historique pour le moment.  
              Lance quelques conversations avec A-11 puis réessaie.
            </div>
          )}

          {filtered.map((e, idx) => (
            <div
              key={idx}
              className="px-4 py-3 border-b border-slate-800/70 hover:bg-slate-800/60"
            >
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span className="px-1.5 py-0.5 rounded bg-slate-700 text-[10px] uppercase tracking-wide">
                    {e.type || "unknown"}
                  </span>
                  <span className="text-[11px] text-emerald-400">
                    {e.conversationId || "default"}
                  </span>
                </div>
                <span className="text-[10px] text-slate-500">
                  {e.ts || ""}
                </span>
              </div>

              {e.type === "chat_turn" && (
                <div className="space-y-1">
                  <div className="text-slate-300">
                    <span className="font-semibold">User →</span>{" "}
                    {JSON.stringify(e.request?.messages ?? []).slice(0, 180)}
                    {JSON.stringify(e.request?.messages ?? []).length > 180
                      ? "…"
                      : ""}
                  </div>
                  <div className="text-slate-400">
                    <span className="font-semibold">Assistant →</span>{" "}
                    {String(
                      e.response?.choices?.[0]?.message?.content ??
                        e.response?.choices?.[0]?.delta?.content ??
                        ""
                    ).slice(0, 200)}
                    {String(
                      e.response?.choices?.[0]?.message?.content ??
                        e.response?.choices?.[0]?.delta?.content ??
                        ""
                    ).length > 200
                      ? "…"
                      : ""}
                  </div>
                </div>
              )}

              {e.type === "agent_actions" && (
                <div className="space-y-1">
                  <div className="text-slate-300">
                    <span className="font-semibold">Résumé actions :</span>{" "}
                    {e.explanation ||
                      "[Actions exécutées par Cerbère / QFLUSH]"}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

