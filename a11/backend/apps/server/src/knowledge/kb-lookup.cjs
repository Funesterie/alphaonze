// kb-lookup.cjs — base de connaissances embarquée, lookup par tags
// Contenu dérivé de E:\kb-funesterie\ — enrichi par recherches BFL docs, LogRocket, arxiv 2506.15742

const KB = [
  {
    id: 'kb-kontext-prompting',
    tags: ['kontext', 'img2img', 'image', 'prompt', 'flux'],
    title: 'Kontext img2img — instructions d\'édition',
    rules: `## Kontext prompt rules (flux-kontext-pro)
Formule universelle : [verbe d'action précis] + [description physique] + [placement] + "while keeping [élément adjacent] unchanged"

Verbes qui marchent : attach, pin, clip, place, rest on, hold, swap, replace, wrap around, change
Verbes qui ratent : "transform" (= refonte complète), "make", "give", "put" — trop vagues

Pour tout objet physique à ajouter : décrire matière + forme + taille + finition + détails de surface.
Toujours fermer avec une clause de préservation : "while keeping [élément touché] unchanged"

Phrases de préservation (force croissante) :
- "while maintaining..."  →  "exact same..."  →  "preserving..."  →  "[element] must remain unchanged"

Max 3 changements par appel. Toujours repartir de l'image originale pour chaque branche d'édition.`,
  },
  {
    id: 'kb-structured-llm-prompt',
    tags: ['llm', 'json', 'structured-output', 'system-prompt', 'groq', 'openai'],
    title: 'System prompts pour JSON structuré',
    rules: `## Structured LLM output rules
Approche 4 couches : (1) schema, (2) 1 exemple complet, (3) règles strictes, (4) "Only return valid JSON, no explanation"

Temperature : 0.0–0.1 pour extraction pure, 0.2–0.3 pour structured créatif.

Groq : response_format json_object + schema dans le system prompt (l'argument schema est ignoré).
OpenAI : json_schema + strict:true pour validation stricte native.

Règles métier : pattern général + exemple > liste de cas particuliers.
Toujours inclure "If unsure, use null — never invent values" pour les champs optionnels.
max_tokens : calculer le pire cas × 1.5. Une troncature produit du JSON invalide, pas une erreur explicite.`,
  },
  {
    id: 'kb-llm-routing',
    tags: ['routing', 'llm', 'groq', 'ollama', 'fallback', 'circuit-breaker'],
    title: 'Routage LLM — stratégies de production',
    rules: `## LLM routing rules
80% des besoins couverts par 5-10 règles simples. Commencer simple, router seulement quand le coût/latence devient problématique.

Retry (même provider, erreur transitoire) : HTTP 429, 500, 502, 503, 504 — avec backoff exponentiel + jitter.
Fallback (changer de provider) : après épuisement des retries ou sur 400/401/403 (erreurs permanentes, ne pas retrier).

Circuit breaker : seuil d'échecs → circuit ouvert → timeout → demi-ouvert → fermeture sur succès consécutifs.
Quand circuit ouvert : aller directement au fallback sans attendre.

Bypass ciblé : créer buildXxxCallFn(env) qui bypass la config globale pour un cas spécifique — la config reste inchangée, le bypass est auditable.`,
  },
  {
    id: 'kb-fallback-patterns',
    tags: ['fallback', 'pipeline', 'resilience', 'retry', 'stub'],
    title: 'Patterns de fallback dans les pipelines async',
    rules: `## Fallback patterns
Retry ≠ Fallback. Retry = même provider + erreur transitoire. Fallback = changer de provider/algorithme.

Pattern cascade : try primary → warn si échec → fallback synchrone (jamais d'appel réseau dans le fallback).
Le fallback ne doit pas lancer d'exception. Il construit depuis le texte brut utilisateur.

Stub non implémenté : lancer une erreur avec code spécifique (WEB_CACHE_NOT_IMPLEMENTED) plutôt que retourner silencieusement.
Sample rate : pour services coûteux post-génération, Math.random() < rate avant d'appeler.
Toujours logger fallbackReason pour le monitoring.`,
  },
  {
    id: 'kb-semantic-intent',
    tags: ['semantic', 'intent', 'nlp', 'french', 'parsing', 'context'],
    title: 'Parsing sémantique d\'intention multilingue',
    rules: `## Semantic intent parsing
Pipeline : supprimer politesse → supprimer préfixes image → normaliser texte → extraire slots.

Slots à extraire : renderHints (anime/cartoon/pixel-art), referenceHints (mario/zelda/ghibli), palette (couleurs), showIntent (montre-moi), replaceIntent (à la place de).

Context carryover : injecter image_context_carryover.summary dans le prompt pour résoudre les références implicites ("cette personne", "ce personnage").

Fiabilité croissante : texte brut > regex hints > entité extraite > analyse LLM. Ne jamais bloquer sur les couches supérieures.`,
  },
  {
    id: 'kb-pipeline-commutator',
    tags: ['pipeline', 'commutator', 'architecture', 'routing'],
    title: 'Pattern commutateur de pipeline',
    rules: `## Pipeline commutator pattern
Un seul point de commutation, commenté, avec chemin actif et alternatif explicites.
Les deux chemins : mêmes paramètres d'entrée + même format de sortie (normalizePayload).
Feature flag env var pour switcher sans redéployer (A11_USE_IMAGE_BRAIN=1).
Documenter les dépendances de chaque chemin (services requis, env vars).`,
  },
];

