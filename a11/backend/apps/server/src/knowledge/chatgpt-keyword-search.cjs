'use strict';

/**
 * Recherche par mot-cle dans l'historique ChatGPT.
 *
 * L'export pese 218 Mo: l'injecter dans le graphe l'aurait fait passer de 2 600 noeuds
 * a plusieurs centaines de milliers. L'index inverse tient en 17 Mo et rend les 25 451
 * passages interrogeables sans toucher au graphe.
 *
 * L'index est charge une fois puis garde en memoire: le relire a chaque requete
 * couterait 17 Mo de lecture disque par recherche.
 */

const fs = require('node:fs');
const path = require('node:path');

const { getCanonicalRuntimeRoot } = require('../../lib/runtime-root.cjs');

let cache = null;
let cacheKey = '';
let lastUse = 0;

// L'index en memoire coute 114 Mo, pour une fonction qui ne sert que pendant l'ecriture
// d'une chanson. Le garder indefiniment immobiliserait cette memoire pour rien; le
// relire coute 123 ms, negligeable devant une production musicale.
const IDLE_EVICT_MS = 600000;

function evictIfIdle() {
  if (cache && lastUse && Date.now() - lastUse > IDLE_EVICT_MS) {
    cache = null;
    cacheKey = '';
  }
}

function resolveIndexPath(env = process.env) {
  const configured = String(env.A11_CHATGPT_KEYWORD_INDEX || '').trim();
  if (configured) return path.resolve(configured);
  return path.join(getCanonicalRuntimeRoot(env), 'chatgpt-keyword-index.json');
}

function loadIndex(env = process.env) {
  evictIfIdle();
  const file = resolveIndexPath(env);
  if (!fs.existsSync(file)) return null;
  let stamp;
  try { stamp = String(fs.statSync(file).mtimeMs); } catch { return null; }
  lastUse = Date.now();
  // Rechargement uniquement si le fichier a change: l'index est volumineux.
  if (cache && cacheKey === `${file}:${stamp}`) return cache;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!parsed?.index || !Array.isArray(parsed?.passages_meta)) return null;
    cache = parsed;
    cacheKey = `${file}:${stamp}`;
    return cache;
  } catch {
    return null;
  }
}

function foldQuery(query) {
  return String(query || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((w) => w.length >= 4 && w.length <= 24);
}

/**
 * Cherche les passages qui contiennent le plus de termes de la requete.
 * Renvoie une liste vide plutot que d'echouer si l'index n'existe pas.
 */
function searchChatGptHistory(query = '', { limit = 6, env = process.env } = {}) {
  const data = loadIndex(env);
  if (!data) return { ok: false, reason: 'index_absent', results: [] };

  const terms = [...new Set(foldQuery(query))].slice(0, 10);
  if (!terms.length) return { ok: true, terms: [], results: [] };

  // Compter les termes a poids egal remontait n'importe quoi: "vivy voix musique"
  // sortait une plainte de tapage nocturne, parce que "musique" est partout. Un terme
  // rare en dit bien plus qu'un terme courant, donc chacun pese log(N / frequence).
  const total = Math.max(1, Number(data.passages) || 1);
  const scores = new Map();
  const matched = new Map();
  for (const term of terms) {
    const postings = data.index[term];
    if (!Array.isArray(postings) || !postings.length) continue;
    // Un terme present dans la moitie du corpus ne discrimine rien.
    if (postings.length > total * 0.5) continue;
    const weight = Math.log(total / postings.length);
    for (const id of postings) {
      scores.set(id, (scores.get(id) || 0) + weight);
      matched.set(id, (matched.get(id) || 0) + 1);
    }
  }
  if (!scores.size) return { ok: true, terms, results: [] };

  const ranked = [...scores.entries()]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, Math.max(1, Math.min(30, Number(limit) || 6)));

  const results = ranked.map(([id, score]) => {
    const meta = data.passages_meta[id] || {};
    return {
      score: Math.round(score * 100) / 100,
      matched: matched.get(id) || 0,
      title: meta.title || '',
      role: meta.role || '',
      conversationId: meta.conversationId || '',
      chars: meta.chars || 0,
      preview: meta.preview || '',
    };
  }).filter((r) => r.preview);

  return { ok: true, terms, total: scores.size, results };
}

function getChatGptIndexStatus(env = process.env) {
  const file = resolveIndexPath(env);
  if (!fs.existsSync(file)) return { present: false, path: file };
  const data = loadIndex(env);
  return {
    present: Boolean(data),
    path: file,
    bytes: fs.statSync(file).size,
    conversations: data?.conversations || 0,
    passages: data?.passages || 0,
    terms: data?.terms || 0,
    builtAt: data?.builtAt || '',
  };
}

module.exports = {
  searchChatGptHistory,
  getChatGptIndexStatus,
  resolveIndexPath,
};
