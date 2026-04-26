/**
 * Checkpoint Manager - Gestion de l'état et rollback
 * 
 * Fonctionnalités:
 * - Sauvegarde de l'état global (Global_State)
 * - Rollback sélectif vers un checkpoint spécifique
 * - Déclenchement automatique et manuel
 * - Rétention et nettoyage automatique
 * - Support Neo4j et fallback JSON
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

// ============================================================================
// CHECKPOINT STORAGE (JSON Fallback)
// ============================================================================

class CheckpointStorage {
  constructor(stateDir) {
    this.stateDir = stateDir || path.join(__dirname, '..', '.a11_state', 'checkpoints');
    this.checkpoints = new Map();
    this.loadCheckpoints();
  }

  loadCheckpoints() {
    try {
      fs.mkdirSync(this.stateDir, { recursive: true });
      const checkpointsFile = path.join(this.stateDir, 'checkpoints.json');
      
      if (fs.existsSync(checkpointsFile)) {
        const data = JSON.parse(fs.readFileSync(checkpointsFile, 'utf8'));
        this.checkpoints = new Map(Object.entries(data));
      }
    } catch (error) {
      console.warn('[CHECKPOINT] Failed to load checkpoints:', error.message);
    }
  }

  saveCheckpoints() {
    try {
      fs.mkdirSync(this.stateDir, { recursive: true });
      const checkpointsFile = path.join(this.stateDir, 'checkpoints.json');
      const data = Object.fromEntries(this.checkpoints);
      fs.writeFileSync(checkpointsFile, JSON.stringify(data, null, 2), 'utf8');
    } catch (error) {
      console.warn('[CHECKPOINT] Failed to save checkpoints:', error.message);
    }
  }

  save(checkpoint) {
    this.checkpoints.set(checkpoint.checkpointId, checkpoint);
    this.saveCheckpoints();
    return checkpoint;
  }

  get(checkpointId) {
    return this.checkpoints.get(checkpointId) || null;
  }

  list(filters = {}) {
    let checkpoints = Array.from(this.checkpoints.values());
    
    if (filters.userId) {
      checkpoints = checkpoints.filter(cp => cp.metadata?.userId === filters.userId);
    }
    
    if (filters.conversationId) {
      checkpoints = checkpoints.filter(cp => cp.metadata?.conversationId === filters.conversationId);
    }
    
    if (filters.runId) {
      checkpoints = checkpoints.filter(cp => cp.metadata?.runId === filters.runId);
    }
    
    // Trier par timestamp décroissant
    checkpoints.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    return checkpoints;
  }

  delete(checkpointId) {
    const deleted = this.checkpoints.delete(checkpointId);
    if (deleted) {
      this.saveCheckpoints();
    }
    return deleted;
  }

  cleanup(options = {}) {
    const now = Date.now();
    const maxAgeMs = options.maxAgeMs || 7 * 24 * 60 * 60 * 1000; // 7 jours
    const keepLast = options.keepLast || 10;
    const keepCurrentSession = options.keepCurrentSession !== false;
    
    // Grouper par conversation
    const byConversation = new Map();
    
    for (const checkpoint of this.checkpoints.values()) {
      const convId = checkpoint.metadata?.conversationId || 'unknown';
      if (!byConversation.has(convId)) {
        byConversation.set(convId, []);
      }
      byConversation.get(convId).push(checkpoint);
    }
    
    let cleaned = 0;
    
    for (const [convId, checkpoints] of byConversation.entries()) {
      // Trier par timestamp décroissant
      checkpoints.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      
      // Identifier la session courante (checkpoints récents < 1h)
      const currentSessionCheckpoints = keepCurrentSession
        ? checkpoints.filter(cp => now - new Date(cp.timestamp).getTime() < 60 * 60 * 1000)
        : [];
      
      const currentSessionIds = new Set(currentSessionCheckpoints.map(cp => cp.checkpointId));
      
      // Garder les N derniers + session courante
      const toKeep = new Set();
      
      checkpoints.slice(0, keepLast).forEach(cp => toKeep.add(cp.checkpointId));
      currentSessionIds.forEach(id => toKeep.add(id));
      
      // Supprimer les vieux checkpoints
      for (const checkpoint of checkpoints) {
        const age = now - new Date(checkpoint.timestamp).getTime();
        
        if (age > maxAgeMs && !toKeep.has(checkpoint.checkpointId)) {
          this.checkpoints.delete(checkpoint.checkpointId);
          cleaned++;
        }
      }
    }
    
    if (cleaned > 0) {
      this.saveCheckpoints();
      console.info(`[CHECKPOINT] Cleaned up ${cleaned} old checkpoints`);
    }
    
    return cleaned;
  }
}

// ============================================================================
// CHECKPOINT MANAGER
// ============================================================================

class CheckpointManager {
  constructor(options = {}) {
    this.storage = new CheckpointStorage(options.stateDir);
    this.autoTriggers = new Set([
      'search_web',
      'generate_visual',
      'generate_video',
      'generate_audio',
      'plan_rewrite',
    ]);
    
    // Nettoyage automatique toutes les heures
    setInterval(() => {
      this.storage.cleanup(options.cleanup);
    }, 60 * 60 * 1000);
  }

  /**
   * Créer un checkpoint
   */
  createCheckpoint(data) {
    const {
      userId,
      conversationId,
      runId,
      stepNumber,
      reason,
      conversationHistory,
      internalStateGraph,
      executionContext,
      toolInputsOutputs,
      confidenceScore,
      metadata,
    } = data;

    if (!userId || !conversationId) {
      throw new Error('userId and conversationId are required');
    }

    const checkpointId = this.generateCheckpointId(userId, conversationId, runId, stepNumber);

    const checkpoint = {
      checkpointId,
      timestamp: new Date().toISOString(),
      conversation_history: conversationHistory || [],
      internal_state_graph: internalStateGraph || {
        plan: [],
        decisions: [],
        currentStep: stepNumber || 0,
      },
      execution_context: executionContext || {
        rag_documents: [],
        kg_facts: [],
        episodic_context: [],
      },
      tool_inputs_outputs: toolInputsOutputs || [],
      current_confidence_score: confidenceScore || 0,
      metadata: {
        userId,
        conversationId,
        runId: runId || this.generateRunId(),
        stepNumber: stepNumber || 0,
        reason: reason || 'manual',
        ...metadata,
      },
    };

    this.storage.save(checkpoint);

    console.info(`[CHECKPOINT] Created: ${checkpointId} (reason: ${checkpoint.metadata.reason})`);

    return checkpoint;
  }

  /**
   * Récupérer un checkpoint
   */
  getCheckpoint(checkpointId) {
    return this.storage.get(checkpointId);
  }

  /**
   * Lister les checkpoints
   */
  listCheckpoints(filters = {}) {
    return this.storage.list(filters);
  }

  /**
   * Rollback vers un checkpoint
   */
  rollback(options) {
    const {
      checkpointId,
      reason,
      preserveContext,
      reformulate,
    } = options;

    if (!checkpointId) {
      throw new Error('checkpointId is required');
    }

    const checkpoint = this.storage.get(checkpointId);

    if (!checkpoint) {
      throw new Error('checkpoint_not_found');
    }

    // Créer un état restauré
    const restoredState = {
      checkpointId: checkpoint.checkpointId,
      timestamp: checkpoint.timestamp,
      conversation_history: checkpoint.conversation_history,
      internal_state_graph: checkpoint.internal_state_graph,
      execution_context: checkpoint.execution_context,
      tool_inputs_outputs: checkpoint.tool_inputs_outputs,
      current_confidence_score: checkpoint.current_confidence_score,
      metadata: checkpoint.metadata,
      rollback: {
        performedAt: new Date().toISOString(),
        reason: reason || 'manual_rollback',
        preserveContext: preserveContext || [],
        reformulate: reformulate || false,
      },
    };

    console.info(`[CHECKPOINT] Rollback to: ${checkpointId} (reason: ${reason || 'manual'})`);

    return restoredState;
  }

  /**
   * Vérifier si un déclenchement automatique est nécessaire
   */
  shouldAutoTrigger(event) {
    return this.autoTriggers.has(event);
  }

  /**
   * Supprimer un checkpoint
   */
  deleteCheckpoint(checkpointId) {
    return this.storage.delete(checkpointId);
  }

  /**
   * Nettoyage manuel
   */
  cleanup(options) {
    return this.storage.cleanup(options);
  }

  /**
   * Générer un ID de checkpoint
   */
  generateCheckpointId(userId, conversationId, runId, stepNumber) {
    const run = runId || this.generateRunId();
    const step = stepNumber !== undefined ? stepNumber : 0;
    return `${userId}:${conversationId}:${run}:step_${step}`;
  }

  /**
   * Générer un ID de run
   */
  generateRunId() {
    return `run_${crypto.randomUUID().replace(/-/g, '').substring(0, 12)}`;
  }

  /**
   * Obtenir les statistiques
   */
  getStats(userId, conversationId) {
    const checkpoints = this.storage.list({ userId, conversationId });
    
    const stats = {
      total: checkpoints.length,
      byReason: {},
      byStep: {},
      oldest: null,
      newest: null,
    };

    for (const checkpoint of checkpoints) {
      const reason = checkpoint.metadata?.reason || 'unknown';
      const step = checkpoint.metadata?.stepNumber || 0;
      
      stats.byReason[reason] = (stats.byReason[reason] || 0) + 1;
      stats.byStep[step] = (stats.byStep[step] || 0) + 1;
      
      if (!stats.oldest || new Date(checkpoint.timestamp) < new Date(stats.oldest)) {
        stats.oldest = checkpoint.timestamp;
      }
      
      if (!stats.newest || new Date(checkpoint.timestamp) > new Date(stats.newest)) {
        stats.newest = checkpoint.timestamp;
      }
    }

    return stats;
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  CheckpointManager,
  CheckpointStorage,
};
