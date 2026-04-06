// src/tools/web-search.ts
import { registerTool } from "./registry";

interface WebSearchArgs {
  query: string;
  limit?: number;
}

/**
 * Simple stub web_search tool for QFlush.
 * Pour l’instant, il ne fait qu’écho de la requête.
 * Tu pourras plus tard brancher DuckDuckGo / une API de recherche réelle.
 */
async function runWebSearch(args: WebSearchArgs) {
  const q = (args?.query || "").toString().trim();
  const limit = typeof args?.limit === "number" ? args.limit : 5;

  if (!q) {
    throw new Error("web_search: 'query' est requis");
  }

  // Stub : à remplacer par un vrai moteur (DuckDuckGo, Bing, etc.)
  return {
    ok: true,
    engine: "stub",
    query: q,
    limit,
    results: [
      {
        title: "web_search stub",
        url: "https://funesterie.me/",
        snippet:
          "Stub QFlush pour web_search. Implémente une vraie recherche quand tu veux."
      }
    ]
  };
}

// Enregistrement dans le registry QFlush
registerTool({
  name: "web_search",
  handler: runWebSearch
});
