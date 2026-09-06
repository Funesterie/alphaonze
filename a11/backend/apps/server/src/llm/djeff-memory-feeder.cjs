'use strict';
/**
 * djeff-memory-feeder.cjs — Worker background qui alimente le LLM Djeff depuis Neo4j.
 *
 * Tourne en boucle, récupère les dernières conversations/décisions/notes du graphe,
 * et les condense en contexte injecté dans les sessions suivantes.
 *
 * Ce n'est PAS du fine-tuning (impossible sur Ollama sans réentraîner le GGUF).
 * C'est du RAG : on enrichit le contexte de chaque appel avec les données pertinentes.
 *
 * Le modèle djeff-engine garde son system prompt fixe (le Modelfile),
 * et reçoit en plus un bloc "mémoire récente" extrait du graphe.
 */

const neo4j = require('neo4j-driver');

const NEO4J_URI = process.env.NEO4J_URI || 'bolt://a11-neo4j:7687';
const NEO4J_USER = process.env.NEO4J_USERNAME || process.env.NEO4J_USER || 'neo4j';
const NEO4J_PASS = process.env.NEO4J_PASSWORD || '';
const NEO4J_DB = process.env.NEO4J_DATABASE || 'neo4j';

const REFRESH_INTERVAL_MS = Number(process.env.DJEFF_MEMORY_REFRESH_MS || 5 * 60 * 1000); // 5 min
const MAX_MEMORY_ITEMS = 50;

let _memoryCache = [];
let _lastRefresh = 0;
let _driver = null;

function getDriver() {
  if (!_driver && NEO4J_PASS) {
    _driver = neo4j.driver(NEO4J_URI, neo4j.auth.basic(NEO4J_USER, NEO4J_PASS));
  }
  return _driver;
}

/**
 * Récupère les éléments de mémoire récents depuis Neo4j.
 */
async function fetchRecentMemory() {
  const driver = getDriver();
  if (!driver) return [];

  const session = driver.session({ database: NEO4J_DB });
  try {
    const result = await session.run(`
      MATCH (m)
      WHERE m:ChatMessage OR m:AgentDialogueMessage OR m:MemoryNote
      WITH m ORDER BY m.createdAt DESC LIMIT $limit
      RETURN 
        labels(m)[0] AS type,
        m.content AS content,
        m.role AS role,
        m.from AS author,
        m.createdAt AS date,
        m.title AS title
    `, { limit: neo4j.int(MAX_MEMORY_ITEMS) });

    return result.records.map(r => ({
      type: r.get('type'),
      content: (r.get('content') || r.get('title') || '').slice(0, 500),
      role: r.get('role') || r.get('author') || 'system',
      date: r.get('date') || '',
    }));
  } catch (err) {
    console.warn('[djeff-memory] Neo4j fetch failed:', err.message);
    return [];
  } finally {
    await session.close();
  }
}

/**
 * Rafraîchit le cache mémoire si nécessaire.
 */
async function refreshMemory() {
  const now = Date.now();
  if (now - _lastRefresh < REFRESH_INTERVAL_MS && _memoryCache.length > 0) {
    return _memoryCache;
  }
  _memoryCache = await fetchRecentMemory();
  _lastRefresh = now;
  return _memoryCache;
}

/**
 * Construit le bloc de contexte mémoire pour injection dans le prompt.
 */
async function buildMemoryContext() {
  const items = await refreshMemory();
  if (!items.length) return '';

  const lines = items.slice(0, 20).map(item => {
    const prefix = item.role === 'human' ? '[Djeff]' : `[${item.role}]`;
    return `${prefix} ${item.content.slice(0, 300)}`;
  });

  return `\n--- MÉMOIRE RÉCENTE (${items.length} éléments) ---\n${lines.join('\n')}\n---\n`;
}

/**
 * Enrichit un tableau de messages avec le contexte mémoire.
 */
async function injectMemoryIntoMessages(messages) {
  const memoryBlock = await buildMemoryContext();
  if (!memoryBlock) return messages;

  // Injecter comme premier message system après le system prompt
  const enriched = [...messages];
  const systemIdx = enriched.findIndex(m => m.role === 'system');
  const insertAt = systemIdx >= 0 ? systemIdx + 1 : 0;
  enriched.splice(insertAt, 0, {
    role: 'system',
    content: memoryBlock,
  });
  return enriched;
}

module.exports = {
  refreshMemory,
  buildMemoryContext,
  injectMemoryIntoMessages,
  fetchRecentMemory,
};
