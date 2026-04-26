# Reflection Loop (Self-Correction) - A11

## Vue d'ensemble

Le système de **Reflection Loop** (boucle de réflexion) implémente des techniques avancées de raisonnement pour améliorer la qualité des réponses de A11. Il utilise trois approches complémentaires :

1. **Chain-of-Thought (CoT)** : Décomposition du raisonnement en étapes
2. **Tree-of-Thought (ToT)** : Exploration de plusieurs branches de raisonnement
3. **Self-Correction** : Vérification et correction automatique des réponses

## Architecture

### Modules

- **`lib/reflection-loop.cjs`** : Logique métier (CoT, ToT, vérification)
- **`src/routes/reflection.cjs`** : API REST pour accès direct aux fonctionnalités

### Dépendances

- **Ollama** : LLM local pour le raisonnement (par défaut `gemma4:e4b`)
- **Variables d'environnement** :
  - `OLLAMA_BASE` : URL du serveur Ollama (défaut : `http://127.0.0.1:11434`)
  - `A11_REASONING_MODEL` : Modèle spécifique pour le raisonnement (optionnel)
  - `LOCAL_DEFAULT_MODEL` : Modèle par défaut si `A11_REASONING_MODEL` non défini

## Fonctionnalités

### 1. Chain-of-Thought (CoT)

Décompose le raisonnement en étapes séquentielles :

**Flux** :

```
Question → Planification → Raisonnement par étapes → Synthèse finale
```

**Exemple** :

```javascript
const result = await generateWithChainOfThought(
  "Comment optimiser les performances d'une API Node.js ?",
  { maxSteps: 3 },
);

// result.finalResponse : réponse synthétisée
// result.steps : détail de chaque étape de raisonnement
```

**Paramètres** :

- `prompt` (string) : Question ou problème à résoudre
- `options.maxSteps` (number) : Nombre max d'étapes de raisonnement (défaut : 3)
- `options.model` (string) : Modèle LLM à utiliser
- `options.ollamaBase` (string) : URL Ollama

**Retour** :

```javascript
{
  ok: true,
  finalResponse: "...",  // Réponse finale synthétisée
  steps: [               // Détail des étapes
    { type: 'planning', prompt: '...', response: '...' },
    { type: 'reasoning', prompt: '...', response: '...' },
    { type: 'synthesis', prompt: '...', response: '...' }
  ],
  reasoning: "..."       // Raisonnement complet concaténé
}
```

### 2. Tree-of-Thought (ToT)

Explore plusieurs approches en parallèle et sélectionne la meilleure :

**Flux** :

```
Question → Génération d'approches → Exploration de branches → Évaluation → Meilleure réponse
```

**Exemple** :

```javascript
const result = await generateWithTreeOfThought(
  "Quelle architecture choisir pour une app temps réel ?",
  { numBranches: 3 },
);

// result.finalResponse : meilleure réponse sélectionnée
// result.branches : toutes les approches explorées
```

**Paramètres** :

- `prompt` (string) : Question ou problème à résoudre
- `options.numBranches` (number) : Nombre de branches à explorer (défaut : 3, max : 5)
- `options.model` (string) : Modèle LLM à utiliser
- `options.ollamaBase` (string) : URL Ollama

**Retour** :

```javascript
{
  ok: true,
  finalResponse: "...",  // Meilleure réponse après évaluation
  branches: [            // Toutes les branches explorées
    { approach: '...', response: '...' },
    { approach: '...', response: '...' }
  ],
  evaluation: "..."      // Justification du choix
}
```

### 3. Self-Correction (Vérification)

Vérifie une réponse et la corrige si nécessaire :

**Flux** :

```
Question + Réponse → Analyse critique → Détection d'erreurs → Correction (si nécessaire)
```

**Exemple** :

```javascript
const result = await verifySelfCorrect(
  "Quelle est la capitale de la France ?",
  "La capitale de la France est Lyon.",
);

// result.needsCorrection : true
// result.correctedResponse : "La capitale de la France est Paris."
```

**Paramètres** :

- `prompt` (string) : Question originale
- `response` (string) : Réponse à vérifier
- `options.model` (string) : Modèle LLM à utiliser
- `options.ollamaBase` (string) : URL Ollama

**Retour** :

```javascript
{
  ok: true,
  needsCorrection: true,
  originalResponse: "...",
  correctedResponse: "...",  // Présent si needsCorrection = true
  verification: {
    isCorrect: false,
    issues: ["Erreur factuelle : Lyon n'est pas la capitale"],
    suggestions: ["Vérifier la capitale de la France"],
    confidence: 0.95
  }
}
```

