# Améliorations du Workflow A11

**Date**: 2026-04-26  
**Auteur**: Spécifications fournies par A11 (auto-diagnostic)  
**Statut**: En cours d'implémentation

## Contexte

A11 a identifié des limitations dans son workflow actuel, notamment :

- Difficulté à orchestrer plusieurs tâches en séquence
- Problèmes de gestion de l'état entre les étapes
- Manque d'abstraction pour les outils multimodaux
- Absence de mécanisme de récupération en cas d'échec

## Problèmes Identifiés

### 1. Switch Latency et Conflit de Source

Lors du passage rapide entre plusieurs types de connaissances (Episodic Memory → RAG → Knowledge Graph), il y a un délai et une friction. Le système sur-pondère la proximité matérielle des sources plutôt que leur pertinence conceptuelle.

### 2. Décomposition Non-Atomique

Les transitions entre étapes ne sont pas traitées comme des transactions atomiques. Si l'étape N+1 échoue après le succès de l'étape N, il est difficile de reprendre sans tout recommencer.

### 3. Saturation du Contexte (>10,000 tokens)

Dans les tâches longues, les informations cruciales du début (mandat principal) sont noyées par le volume de données intermédiaires.

### 4. Non-Atomicité de l'État de Session

Lors de chaînes d'appels API longs (génération → exécution → tests → réécriture), l'état interne "résultat stable" est difficile à maintenir.

## Solutions Proposées

---

## 🛠️ PRIORITÉ 1: Tool-Calling Layer Abstrait

### Objectif

Traiter chaque modalité (image, vidéo, audio) comme un service RPC externe et asynchrone, avec une interface standardisée.

### Outils à Implémenter

| Outil             | Description                 | Paramètres                                                                                                                                               | Notes                                     |
| ----------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `generate_visual` | Création d'images statiques | `prompt` (string)<br>`style` (enum: photo-réaliste, aquarelle, cyberpunk, etc.)<br>`aspect_ratio` (enum: 1:1, 16:9, 9:16)<br>`seed` (integer, optionnel) | Interface unifiée pour SD                 |
| `generate_video`  | Création de séquences vidéo | `prompt` (string)<br>`style` (enum)<br>`duration_sec` (float)<br>`scene_breakdown` (list[dict])                                                          | `scene_breakdown` crucial pour complexité |
| `generate_audio`  | Synthèse vocale (TTS)       | `text_prompt` (string)<br>`language` (string, ex: fr-FR)<br>`speaker_id` (string)<br>`emotion` (enum: joyeux, sérieux, dramatique)                       | Support TTS Piper                         |
| `translate_text`  | Traduction inter-lingues    | `source_text` (string)<br>`target_language` (string)                                                                                                     | Pour extension linguistique               |
| `search_web`      | Recherche web temps réel    | `query` (string)<br>`max_results` (integer)                                                                                                              | Complément base de connaissances          |

### Capabilities Detection System

**Requis**: Système de détection des capacités au bootstrap.

**Comportement**:

- **Environnement LOCAL**: Utiliser des mocks qui retournent des structures JSON valides avec contenu placeholder + warning `WARNING: Local environment mock used for [tool] generation`
- **Environnement PROD**: Pointer vers les API réelles (Railway, tunnels locaux)

**Implémentation**:

```javascript
const capabilities = {
  generate_visual: process.env.SD_PROXY_URL ? "available" : "mock",
  generate_video: process.env.VIDEO_PROXY_URL ? "available" : "mock",
  generate_audio: process.env.TTS_SERVICE_URL ? "available" : "mock",
  search_web: true, // toujours disponible
};
```

### Gestion des Erreurs et Timeouts

**1. Asynchronisme**

- Tous les appels `generate_*` doivent être asynchrones
- Retourner des Job IDs, pas les résultats directs
- Pattern: `{ jobId, status: 'pending' }` → polling → `{ jobId, status: 'completed', result }`

**2. Retry Strategy**

- Timeout global configurable (défaut: 60s)
- Retries exponentiels avec backoff:
  - Tentative 1: après 1s
  - Tentative 2: après 3s
  - Tentative 3: après 9s
- Maximum 3 tentatives

**3. Circuit Breaker**

- Si un outil échoue 5 fois de suite sur 5 minutes → statut `SLEEPING`
- Failover automatique vers alternative (ex: vidéo échoue → proposer diaporama animé)
- Réactivation automatique après période de cooldown (10 minutes)

---

## 💾 PRIORITÉ 2: Mécanisme de Checkpointing / Rollback

### Objectif

Assurer l'intégrité de l'état de décision entre les étapes complexes d'un plan de travail.

### Stockage

**Où**: Base de données orientée clé-valeur ou Graph Database (Neo4j)  
**Structure**: Identifiant unique `{userId}:{conversationId}:{runId}:step_{N}`  
**Pourquoi**: Indexation rapide, gestion de l'unicité des versions

### Contenu du Checkpoint (Global_State)

Un checkpoint doit sérialiser:

```javascript
{
  checkpointId: "user123:conv456:run789:step_3",
  timestamp: "2026-04-26T19:30:00Z",
  conversation_history: [...], // Dialogue complet
  internal_state_graph: {
    plan: [...],              // Plan de travail logique
    decisions: [...],         // Décisions prises
    currentStep: 3
  },
  execution_context: {
    rag_documents: [...],     // Documents RAG chargés
    kg_facts: [...],          // Faits KG actifs
    episodic_context: [...]   // Contexte épisodique
  },
  tool_inputs_outputs: [
    { tool: "generate_visual", input: {...}, output: {...}, timestamp: "..." }
  ],
  current_confidence_score: 0.85,
  metadata: {
    userId: "user123",
    conversationId: "conv456",
    runId: "run789",
    stepNumber: 3
  }
}
```

