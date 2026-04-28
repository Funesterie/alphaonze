# Implémentation de la Détection d'Intent Agent — Task 9.2

## Vue d'ensemble

Cette implémentation ajoute la détection d'intent agent dans le pipeline chat d'A11, permettant aux utilisateurs de créer des tâches autonomes via des commandes naturelles comme "A11, fais X".

## Modifications apportées

### 1. `lib/intent-detection.cjs`

**Ajout de `fastPathAgentIntent(normalized)`**

- Détecte les formulations agent via regex patterns
- Patterns supportés :
  - `A11, fais/fait X`
  - `A11, peux-tu/pourrais-tu/veux-tu X`
  - `A11, lance/démarre/exécute/effectue/réalise/accomplis X`
  - `A11, crée/génère/produis/fabrique/construis X`
- Retourne `{ intent: 'agent.task', confidence: 0.95, reason: 'fast_path_agent_command', goal }`

**Ajout de `detectAgentIntent(message)`**

- Wrapper public pour la détection d'intent agent
- Retourne `{ goal, confidence }` si détecté, `null` sinon
- Exporté dans `module.exports`

### 2. `src/routes/chat.cjs`

**Import de `detectAgentIntent`**

```javascript
const {
  detectImageIntent: defaultDetectImageIntent,
  detectVideoIntent: defaultDetectVideoIntent,
  detectWebImageIntent: defaultDetectWebImageIntent,
  detectAgentIntent: defaultDetectAgentIntent,
} = require("../../lib/intent-detection.cjs");
```

**Ajout dans `resolveChatDependencies`**

```javascript
detectAgentIntent: overrides.detectAgentIntent || defaultDetectAgentIntent,
```

**Logique de détection dans le handler `/chat`**

- Détecte l'intent agent avant le traitement normal
- Si détecté :
  1. Appelle Cerbère (port 3001) via HTTP POST à `/api/droid/tasks`
  2. Utilise `LLM_ROUTER_URL` (défaut: `http://localhost:3001`)
  3. Envoie le payload avec `goal`, `meta`, `userId`
  4. Timeout de 5s sur l'appel HTTP
  5. Retourne une confirmation avec l'ID de la Task
  6. Format de réponse :
     ```json
     {
       "ok": true,
       "mode": "agent_task",
       "taskId": "task_1_1777324115069",
       "goal": "une recherche web sur les pandas",
       "assistant": "✅ Tâche créée : **task_1_1777324115069**\n\nJe vais m'occuper de : \"une recherche web sur les pandas\"\n\nTu peux suivre l'avancement avec `/api/droid/tasks/task_1_1777324115069`."
     }
     ```
- Si échec de Cerbère : fallback sur le traitement normal (pas d'erreur bloquante)

## Tests

### Tests unitaires (`test/agent-intent-detection.test.cjs`)

1. ✅ Détecte "A11, fais X"
2. ✅ Détecte "A11, peux-tu X"
3. ✅ Détecte "A11, lance X"
4. ✅ Ne détecte pas les messages normaux
5. ✅ Ne détecte pas les questions
6. ✅ Gère les variations de ponctuation

### Tests d'intégration

Tous les tests existants passent (38/38) :

- Tests de propriétés (PBT) : 15/15
- Tests unitaires : 5/5
- Tests d'intégration : 18/18

## Exemples d'utilisation

### Commandes détectées

```
✅ "A11, fais une recherche web sur les pandas"
✅ "A11, peux-tu créer un fichier test.txt"
✅ "A11, lance une analyse du code"
✅ "A11, génère un rapport PDF"
✅ "A11 fais une recherche" (sans virgule)
```

### Commandes non détectées (comportement normal)

```
❌ "Bonjour A11, comment vas-tu ?"
❌ "A11, qu'est-ce qu'un panda ?"
❌ "Peux-tu m'aider ?" (sans "A11")
```

## Exigences satisfaites

- ✅ **Exigence 8.1** : Détection d'intent agent dans le pipeline chat
- ✅ **Exigence 5.6** : Confirmation de création avec ID de Task dans le fil de conversation

## Notes d'implémentation

### Choix de design

1. **Appel HTTP vers Cerbère** : Délègue la création de tâches au serveur Cerbère (port 3001) qui héberge le Droid
2. **Configuration via `LLM_ROUTER_URL`** : Utilise la même variable d'environnement que le routeur LLM
3. **Timeout de 5s** : Évite de bloquer le pipeline chat si Cerbère est lent ou indisponible
4. **Fallback gracieux** : Si Cerbère échoue, le traitement continue normalement
5. **Fast-path regex** : Détection rapide sans appel LLM (confiance 0.95)
6. **Métadonnées enrichies** : La Task inclut `source: 'chat'`, `conversationId`, `userId`

### Limitations actuelles

1. **Messages de statut** : Non implémentés dans cette tâche (nécessite modification de l'Executor)
2. **Showcase_Mode** : Non implémenté dans cette tâche (tâche 9.3)
3. **Patterns limités** : Seuls les patterns français sont supportés

### Prochaines étapes (hors scope de cette tâche)

- Tâche 9.3 : Implémenter le Showcase_Mode
- Tâche 9.4 : Tests unitaires pour showcase
- Insertion de messages de statut pendant l'exécution (nécessite modification de l'Executor)

## Commandes de test

```bash
# Test de la détection d'intent agent
node --test ./test/agent-intent-detection.test.cjs

# Test complet du système autonome
node --test ./test/a11-autonomous-action-system.node.test.cjs
```

## Compatibilité

- ✅ Node.js >= 20
- ✅ CommonJS (.cjs)
- ✅ Pas de dépendances externes ajoutées
- ✅ Rétrocompatible avec le pipeline chat existant