### 4. Génération avec vérification automatique

Combine CoT + Self-Correction pour une réponse optimale :

**Exemple** :

```javascript
const reflectionLoop = createReflectionLoop({ mode: "cot" });
const result = await reflectionLoop.generateWithVerification(
  "Explique le fonctionnement des closures en JavaScript",
);

// result.finalResponse : réponse CoT corrigée si nécessaire
// result.cotSteps : étapes du raisonnement
// result.verification : résultat de la vérification
// result.needsCorrection : true si correction appliquée
```

## API REST

### Endpoints

#### 1. POST `/api/reflection/cot`

Chain-of-Thought sur une question.

**Headers** :

```
Authorization: Bearer <JWT_TOKEN>
Content-Type: application/json
```

**Body** :

```json
{
  "prompt": "Comment optimiser une base de données PostgreSQL ?",
  "maxSteps": 3
}
```

**Réponse** :

```json
{
  "ok": true,
  "finalResponse": "Pour optimiser PostgreSQL...",
  "steps": [...],
  "reasoning": "..."
}
```

#### 2. POST `/api/reflection/tot`

Tree-of-Thought sur une question.

**Body** :

```json
{
  "prompt": "Quelle stack technique pour un SaaS B2B ?",
  "numBranches": 3
}
```

**Réponse** :

```json
{
  "ok": true,
  "finalResponse": "Après évaluation des approches...",
  "branches": [...],
  "evaluation": "..."
}
```

#### 3. POST `/api/reflection/verify`

Vérification et correction d'une réponse.

**Body** :

```json
{
  "prompt": "Quelle est la capitale de l'Italie ?",
  "response": "La capitale de l'Italie est Milan."
}
```

**Réponse** :

```json
{
  "ok": true,
  "needsCorrection": true,
  "originalResponse": "La capitale de l'Italie est Milan.",
  "correctedResponse": "La capitale de l'Italie est Rome.",
  "verification": {
    "isCorrect": false,
    "issues": ["Erreur factuelle : Milan n'est pas la capitale"],
    "suggestions": ["La capitale de l'Italie est Rome"],
    "confidence": 0.98
  }
}
```

#### 4. POST `/api/reflection/generate`

Génération avec vérification automatique (CoT + Self-Correction).

**Body** :

```json
{
  "prompt": "Explique le théorème de Pythagore",
  "mode": "cot",
  "maxSteps": 3
}
```

**Réponse** :

```json
{
  "ok": true,
  "finalResponse": "Le théorème de Pythagore...",
  "cotSteps": [...],
  "verification": {...},
  "needsCorrection": false
}
```

## Utilisation programmatique

### Import

```javascript
const {
  ReflectionLoop,
  createReflectionLoop,
  generateWithChainOfThought,
  generateWithTreeOfThought,
  verifySelfCorrect,
} = require("./lib/reflection-loop.cjs");
```

### Classe ReflectionLoop

```javascript
// Créer une instance
const reflectionLoop = new ReflectionLoop({
  ollamaBase: "http://127.0.0.1:11434",
  model: "gemma4:e4b",
  mode: "cot", // 'cot', 'tot', ou 'verify'
});

// Générer avec le mode configuré
const result = await reflectionLoop.generate("Question ?");

// Générer avec vérification automatique
const verifiedResult =
  await reflectionLoop.generateWithVerification("Question ?");
```

### Factory

```javascript
const reflectionLoop = createReflectionLoop({
  mode: "tot",
  model: "gemma4:e4b",
});
```

## Intégration dans le chat (optionnel)

Le Reflection Loop peut être intégré dans le pipeline de chat principal pour améliorer automatiquement les réponses. Cette fonctionnalité est **désactivée par défaut** pour ne pas impacter les performances.

### Activation

Pour activer la réflexion dans le chat, ajouter dans `.env.local` :

```bash
# Activer la boucle de réflexion dans le chat
A11_ENABLE_REFLECTION=true

# Mode de réflexion : 'cot' (défaut), 'tot', ou 'verify'
A11_REFLECTION_MODE=cot

# Nombre d'étapes max pour CoT (défaut : 3)
A11_REFLECTION_MAX_STEPS=3
```

### Comportement

Quand activé :

1. Le message utilisateur est d'abord traité par le Reflection Loop
2. La réponse générée passe par une vérification automatique
3. Si des erreurs sont détectées, la réponse est corrigée
4. La réponse finale (corrigée ou non) est retournée à l'utilisateur

