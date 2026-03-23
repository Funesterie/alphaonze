import React, { useEffect, useState, useMemo } from "react";

type MemoryEntry = {
  ts?: string;
  type?: string;
  conversationId?: string;
  request?: any;
  response?: any;
  explanation?: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
};

export const HistoryDrawer: React.FC<Props> = ({ open, onClose }) => {
  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [filterConvId, setFilterConvId] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/a11/memory/conversations");
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const json = await res.json();
        const list: MemoryEntry[] = Array.isArray(json.entries)
          ? json.entries
          : [];
        setEntries(list);
      } catch (e: any) {
        setError(e?.message || "Erreur de chargement");
      } finally {
        setLoading(false);
      }
    })();
  }, [open]);

  const grouped = useMemo(() => {
    const map = new Map<string, MemoryEntry[]>();
    for (const e of entries) {
      const id = (e.conversationId || "default").toString();
      if (filterConvId && !id.toLowerCase().includes(filterConvId.toLowerCase())) {
        continue;
      }
      if (!map.has(id)) map.set(id, []);
      map.get(id)!.push(e);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [entries, filterConvId]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex">
      {/* Overlay */}
      <div
        className="flex-1 bg-black/40"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="w-full max-w-md bg-slate-900 text-slate-100 shadow-xl border-l border-slate-700 flex flex-col">
        <div className="p-3 border-b border-slate-700 flex items-center justify-between">
          <div className="flex flex-col">
            <span className="text-sm font-semibold">Historique des conversations</span>
            <span className="text-xs text-slate-400">
              Chargé depuis a11_memory (JSONL)
            </span>
          </div>
          <button
            onClick={onClose}
            className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-xs"
          >
            Fermer
          </button>
        </div>

        {/* Filtre */}
        <div className="p-3 border-b border-slate-800 space-y-2">
          <label className="text-xs text-slate-400">
            Filtrer par <code>conversationId</code>
          </label>
          <input
            value={filterConvId}
            onChange={(e) => setFilterConvId(e.target.value)}
            placeholder="ex: VSIX, Funesterie, Debug QFlush..."
            className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs focus:outline-none focus:ring focus:ring-amber-500/40"
          />
        </div>

        {/* Contenu */}
        <div className="flex-1 overflow-auto p-3 space-y-3 text-xs">
          {loading && <div className="text-slate-400">Chargement…</div>}
          {error && (
            <div className="text-red-400">
              Erreur lors du chargement : {error}
            </div>
          )}
          {!loading && !error && grouped.length === 0 && (
            <div className="text-slate-500">
              Aucun historique trouvé pour ce filtre.
            </div>
          )}

          {grouped.map(([convId, list]) => (
            <div
              key={convId}
              className="border border-slate-700 rounded-lg p-2 bg-slate-900/70"
            >
              <div className="flex items-center justify-between mb-1">
                <span className="font-semibold text-amber-400 text-xs">
                  {convId}
                </span>
                <span className="text-[10px] text-slate-500">
                  {list.length} entrées
                </span>
              </div>
              <div className="space-y-1 max-h-48 overflow-auto pr-1">
                {list.map((e, idx) => (
                  <div
                    key={idx}
                    className="border border-slate-800 rounded px-2 py-1 bg-slate-950/60"
                  >
                    <div className="flex justify-between mb-0.5">
                      <span className="text-[10px] text-slate-400">
                        {e.type || "chat_turn"}
                      </span>
                      <span className="text-[10px] text-slate-500">
                        {e.ts?.replace("T", " ").replace("Z", "")}
                      </span>
                    </div>
                    {e.explanation && (
                      <div className="text-[11px] text-slate-200 line-clamp-3">
                        {e.explanation}
                      </div>
                    )}
                    {!e.explanation && e.request?.messages?.length && (
                      <div className="text-[11px] text-slate-300 line-clamp-2">
                        {e.request.messages[e.request.messages.length - 1].content}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
