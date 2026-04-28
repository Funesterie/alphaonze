'use strict';
/**
 * Memory Consolidator — Synthèse automatique des mémoires d'A11
 *
 * Tourne en background et :
 * 1. Lit les nouvelles conversations JSONL
 * 2. Extrait les faits importants via LLM
 * 3. Alimente le Knowledge Graph
 * 4. Met à jour la mémoire épisodique
 * 5. Génère des snapshots périodiques
 *
 * Comme Senku qui transforme chaque expérience en connaissance structurée.
 */

const fs = require('node:fs');
const path = require('node:path');
const { getLogger } = require('./structured-logger.cjs');

const logger = getLogger({ component: 'memory-consolidator' });

const DEFAULT_INTERVAL_MS = Number(process.env.A11_CONSOLIDATION_INTERVAL_MS || 10 * 60 * 1000); // 10 min
const CONVERSATIONS_DIR = path.resolve(
  process.env.A11_DATA_ROOT || path.resolve(__dirname, '../../../'),
  'a11_memory/conversations'
);
const CONSOLIDATION_STATE_PATH = path.resolve(
  process.env.A11_RUNTIME_ROOT || path.resolve(__dirname, '../../../runtime'),
  'memory-consolidation-state.json'
);

// ─── State ────────────────────────────────────────────────────────────────────

let _timer = null;
let _running = false;
let _knowledgeGraph = null;
let _episodicMemory = null;
let _llmCall = null; // injected: async (messages) => string

// ─── State persistence ────────────────────────────────────────────────────────

function loadState() {
  try {
    if (fs.existsSync(CONSOLIDATION_STATE_PATH)) {
      return JSON.parse(fs.readFileSync(CONSOLIDATION_STATE_PATH, 'utf8'));
    }
  } catch {}
  return { lastProcessedAt: null, processedFiles: [] };
}

function saveState(state) {
  try {
    fs.mkdirSync(path.dirname(CONSOLIDATION_STATE_PATH), { recursive: true });
    fs.writeFileSync(CONSOLIDATION_STATE_PATH, JSON.stringify(state, null, 2), 'utf8');
  } catch (err) {
    logger.warn('Failed to save consolidation state', { error: err.message });
  }
}

// ─── Conversation parsing ─────────────────────────────────────────────────────

function readConversationFile(filePath) {
  try {
    const lines = fs.readFileSync(filePath, 'utf8').trim().split('\n').filter(Boolean);
    return lines.map(line => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean);
  } catch {
    return [];
  }
}

function extractTextFromEntry(entry) {
  const messages = entry?.messages || entry?.conversation || [];
  return messages
    .filter(m => m?.role === 'user' || m?.role === 'assistant')
    .map(m => `${m.role === 'user' ? 'User' : 'A11'}: ${String(m.content || '').slice(0, 500)}`)
    .join('\n');
}

// ─── LLM extraction ───────────────────────────────────────────────────────────

async function extractFactsFromText(text) {
  if (!_llmCall || !text?.trim()) return [];

  try {
    const prompt = `Analyse cette conversation et extrais les faits importants à retenir sur l'utilisateur, ses préférences, ses projets, et les décisions prises. Réponds UNIQUEMENT avec un JSON array de strings courtes (max 100 chars chacune). Si rien d'important, réponds [].

Conversation:
${text.slice(0, 2000)}

Faits importants (JSON array):`;

    const result = await _llmCall([{ role: 'user', content: prompt }]);
    const match = String(result || '').match(/\[[\s\S]*\]/);
    if (!match) return [];
    const parsed = JSON.parse(match[0]);
    return Array.isArray(parsed) ? parsed.filter(f => typeof f === 'string' && f.trim()) : [];
  } catch {
    return [];
  }
}

async function extractTripletsFromText(text) {
  if (!_llmCall || !text?.trim()) return [];

  try {
    const prompt = `Extrais les relations importantes de cette conversation sous forme de triplets (sujet, prédicat, objet). Réponds UNIQUEMENT avec un JSON array d'objets {subject, predicate, object}. Si rien, réponds [].

Conversation:
${text.slice(0, 2000)}

Triplets (JSON array):`;

    const result = await _llmCall([{ role: 'user', content: prompt }]);
    const match = String(result || '').match(/\[[\s\S]*\]/);
    if (!match) return [];
    const parsed = JSON.parse(match[0]);
    return Array.isArray(parsed) ? parsed.filter(t => t?.subject && t?.predicate && t?.object) : [];
  } catch {
    return [];
  }
}

