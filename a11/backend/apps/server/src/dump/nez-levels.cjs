'use strict';
/**
 * NEZ LEVELS — Système de niveaux d'accès à 10 étages
 *
 * Chaque personne ou agent reçoit un niveau d'accès qui détermine
 * quels pipelines, quels outils MCP et quelles données il peut utiliser.
 *
 *   Niveau 1  : Visiteur (lecture publique uniquement)
 *   Niveaux 2-5 : Utilisateurs (dialogue, lecture, outils limités)
 *   Niveaux 6-9 : Métiers (outils étendus, écriture contrôlée, pipelines)
 *   Niveau 10 : Gestionnaire de compte (admin partiel, tous les pipelines)
 *
 * Chaque niveau obtient son assistant IA, ses données et ses outils MCP autorisés.
 * NEZ vérifie l'identité, le niveau, et les capabilities à chaque requête.
 */

const SCHEMA = 'nossen.nez_levels.v1';

// ─── Level definitions ──────────────────────────────────────────────────────

const LEVELS = {
  1: {
    name: 'visitor',
    label: 'Visiteur',
    pipelines: ['public'],
    mcpTools: ['search', 'fetch', 'health'],
    dataAccess: 'public_only',
    canWrite: false,
    canShell: false,
    canAdmin: false,
    description: 'Lecture publique uniquement. Aucune écriture, aucun shell, aucun admin.',
  },
  2: {
    name: 'user_basic',
    label: 'Utilisateur de base',
    pipelines: ['public', 'memory_read'],
    mcpTools: ['search', 'fetch', 'health', 'a11_status', 'kaen44_status', 'qflush_status'],
    dataAccess: 'public + own_memory',
    canWrite: false,
    canShell: false,
    canAdmin: false,
    description: 'Dialogue + lecture de sa propre mémoire. Pas d écriture.',
  },
  3: {
    name: 'user',
    label: 'Utilisateur',
    pipelines: ['public', 'memory_read', 'memory_write', 'dialogue'],
    mcpTools: ['search', 'fetch', 'health', 'a11_status', 'kaen44_status', 'qflush_status', 'a11_chat', 'discussion_list', 'discussion_read'],
    dataAccess: 'public + own_memory + dialogue',
    canWrite: true,
    canShell: false,
    canAdmin: false,
    description: 'Dialogue + écriture mémoire + discussion entre agents.',
  },
  4: {
    name: 'user_advanced',
    label: 'Utilisateur avancé',
    pipelines: ['public', 'memory_read', 'memory_write', 'dialogue', 'audio_read'],
    mcpTools: ['search', 'fetch', 'health', 'a11_status', 'kaen44_status', 'qflush_status', 'a11_chat', 'discussion_list', 'discussion_read', 'discussion_post', 'qflush_sources_status'],
    dataAccess: 'public + own_memory + dialogue + audio_read',
    canWrite: true,
    canShell: false,
    canAdmin: false,
    description: 'Ajoute audio en lecture et écriture de discussions.',
  },
  5: {
    name: 'user_premium',
    label: 'Utilisateur premium',
    pipelines: ['public', 'memory_read', 'memory_write', 'dialogue', 'audio_read', 'audio_write'],
    mcpTools: ['search', 'fetch', 'health', 'a11_status', 'kaen44_status', 'qflush_status', 'a11_chat', 'discussion_list', 'discussion_read', 'discussion_post', 'qflush_sources_status', 'qflush_sources_select', 'memory_write_safe'],
    dataAccess: 'public + own_memory + dialogue + audio',
    canWrite: true,
    canShell: false,
    canAdmin: false,
    description: 'Audio complet + écriture mémoire sécurisée.',
  },
  6: {
    name: 'metier_basic',
    label: 'Métier de base',
    pipelines: ['public', 'memory_read', 'memory_write', 'dialogue', 'audio_read', 'audio_write', 'tools_limited'],
    mcpTools: ['search', 'fetch', 'health', 'a11_status', 'kaen44_status', 'qflush_status', 'a11_chat', 'discussion_list', 'discussion_read', 'discussion_post', 'qflush_sources_status', 'qflush_sources_select', 'memory_write_safe', 'a11_llm_stats', 'agent_heartbeat'],
    dataAccess: 'all_read + own_write',
    canWrite: true,
    canShell: false,
    canAdmin: false,
    description: 'Accès outils limités + stats LLM + heartbeat agent.',
  },
  7: {
    name: 'metier',
    label: 'Métier',
    pipelines: ['public', 'memory_read', 'memory_write', 'dialogue', 'audio_read', 'audio_write', 'tools_limited', 'tools_extended'],
    mcpTools: ['search', 'fetch', 'health', 'a11_status', 'kaen44_status', 'qflush_status', 'a11_chat', 'discussion_list', 'discussion_read', 'discussion_post', 'qflush_sources_status', 'qflush_sources_select', 'memory_write_safe', 'a11_llm_stats', 'agent_heartbeat', 'agent_inbox', 'r2_bucket_status'],
    dataAccess: 'all_read + own_write + r2_read',
    canWrite: true,
    canShell: false,
    canAdmin: false,
    description: 'Outils étendus + inbox + R2 lecture.',
  },
  8: {
    name: 'metier_senior',
    label: 'Métier senior',
    pipelines: ['public', 'memory_read', 'memory_write', 'dialogue', 'audio_read', 'audio_write', 'tools_limited', 'tools_extended', 'deploy_staging'],
    mcpTools: ['search', 'fetch', 'health', 'a11_status', 'kaen44_status', 'qflush_status', 'a11_chat', 'discussion_list', 'discussion_read', 'discussion_post', 'qflush_sources_status', 'qflush_sources_select', 'memory_write_safe', 'a11_llm_stats', 'agent_heartbeat', 'agent_inbox', 'r2_bucket_status', 'r2_bucket_upload', 'neo4j_read_query'],
    dataAccess: 'all_read + all_write + r2 + neo4j_read',
    canWrite: true,
    canShell: false,
    canAdmin: false,
    description: 'Déploiement staging + R2 écriture + Neo4j lecture.',
  },
  9: {
    name: 'metier_lead',
    label: 'Métier lead',
    pipelines: ['public', 'memory_read', 'memory_write', 'dialogue', 'audio_read', 'audio_write', 'tools_limited', 'tools_extended', 'deploy_staging', 'deploy_production'],
    mcpTools: ['search', 'fetch', 'health', 'a11_status', 'kaen44_status', 'qflush_status', 'a11_chat', 'discussion_list', 'discussion_read', 'discussion_post', 'qflush_sources_status', 'qflush_sources_select', 'memory_write_safe', 'a11_llm_stats', 'agent_heartbeat', 'agent_inbox', 'r2_bucket_status', 'r2_bucket_upload', 'neo4j_read_query', 'neo4j_write_query', 'agent_job_create', 'agent_job_status'],
    dataAccess: 'all + neo4j_write + job_queue',
    canWrite: true,
    canShell: false,
    canAdmin: false,
    description: 'Déploiement production + Neo4j écriture + job queue.',
  },
  10: {
    name: 'account_manager',
    label: 'Gestionnaire de compte',
    pipelines: ['*'],
    mcpTools: ['*'],
    dataAccess: 'all',
    canWrite: true,
    canShell: true,
    canAdmin: true,
    description: 'Accès complet. Tous les pipelines, tous les outils, shell, admin.',
  },
};

