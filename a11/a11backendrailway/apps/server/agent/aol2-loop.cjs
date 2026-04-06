// AOL 2 — Boucle agent principale
const { applyPolicy, isNeedUser } = require('./aol2-policy.cjs');
const { grant } = require('./aol2-auth.cjs');

async function aol2Loop(prompt, context, callLLM, dispatchTool, userReply = null) {
  const state = {
    tries: 0,
    maxTries: 3,
    history: [],
    lastToolResult: null,
    topic: null // Ajout du topic pour l'autorisation TTL
  };

  // Définir le topic à partir du prompt (simple: 3 premiers mots)
  state.topic = (prompt || '').split(/\s+/).slice(0, 3).join(' ');

  // Si userReply contient une autorisation, on la stocke (ex: "Autoriser recherche")
  if (userReply && typeof userReply === 'string') {
    if (userReply.toLowerCase().includes('autoriser')) {
      grant({ scope: 'download_file', topic: state.topic, ttlMs: 20 * 60 * 1000, note: 'User confirmed in chat' });
    }
  }

  while (state.tries < state.maxTries) {
    state.tries++;

    const llmResponse = await callLLM({
      prompt,
      context,
      toolResults: state.lastToolResult
    });

    if (llmResponse.mode === "final") return llmResponse.content;

    if (llmResponse.mode !== "actions") {
      return "❌ Réponse inconnue du modèle";
    }

    const results = [];

    for (const action of llmResponse.actions) {
      const result = await dispatchTool(action);
      results.push({ action, result });

      if (!result?.ok) {
        const { decision, reason } = applyPolicy(result, state);

        if (decision === "need_user") {
          return {
            mode: "need_user",
            question:
              `Je suis bloqué (policy): ${reason}\n` +
              `Tu veux :\n` +
              `1) Me donner une URL précise,\n` +
              `2) M’autoriser à chercher et choisir une source (Wikimedia/Commons),\n` +
              `3) Annuler ?`,
            choices: ["Donner une URL", "Autoriser recherche", "Annuler"],
            debug: { action, error: result.error }
          };
        }

        if (decision === "abort") {
          return `❌ Action échouée: ${result.error}`;
        }
        // decision === "retry" : on continue la boucle,
        // mais il faut réinjecter le résultat pour que le LLM corrige.
      }
    }

    state.lastToolResult = results;
    state.history.push(results);

    continue;
  }

  return "❌ Limite de tentatives atteinte";
}

module.exports = { aol2Loop };