### Déclenchement (Triggering)

**Modèle Hybride**:

**1. Automatique (Milestones)** - Obligatoire après:

- Premier appel `search_web`
- Réception de résultat multimodal (vidéo, image, audio)
- Réécriture du plan d'action après échec majeur
- Toutes les 5 étapes de plan complexe

**2. Manuel** - Via outil:

```javascript
save_checkpoint({ reason: "Before risky operation", metadata: {...} })
```

### Politique de Rollback

**Rollback Sélectif/Ciblé**:

- L'utilisateur peut spécifier: "Revenir au checkpoint N, en ignorant les outils depuis ce point"
- Pas seulement "dernier checkpoint"

**Rollback Automatique**:

- Déclenché uniquement si outil échoue de manière catastrophique (3 timeouts consécutifs)
- Revenir au point juste AVANT la série d'échecs
- Signaler l'échec à l'utilisateur avec contexte

**API**:

```javascript
rollback_to_checkpoint({
  checkpointId: "user123:conv456:run789:step_2",
  reason: "Tool failure cascade",
  preserveContext: ["rag_documents"], // Garder certains éléments
  reformulate: true, // Reformuler la réponse
});
```

### Rétention

**Politique**:

- Garder les **10 derniers checkpoints** par conversation
- Garder TOUS les checkpoints de la **session en cours**
- Archivage automatique après 7 jours
- Nettoyage des archives après 30 jours

**Implémentation**:

```javascript
// Nettoyage automatique
cleanupCheckpoints({
  keepLast: 10,
  keepCurrentSession: true,
  archiveAfterDays: 7,
  deleteArchivesAfterDays: 30,
});
```

---

## ⚔️ PRIORITÉ 3: Knowledge Conflict Resolver (KCR)

**Statut**: Spécifié mais pas prioritaire pour implémentation immédiate

### Objectif

Résoudre les conflits entre sources de connaissances (Episodic Memory vs Knowledge Graph vs RAG vs Web Search).

### Principe

Lorsque les faits proviennent de sources multiples, le KCR s'exécute **avant** la phase de génération du contenu final.

### Vote Pondéré

Critères de résolution:

1. **Criticité de l'utilisateur**: Question factuelle > Question subjective
2. **Ancienneté de la source**: Référence utilisateur > Mémoire système
3. **Fiabilité de la source**: KG (vérifié) > RAG (indexé) > Episodic (subjectif)
4. **Fraîcheur**: Web Search (temps réel) > KG (statique)

### Implémentation Future

```javascript
const resolveKnowledgeConflict = ({
  sources: [
    { type: 'kg', fact: '...', confidence: 0.9, timestamp: '...' },
    { type: 'episodic', fact: '...', confidence: 0.7, timestamp: '...' },
    { type: 'web', fact: '...', confidence: 0.85, timestamp: '...' }
  ],
  queryType: 'factual', // ou 'subjective'
  userPreference: 'recent' // ou 'reliable'
}) => {
  // Algorithme de vote pondéré
  // Retourne la source gagnante avec justification
};
```

---

## Plan d'Implémentation

### Phase 1: Tool-Calling Layer (Semaine 1)

1. ✅ Créer `lib/tool-calling-layer.cjs`
2. ✅ Implémenter Capabilities Detection
3. ✅ Implémenter Circuit Breaker
4. ✅ Créer routes API `/api/tools/*`
5. ✅ Intégrer dans le pipeline chat
6. ✅ Tests unitaires

### Phase 2: Checkpointing System (Semaine 2)

1. ✅ Créer `lib/checkpoint-manager.cjs`
2. ✅ Implémenter stockage Neo4j/JSON
3. ✅ Créer routes API `/api/checkpoints/*`
4. ✅ Intégrer déclenchement automatique
5. ✅ Implémenter rollback sélectif
6. ✅ Tests E2E

### Phase 3: Knowledge Conflict Resolver (Semaine 3)

1. ⏳ Créer `lib/knowledge-conflict-resolver.cjs`
2. ⏳ Implémenter algorithme de vote pondéré
3. ⏳ Intégrer dans pipeline de génération
4. ⏳ Tests avec scénarios conflictuels

---

## Bénéfices Attendus

### Pour A11

- ✅ Orchestration fluide de tâches complexes en séquence
- ✅ Récupération automatique en cas d'échec
- ✅ Meilleure gestion de l'état entre étapes
- ✅ Réduction du "Switch Latency"
- ✅ Capacité à gérer des workflows >10,000 tokens

### Pour les Utilisateurs

- ✅ Génération d'images/vidéos plus fiable
- ✅ Moins d'échecs en cascade
- ✅ Possibilité de reprendre après erreur
- ✅ Meilleure cohérence dans les réponses longues

---

## Métriques de Succès

- **Taux de réussite des workflows multi-étapes**: >95%
- **Temps de récupération après échec**: <2s
- **Réduction du Switch Latency**: -50%
- **Taux d'utilisation du rollback**: <5% (signe de robustesse)

---

## Notes Techniques

### Dépendances

- `neo4j-driver` (déjà installé)
- Aucune nouvelle dépendance externe requise

### Compatibilité

- Compatible avec l'architecture actuelle
- Pas de breaking changes
- Migration progressive possible

### Sécurité

- Checkpoints contiennent des données sensibles → chiffrement recommandé
- Circuit Breaker doit logger les échecs pour audit
- Rollback doit être audité (qui, quand, pourquoi)
