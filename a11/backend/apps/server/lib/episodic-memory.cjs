// episodic-memory.cjs
// Mémoire épisodique pour A11 - Stockage des préférences et événements utilisateur
// Architecture simple : stockage JSON plat, pas de ML ni heuristiques

const fs = require('node:fs');
const path = require('node:path');
const { getLogger } = require('./structured-logger.cjs');

const logger = getLogger({ component: 'episodic-memory' });

const MEMORY_DIR = process.env.A11_EPISODIC_MEMORY_DIR || path.join(__dirname, '../../../a11_memory/episodic');
const MAX_EPISODES_PER_USER = Number(process.env.A11_MAX_EPISODES_PER_USER || 1000);
const EPISODE_RETENTION_DAYS = Number(process.env.A11_EPISODE_RETENTION_DAYS || 90);

/**
 * Initialise le répertoire de mémoire épisodique
 */
function ensureMemoryDir() {
  try {
    if (!fs.existsSync(MEMORY_DIR)) {
      fs.mkdirSync(MEMORY_DIR, { recursive: true });
      logger.info('Episodic memory directory created', { path: MEMORY_DIR });
    }
  } catch (error) {
    logger.error('Failed to create episodic memory directory', { error, path: MEMORY_DIR });
  }
}

/**
 * Chemin du fichier de mémoire pour un utilisateur
 */
function getUserMemoryPath(userId) {
  const normalized = String(userId || 'anonymous').replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(MEMORY_DIR, `${normalized}.json`);
}

/**
 * Charge la mémoire épisodique d'un utilisateur
 */
function loadUserEpisodes(userId) {
  const filePath = getUserMemoryPath(userId);
  
  try {
    if (!fs.existsSync(filePath)) {
      return [];
    }
    
    const content = fs.readFileSync(filePath, 'utf8');
    const episodes = JSON.parse(content);
    
    if (!Array.isArray(episodes)) {
      logger.warn('Invalid episodes format, resetting', { userId });
      return [];
    }
    
    return episodes;
  } catch (error) {
    logger.error('Failed to load user episodes', { error, userId });
    return [];
  }
}

/**
 * Sauvegarde la mémoire épisodique d'un utilisateur
 */
function saveUserEpisodes(userId, episodes) {
  ensureMemoryDir();
  const filePath = getUserMemoryPath(userId);
  
  try {
    fs.writeFileSync(filePath, JSON.stringify(episodes, null, 2), 'utf8');
    return true;
  } catch (error) {
    logger.error('Failed to save user episodes', { error, userId });
    return false;
  }
}

/**
 * Ajoute un épisode à la mémoire
 */
