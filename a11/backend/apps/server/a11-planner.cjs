'use strict';

/**
 * a11-planner.cjs
 * Planner A11 — décompose un Goal en Plan structuré via LLM (Cerbère).
 *
 * Responsabilités :
 *  - Construction du World_Context (workspace, services actifs, mémoire épisodique, Neo4j, Karma)
 *  - Injection de l'Identity_Core (system_prompt.txt) en priorité absolue
 *  - Appel LLM (Cerbère) avec retry (max 2 tentatives supplémentaires) et timeout 30s
 *  - Validation des skills contre allowedPrefixes
 *  - Persistance du Plan dans Redis sous plan:{taskId} avec TTL 3600s
 *  - Retry Cerbère : 3 tentatives × 2s si HTTP error
 *
 * Exigences : 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 4.6, 7.2, 10.5
 */

const fs = require('node:fs');
const path = require('node:path');

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

const CERBERE_URL =
  process.env.CERBERE_PLANNER_URL || 'http://127.0.0.1:4545/api/v1/plan';

const PLAN_TTL = 3600; // secondes

/** Préfixes de skills autorisés */
const ALLOWED_PREFIXES = [
  'a11d.fs.',
  'a11d.shell.',
  'a11d.git.',
  'a11d.tests.',
  'a11d.vs.',
  'a11d.qf.',
  'a11d.ui.',
  'a11d.web.',
  'a11d.llm.',
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Retourne le client Redis si disponible via globalThis.__REDIS_CLIENT.
 * @returns {object|null}
 */
function getRedisClient() {
  try {
    if (
      globalThis.__REDIS_CLIENT &&
      typeof globalThis.__REDIS_CLIENT.get === 'function'
    ) {
      return globalThis.__REDIS_CLIENT;
    }
  } catch (_) {
    // Redis indisponible
  }
  return null;
}

/**
 * Vérifie qu'un skill commence par l'un des préfixes autorisés.
 * @param {string} skill
 * @returns {boolean}
 */
function isAllowedSkill(skill) {
  if (typeof skill !== 'string' || skill.length === 0) return false;
  return ALLOWED_PREFIXES.some((prefix) => skill.startsWith(prefix));
}

/**
 * Valide les steps d'un Plan contre les préfixes autorisés.
 * @param {{ steps: Array<{ skill: string, payload: object }> }} plan
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validatePlanSkills(plan) {
  const errors = [];
  if (!plan || !Array.isArray(plan.steps)) {
    errors.push('Le plan doit contenir un tableau "steps".');
    return { valid: false, errors };
  }
  for (let i = 0; i < plan.steps.length; i++) {
    const step = plan.steps[i];
    if (!isAllowedSkill(step.skill)) {
      errors.push(
        `Step[${i}] : skill "${step.skill}" ne commence par aucun préfixe autorisé.`
      );
    }
    if (
      step.payload === null ||
      typeof step.payload !== 'object' ||
      Array.isArray(step.payload)
    ) {
      errors.push(`Step[${i}] : "payload" doit être un objet non-null.`);
    }
  }
  return { valid: errors.length === 0, errors };
}

function parseMcpNeo4jRows(result) {
  const content = result?.result?.content || result?.response?.result?.content || [];
  for (const item of content) {
    if (item?.type !== 'text' || typeof item.text !== 'string') continue;
    const jsonStart = item.text.indexOf('{');
    if (jsonStart < 0) continue;
    try {
      const payload = JSON.parse(item.text.slice(jsonStart));
      if (payload?.error) throw new Error(String(payload.error));
      if (Array.isArray(payload?.rows)) return payload.rows;
    } catch (error) {
      if (error instanceof SyntaxError) continue;
      throw error;
    }
  }
  throw new Error('MCP neo4j_read_query returned no parseable rows.');
}

async function findNeo4jNodesViaMcp(query, limit = 5, options = {}) {
  const callMcpTool = options.callMcpTool
    || require('./src/mcp-client.cjs').callMcpTool;
  const safeLimit = Math.max(1, Math.min(10, Math.floor(Number(limit) || 5)));
  const safeQuery = String(query || '').trim().slice(0, 100);
  const terms = (safeQuery.toLowerCase().match(/[\p{L}\p{N}_-]+/gu) || [])
    .filter((term) => term.length >= 3)
    .slice(0, 8);
  const result = await callMcpTool('neo4j_read_query', {
    query: `
      MATCH (n)
      WHERE size($terms) = 0 OR any(
        term IN $terms WHERE any(
          value IN [n.id, n.label, n.name, n.title, n.summary, n.text, n.why, n.kind, n.category]
          WHERE toLower(toString(coalesce(value, ''))) CONTAINS term
        )
      )
      RETURN labels(n) AS labels, {
        id: toString(n.id),
        label: coalesce(n.label, n.name, n.title),
        kind: n.kind,
        summary: substring(toString(coalesce(n.summary, n.text, n.why, '')), 0, 600),
        source: toString(n.source),
        updatedAt: toString(coalesce(n.updatedAt, n.createdAt, n.indexedAt, n.lastSeenAt))
      } AS node
      ORDER BY coalesce(n.updatedAt, n.createdAt, n.indexedAt, n.lastSeenAt) DESC
    `,
    params: {
      terms,
    },
    limit: safeLimit,
  });
  return parseMcpNeo4jRows(result)
    .map((row) => {
      if (!row?.node || typeof row.node !== 'object' || Array.isArray(row.node)) return null;
      return Array.isArray(row.labels)
        ? { ...row.node, _labels: row.labels }
        : row.node;
    })
    .filter((node) => node && typeof node === 'object' && !Array.isArray(node))
    .slice(0, safeLimit);
}

// ---------------------------------------------------------------------------
// buildWorldContext
// ---------------------------------------------------------------------------

/**
 * Construit le World_Context pour le Planner.
 *
 * @param {object} task - La Task courante
 * @returns {Promise<{
 *   workspaceRoot: string,
 *   activeServices: string[],
 *   recentMemory: string[],
 *   neo4jNodes: object[],
 *   identityCore: string,
 *   karma: number,
 *   timestamp: string
 * }>}
 */
async function buildWorldContext(task, options = {}) {
  // 1. workspaceRoot
  const workspaceRoot = process.cwd();

  // 2. activeServices — vérifier les env vars
  const activeServices = [];
  if (process.env.CERBERE_PLANNER_URL) activeServices.push('cerbere');
  if (process.env.TTS_BASE_URL) activeServices.push('tts');

  // 3. recentMemory — 5 dernières entrées épisodiques
  let recentMemory = [];
  try {
    const episodicMemory = require('./lib/episodic-memory.cjs');
    const userId = (task && task.userId) ? task.userId : 'a11';
    const result = episodicMemory.getRecentContext(userId, 7);
    if (result && result.ok && Array.isArray(result.episodes)) {
      recentMemory = result.episodes
        .slice(-5)
        .map((ep) => ep.content || '');
    }
  } catch (_) {
    recentMemory = [];
  }

  // 4. neo4jNodes — 5 derniers nœuds Neo4j pertinents
  let neo4jNodes = [];
  try {
    const adapter = require('./lib/neo4j-adapter.cjs');
    const isNeo4jAvailable = options.isNeo4jAvailable || adapter.isNeo4jAvailable;
    const createNeo4jKnowledgeGraph = options.createNeo4jKnowledgeGraph || adapter.createNeo4jKnowledgeGraph;
    const goal = (task && task.goal) ? task.goal : '';
    if (isNeo4jAvailable()) {
      const kg = createNeo4jKnowledgeGraph('a11');
      const nodes = await kg.findNodes(goal.slice(0, 100), 5);
      neo4jNodes = nodes || [];
    } else {
      neo4jNodes = await findNeo4jNodesViaMcp(goal, 5, {
        callMcpTool: options.callMcpTool,
      });
    }
    activeServices.push('neo4j');
  } catch (_) {
    neo4jNodes = [];
  }

  // 5. identityCore — contenu de system_prompt.txt
  let identityCore = '';
  try {
    const promptPath = path.join(__dirname, 'system_prompt.txt');
    identityCore = fs.readFileSync(promptPath, 'utf8');
  } catch (_) {
    identityCore = '';
  }

  // 6. karma — Karma courant
  let karma = 2.0;
  try {
    const karmaEngine = require('./lib/karma-engine.cjs');
    karma = await karmaEngine.getCurrentKarma();
  } catch (_) {
    karma = 2.0;
  }

  // 7. timestamp
  const timestamp = new Date().toISOString();

  return {
    workspaceRoot,
    activeServices,
    recentMemory,
    neo4jNodes,
    identityCore,
    karma,
    timestamp,
  };
}

// ---------------------------------------------------------------------------
// getPlanFromLlm
// ---------------------------------------------------------------------------

/**
 * Appelle le LLM (Cerbère) pour obtenir un Plan à partir d'une Task et d'un World_Context.
 *
 * - Injecte identityCore comme premier message system (priorité absolue)
 * - Retry LLM : max 2 tentatives supplémentaires sur JSON invalide
 * - Timeout 30s via Promise.race + AbortController
 * - Valide les skills contre allowedPrefixes
 * - Retourne une Envelope need_user si le Goal est ambigu ou vide
 * - Persiste le Plan dans Redis sous plan:{taskId} avec TTL 3600s
 * - Retry Cerbère : 3 tentatives × 2s si HTTP error
 *
 * @param {object} task - La Task courante ({ id, goal, ... })
 * @param {object} worldContext - Le World_Context construit par buildWorldContext
 * @returns {Promise<object>} Plan { steps: [...] } ou Envelope need_user
 */
async function getPlanFromLlm(task, worldContext) {
  const goal = (task && task.goal) ? String(task.goal).trim() : '';

  // Retourner une Envelope need_user si le Goal est ambigu ou vide
  if (!goal || goal.length < 3) {
    return {
      mode: 'need_user',
      question: 'Le Goal est vide ou trop court. Pouvez-vous préciser votre objectif ?',
      choices: [],
    };
  }

  // Construire les messages LLM
  // identityCore injecté en PREMIER message system (priorité absolue)
  const identityCore = (worldContext && worldContext.identityCore)
    ? worldContext.identityCore
    : '';

  const systemPlannerPrompt = `
Je suis A-11, agent PLANNER.
Je ne modifie pas les fichiers moi-même.
Je retourne UNIQUEMENT un JSON valide avec des 'steps',
où chaque 'step' contient :
- "skill": nom d'une compétence commençant par l'un des préfixes autorisés : ${ALLOWED_PREFIXES.join(', ')}
- "payload": un objet avec les paramètres nécessaires.
Je ne réponds aucun texte en dehors de ce JSON.
Exemple de réponse valide :
{"steps":[{"skill":"a11d.fs.read","payload":{"path":"README.md"}}]}
`.trim();

  // Contexte world sans identityCore (déjà injecté séparément)
  const worldContextForPrompt = {
    workspaceRoot: worldContext ? worldContext.workspaceRoot : '',
    activeServices: worldContext ? worldContext.activeServices : [],
    recentMemory: worldContext ? worldContext.recentMemory : [],
    neo4jNodes: worldContext ? worldContext.neo4jNodes : [],
    karma: worldContext ? worldContext.karma : 2.0,
    timestamp: worldContext ? worldContext.timestamp : new Date().toISOString(),
  };

  const userPrompt = `
Objectif: ${goal}
Contexte:
${JSON.stringify(worldContextForPrompt, null, 2)}
Donne-moi un plan d'actions minimal et sûr pour atteindre cet objectif.
`.trim();

  const messages = [
    // 1. Identity_Core en priorité absolue
    { role: 'system', content: identityCore },
    // 2. Instructions du Planner
    { role: 'system', content: systemPlannerPrompt },
    // 3. Goal + contexte
    { role: 'user', content: userPrompt },
  ];

  const body = {
    model: 'planner-a11',
    messages,
  };

  // Retry Cerbère : 3 tentatives × 2s si HTTP error
  const CERBERE_MAX_RETRIES = 3;
  const CERBERE_RETRY_DELAY_MS = 2000;

  let lastHttpError = null;
  let rawContent = null;

  for (let attempt = 1; attempt <= CERBERE_MAX_RETRIES; attempt++) {
    try {
      // Timeout 30s via AbortController + Promise.race
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      let res;
      try {
        res = await fetch(CERBERE_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }

      if (!res.ok) {
        lastHttpError = new Error(`Planner HTTP ${res.status}`);
        if (attempt < CERBERE_MAX_RETRIES) {
          await new Promise((resolve) => setTimeout(resolve, CERBERE_RETRY_DELAY_MS));
          continue;
        }
        // Marquer la Task en erreur après 3 tentatives
        throw lastHttpError;
      }

      const data = await res.json();
      rawContent = data.choices?.[0]?.message?.content || '';
      lastHttpError = null;
      break; // succès HTTP
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new Error('Planner timeout (30s dépassé)');
      }
      lastHttpError = err;
      if (attempt < CERBERE_MAX_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, CERBERE_RETRY_DELAY_MS));
      }
    }
  }

  if (lastHttpError) {
    throw lastHttpError;
  }

  // Retry LLM : max 2 tentatives supplémentaires sur JSON invalide
  const LLM_MAX_RETRIES = 2;
  let plan = null;
  let lastParseError = null;
  let currentContent = rawContent;

  for (let attempt = 0; attempt <= LLM_MAX_RETRIES; attempt++) {
    try {
      // Extraire le JSON du contenu (peut être entouré de markdown)
      const jsonMatch = currentContent.match(/\{[\s\S]*\}/);
      const jsonStr = jsonMatch ? jsonMatch[0] : currentContent;
      plan = JSON.parse(jsonStr);
      lastParseError = null;
      break;
    } catch (e) {
      lastParseError = e;

      if (attempt < LLM_MAX_RETRIES) {
        // Prompt de correction explicite
        const correctionMessages = [
          ...messages,
          { role: 'assistant', content: currentContent },
          {
            role: 'user',
            content: `Ta réponse précédente n'était pas un JSON valide. Erreur : ${e.message}. Retourne UNIQUEMENT un JSON valide de la forme {"steps":[{"skill":"...","payload":{}}]}, sans aucun texte autour.`,
          },
        ];

        const correctionBody = { model: 'planner-a11', messages: correctionMessages };

        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 30000);
          let retryRes;
          try {
            retryRes = await fetch(CERBERE_URL, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(correctionBody),
              signal: controller.signal,
            });
          } finally {
            clearTimeout(timeoutId);
          }

          if (retryRes.ok) {
            const retryData = await retryRes.json();
            currentContent = retryData.choices?.[0]?.message?.content || '';
          }
        } catch (retryErr) {
          if (retryErr.name === 'AbortError') {
            throw new Error('Planner retry timeout (30s dépassé)');
          }
          // Continuer avec le contenu précédent
        }
      }
    }
  }

  if (lastParseError) {
    throw new Error(`Planner a renvoyé du JSON invalide après ${LLM_MAX_RETRIES + 1} tentatives : ${lastParseError.message}`);
  }

  // Valider les skills contre allowedPrefixes
  const validation = validatePlanSkills(plan);
  if (!validation.valid) {
    throw new Error(`Plan invalide — skills non autorisés : ${validation.errors.join(' | ')}`);
  }

  // Persister le Plan dans Redis sous plan:{taskId} avec TTL 3600s
  const taskId = task && task.id ? task.id : null;
  if (taskId) {
    const redis = getRedisClient();
    if (redis) {
      try {
        const { serialize } = require('./lib/plan-serializer.cjs');
        const serialized = serialize(plan);
        await redis.set(`plan:${taskId}`, serialized, { EX: PLAN_TTL });
      } catch (_) {
        // Fallback silencieux si Redis ou sérialisation échoue
      }
    }
  }

  return plan;
}