// Index par tag pour lookup O(1)
const TAG_INDEX = new Map();
for (const entry of KB) {
  for (const tag of entry.tags) {
    if (!TAG_INDEX.has(tag)) TAG_INDEX.set(tag, []);
    TAG_INDEX.get(tag).push(entry);
  }
}

/**
 * Retourne les entrées KB pertinentes pour un ensemble de tags.
 * @param {string[]} tags
 * @returns {Array<{id, title, rules}>}
 */
function lookupByTags(tags = []) {
  const seen = new Set();
  const results = [];
  for (const tag of tags) {
    const matches = TAG_INDEX.get(tag) || [];
    for (const entry of matches) {
      if (!seen.has(entry.id)) {
        seen.add(entry.id);
        results.push(entry);
      }
    }
  }
  return results;
}

/**
 * Retourne les règles formatées pour injection dans un system prompt LLM.
 * Retourne '' si aucun match — pas de surcoût sur les appels non concernés.
 * @param {string[]} tags
 * @returns {string}
 */
function getKbRulesForPrompt(tags = []) {
  const entries = lookupByTags(tags);
  if (!entries.length) return '';
  return entries.map((e) => e.rules).join('\n\n');
}

/**
 * Détecte les tags KB depuis le CONTEXTE d'exécution, pas depuis des mots-clés.
 * Principe KB : les règles s'appliquent en fonction de ce qu'on fait, pas de ce qu'on dit.
 *
 * @param {object} ctx
 * @param {boolean} [ctx.hasReferenceImage]  - image de référence présente (init_image_url)
 * @param {boolean} [ctx.isImagePipeline]    - on est dans un pipeline génération image
 * @param {boolean} [ctx.isStructuredLlm]    - on construit un prompt LLM structuré (JSON)
 * @param {boolean} [ctx.isEditing]          - l'utilisateur veut modifier l'image existante
 * @returns {string[]}
 */
function detectTagsFromContext(ctx = {}) {
  const tags = [];

  // Règles Kontext : toujours actives quand une image de référence est présente
  // C'est le critère d'activation, pas les mots du message
  if (ctx.hasReferenceImage || ctx.isEditing) {
    tags.push('kontext', 'img2img');
  }

  // Règles structured LLM : toujours actives pour tout appel LLM avec JSON attendu
  if (ctx.isStructuredLlm) {
    tags.push('llm', 'structured-output');
  }

  // Règles semantic intent : toujours actives en entrée d'un pipeline image
  if (ctx.isImagePipeline) {
    tags.push('semantic', 'intent');
  }

  return [...new Set(tags)];
}

/**
 * Retourne les règles KB injectables selon le contexte d'exécution.
 * Usage : appeler avant de construire le system prompt LLM.
 *
 * @param {object} ctx - contexte d'exécution (voir detectTagsFromContext)
 * @returns {string}
 */
function getKbRulesForContext(ctx = {}) {
  const tags = detectTagsFromContext(ctx);
  return getKbRulesForPrompt(tags);
}

/**
 * @deprecated Utiliser getKbRulesForContext(ctx) à la place.
 * Détection par mots-clés = cas par cas, fragile. Conservé pour compatibilité.
 */
function detectTagsFromText(text = '') {
  const t = String(text || '').toLowerCase();
  const detected = [];
  if (/kontext|img2img/i.test(t)) detected.push('kontext', 'img2img');
  if (/json|structured|schema/i.test(t)) detected.push('structured-output', 'llm');
  return [...new Set(detected)];
}

/** @deprecated Utiliser getKbRulesForContext à la place. */
function getKbRulesForMessage(userMessage = '') {
  const tags = detectTagsFromText(userMessage);
  return getKbRulesForPrompt(tags);
}

module.exports = {
  KB,
  lookupByTags,
  getKbRulesForPrompt,
  detectTagsFromContext,
  getKbRulesForContext,
  // deprecated
  detectTagsFromText,
  getKbRulesForMessage,
};
