/**
 * Tool-Calling Layer - Abstraction unifiée pour outils multimodaux
 * 
 * Fournit une interface standardisée pour:
 * - Génération d'images (Stable Diffusion)
 * - Génération de vidéos
 * - Synthèse vocale (TTS)
 * - Traduction
 * - Recherche web
 * 
 * Inclut:
 * - Capabilities Detection (local vs prod)
 * - Circuit Breaker pattern
 * - Retry strategy avec backoff exponentiel
 * - Job management asynchrone
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

// ============================================================================
// CAPABILITIES DETECTION
// ============================================================================

function detectCapabilities() {
  return {
    generate_visual: {
      available: !!(process.env.SD_PROXY_URL || process.env.STABLE_DIFFUSION_URL),
      mode: (process.env.SD_PROXY_URL || process.env.STABLE_DIFFUSION_URL) ? 'production' : 'mock',
      endpoint: process.env.SD_PROXY_URL || process.env.STABLE_DIFFUSION_URL || null,
    },
    generate_video: {
      available: !!process.env.VIDEO_PROXY_URL,
      mode: process.env.VIDEO_PROXY_URL ? 'production' : 'mock',
      endpoint: process.env.VIDEO_PROXY_URL || null,
    },
    generate_audio: {
      available: !!process.env.TTS_SERVICE_URL,
      mode: process.env.TTS_SERVICE_URL ? 'production' : 'mock',
      endpoint: process.env.TTS_SERVICE_URL || null,
    },
    translate_text: {
      available: !!(process.env.OPENAI_API_KEY || process.env.LLM_ROUTER_URL),
      mode: 'production',
      endpoint: null,
    },
    search_web: {
      available: true,
      mode: 'production',
      endpoint: null,
    },
  };
}

// ============================================================================
// CIRCUIT BREAKER
// ============================================================================

class CircuitBreaker {
  constructor(options = {}) {
    this.failureThreshold = options.failureThreshold || 5;
    this.timeWindow = options.timeWindow || 5 * 60 * 1000; // 5 minutes
    this.cooldownPeriod = options.cooldownPeriod || 10 * 60 * 1000; // 10 minutes
    
    this.failures = new Map(); // toolName -> [timestamps]
    this.sleeping = new Map(); // toolName -> sleepUntil timestamp
  }

  recordFailure(toolName) {
    const now = Date.now();
    
    if (!this.failures.has(toolName)) {
      this.failures.set(toolName, []);
    }
    
    const toolFailures = this.failures.get(toolName);
    toolFailures.push(now);
    
    // Nettoyer les échecs hors de la fenêtre temporelle
    const recentFailures = toolFailures.filter(ts => now - ts < this.timeWindow);
    this.failures.set(toolName, recentFailures);
    
    // Vérifier si on dépasse le seuil
    if (recentFailures.length >= this.failureThreshold) {
      const sleepUntil = now + this.cooldownPeriod;
      this.sleeping.set(toolName, sleepUntil);
      console.warn(`[CIRCUIT_BREAKER] Tool "${toolName}" is now SLEEPING until ${new Date(sleepUntil).toISOString()}`);
      return true; // Circuit ouvert
    }
    
    return false;
  }

  recordSuccess(toolName) {
    // Réinitialiser les échecs en cas de succès
    this.failures.delete(toolName);
  }

  isAvailable(toolName) {
    const sleepUntil = this.sleeping.get(toolName);
    
    if (!sleepUntil) {
      return { available: true };
    }
    
    const now = Date.now();
    
    if (now >= sleepUntil) {
      // Période de cooldown terminée
      this.sleeping.delete(toolName);
      this.failures.delete(toolName);
      console.info(`[CIRCUIT_BREAKER] Tool "${toolName}" is now AWAKE`);
      return { available: true };
    }
    
    return {
      available: false,
      reason: 'circuit_breaker_open',
      sleepUntil: new Date(sleepUntil).toISOString(),
      remainingMs: sleepUntil - now,
    };
  }

  getStatus() {
    const now = Date.now();
    const status = {};
    
    for (const [toolName, sleepUntil] of this.sleeping.entries()) {
      status[toolName] = {
        state: now < sleepUntil ? 'SLEEPING' : 'AWAKE',
        sleepUntil: new Date(sleepUntil).toISOString(),
        remainingMs: Math.max(0, sleepUntil - now),
      };
    }
    
    return status;
  }
}

// ============================================================================
// JOB MANAGER
// ============================================================================

class JobManager {
  constructor(stateDir) {
    this.stateDir = stateDir || path.join(__dirname, '..', '.a11_state', 'tool-jobs');
    this.jobs = new Map(); // jobId -> job object
    this.loadJobs();
  }

  loadJobs() {
    try {
      fs.mkdirSync(this.stateDir, { recursive: true });
      const jobsFile = path.join(this.stateDir, 'jobs.json');
      
      if (fs.existsSync(jobsFile)) {
        const data = JSON.parse(fs.readFileSync(jobsFile, 'utf8'));
        this.jobs = new Map(Object.entries(data));
      }
    } catch (error) {
      console.warn('[JOB_MANAGER] Failed to load jobs:', error.message);
    }
  }

  saveJobs() {
    try {
      fs.mkdirSync(this.stateDir, { recursive: true });
      const jobsFile = path.join(this.stateDir, 'jobs.json');
      const data = Object.fromEntries(this.jobs);
      fs.writeFileSync(jobsFile, JSON.stringify(data, null, 2), 'utf8');
    } catch (error) {
      console.warn('[JOB_MANAGER] Failed to save jobs:', error.message);
    }
  }

  createJob(toolName, params, userId) {
    const jobId = `job_${toolName}_${crypto.randomUUID().replace(/-/g, '')}`;
    
    const job = {
      jobId,
      toolName,
      params,
      userId,
      status: 'pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      attempts: 0,
      maxAttempts: 3,
      result: null,
      error: null,
    };
    
    this.jobs.set(jobId, job);
    this.saveJobs();
    
    return job;
  }

  getJob(jobId) {
    return this.jobs.get(jobId) || null;
  }

  updateJob(jobId, updates) {
    const job = this.jobs.get(jobId);
    
    if (!job) {
      return null;
    }
    
    Object.assign(job, updates, { updatedAt: new Date().toISOString() });
    this.jobs.set(jobId, job);
    this.saveJobs();
    
    return job;
  }

  listJobs(userId, filters = {}) {
    const jobs = Array.from(this.jobs.values())
      .filter(job => !userId || job.userId === userId);
    
    if (filters.status) {
      return jobs.filter(job => job.status === filters.status);
    }
    
    if (filters.toolName) {
      return jobs.filter(job => job.toolName === filters.toolName);
    }
    
    return jobs;
  }

  cleanupOldJobs(maxAgeMs = 24 * 60 * 60 * 1000) {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [jobId, job] of this.jobs.entries()) {
      const age = now - new Date(job.createdAt).getTime();
      
      if (age > maxAgeMs && ['completed', 'failed', 'cancelled'].includes(job.status)) {
        this.jobs.delete(jobId);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      this.saveJobs();
      console.info(`[JOB_MANAGER] Cleaned up ${cleaned} old jobs`);
    }
    
    return cleaned;
  }
}

// ============================================================================
// RETRY STRATEGY
// ============================================================================

async function retryWithBackoff(fn, options = {}) {
  const maxAttempts = options.maxAttempts || 3;
  const baseDelay = options.baseDelay || 1000;
  const timeout = options.timeout || 60000;
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('timeout')), timeout);
      });
      
      const result = await Promise.race([fn(), timeoutPromise]);
      return { ok: true, result, attempt };
    } catch (error) {
      if (attempt === maxAttempts) {
        return { ok: false, error: error.message, attempt };
      }
      
      // Backoff exponentiel: 1s, 3s, 9s
      const delay = baseDelay * Math.pow(3, attempt - 1);
      console.warn(`[RETRY] Attempt ${attempt} failed, retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

// ============================================================================
// TOOL IMPLEMENTATIONS
// ============================================================================

async function generateVisualMock(params) {
  console.warn('[TOOL] WARNING: Local environment mock used for visual generation');
  
  return {
    ok: true,
    mode: 'mock',
    result: {
      imageUrl: 'https://via.placeholder.com/512x512.png?text=Mock+Image',
      prompt: params.prompt,
      style: params.style || 'default',
      aspectRatio: params.aspectRatio || '1:1',
      seed: params.seed || Math.floor(Math.random() * 1000000),
      generatedAt: new Date().toISOString(),
    },
  };
}

async function generateVideoMock(params) {
  console.warn('[TOOL] WARNING: Local environment mock used for video generation');
  
  return {
    ok: true,
    mode: 'mock',
    result: {
      videoUrl: 'https://via.placeholder.com/1280x720.mp4?text=Mock+Video',
      prompt: params.prompt,
      style: params.style || 'default',
      duration: params.duration_sec || 5,
      sceneCount: params.scene_breakdown?.length || 1,
      generatedAt: new Date().toISOString(),
    },
  };
}

async function generateAudioMock(params) {
  console.warn('[TOOL] WARNING: Local environment mock used for audio generation');
  
  return {
    ok: true,
    mode: 'mock',
    result: {
      audioUrl: 'https://via.placeholder.com/audio.mp3?text=Mock+Audio',
      text: params.text_prompt,
      language: params.language || 'fr-FR',
      speaker: params.speaker_id || 'default',
      emotion: params.emotion || 'neutral',
      generatedAt: new Date().toISOString(),
    },
  };
}

// ============================================================================
// TOOL CALLING LAYER
// ============================================================================

class ToolCallingLayer {
  constructor(options = {}) {
    this.capabilities = detectCapabilities();
    this.circuitBreaker = new CircuitBreaker(options.circuitBreaker);
    this.jobManager = new JobManager(options.stateDir);
    
    // Nettoyage automatique des vieux jobs toutes les heures
    setInterval(() => {
      this.jobManager.cleanupOldJobs();
    }, 60 * 60 * 1000);
  }

  getCapabilities() {
    return {
      ...this.capabilities,
      circuitBreaker: this.circuitBreaker.getStatus(),
    };
  }

  async callTool(toolName, params, userId) {
    // Vérifier la disponibilité du circuit breaker
    const cbStatus = this.circuitBreaker.isAvailable(toolName);
    
    if (!cbStatus.available) {
      return {
        ok: false,
        error: 'circuit_breaker_open',
        details: cbStatus,
      };
    }
    
    // Créer un job
    const job = this.jobManager.createJob(toolName, params, userId);
    
    // Exécuter de manière asynchrone
    this.executeJob(job.jobId).catch(error => {
      console.error(`[TOOL] Job ${job.jobId} execution failed:`, error.message);
    });
    
    return {
      ok: true,
      jobId: job.jobId,
      status: 'pending',
      toolName,
    };
  }

  async executeJob(jobId) {
    const job = this.jobManager.getJob(jobId);
    
    if (!job) {
      throw new Error('job_not_found');
    }
    
    this.jobManager.updateJob(jobId, { status: 'running' });
    
    const capability = this.capabilities[job.toolName];
    
    if (!capability) {
      this.jobManager.updateJob(jobId, {
        status: 'failed',
        error: 'unknown_tool',
      });
      return;
    }
    
    // Sélectionner l'implémentation (mock ou prod)
    let toolFn;
    
    if (capability.mode === 'mock') {
      if (job.toolName === 'generate_visual') toolFn = () => generateVisualMock(job.params);
      else if (job.toolName === 'generate_video') toolFn = () => generateVideoMock(job.params);
      else if (job.toolName === 'generate_audio') toolFn = () => generateAudioMock(job.params);
      else {
        this.jobManager.updateJob(jobId, {
          status: 'failed',
          error: 'mock_not_implemented',
        });
        return;
      }
    } else {
      // TODO: Implémenter les appels réels aux APIs
      this.jobManager.updateJob(jobId, {
        status: 'failed',
        error: 'production_implementation_pending',
      });
      return;
    }
    
    // Exécuter avec retry
    const result = await retryWithBackoff(toolFn, {
      maxAttempts: job.maxAttempts,
      timeout: 60000,
    });
    
    if (result.ok) {
      this.circuitBreaker.recordSuccess(job.toolName);
      this.jobManager.updateJob(jobId, {
        status: 'completed',
        result: result.result,
        attempts: result.attempt,
      });
    } else {
      const circuitOpened = this.circuitBreaker.recordFailure(job.toolName);
      this.jobManager.updateJob(jobId, {
        status: 'failed',
        error: result.error,
        attempts: result.attempt,
        circuitOpened,
      });
    }
  }

  getJobStatus(jobId) {
    return this.jobManager.getJob(jobId);
  }

  listJobs(userId, filters) {
    return this.jobManager.listJobs(userId, filters);
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  ToolCallingLayer,
  detectCapabilities,
  CircuitBreaker,
  JobManager,
};