// ─── Level resolution ───────────────────────────────────────────────────────

/**
 * Get the level definition for a numeric level.
 * @param {number} level — 1 to 10
 * @returns {object|null}
 */
function getLevel(level) {
  const n = parseInt(level, 10);
  if (!Number.isFinite(n) || n < 1 || n > 10) return null;
  return LEVELS[n];
}

/**
 * Check if a level has access to a specific pipeline.
 * @param {number} level
 * @param {string} pipeline
 * @returns {boolean}
 */
function canAccessPipeline(level, pipeline) {
  const def = getLevel(level);
  if (!def) return false;
  if (def.pipelines.includes('*')) return true;
  return def.pipelines.includes(pipeline);
}

/**
 * Check if a level can use a specific MCP tool.
 * @param {number} level
 * @param {string} toolName
 * @returns {boolean}
 */
function canUseTool(level, toolName) {
  const def = getLevel(level);
  if (!def) return false;
  if (def.mcpTools.includes('*')) return true;
  return def.mcpTools.includes(toolName);
}

/**
 * Check if a level has a specific capability.
 * @param {number} level
 * @param {'canWrite'|'canShell'|'canAdmin'} capability
 * @returns {boolean}
 */
function hasCapability(level, capability) {
  const def = getLevel(level);
  if (!def) return false;
  return Boolean(def[capability]);
}

/**
 * Get all tools available for a level.
 * @param {number} level
 * @returns {string[]}
 */
function availableTools(level) {
  const def = getLevel(level);
  if (!def) return [];
  return def.mcpTools;
}

/**
 * Get all pipelines available for a level.
 * @param {number} level
 * @returns {string[]}
 */
function availablePipelines(level) {
  const def = getLevel(level);
  if (!def) return [];
  return def.pipelines;
}

/**
 * Resolve the level from a persona or token.
 * In the real system, this would check the JWT/session for the level claim.
 * For now, we use a simple mapping.
 * @param {object} context — { persona, level?, token? }
 * @returns {number} level (1-10)
 */
function resolveLevel(context) {
  // Explicit level from token/session
  if (context.level) {
    const n = parseInt(context.level, 10);
    if (n >= 1 && n <= 10) return n;
  }
  // Default levels by persona
  const personaDefaults = {
    chatgpt: 1,   // visitor
    grok: 1,      // visitor
    claude: 3,    // user
    gemini: 1,    // visitor
    codex: 8,     // metier senior
    vivy: 5,      // user premium
    a11: 10,      // account manager
    k44: 9,       // metier lead
    djeff: 10,    // account manager (founder)
  };
  return personaDefaults[context.persona] || 1;
}

module.exports = {
  SCHEMA,
  LEVELS,
  getLevel,
  canAccessPipeline,
  canUseTool,
  hasCapability,
  availableTools,
  availablePipelines,
  resolveLevel,
};