**Impact sur les performances** :

- CoT : ~3x plus lent (3 appels LLM au lieu de 1)
- ToT : ~4x plus lent (exploration de branches multiples)
- Vérification : +1 appel LLM supplémentaire

**Recommandation** : Activer uniquement pour des cas d'usage nécessitant une haute précision (support technique, conseil, éducation).

## Cas d'usage

### 1. Questions complexes nécessitant un raisonnement structuré

**Exemple** : "Comment architecturer un système distribué tolérant aux pannes ?"

→ Utiliser **CoT** pour décomposer le problème en étapes (architecture, résilience, monitoring, etc.)

### 2. Décisions nécessitant l'exploration de plusieurs options

**Exemple** : "Quelle base de données choisir entre PostgreSQL, MongoDB et Cassandra ?"

→ Utiliser **ToT** pour explorer chaque option et comparer

### 3. Vérification de réponses critiques

**Exemple** : Vérifier une réponse médicale, juridique, ou financière avant de la présenter

→ Utiliser **Self-Correction** pour détecter les erreurs factuelles

### 4. Amélioration automatique de la qualité

**Exemple** : Chatbot de support technique

→ Activer **Reflection Loop** dans le chat pour garantir des réponses précises

## Limitations

1. **Performance** : Chaque mode nécessite plusieurs appels LLM (2 à 5 appels)
2. **Latence** : Temps de réponse multiplié par 2 à 4
3. **Dépendance Ollama** : Nécessite un serveur Ollama fonctionnel
4. **Qualité du modèle** : La qualité dépend du modèle LLM utilisé (recommandé : `gemma4:e4b` ou mieux)
5. **Pas de garantie** : La vérification peut manquer certaines erreurs subtiles

## Monitoring

### Logs

Les logs sont générés avec le composant `reflection-loop` :

```javascript
logger.debug("Starting reflection loop", { mode, prompt });
logger.error("Chain-of-Thought failed", { error, prompt });
```

### Métriques

Pour monitorer les performances :

- Temps de réponse par mode (CoT, ToT, verify)
- Taux de correction (needsCorrection = true)
- Taux d'échec des appels LLM

## Tests

### Tests unitaires

```bash
# Tester les fonctions individuelles
node --test test/reflection-loop.test.cjs
```

### Tests d'intégration

```bash
# Tester les endpoints API
curl -X POST http://localhost:3000/api/reflection/cot \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Test question","maxSteps":2}'
```

### Tests manuels

```javascript
// Dans une console Node.js
const { generateWithChainOfThought } = require("./lib/reflection-loop.cjs");

(async () => {
  const result = await generateWithChainOfThought(
    "Explique la différence entre async/await et les Promises",
    { maxSteps: 2 },
  );
  console.log(result);
})();
```

## Roadmap

### Priorité A (implémenté)

- ✅ Chain-of-Thought (CoT)
- ✅ Tree-of-Thought (ToT)
- ✅ Self-Correction
- ✅ API REST
- ✅ Classe ReflectionLoop

### Priorité B (à faire)

- ⬜ Intégration optionnelle dans le chat pipeline
- ⬜ Métriques et monitoring
- ⬜ Tests automatisés
- ⬜ Cache des résultats de réflexion
- ⬜ Support multi-modèles (fallback OpenAI si Ollama indisponible)

### Priorité C (futur)

- ⬜ Interface frontend pour visualiser les étapes de raisonnement
- ⬜ Mode "explain" pour afficher le raisonnement à l'utilisateur
- ⬜ Fine-tuning du modèle de raisonnement
- ⬜ Reflection Loop multi-agents (plusieurs LLM débattent)

## Références

- **Chain-of-Thought Prompting** : [Wei et al., 2022](https://arxiv.org/abs/2201.11903)
- **Tree-of-Thoughts** : [Yao et al., 2023](https://arxiv.org/abs/2305.10601)
- **Self-Consistency** : [Wang et al., 2022](https://arxiv.org/abs/2203.11171)

## Support

Pour toute question ou problème :

1. Vérifier que Ollama est démarré : `curl http://127.0.0.1:11434/api/tags`
2. Vérifier les logs : `grep "reflection-loop" logs/a11.log`
3. Tester les endpoints API avec curl
4. Consulter la documentation Ollama : https://ollama.ai/docs

---

**Dernière mise à jour** : 2026-04-26  
**Version** : 1.0.0  
**Auteur** : Funesterie / A11 Team