// ─── Core consolidation ───────────────────────────────────────────────────────

async function consolidateFile(filePath, state) {
  if (state.processedFiles.includes(filePath)) return 0;

  const entries = readConversationFile(filePath);
  if (!entries.length) return 0;

  let processed = 0;

  for (const entry of entries.slice(-20)) { // Max 20 dernières entrées par fichier
    const text = extractTextFromEntry(entry);
    if (!text?.trim()) continue;

    const userId = entry?.userId || entry?.user_id || 'anonymous';

    // Extraire les faits → mémoire épisodique
    if (_episodicMemory) {
      try {
        const facts = await extractFactsFromText(text);
        for (const fact of facts.slice(0, 5)) {
          await _episodicMemory.addEpisode(userId, {
            type: 'fact',
            content: fact,
            source: 'consolidation',
            conversationFile: path.basename(filePath),
          });
        }
      } catch (err) {
        logger.debug('Episodic extraction failed', { error: err.message });
      }
    }

    // Extraire les triplets → knowledge graph
    if (_knowledgeGraph) {
      try {
        const triplets = await extractTripletsFromText(text);
        if (triplets.length > 0) {
          await _knowledgeGraph.addTriplets(userId, triplets);
        }
      } catch (err) {
        logger.debug('Triplet extraction failed', { error: err.message });
      }
    }

    processed++;
  }

  return processed;
}

async function runConsolidation() {
  if (_running) return;
  _running = true;

  const state = loadState();
  let totalProcessed = 0;

  try {
    if (!fs.existsSync(CONVERSATIONS_DIR)) {
      logger.debug('No conversations directory found', { path: CONVERSATIONS_DIR });
      return;
    }

    const files = fs.readdirSync(CONVERSATIONS_DIR)
      .filter(f => f.endsWith('.jsonl'))
      .sort()
      .slice(-7) // 7 derniers jours
      .map(f => path.join(CONVERSATIONS_DIR, f));

    for (const file of files) {
      try {
        const count = await consolidateFile(file, state);
        if (count > 0) {
          totalProcessed += count;
          logger.info('Consolidated file', { file: path.basename(file), entries: count });
        }
      } catch (err) {
        logger.warn('Failed to consolidate file', { file, error: err.message });
      }
    }

    // Marquer les fichiers traités (sauf le fichier du jour — il peut encore recevoir des entrées)
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const processedFiles = files
      .filter(f => !path.basename(f).startsWith(today))
      .map(f => f);

    state.processedFiles = [...new Set([...state.processedFiles, ...processedFiles])].slice(-30);
    state.lastProcessedAt = new Date().toISOString();
    saveState(state);

    if (totalProcessed > 0) {
      logger.info('Memory consolidation complete', { totalProcessed });
    }
  } catch (err) {
    logger.error('Consolidation error', { error: err.message });
  } finally {
    _running = false;
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

function start({ knowledgeGraph, episodicMemory, llmCall, intervalMs } = {}) {
  _knowledgeGraph = knowledgeGraph || null;
  _episodicMemory = episodicMemory || null;
  _llmCall = llmCall || null;

  const interval = intervalMs || DEFAULT_INTERVAL_MS;

  // Premier run après 2 minutes (laisser le serveur démarrer)
  setTimeout(() => {
    runConsolidation();
    _timer = setInterval(runConsolidation, interval);
  }, 2 * 60 * 1000);

  logger.info('Memory consolidator started', { intervalMs: interval });
}

function stop() {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
  logger.info('Memory consolidator stopped');
}

async function runNow() {
  return runConsolidation();
}

function getStatus() {
  const state = loadState();
  return {
    running: _running,
    active: !!_timer,
    lastProcessedAt: state.lastProcessedAt,
    processedFilesCount: state.processedFiles.length,
    hasKnowledgeGraph: !!_knowledgeGraph,
    hasEpisodicMemory: !!_episodicMemory,
    hasLlmCall: !!_llmCall,
  };
}

module.exports = { start, stop, runNow, getStatus };
