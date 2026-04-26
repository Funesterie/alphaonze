// reflection-loop.cjs
// Système de boucle de réflexion (Self-Correction) pour A11
// Implémente Chain-of-Thought (CoT) et Tree-of-Thought (ToT)

const { getLogger } = require('./structured-logger.cjs');

const logger = getLogger({ component: 'reflection-loop' });

/**
 * Génère une réponse avec Chain-of-Thought (CoT)
 * Flux : Question → Planification → Raisonnement → Réponse
 */
async function generateWithChainOfThought(prompt, options = {}) {
  const ollamaBase = options.ollamaBase || process.env.OLLAMA_BASE || 'http://127.0.0.1:11434';
  const model = options.model || process.env.A11_REASONING_MODEL || process.env.LOCAL_DEFAULT_MODEL || 'gemma4:e4b';
  const maxSteps = options.maxSteps || 3;

  const steps = [];

  // Étape 1 : Planification
  const planningPrompt = `Tu es un assistant qui planifie sa réponse avant de répondre.

Question : ${prompt}

Décompose cette question en étapes de raisonnement. Liste les étapes nécessaires pour répondre correctement.

Réponds UNIQUEMENT avec les étapes, une par ligne, préfixées par un numéro :`;

  try {
    const planningResponse = await callLLM(ollamaBase, model, planningPrompt);
    steps.push({
      type: 'planning',
      prompt: 'Planification des étapes',
      response: planningResponse,
    });

    // Étape 2 : Raisonnement par étapes
    const reasoningSteps = extractSteps(planningResponse);
    for (let i = 0; i < Math.min(reasoningSteps.length, maxSteps); i++) {
      const step = reasoningSteps[i];
      const reasoningPrompt = `Question originale : ${prompt}

Étape ${i + 1} : ${step}

Raisonne sur cette étape. Fournis ton analyse et tes conclusions.`;

      const reasoningResponse = await callLLM(ollamaBase, model, reasoningPrompt);
      steps.push({
        type: 'reasoning',
        prompt: step,
        response: reasoningResponse,
      });
    }

    // Étape 3 : Synthèse finale
    const synthesisPrompt = `Question originale : ${prompt}

Voici les étapes de raisonnement :
${steps.map((s, i) => `${i + 1}. ${s.prompt}\n${s.response}`).join('\n\n')}

Synthétise maintenant une réponse finale claire et concise à la question originale.`;

    const finalResponse = await callLLM(ollamaBase, model, synthesisPrompt);
    steps.push({
      type: 'synthesis',
      prompt: 'Synthèse finale',
      response: finalResponse,
    });

    return {
      ok: true,
      finalResponse,
      steps,
      reasoning: steps.map((s) => s.response).join('\n\n'),
    };
  } catch (error) {
    logger.error('Chain-of-Thought failed', { error, prompt: prompt.slice(0, 100) });
    return {
      ok: false,
      error: String(error?.message || error),
      steps,
    };
  }
}

/**
 * Génère une réponse avec Tree-of-Thought (ToT)
 * Explore plusieurs branches de raisonnement et sélectionne la meilleure
 */
async function generateWithTreeOfThought(prompt, options = {}) {
  const ollamaBase = options.ollamaBase || process.env.OLLAMA_BASE || 'http://127.0.0.1:11434';
  const model = options.model || process.env.A11_REASONING_MODEL || process.env.LOCAL_DEFAULT_MODEL || 'gemma4:e4b';
  const numBranches = options.numBranches || 3;

  const branches = [];

  // Générer plusieurs approches différentes
  const approachesPrompt = `Tu es un assistant qui explore plusieurs approches pour répondre à une question.

Question : ${prompt}

Propose ${numBranches} approches différentes pour répondre à cette question. Pour chaque approche, donne un titre court.

Réponds UNIQUEMENT avec les approches, une par ligne, préfixées par un numéro :`;

  try {
    const approachesResponse = await callLLM(ollamaBase, model, approachesPrompt);
    const approaches = extractSteps(approachesResponse);

    // Explorer chaque branche
    for (let i = 0; i < Math.min(approaches.length, numBranches); i++) {
      const approach = approaches[i];
      const branchPrompt = `Question : ${prompt}

Approche : ${approach}

Développe cette approche et fournis une réponse complète en suivant cette méthode.`;

      const branchResponse = await callLLM(ollamaBase, model, branchPrompt);
      branches.push({
        approach,
        response: branchResponse,
      });
    }

    // Évaluer et sélectionner la meilleure branche
    const evaluationPrompt = `Question originale : ${prompt}

Voici ${branches.length} réponses différentes :

${branches.map((b, i) => `Réponse ${i + 1} (${b.approach}) :\n${b.response}`).join('\n\n---\n\n')}

Évalue ces réponses et sélectionne la meilleure. Explique pourquoi elle est meilleure, puis fournis une version améliorée de cette réponse.`;

    const evaluationResponse = await callLLM(ollamaBase, model, evaluationPrompt);

    return {
      ok: true,
      finalResponse: evaluationResponse,
      branches,
      evaluation: evaluationResponse,
    };
  } catch (error) {
    logger.error('Tree-of-Thought failed', { error, prompt: prompt.slice(0, 100) });
    return {
      ok: false,
      error: String(error?.message || error),
      branches,
    };
  }
}

/**
 * Vérifie et corrige une réponse (Self-Correction)
 */
