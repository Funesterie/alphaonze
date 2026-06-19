import React, { useState } from "react";
import { callA11Agent } from "../lib/api";

type ChatMessage = {
  id: number;
  role: "user" | "assistant";
  content: string;
  imageUrl?: string | null;
  artifactType?: string | null;
  tool?: string | null;
};

const ChatPanel: React.FC = () => {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 0,
      role: "assistant",
      content: "Je suis AlphaOnze (A-11). Comment puis-je aider ?"
    }
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  // Fonction de normalisation robuste du résultat assistant
  function normalizeAssistantResult(result: any): ChatMessage {
    let replyText = "[Réponse inconnue]";
    let imageUrl: string | null = null;
    let artifactType: string | null = null;
    let tool: string | null = null;

    // Mapping robuste de l'URL d'image
    const extractImageUrl = (obj: any): string | null => {
      if (!obj) return null;
      return (
        obj.imageUrl ||
        obj.image_url ||
        obj.result?.image_url ||
        obj.result?.imageUrl ||
        obj.result?.image_path ||
        obj.result?.imagePath ||
        obj.result?.url ||
        null
      );
    };

    if (result.type === "tool-result") {
      replyText = result.explanation || `Outil: ${result.tool}`;
      imageUrl = extractImageUrl(result);
      artifactType = result.result?.artifact_type || null;
      tool = result.tool || null;
    } else if (result.type === "text") {
      replyText = result.content;
      imageUrl = extractImageUrl(result) || extractImageUrl(result.result) || null;
      artifactType = result.artifactType || result.result?.artifact_type || null;
      tool = result.tool || null;
    } else {
      replyText = `Réponse brute: ${JSON.stringify(result.content)}`;
    }

    return {
      id: Date.now() + 1,
      role: "assistant",
      content: String(replyText),
      imageUrl,
      artifactType,
      tool
    };
  }

  async function sendMessage() {
    const text = input.trim();
    if (!text || loading) return;

    const userMsg: ChatMessage = {
      id: Date.now(),
      role: "user",
      content: text
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    try {
      // Appel à l'agent A-11 via callA11Agent
      const result = await callA11Agent([
        { role: "user", content: text }
      ]);

      const aiMsg = normalizeAssistantResult(result);
      setMessages((prev) => [...prev, aiMsg]);
    } catch (err) {
      console.error("Erreur appel backend:", err);
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now() + 1,
          role: "assistant",
          content: "Erreur lors de l'appel à l'agent A-11."
        }
      ]);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  return (
    <div
      style={{
        marginTop: 16,
        borderRadius: 12,
        background: "#020617",
        padding: 12,
        height: 420,
        display: "flex",
        flexDirection: "column",
        border: "1px solid #1f2937"
      }}
    >
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 8,
          paddingRight: 4
        }}
      >
        {messages.map((m) => (
          <div
            key={m.id}
            style={{
              alignSelf: m.role === "user" ? "flex-end" : "flex-start",
              maxWidth: "75%",
              padding: "8px 10px",
              borderRadius: 8,
              background: m.role === "user" ? "#0f766e" : "#111827",
              color: "#e5e7eb",
              fontSize: 14,
              whiteSpace: "pre-wrap",
              marginBottom: m.imageUrl ? 4 : 0
            }}
          >
            {m.content}
            {m.imageUrl && (
              <div style={{ marginTop: 8, textAlign: 'center' }}>
                <a
                  href={m.imageUrl}
                  target="_blank"
                  rel="noreferrer"
                  style={{ display: 'inline-block', textDecoration: 'none' }}
                >
                  <img
                    src={m.imageUrl}
                    alt="Image générée"
                    style={{ maxWidth: 220, borderRadius: 12, border: '1px solid #333', boxShadow: '0 2px 8px #0004', cursor: 'pointer', display: 'block', margin: '0 auto' }}
                    onError={e => {
                      const target = e.target as HTMLImageElement;
                      target.style.display = 'none';
                      const msg = target.nextElementSibling as HTMLElement;
                      if (msg) msg.style.display = 'block';
                    }}
                  />
                  <span style={{ display: 'none', color: '#f87171', fontSize: 13 }}>Image indisponible</span>
                </a>
                <div style={{ marginTop: 4, display: 'flex', gap: 8, justifyContent: 'center', alignItems: 'center' }}>
                  {m.tool === 'generate_sd' && (
                    <span style={{ background: '#334155', color: '#fbbf24', fontSize: 12, borderRadius: 6, padding: '2px 8px', fontWeight: 500 }}>
                      Stable Diffusion
                    </span>
                  )}
                  <button
                    type="button"
                    style={{ fontSize: 12, color: '#94a3b8', background: 'none', border: '1px solid #334155', borderRadius: 6, padding: '2px 8px', cursor: 'pointer' }}
                    onClick={async () => {
                      const src = m.imageUrl!;
                      try {
                        let res = await fetch(src, { credentials: 'include' }).catch(() => fetch(src, { credentials: 'omit' }));
                        if (!res.ok) throw new Error('fetch_failed');
                        const blob = await res.blob();
                        const ext = (blob.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
                        const a = document.createElement('a');
                        a.href = URL.createObjectURL(blob);
                        a.download = `image-${Date.now()}.${ext}`;
                        a.click();
                        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
                      } catch {
                        window.open(src, '_blank', 'noopener,noreferrer');
                      }
                    }}
                  >
                    Télécharger
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <div
        style={{
          marginTop: 8,
          display: "flex",
          gap: 8
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Écris ton message…"
          style={{
            flex: 1,
            borderRadius: 6,
            border: "1px solid #4b5563",
            padding: "6px 8px",
            background: "#020617",
            color: "#e5e7eb",
            fontSize: 14
          }}
        />
        <button
          onClick={sendMessage}
          disabled={loading}
          style={{
            padding: "6px 12px",
            borderRadius: 6,
            border: "none",
            background: loading ? "#4b5563" : "#22c55e",
            color: "#020617",
            fontWeight: 600,
            cursor: loading ? "default" : "pointer"
          }}
        >
          {loading ? "..." : "Envoyer"}
        </button>
      </div>
    </div>
  );
};

export default ChatPanel;
