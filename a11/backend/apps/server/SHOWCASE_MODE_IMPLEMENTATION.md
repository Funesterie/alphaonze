# Showcase Mode Implementation — Task 9.3

## Vue d'ensemble

Implémentation de la détection et de la génération de plan pour le **Showcase_Mode** d'A11, permettant à l'utilisateur de demander une démonstration autonome des capacités du système.

## Composants modifiés

### 1. `lib/intent-detection.cjs`

**Ajouts :**

- `fastPathShowcaseIntent(normalized)` : Détection rapide des formulations Showcase via regex
  - Patterns supportés :
    - "montre-moi ce que tu sais faire"
    - "montre-moi tes capacités"
    - "showcase" / "démonstration" / "démo"
    - "révèle ton talent"
    - "que sais-tu faire ?"
    - "quelles sont tes capacités ?"
  - Extraction optionnelle d'un thème : "sur le thème de X", "avec X", "pour X"
- `detectShowcaseIntent(message)` : Wrapper public retournant `{ theme, confidence }` ou `null`

**Export :**

```javascript
module.exports = {
  // ... exports existants
  detectShowcaseIntent,
};
```

### 2. `a11-planner.cjs`

**Ajouts :**

- `buildShowcasePlan(theme?)` : Génère un Plan de démonstration Showcase
  - Consulte Neo4j pour récupérer les 10 dernières créations passées (images, vidéos, PDFs, audio, code)
  - Construit le World_Context (workspace, services actifs, Karma)
  - Injecte l'Identity_Core (`system_prompt.txt`) en priorité absolue
  - Appelle Cerbère avec un prompt spécifique Showcase demandant :
    - Minimum 5 catégories de tools différentes
    - Maximum 8 actions
    - Actions spectaculaires et impressionnantes
  - Valide les skills contre `allowedPrefixes`
  - Limite le plan à 8 steps maximum
  - Retry Cerbère : 3 tentatives × 2s si HTTP error
  - Timeout 30s sur la génération

**Export :**

```javascript
module.exports = {
  getPlanFromLlm,
  buildWorldContext,
  buildShowcasePlan, // Nouveau
};
```

### 3. `src/routes/chat.cjs`

**Ajouts :**

- Import de `detectShowcaseIntent` depuis `intent-detection.cjs`
- Ajout dans `resolveChatDependencies()` et `createChatRouter()`
- Nouvelle logique de détection Showcase dans le handler `POST /chat` :
  1. Détecte l'intent Showcase via `detectShowcaseIntent(userMessage)`
  2. Si détecté :
     - Appelle `buildShowcasePlan(theme)` pour générer le plan
     - Crée une Task via Cerbère (port 3001) avec :
       - Goal : "Showcase Mode : démonstration [sur le thème X]"
       - Meta : `{ mode: 'showcase', showcaseMode: true, theme, plan }`
     - Retourne une réponse JSON avec :
       - `mode: 'showcase'`
       - `taskId`, `theme`, `stepsCount`
       - Message enthousiaste avec `[SFX:thinking]`
  3. Fallback gracieux si erreur : message d'erreur explicatif

**Réponse Showcase :**

```json
{
  "ok": true,
  "mode": "showcase",
  "taskId": "task_123_1234567890",
  "theme": "créativité",
  "stepsCount": 7,
  "assistant": "🎭 **Showcase Mode activé !**\n\n[SFX:thinking]\n\nJe vais te montrer ce que je sais faire sur le thème \"créativité\".\n\nPlan de démonstration : 7 actions spectaculaires.\n\nC'est parti ! 🚀"
}
```

## Tests

### Test manuel de détection

Fichier : `test/showcase-detection.manual.test.cjs`

**Résultats :**

- ✅ 12/12 tests passés
- Détection correcte des formulations positives
- Pas de faux positifs sur les formulations négatives
- Extraction correcte du thème optionnel

**Usage :**

```bash
node test/showcase-detection.manual.test.cjs
```

## Exigences couvertes

### Tâche 9.3 — Exigences

✅ **3.1** : Détection des formulations "montre-moi ce que tu sais faire", "showcase", "révèle ton talent" et variantes sémantiques

✅ **3.2** : Génération d'un Plan utilisant au minimum 5 catégories de tools distinctes (via prompt Cerbère)

