import React, { useState } from "react";
import { callA11Agent } from "../lib/api";

type ChatMessage = {
  id: number;
  role: "user" | "assistant";
  content: string;
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

      let replyText = "[Réponse inconnue]";
      if (result.type === "tool-result") {
        replyText = `Outil: ${result.tool}\nEntrée: ${JSON.stringify(result.input, null, 2)}\nRésultat: ${JSON.stringify(result.result, null, 2)}`;
      } else if (result.type === "text") {
        replyText = result.content;
      } else {
        replyText = `Réponse brute: ${JSON.stringify(result.content)}`;
      }

      const aiMsg: ChatMessage = {
        id: Date.now() + 1,
        role: "assistant",
        content: String(replyText)
      };

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
              whiteSpace: "pre-wrap"
            }}
          >
            {m.content}
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
