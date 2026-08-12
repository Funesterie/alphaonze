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

/** Extraits de l'historique ChatGPT via l'index inverse. Ne leve jamais. */
function formatChatGptExtracts(query, env = process.env) {
  if (String(env.A11_SONGCRAFT_CHATGPT_CONTEXT || '1') === '0') return [];
  try {
    const { searchChatGptHistory } = require('../knowledge/chatgpt-keyword-search.cjs');
    const found = searchChatGptHistory(query, { limit: 4, env });
    if (!found?.ok || !found.results?.length) return [];
    return found.results
      .filter((r) => Number(r.matched) >= 2)   // au moins deux termes: sinon c'est du bruit
      .slice(0, 2)
      .map((r) => `- memoire (${String(r.title).slice(0, 50)}): ${String(r.preview).replace(/\s+/g, ' ').slice(0, 280)}`);
  } catch {
    return [];
  }
}

/**
 * Renvoie un bloc de matiere pret a coller dans le prompt, ou une chaine vide.
 * Ne leve jamais.
 */
async function buildSongcraftGraphContext(input = {}, env = process.env) {
  if (String(env.A11_SONGCRAFT_GRAPH_CONTEXT || '1') === '0') return '';

  const query = buildSearchQuery(input);
  if (query.length < 8) return '';

  // Les deux sources sont independantes: le graphe peut tomber sans priver Vivy de la
  // memoire ChatGPT, et inversement. Les coupler ferait perdre les deux d'un coup.
  let lines = [];
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
    if (result?.results?.length) lines = formatExtracts(result.results);
  } catch {
    lines = [];
  }

  // L'historique ChatGPT pese 218 Mo: interroge par index inverse, jamais charge
  // dans le graphe. Recherche locale et synchrone, donc sans risque de latence.
  const memoire = formatChatGptExtracts(query, env);

  if (!lines.length && !memoire.length) return '';

  return [
    'MATIERE FUNESTERIE (pour nourrir ton ecriture):',
    ...lines,
    ...memoire,
    'Sers-t-en comme reference de ton, de lore et de vocabulaire. Ne cite jamais ces',
    'lignes telles quelles dans les paroles: elles t informent, elles ne se chantent pas.',
  ].join('\n');
}

/**
 * Termes de recherche tires d'un message de conversation.
 *
 * buildSearchQuery() ne sert pas ici: elle lit songTitle/theme/songMood, des champs
 * qui n'existent pas dans un echange ordinaire. En conversation la seule matiere
 * est ce que la personne vient d'ecrire.
 *
 * On retire les mots trop courts et la ponctuation: l'index plein texte de Neo4j
 * repond au bruit par du bruit, et une question de trois mots vides ramenerait
 * n'importe quel document.
 */
function buildChatSearchQuery(message = '') {
  const mots = String(message || '')
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .split(/\s+/)
    .map((mot) => mot.trim())
    .filter((mot) => mot.length >= 4);

  // Au-dela d'une douzaine de termes on ne cherche plus, on ratisse.
  return mots.slice(0, 12).join(' ').slice(0, 300);
}

/**
 * Matiere de memoire injectee dans une conversation ordinaire.
 *
 * POURQUOI CETTE FONCTION EXISTE, alors que buildSongcraftGraphContext lui ressemble:
 * le graphe n'etait consulte QUE pendant l'ecriture d'une chanson
 * (`mode === 'song'` dans vivy-studio.cjs). Dans un echange normal Vivy ne pouvait
 * donc pas s'appuyer sur les 2 715 messages et 21 documents indexes -- elle ne
 * pouvait pas repondre « on avait dit ca le 3 aout ». La matiere existait, la porte
 * etait fermee.
 *
 * Le CADRAGE est l'inverse de celui de l'ecriture, et c'est tout l'interet d'une
 * fonction distincte: en chanson on interdit de citer ces lignes (« elles t'informent,
 * elles ne se chantent pas »); en conversation, citer est precisement le service rendu.
 *
 * Memes precautions que sa soeur: ne leve jamais, borne ce qu'elle injecte, et se
 * desactive proprement.
 */
async function buildChatGraphContext(message = '', env = process.env) {
  if (String(env.A11_CHAT_GRAPH_CONTEXT || '1') === '0') return '';

  const query = buildChatSearchQuery(message);
  // Sous trois termes utiles, une recherche plein texte ne discrimine rien.
  if (query.split(' ').filter(Boolean).length < 3) return '';

  let lines = [];
  try {
    const { searchVivyGraph } = require('../knowledge/vivy-graph-access.cjs');
    const search = searchVivyGraph({
      query,
      source: String(env.A11_CHAT_GRAPH_SOURCE || env.A11_SONGCRAFT_GRAPH_SOURCE || 'local'),
      limit: 10,
    });
    // Une recherche lente ne doit jamais retarder une reponse de chat: on repond
    // sans memoire plutot que de faire attendre.
    const timeout = new Promise((resolve) => setTimeout(() => resolve(null), SEARCH_TIMEOUT_MS));
    const result = await Promise.race([search, timeout]);
    if (result?.results?.length) lines = formatExtracts(result.results);
  } catch {
    lines = [];
  }

  if (!lines.length) return '';

  return [
    'MEMOIRE FUNESTERIE (echanges et documents deja indexes):',
    ...lines,
    "Tu PEUX t'y referer explicitement et citer ce qui s'y trouve: c'est la memoire",
    'partagee de Funesterie, pas une source externe. Si un element contredit ce que dit',
    "la personne, dis-le sans trancher a sa place -- une note peut etre perimee.",
  ].join('\n');
}

module.exports = {
  buildSongcraftGraphContext,
  buildChatGraphContext,
  buildChatSearchQuery,
  buildSearchQuery,
  formatExtracts,
};