async function verifySelfCorrect(prompt, response, options = {}) {
  const ollamaBase = options.ollamaBase || process.env.OLLAMA_BASE || 'http://127.0.0.1:11434';
  const model = options.model || process.env.A11_REASONING_MODEL || process.env.LOCAL_DEFAULT_MODEL || 'gemma4:e4b';

  const verificationPrompt = `Tu es un vérificateur critique qui détecte les erreurs et les incohérences.

Question : ${prompt}

Réponse proposée : ${response}

Analyse cette réponse et réponds en JSON avec ce format :
{
  "isCorrect": true/false,
  "issues": ["liste des problèmes détectés"],
  "suggestions": ["liste des améliorations suggérées"],
  "confidence": 0.0-1.0
}`;

  try {
    const verificationResponse = await callLLM(ollamaBase, model, verificationPrompt, { format: 'json' });
    let verification;
    try {
      verification = JSON.parse(verificationResponse);
    } catch {
      const jsonMatch = verificationResponse.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        verification = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('Invalid JSON response');
      }
    }

    // Si des problèmes sont détectés, générer une réponse corrigée
    if (!verification.isCorrect || (verification.issues && verification.issues.length > 0)) {
      const correctionPrompt = `Question : ${prompt}

Réponse initiale : ${response}

Problèmes détectés :
${verification.issues ? verification.issues.map((issue, i) => `${i + 1}. ${issue}`).join('\n') : 'Aucun'}

Suggestions d'amélioration :
${verification.suggestions ? verification.suggestions.map((sug, i) => `${i + 1}. ${sug}`).join('\n') : 'Aucune'}

Fournis une réponse corrigée qui résout ces problèmes.`;

      const correctedResponse = await callLLM(ollamaBase, model, correctionPrompt);

      return {
        ok: true,
        needsCorrection: true,
        originalResponse: response,
        correctedResponse,
        verification,
      };
    }

    return {
      ok: true,
      needsCorrection: false,
      originalResponse: response,
      verification,
    };
  } catch (error) {
    logger.error('Self-correction failed', { error, prompt: prompt.slice(0, 100) });
    return {
      ok: false,
      error: String(error?.message || error),
      originalResponse: response,
    };
  }
}

/**
 * Appelle le LLM via Ollama
 */
async function callLLM(ollamaBase, model, prompt, options = {}) {
  const response = await fetch(`${ollamaBase}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt,
      stream: false,
      format: options.format || undefined,
    }),
  });

  if (!response.ok) {
    throw new Error(`Ollama generate failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return String(data.response || '').trim();
}

/**
 * Extrait les étapes d'une réponse numérotée
 */
function extractSteps(text) {
  const lines = text.split('\n');
  const steps = [];

  for (const line of lines) {
    const match = line.match(/^\s*\d+[\.\)]\s*(.+)$/);
    if (match) {
      steps.push(match[1].trim());
    }
  }

  return steps.length > 0 ? steps : [text];
}

/**
 * Classe pour gérer la boucle de réflexion
 */
class ReflectionLoop {
  constructor(options = {}) {
    this.ollamaBase = options.ollamaBase || process.env.OLLAMA_BASE || 'http://127.0.0.1:11434';
    this.model = options.model || process.env.A11_REASONING_MODEL || process.env.LOCAL_DEFAULT_MODEL || 'gemma4:e4b';
    this.mode = options.mode || 'cot'; // 'cot', 'tot', 'verify'
    this.logger = logger.child({ mode: this.mode });
  }

  /**
   * Génère une réponse avec réflexion
   */
  async generate(prompt, options = {}) {
    const mode = options.mode || this.mode;

    this.logger.debug('Starting reflection loop', { mode, prompt: prompt.slice(0, 100) });

    switch (mode) {
      case 'cot':
        return generateWithChainOfThought(prompt, {
          ollamaBase: this.ollamaBase,
          model: this.model,
          ...options,
        });

      case 'tot':
        return generateWithTreeOfThought(prompt, {
          ollamaBase: this.ollamaBase,
          model: this.model,
          ...options,
        });

      case 'verify':
        // Pour le mode verify, on a besoin d'une réponse initiale
        if (!options.response) {
          throw new Error('Mode "verify" requires an initial response');
        }
        return verifySelfCorrect(prompt, options.response, {
          ollamaBase: this.ollamaBase,
          model: this.model,
        });

      default:
        throw new Error(`Unknown reflection mode: ${mode}`);
    }
  }

  /**
   * Génère une réponse avec vérification automatique
   */
  async generateWithVerification(prompt, options = {}) {
    // Étape 1 : Générer une réponse initiale avec CoT
    const cotResult = await this.generate(prompt, { mode: 'cot', ...options });

    if (!cotResult.ok) {
      return cotResult;
    }

    // Étape 2 : Vérifier et corriger si nécessaire
    const verifyResult = await this.generate(prompt, {
      mode: 'verify',
      response: cotResult.finalResponse,
    });

    if (!verifyResult.ok) {
      return cotResult; // Retourner la réponse CoT si la vérification échoue
    }

    return {
      ok: true,
      finalResponse: verifyResult.needsCorrection ? verifyResult.correctedResponse : cotResult.finalResponse,
      cotSteps: cotResult.steps,
      verification: verifyResult.verification,
      needsCorrection: verifyResult.needsCorrection,
      originalResponse: verifyResult.needsCorrection ? verifyResult.originalResponse : undefined,
    };
  }
}

/**
 * Factory pour créer une instance de ReflectionLoop
 */
function createReflectionLoop(options = {}) {
  return new ReflectionLoop(options);
}

module.exports = {
  ReflectionLoop,
  createReflectionLoop,
  generateWithChainOfThought,
  generateWithTreeOfThought,
  verifySelfCorrect,
};