✅ **3.3** : Exécution autonome sans confirmation pour les steps `low`/`medium` (délégué à l'Executor via flag `showcaseMode: true`)

⚠️ **3.4** : Stockage des artefacts via `share_file` (délégué à l'Executor)

⚠️ **3.5** : Rapport narratif en français avec liens artefacts (délégué à l'Executor)

✅ **3.6** : Vocalisation TTS avec `[SFX:thinking]` au démarrage (inclus dans le message de confirmation)

⚠️ **3.7** : Limite de 5 minutes pour une démonstration standard (délégué à l'Executor)

⚠️ **3.8** : Adaptation du Plan selon le thème spécifié (implémenté dans `buildShowcasePlan`)

### Notes

Les exigences marquées ⚠️ dépendent de l'Executor et du TTS, qui seront gérés dans les tâches suivantes ou sont déjà partiellement implémentés :

- L'Executor a déjà un paramètre `showcaseMode` dans ses options
- Le Safety_Gate ne bloque pas les steps `low`/`medium` par défaut
- Le TTS et le rapport narratif seront gérés par l'Executor lors de la complétion de la Task

## Flux complet

```
Utilisateur: "montre-moi ce que tu sais faire"
    │
    ▼
detectShowcaseIntent() → { theme: null, confidence: 0.95 }
    │
    ▼
buildShowcasePlan(null)
    │  1. Consulte Neo4j (10 dernières créations)
    │  2. Construit World_Context
    │  3. Injecte Identity_Core
    │  4. Appelle Cerbère avec prompt Showcase
    │  5. Valide le Plan (skills, limite 8 steps)
    ▼
Plan { steps: [{ skill, payload }, ...] }
    │
    ▼
Création Task via Cerbère (port 3001)
    │  Goal: "Showcase Mode : démonstration complète"
    │  Meta: { mode: 'showcase', showcaseMode: true, plan }
    ▼
Réponse JSON avec taskId + message enthousiaste
    │
    ▼
Droid traite la Task → Executor exécute le Plan
    │
    ▼
[À implémenter] TTS [SFX:victory] + rapport narratif
```

## Prochaines étapes

1. **Tâche 9.4** : Écrire des tests unitaires pour la détection Showcase
2. **Intégration Executor** : Gérer le flag `showcaseMode` pour :
   - Désactiver les confirmations pour steps `low`/`medium`
   - Appeler le TTS avec `[SFX:victory]` à la fin
   - Générer un rapport narratif en français avec liens artefacts
3. **Intégration TTS** : Vocaliser les SFX et le rapport final

## Dépendances

- **Cerbère** (port 3001) : Doit être accessible pour créer les Tasks Droid
- **Neo4j** : Optionnel, fallback JSON local si indisponible
- **Redis** : Optionnel, fallback fichier local si indisponible
- **Identity_Core** : `system_prompt.txt` doit exister dans le répertoire du serveur

## Configuration

Variables d'environnement :

- `LLM_ROUTER_URL` : URL de Cerbère (défaut : `http://localhost:3001`)
- `CERBERE_PLANNER_URL` : URL du Planner Cerbère (défaut : `http://127.0.0.1:4545/api/v1/plan`)
- `NEO4J_URI` : URI Neo4j (optionnel)
- `A11_WORKSPACE_ROOTS` : Racines workspace autorisées (optionnel)

## Exemples d'utilisation

### Showcase simple

**Requête :**

```json
POST /api/chat
{
  "message": "montre-moi ce que tu sais faire"
}
```

**Réponse :**

```json
{
  "ok": true,
  "mode": "showcase",
  "taskId": "task_1_1234567890",
  "theme": null,
  "stepsCount": 7,
  "assistant": "🎭 **Showcase Mode activé !**\n\n[SFX:thinking]\n\nJe vais te montrer ce que je sais faire.\n\nPlan de démonstration : 7 actions spectaculaires.\n\nC'est parti ! 🚀"
}
```

### Showcase avec thème

**Requête :**

```json
POST /api/chat
{
  "message": "montre-moi tes capacités créatives"
}
```

**Réponse :**

```json
{
  "ok": true,
  "mode": "showcase",
  "taskId": "task_2_1234567891",
  "theme": "créatives",
  "stepsCount": 6,
  "assistant": "🎭 **Showcase Mode activé !**\n\n[SFX:thinking]\n\nJe vais te montrer ce que je sais faire sur le thème \"créatives\".\n\nPlan de démonstration : 6 actions spectaculaires.\n\nC'est parti ! 🚀"
}
```

## Limitations connues

1. **Corpus non consulté** : L'implémentation actuelle consulte Neo4j mais pas le Corpus (artefacts mémorisés en PNG RGB). Cela pourrait être ajouté dans une version future.

2. **Validation des 5 catégories** : Le prompt Cerbère demande ≥5 catégories, mais il n'y a pas de validation stricte côté code. Cerbère est responsable de respecter cette contrainte.

3. **Rapport narratif** : Le rapport final avec liens artefacts n'est pas encore généré. Il sera implémenté dans l'Executor lors de la complétion de la Task.

4. **TTS [SFX:victory]** : Le SFX de fin n'est pas encore vocalisé. Il sera ajouté dans l'Executor.

## Références

- **Spec** : `funesterie/.kiro/specs/a11-autonomous-action-system/`
- **Requirements** : Exigences 3.1 à 3.8
- **Design** : Section "Flux Showcase_Mode"
- **Tasks** : Tâche 9.3
