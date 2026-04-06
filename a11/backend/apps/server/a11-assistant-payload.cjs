// apps/server/a11-assistant-payload.cjs
// Helper pour parler au routeur LLM (Cerbère) et générer un payload/planning.

const fetch = require('node-fetch');

const CERBERE_URL =
  process.env.A11_ASSISTANT_URL ||
  process.env.LLM_ROUTER_URL ||
  "http://127.0.0.1:4545/v1/chat/completions";

function buildSystemPrompt() {
  return [
    "Tu es A-11 Droid Planner.",
    "Tu dois répondre UNIQUEMENT avec un JSON valide.",
    "Pas de texte autour, pas d'explication.",
    "",
    "Format attendu :",
    "{",
    '  "steps": [',
    "    {",
    '      "skill": "a11d.fs.write",',
    '      "payload": { "file": "notes.txt", "content": "Hello" }',
    "    }",
    "  ]",
    "}",
    "",
    "Règles :",
    "- Toujours un JSON strictement valide.",
    "- Pas de commentaires.",
    "- Pas d'autres champs inutiles.",
  ].join("\n");
}

/**
 * Appelle Cerbère pour générer un payload d'actions à partir d'une consigne.
 * @param {string} message - consigne utilisateur / goal
 * @returns {Promise<any>} JSON parsé (steps, etc.) ou null
 */
async function callPayloadAssistant(message) {
  const userText = String(message || "").trim();
  if (!userText) {
    throw new Error("callPayloadAssistant: message vide");
  }

  const body = {
    model: "llama3.2:latest",
    stream: false,
    messages: [
      { role: "system", content: buildSystemPrompt() },
      { role: "user", content: userText },
    ],
  };

  const res = await fetch(CERBERE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `callPayloadAssistant: Cerbère HTTP ${res.status} ${res.statusText} – ${text}`
    );
  }

  const data = await res.json();
  const choice = data && data.choices && data.choices[0];
  const content = choice && choice.message && choice.message.content;

  if (!content || typeof content !== "string") {
    throw new Error("callPayloadAssistant: réponse LLM sans contenu texte");
  }

  // On s'attend à ce que le LLM renvoie un JSON pur
  try {
    const trimmed = content.trim();
    return JSON.parse(trimmed);
  } catch (e) {
    console.error("[A11][PAYLOAD] JSON parse error:", e && e.message, content);
    throw new Error("callPayloadAssistant: réponse LLM non JSON");
  }
}

module.exports = {
  callPayloadAssistant,
};