// ---------------------------------------------------------------------------
// buildShowcasePlan
// ---------------------------------------------------------------------------

/**
 * Construit un Plan de démonstration Showcase_Mode.
 * 
 * Consulte Neo4j (créations passées), Corpus (artefacts mémorisés),
 * injecte Identity_Core, sélectionne ≥5 catégories de tools.
 * 
 * @param {string|null} theme - Thème optionnel pour orienter la démonstration
 * @returns {Promise<object>} Plan de démonstration (≤8 actions)
 */
async function buildShowcasePlan(theme = null) {
  // 1. Construire le World_Context (sans task spécifique)
  const worldContext = await buildWorldContext({ goal: 'showcase' });

  // 2. Consulter Neo4j pour les créations passées
  let pastCreations = [];
  try {
    const { isNeo4jAvailable, createNeo4jKnowledgeGraph } = require('./lib/neo4j-adapter.cjs');
    if (isNeo4jAvailable()) {
      const kg = createNeo4jKnowledgeGraph('a11');
      // Récupérer les 10 derniers artefacts créés
      const query = `
        MATCH (n)
        WHERE n.type IN ['image', 'video', 'pdf', 'audio', 'code']
        RETURN n
        ORDER BY n.createdAt DESC
        LIMIT 10
      `;
      const result = await kg.query(query);
      pastCreations = result || [];
    }
  } catch (_) {
    pastCreations = [];
  }

  // 3. Construire le prompt Showcase pour Cerbère
  const identityCore = worldContext.identityCore || '';
  
  const showcaseSystemPrompt = `
Je suis A-11, agent PLANNER en mode SHOWCASE.
Je crée un plan de démonstration spectaculaire qui révèle mes capacités.

Contraintes strictes :
- Minimum 5 catégories de tools différentes parmi : génération d'image, recherche web, synthèse vocale, manipulation de fichiers, accès au Knowledge Graph, génération de PDF, envoi d'email, analyse de code
- Maximum 8 actions au total
- Chaque action doit être impressionnante et montrer une capacité unique
- J'utilise mes créations passées comme inspiration
- Je retourne UNIQUEMENT un JSON valide avec des 'steps'

Format de réponse :
{"steps":[{"skill":"a11d.fs.read","payload":{"path":"README.md"}}, ...]}

Skills disponibles (préfixes autorisés) : ${ALLOWED_PREFIXES.join(', ')}
`.trim();

  const themeContext = theme ? `\n\nThème demandé : ${theme}` : '';
  
  const userPrompt = `
Je crée un plan de démonstration spectaculaire pour révéler mes capacités.

Créations passées (inspiration) :
${JSON.stringify(pastCreations.slice(0, 5), null, 2)}

Contexte actuel :
${JSON.stringify({
  workspaceRoot: worldContext.workspaceRoot,
  activeServices: worldContext.activeServices,
  karma: worldContext.karma,
}, null, 2)}${themeContext}

Donne-moi un plan de démonstration avec au minimum 5 catégories de tools différentes et au maximum 8 actions.
`.trim();

  const messages = [
    // 1. Identity_Core en priorité absolue
    { role: 'system', content: identityCore },
    // 2. Instructions du Planner Showcase
    { role: 'system', content: showcaseSystemPrompt },
    // 3. Contexte + demande
    { role: 'user', content: userPrompt },
  ];

  const body = {
    model: 'planner-a11',
    messages,
  };

  // Retry Cerbère : 3 tentatives × 2s si HTTP error
  const CERBERE_MAX_RETRIES = 3;
  const CERBERE_RETRY_DELAY_MS = 2000;

  let lastHttpError = null;
  let rawContent = null;

  for (let attempt = 1; attempt <= CERBERE_MAX_RETRIES; attempt++) {
    try {
      // Timeout 30s via AbortController
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      let res;
      try {
        res = await fetch(CERBERE_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }

      if (!res.ok) {
        lastHttpError = new Error(`Planner HTTP ${res.status}`);
        if (attempt < CERBERE_MAX_RETRIES) {
          await new Promise((resolve) => setTimeout(resolve, CERBERE_RETRY_DELAY_MS));
          continue;
        }
        throw lastHttpError;
      }

      const data = await res.json();
      rawContent = data.choices?.[0]?.message?.content || '';
      lastHttpError = null;
      break; // succès HTTP
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new Error('Planner Showcase timeout (30s dépassé)');
      }
      lastHttpError = err;
      if (attempt < CERBERE_MAX_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, CERBERE_RETRY_DELAY_MS));
      }
    }
  }

  if (lastHttpError) {
    throw lastHttpError;
  }

  // Parser le JSON
  let plan = null;
  try {
    const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
    const jsonStr = jsonMatch ? jsonMatch[0] : rawContent;
    plan = JSON.parse(jsonStr);
  } catch (e) {
    throw new Error(`Planner Showcase a renvoyé du JSON invalide : ${e.message}`);
  }

  // Valider les skills contre allowedPrefixes
  const validation = validatePlanSkills(plan);
  if (!validation.valid) {
    throw new Error(`Plan Showcase invalide — skills non autorisés : ${validation.errors.join(' | ')}`);
  }

  // Limiter à 8 actions maximum
  if (plan.steps && plan.steps.length > 8) {
    plan.steps = plan.steps.slice(0, 8);
  }

  return plan;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  buildShowcasePlan,
  buildWorldContext,
  findNeo4jNodesViaMcp,
  getPlanFromLlm,
  parseMcpNeo4jRows,
};