function addEpisode(userId, type, content, metadata = {}) {
  const normalizedUserId = String(userId || '').trim();
  const normalizedType = String(type || 'event').trim();
  const normalizedContent = String(content || '').trim();
  
  if (!normalizedUserId || !normalizedContent) {
    logger.warn('Cannot add episode: missing userId or content');
    return { ok: false, error: 'missing_required_fields' };
  }
  
  const episodes = loadUserEpisodes(normalizedUserId);
  
  const episode = {
    id: `ep_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    userId: normalizedUserId,
    type: normalizedType,
    content: normalizedContent,
    metadata: metadata || {},
    timestamp: new Date().toISOString(),
    createdAt: Date.now(),
  };
  
  episodes.push(episode);
  
  // Nettoyer les vieux épisodes si nécessaire
  const cleaned = cleanOldEpisodes(episodes);
  
  // Limiter le nombre total d'épisodes
  const limited = cleaned.slice(-MAX_EPISODES_PER_USER);
  
  const saved = saveUserEpisodes(normalizedUserId, limited);
  
  if (!saved) {
    return { ok: false, error: 'save_failed' };
  }
  
  logger.debug('Episode added', { userId: normalizedUserId, type: normalizedType, episodeId: episode.id });
  
  return {
    ok: true,
    episode,
    totalEpisodes: limited.length,
  };
}

/**
 * Récupère les épisodes d'un utilisateur avec filtres optionnels
 */
function getEpisodes(userId, options = {}) {
  const normalizedUserId = String(userId || '').trim();
  
  if (!normalizedUserId) {
    return { ok: false, error: 'missing_user_id', episodes: [] };
  }
  
  let episodes = loadUserEpisodes(normalizedUserId);
  
  // Filtre par type
  if (options.type) {
    const typeFilter = String(options.type).trim();
    episodes = episodes.filter((ep) => ep.type === typeFilter);
  }
  
  // Filtre par date (depuis X jours)
  if (options.days) {
    const days = Number(options.days);
    if (days > 0) {
      const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
      episodes = episodes.filter((ep) => ep.createdAt >= cutoff);
    }
  }
  
  // Filtre par date de début
  if (options.since) {
    const since = new Date(options.since).getTime();
    if (!isNaN(since)) {
      episodes = episodes.filter((ep) => ep.createdAt >= since);
    }
  }
  
  // Filtre par date de fin
  if (options.until) {
    const until = new Date(options.until).getTime();
    if (!isNaN(until)) {
      episodes = episodes.filter((ep) => ep.createdAt <= until);
    }
  }
  
  // Limite le nombre de résultats
  const limit = Math.max(1, Math.min(1000, Number(options.limit || 100)));
  const limited = episodes.slice(-limit);
  
  return {
    ok: true,
    episodes: limited,
    total: limited.length,
    filtered: episodes.length !== loadUserEpisodes(normalizedUserId).length,
  };
}

/**
 * Récupère les préférences utilisateur (épisodes de type 'preference')
 */
function getPreferences(userId) {
  return getEpisodes(userId, { type: 'preference' });
}

/**
 * Définit une préférence utilisateur
 */
function setPreference(userId, key, value, metadata = {}) {
  const content = `${key}: ${value}`;
  return addEpisode(userId, 'preference', content, { key, value, ...metadata });
}

/**
 * Récupère le contexte récent (derniers N jours)
 */
function getRecentContext(userId, days = 7) {
  return getEpisodes(userId, { days });
}

/**
 * Nettoie les épisodes trop anciens
 */
function cleanOldEpisodes(episodes) {
  const cutoff = Date.now() - EPISODE_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  return episodes.filter((ep) => ep.createdAt >= cutoff);
}

/**
 * Supprime un épisode par ID
 */
function deleteEpisode(userId, episodeId) {
  const normalizedUserId = String(userId || '').trim();
  const normalizedEpisodeId = String(episodeId || '').trim();
  
  if (!normalizedUserId || !normalizedEpisodeId) {
    return { ok: false, error: 'missing_required_fields' };
  }
  
  const episodes = loadUserEpisodes(normalizedUserId);
  const filtered = episodes.filter((ep) => ep.id !== normalizedEpisodeId);
  
  if (filtered.length === episodes.length) {
    return { ok: false, error: 'episode_not_found' };
  }
  
  const saved = saveUserEpisodes(normalizedUserId, filtered);
  
  if (!saved) {
    return { ok: false, error: 'save_failed' };
  }
  
  logger.debug('Episode deleted', { userId: normalizedUserId, episodeId: normalizedEpisodeId });
  
  return {
    ok: true,
    deleted: true,
    remainingEpisodes: filtered.length,
  };
}

/**
 * Supprime tous les épisodes d'un utilisateur
 */
function clearUserEpisodes(userId) {
  const normalizedUserId = String(userId || '').trim();
  
  if (!normalizedUserId) {
    return { ok: false, error: 'missing_user_id' };
  }
  
  const saved = saveUserEpisodes(normalizedUserId, []);
  
  if (!saved) {
    return { ok: false, error: 'save_failed' };
  }
  
  logger.info('User episodes cleared', { userId: normalizedUserId });
  
  return {
    ok: true,
    cleared: true,
  };
}

/**
 * Construit un contexte textuel à partir des épisodes récents
 */
function buildEpisodicContext(userId, days = 7) {
  const result = getRecentContext(userId, days);
  
  if (!result.ok || result.episodes.length === 0) {
    return '';
  }
  
  const lines = [];
  
  // Grouper par type
  const byType = {};
  for (const ep of result.episodes) {
    if (!byType[ep.type]) {
      byType[ep.type] = [];
    }
    byType[ep.type].push(ep);
  }
  
  // Préférences
  if (byType.preference && byType.preference.length > 0) {
    lines.push('Préférences utilisateur :');
    for (const ep of byType.preference) {
      lines.push(`- ${ep.content}`);
    }
    lines.push('');
  }
  
  // Événements
  if (byType.event && byType.event.length > 0) {
    lines.push('Événements récents :');
    for (const ep of byType.event.slice(-5)) {
      const date = new Date(ep.timestamp).toLocaleDateString('fr-FR');
      lines.push(`- [${date}] ${ep.content}`);
    }
    lines.push('');
  }
  
  // Contexte
  if (byType.context && byType.context.length > 0) {
    lines.push('Contexte récent :');
    for (const ep of byType.context.slice(-3)) {
      lines.push(`- ${ep.content}`);
    }
    lines.push('');
  }
  
  return lines.join('\n').trim();
}

/**
 * Statistiques de la mémoire épisodique
 */
function getStats(userId) {
  const normalizedUserId = String(userId || '').trim();
  
  if (!normalizedUserId) {
    return { ok: false, error: 'missing_user_id' };
  }
  
  const episodes = loadUserEpisodes(normalizedUserId);
  
  const byType = {};
  let oldest = null;
  let newest = null;
  
  for (const ep of episodes) {
    byType[ep.type] = (byType[ep.type] || 0) + 1;
    
    if (!oldest || ep.createdAt < oldest) {
      oldest = ep.createdAt;
    }
    if (!newest || ep.createdAt > newest) {
      newest = ep.createdAt;
    }
  }
  
  return {
    ok: true,
    userId: normalizedUserId,
    totalEpisodes: episodes.length,
    byType,
    oldestEpisode: oldest ? new Date(oldest).toISOString() : null,
    newestEpisode: newest ? new Date(newest).toISOString() : null,
    retentionDays: EPISODE_RETENTION_DAYS,
    maxEpisodes: MAX_EPISODES_PER_USER,
  };
}

module.exports = {
  addEpisode,
  getEpisodes,
  getPreferences,
  setPreference,
  getRecentContext,
  deleteEpisode,
  clearUserEpisodes,
  buildEpisodicContext,
  getStats,
};
