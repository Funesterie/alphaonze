// vector-memory.cjs
// Système de mémoire vectorielle (RAG) pour A11
// Utilise Ollama pour générer des embeddings et recherche par similarité cosinus

const fs = require('node:fs');
const path = require('node:path');
const { getLogger } = require('./structured-logger.cjs');
const {
  isSemanticMemoryText,
  shouldStoreSemanticExchange,
} = require('./semantic-memory-filter.cjs');

const logger = getLogger({ component: 'vector-memory' });

/**
 * Calcule la similarité cosinus entre deux vecteurs
 */
function cosineSimilarity(vecA, vecB) {
  if (!Array.isArray(vecA) || !Array.isArray(vecB) || vecA.length !== vecB.length) {
    return 0;
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }

  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Génère un embedding vectoriel via Ollama
 */
function isEnvEnabled(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return null;
}

function areEmbeddingsEnabled(options = {}, env = process.env) {
  const explicit = isEnvEnabled(env.A11_ENABLE_EMBEDDINGS);
  if (explicit !== null) return explicit;
  if (options.ollamaBase || env.A11_EMBEDDING_BASE_URL || env.OLLAMA_BASE) return true;
  if (String(env.NODE_ENV || '').trim().toLowerCase() === 'production') return false;
  return true;
}

function resolveEmbeddingBaseUrl(options = {}, env = process.env) {
  return options.ollamaBase || env.A11_EMBEDDING_BASE_URL || env.OLLAMA_BASE || 'http://127.0.0.1:11434';
}

async function generateEmbedding(text, options = {}) {
  const normalizedText = String(text || '').trim();
  if (!isSemanticMemoryText(normalizedText, { maxChars: options.maxChars || 9000 })) {
    logger.debug('Skipping embedding for non-semantic payload');
    return null;
  }

  // Vérifier si les embeddings sont activés
  const enableEmbeddings = areEmbeddingsEnabled(options);
  if (!enableEmbeddings) {
    logger.debug('Embeddings disabled or not configured');
    return null;
  }

  const ollamaBase = resolveEmbeddingBaseUrl(options);
  const model = options.model || process.env.A11_EMBEDDING_MODEL || 'nomic-embed-text';

  try {
    const response = await fetch(`${ollamaBase}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt: normalizedText,
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama embeddings failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return Array.isArray(data.embedding) ? data.embedding : null;
  } catch (error) {
    logger.warn('Failed to generate embedding', { error: String(error?.message || error) });
    return null;
  }
}

/**
 * Classe pour gérer la mémoire vectorielle
 */
class VectorMemory {
  constructor(options = {}) {
    this.userId = options.userId;
    this.conversationId = options.conversationId || 'default';
    this.storageDir = options.storageDir || path.join(
      process.env.A11_RUNTIME_ROOT || process.cwd(),
      'vector-memory'
    );
    this.maxEntries = options.maxEntries || 1000;
    this.entries = [];
    this.logger = logger.child({ userId: this.userId, conversationId: this.conversationId });

    this._ensureStorageDir();
    this._load();
  }

  _ensureStorageDir() {
    try {
      if (!fs.existsSync(this.storageDir)) {
        fs.mkdirSync(this.storageDir, { recursive: true });
      }
    } catch (error) {
      this.logger.error('Failed to create storage directory', { error });
    }
  }

  _getStoragePath() {
    const filename = `${this.userId}_${this.conversationId}.jsonl`;
    return path.join(this.storageDir, filename);
  }

  _load() {
    const storagePath = this._getStoragePath();
    if (!fs.existsSync(storagePath)) {
      this.entries = [];
      return;
    }

    try {
      const content = fs.readFileSync(storagePath, 'utf8');
      const lines = content.split('\n').filter(Boolean);
      this.entries = lines.map((line) => JSON.parse(line));
      this.logger.info('Loaded vector memory', { entryCount: this.entries.length });
    } catch (error) {
      this.logger.error('Failed to load vector memory', { error });
      this.entries = [];
    }
  }

  _save() {
    const storagePath = this._getStoragePath();
    try {
      const content = this.entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n';
      fs.writeFileSync(storagePath, content, 'utf8');
    } catch (error) {
      this.logger.error('Failed to save vector memory', { error });
    }
  }

  /**
   * Ajoute un échange (user + assistant) à la mémoire vectorielle
   */
  async addExchange(userMessage, assistantMessage, metadata = {}) {
    if (!userMessage || !assistantMessage) return null;
    if (!shouldStoreSemanticExchange(userMessage, assistantMessage)) {
      this.logger.debug('Skipping vector memory for non-semantic exchange');
      return null;
    }

    const text = `User: ${userMessage}\nAssistant: ${assistantMessage}`;
    const embedding = await generateEmbedding(text);

    if (!embedding) {
      this.logger.debug('No embedding stored for exchange');
      return null;
    }

    const entry = {
      id: `exchange_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      userMessage: String(userMessage).trim(),
      assistantMessage: String(assistantMessage).trim(),
      embedding,
      metadata: {
        ...metadata,
        userId: this.userId,
        conversationId: this.conversationId,
      },
    };

    this.entries.push(entry);

    // Limiter le nombre d'entrées (FIFO)
    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(-this.maxEntries);
    }

    this._save();
    this.logger.debug('Added exchange to vector memory', { id: entry.id });
    return entry;
  }

  /**
   * Recherche les K échanges les plus similaires à une requête
   */
  async search(query, options = {}) {
    const k = options.k || 5;
    const minSimilarity = options.minSimilarity || 0.5;

    if (!query || this.entries.length === 0 || !isSemanticMemoryText(query)) {
      return [];
    }

    const queryEmbedding = await generateEmbedding(query);
    if (!queryEmbedding) {
      this.logger.debug('No embedding available for query');
      return [];
    }

    // Calculer la similarité pour chaque entrée
    const results = this.entries
      .map((entry) => ({
        ...entry,
        similarity: cosineSimilarity(queryEmbedding, entry.embedding),
      }))
      .filter((entry) => entry.similarity >= minSimilarity)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, k);

    this.logger.debug('Vector search completed', {
      query: query.slice(0, 50),
      resultCount: results.length,
      topSimilarity: results[0]?.similarity,
    });

    return results;
  }

  /**
   * Récupère le contexte pertinent pour une requête
   */
  async getRelevantContext(query, options = {}) {
    const results = await this.search(query, options);

    if (results.length === 0) {
      return {
        found: false,
        context: '',
        exchanges: [],
      };
    }

    // Formater le contexte pour injection dans le prompt
    const contextLines = results.map((result, index) => {
      const timeAgo = this._formatTimeAgo(result.timestamp);
      return [
        `[Échange pertinent #${index + 1} - ${timeAgo} - similarité: ${(result.similarity * 100).toFixed(1)}%]`,
        `User: ${result.userMessage}`,
        `Assistant: ${result.assistantMessage}`,
        '',
      ].join('\n');
    });

    return {
      found: true,
      context: contextLines.join('\n'),
      exchanges: results.map((r) => ({
        userMessage: r.userMessage,
        assistantMessage: r.assistantMessage,
        timestamp: r.timestamp,
        similarity: r.similarity,
      })),
    };
  }

  _formatTimeAgo(timestamp) {
    const now = Date.now();
    const then = new Date(timestamp).getTime();
    const diffMs = now - then;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'à l\'instant';
    if (diffMins < 60) return `il y a ${diffMins} min`;
    if (diffHours < 24) return `il y a ${diffHours}h`;
    return `il y a ${diffDays}j`;
  }

  /**
   * Nettoie les entrées anciennes
   */
  pruneOldEntries(maxAgeDays = 30) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - maxAgeDays);
    const cutoffTimestamp = cutoffDate.toISOString();

    const before = this.entries.length;
    this.entries = this.entries.filter((entry) => entry.timestamp >= cutoffTimestamp);
    const removed = before - this.entries.length;

    if (removed > 0) {
      this._save();
      this.logger.info('Pruned old vector memory entries', { removed, remaining: this.entries.length });
    }

    return { removed, remaining: this.entries.length };
  }

  /**
   * Statistiques de la mémoire
   */
  getStats() {
    return {
      entryCount: this.entries.length,
      maxEntries: this.maxEntries,
      oldestEntry: this.entries[0]?.timestamp,
      newestEntry: this.entries[this.entries.length - 1]?.timestamp,
      storageSize: this._getStorageSize(),
    };
  }

  _getStorageSize() {
    try {
      const storagePath = this._getStoragePath();
      if (!fs.existsSync(storagePath)) return 0;
      const stats = fs.statSync(storagePath);
      return stats.size;
    } catch {
      return 0;
    }
  }
}

/**
 * Factory pour créer une instance de VectorMemory
 */
function createVectorMemory(userId, conversationId, options = {}) {
  return new VectorMemory({
    userId,
    conversationId,
    ...options,
  });
}

module.exports = {
  VectorMemory,
  createVectorMemory,
  generateEmbedding,
  cosineSimilarity,
  areEmbeddingsEnabled,
  resolveEmbeddingBaseUrl,
};
