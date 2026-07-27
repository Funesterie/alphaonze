'use strict';

/**
 * Matiere de doctrine injectee dans le prompt d'ecriture.
 *
 * Le graphe contenait 239 documents indexes -- regles de persona, references
 * d'humour, lore, canon audio -- mais `vivy-songcraft.cjs` ne l'interrogeait jamais:
 * zero appel a searchVivyGraph dans toute la chaine d'ecriture. La matiere existait,
 * personne n'y puisait.
 *
 * Ce module fait le pont, avec trois precautions:
 *   - il n'echoue jamais: une recherche qui tombe rend une chaine vide, l'ecriture
 *     continue sans matiere plutot que de casser une production;
 *   - il borne strictement ce qu'il injecte, pour ne pas noyer le prompt;
 *   - il ne fait rien si la fonction est desactivee.
 */

const MAX_EXTRACTS = 4;
const MAX_CHARS_PER_EXTRACT = 320;
const MAX_TOTAL_CHARS = 1400;
const SEARCH_TIMEOUT_MS = 4000;

/** Termes de recherche tires du sujet et du casting, sans bruit. */
function buildSearchQuery(input = {}) {
  const parts = [
    input.songTitle || input.title,
    input.theme,
    input.songMood,
    // Le texte est tronque: on cherche un sujet, pas la chanson entiere.
    String(input.songText || input.lyrics || '').slice(0, 240),
  ].filter(Boolean).join(' ');

  return String(parts)
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

function formatExtracts(results = []) {
  const seen = new Set();
  const lines = [];
  let total = 0;

  for (const item of results) {
    const title = String(item?.title || '').trim();
    // Un meme document peut renvoyer plusieurs chunks: on n'en garde qu'un.
    if (!title || seen.has(title)) continue;
    const preview = String(item?.preview || '').replace(/\s+/g, ' ').trim();
    if (preview.length < 40) continue;

    const extract = preview.slice(0, MAX_CHARS_PER_EXTRACT);
    if (total + extract.length > MAX_TOTAL_CHARS) break;

    seen.add(title);
    lines.push(`- ${title}: ${extract}`);
    total += extract.length;
    if (lines.length >= MAX_EXTRACTS) break;
  }
  return lines;
}

/**
 * Renvoie un bloc de matiere pret a coller dans le prompt, ou une chaine vide.
 * Ne leve jamais.
 */
async function buildSongcraftGraphContext(input = {}, env = process.env) {
  if (String(env.A11_SONGCRAFT_GRAPH_CONTEXT || '1') === '0') return '';

  const query = buildSearchQuery(input);
  if (query.length < 8) return '';

  try {
    const { searchVivyGraph } = require('../knowledge/vivy-graph-access.cjs');
    const search = searchVivyGraph({
      query,
      source: String(env.A11_SONGCRAFT_GRAPH_SOURCE || 'local'),
      limit: 10,
    });

    // Une recherche lente ne doit jamais retarder une production musicale.
    const timeout = new Promise((resolve) => setTimeout(() => resolve(null), SEARCH_TIMEOUT_MS));
    const result = await Promise.race([search, timeout]);
    if (!result?.results?.length) return '';

    const lines = formatExtracts(result.results);
    if (!lines.length) return '';

    return [
      'MATIERE FUNESTERIE (extraits du graphe, pour nourrir ton ecriture):',
      ...lines,
      'Sers-t-en comme reference de ton, de lore et de vocabulaire. Ne cite jamais ces',
      'lignes telles quelles dans les paroles: elles t informent, elles ne se chantent pas.',
    ].join('\n');
  } catch {
    // Graphe indisponible: on ecrit sans matiere plutot que d'echouer.
    return '';
  }
}

module.exports = {
  buildSongcraftGraphContext,
  buildSearchQuery,
  formatExtracts,
};
