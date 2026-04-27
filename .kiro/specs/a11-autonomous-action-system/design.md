# Document de Design Technique — A11 Autonomous Action System

## Vue d'ensemble

L'**A11 Autonomous Action System** est le liens qui connecte les composants agentiques existants d'A11 en une boucle autonome harmonieuse. Ll libère celles qui existent déjà en les orchestrant de façon transparente, sûre et traçable.

Le système repose sur quatre piliers :

1. **Planification** — L'utilisateur compose un Goal en Plan structuré, A11 enrichi du World_Context et le donne planifit via Cerbère.
2. **Exécution** — Le Droid pilote la boucle de traitement des Tasks ; l'Executor dispatche les steps via les modules.
3. **Identité & Karma** — L'Identity_Core d'A11 est délimité via `system_prompt.txt` dans chaque appel LLM ; le Karma_Engine calcule l'état émotionnel à partir des stats réelles.
4. **Transparence** — L'Audit_Trail enregistre chaque événement ; les endpoints REST exposent l'état en temps réel.

### Contraintes techniques

- CommonJS (`.cjs`) — pas d'ESM
- Node.js >= 20
- Pas de nouvelle dépendance externe sauf si absolument nécessaire
- Tous les fichiers dans `funesterie/a11/backend/apps/server/`

---

## Architecture

### Vue d'ensemble des composants

```
┌─────────────────────────────────────────────────────────────────────┐
│                         server.cjs (Express)                        │
│  ┌──────────────────┐   ┌──────────────────────────────────────┐   │
│  │  Pipeline Chat   │   │         routes/droid.cjs             │   │
│  │  (Showcase_Mode) │   │  POST /api/droid/tasks               │   │
│  └────────┬─────────┘   │  GET  /api/droid/status              │   │
│           │             │  GET  /api/droid/tasks               │   │
│           ▼             │  GET  /api/droid/tasks/:id           │   │
│    détecte intent       │  DELETE /api/droid/tasks/:id         │   │
│    agent/showcase       │  POST /api/droid/tasks/:id/rollback  │   │
│                         └──────────────┬───────────────────────┘   │
└───────────────────────────────────────┼────────────────────────────┘
                                        │
                    ┌───────────────────▼──────────────────────┐
                    │              a11-droid.cjs               │
                    │  • Boucle de polling (FIFO)              │
                    │  • Gestion des statuts de Tasks          │
                    │  • Checkpoints & Rollback                │
                    │  • Rate_Limiter global                   │
                    └──────┬──────────────────┬───────────────┘
                           │                  │
              ┌────────────▼──────┐  ┌────────▼──────────────┐
              │  a11-planner.cjs  │  │ a11-plan-executor.cjs │
              │  • World_Context  │  │  • Safety_Gate        │
              │  • system_prompt  │  │  • Horn/Qflush        │
              │    (Identity_Core)│  │  • Retry exponentiel  │
              │  • LLM (Cerbère)  │  │  • Audit_Trail        │
              │  • Validation     │  │  • Karma_Engine       │
              │  • Persistance    │  └────────┬──────────────┘
              └────────┬──────────┘           │
                       │                      │
              ┌────────▼──────────────────────▼──────────────┐
              │              Couche Infrastructure            │
              │  ┌──────────┐  ┌──────────┐  ┌───────────┐  │
              │  │  Redis   │  │  Neo4j   │  │  Qflush/  │  │
              │  │ (Qflush) │  │  (Graph) │  │   Horn    │  │
              │  └──────────┘  └──────────┘  └───────────┘  │
              └──────────────────────────────────────────────┘
                       │
              ┌────────▼──────────────────────────────────────┐
              │              Nouveaux modules                  │
              │  ┌──────────────────┐  ┌────────────────────┐ │
              │  │ lib/karma-engine │  │ lib/plan-serializer│ │
              │  │      .cjs        │  │       .cjs         │ │
              │  └──────────────────┘  └────────────────────┘ │
              └───────────────────────────────────────────────┘
```

### Flux de données principal

```
Utilisateur
    │
    │  "A11, fais [Goal]"
    ▼
server.cjs (pipeline chat)
    │
    │  détecte intent agent
    ▼
a11-droid.cjs → addDroidTask({ goal })
    │
    │  [boucle polling A11_DROID_INTERVAL_MS]
    ▼
Task: pending → running
    │
    ▼
a11-planner.cjs → getPlanFromLlm(task, worldContext)
    │  1. Construit World_Context (workspace, Neo4j, mémoire)
    │  2. Injecte Identity_Core (system_prompt.txt) en priorité
    │  3. Appelle Cerbère (port 4545)
    │  4. Valide le Plan (skills, structure)
    │  5. Persiste dans Redis: plan:{taskId}
    ▼
Plan { steps: [{ skill, payload, id }] }
    │
    ▼
a11-plan-executor.cjs → executePlan(task, plan)
    │  Pour chaque step:
    │    1. Safety_Gate (dangerLevel check)
    │    2. Rate_Limiter check
    │    3. Horn.scream(skill, payload)
    │    4. Audit_Trail.log(event)
    │    5. Karma_Engine.applyDelta(event)
    │    6. Retry exponentiel si échec (max 2)
    ▼
Task: done / suspended / error
    │
    ▼
Karma_Engine → recalculate()
Neo4j → writeTaskNode()
EpisodicMemory → writeEntry() [avec a11_perspective]
TTS → vocalize() [si Karma > 0]
```

### Flux Showcase_Mode

```
Utilisateur: "montre-moi ce que tu sais faire"
    │
    ▼
server.cjs → detectShowcaseIntent(message)
    │
    ▼
a11-planner.cjs → buildShowcasePlan(theme?)
    │  Consulte Neo4j (créations passées)
    │  Consulte Corpus (artefacts mémorisés)
    │  Injecte Identity_Core (system_prompt.txt)
    │  Sélectionne ≥5 catégories de tools
    ▼
Plan de démonstration (≤8 actions)
    │
    ▼
TTS: [SFX:thinking] + "Je vais vous montrer..."
    │
    ▼
a11-plan-executor.cjs (mode showcase)
    │  Exécute sans confirmation pour low/medium
    │  Stocke artefacts via share_file
    │  Insère messages de statut dans le chat
    ▼
Rapport narratif + liens artefacts
    │
    ▼
TTS: [SFX:victory] + rapport vocal
```

---

## Composants et Interfaces

### `a11-droid.cjs` (modifié)

Gestionnaire principal de la file de Tasks. Connecté à Redis via Qflush.

```javascript
// Interface publique
module.exports = {
  startDroidLoop(intervalMs?: number): void,
  stopDroidLoop(): void,
  addDroidTask(taskData: TaskInput): Promise<Task>,
  getDroidStatus(): Promise<DroidStatus>,
  getTaskById(taskId: string): Promise<Task | null>,
  listTasks(filter?: TaskFilter): Promise<Task[]>,
  cancelTask(taskId: string): Promise<boolean>,
  rollbackTask(taskId: string): Promise<boolean>,
  createCheckpoint(taskId: string): Promise<Checkpoint>,
};
```

**Responsabilités ajoutées :**

- Connexion Redis via `src/qflush-integration.cjs` au démarrage
- Publication de l'événement `a11:droid:started` dans Redis
- Persistance duale : Redis (`a11:droid:tasks`) + fichier local (`a11d-tasks.json`)
- Gestion des Checkpoints pour le rollback
- Compteur global d'erreurs (circuit breaker : 10 erreurs / 60s → pause 30s)
- Mise à jour du champ `updatedAt` toutes les 5s pendant l'exécution

### `a11-planner.cjs` (modifié)

Décomposeur de Goals en Plans via LLM. Enrichi du World_Context et de l'Identity_Core.

```javascript
// Interface publique
module.exports = {
  getPlanFromLlm(task: Task, worldContext: WorldContext): Promise<Plan>,
  buildWorldContext(task: Task): Promise<WorldContext>,
};
```

**Responsabilités ajoutées :**

- Construction du World_Context (workspace root, services actifs, 5 derniers nœuds Neo4j pertinents)
- Injection de l'Identity_Core (`system_prompt.txt`) en priorité absolue
- Validation des skills contre `allowedPrefixes`
- Persistance du Plan dans Redis : `plan:{taskId}` avec TTL 3600s
- Retry LLM (max 2 tentatives) sur JSON invalide
- Timeout 30s sur la génération

### `a11-plan-executor.cjs` (modifié)

Exécuteur séquentiel de steps. Connecté à Horn, Safety_Gate et Karma_Engine.

```javascript
// Interface publique
module.exports = {
  executePlan(task: Task, plan: Plan, options?: ExecutorOptions): Promise<ExecutionResult>,
};
```

**Responsabilités ajoutées :**

- Intégration Safety_Gate avant chaque step
- Intégration Rate_Limiter (60 appels/min)
- Dispatch via Horn (`scream(skill, payload)`) avec fallback direct
- Retry exponentiel : 1s, 2s (max 2 tentatives)
- Compteur de steps consécutifs en échec (suspend à 3)
- Appel Karma_Engine après chaque événement
- Écriture dans l'Audit_Trail

### `lib/karma-engine.cjs` (nouveau)

Moteur de calcul du Karma à partir des Karma_Stats.

```javascript
// Interface publique
module.exports = {
  applyDelta(event: KarmaEvent): Promise<number>,
  recalculate(): Promise<number>,
  getStats(): Promise<KarmaStats>,
  getCurrentKarma(): Promise<number>,
  persistStats(): Promise<void>,
};
```

### `lib/plan-serializer.cjs` (nouveau)

Sérialiseur/désérialiseur de Plans avec validation stricte.

```javascript
// Interface publique
module.exports = {
  serialize(plan: Plan): string,
  deserialize(json: string): Plan,
  validate(plan: Plan): ValidationResult,
};
```

### `lib/word-power-engine.cjs` (nouveau)

Moteur linguistique caché. Enrichit les réponses d'A11 avec des figures de style calibrées selon le Karma et le Dialogue_Register. N'apparaît jamais dans le prompt visible.

```javascript
// Interface publique
module.exports = {
  // Détecte le registre du dialogue à partir du texte et du contexte
  detectRegister(text: string, context?: DialogueContext): DialogueRegister,

  // Enrichit une réponse avec des figures de style selon le Karma et le registre
  // Retourne le texte enrichi — sémantiquement identique, stylistiquement modulé
  enrich(text: string, karma: number, register: DialogueRegister): string,

  // Mémorise un pattern qui a généré un engagement positif
  memorizePattern(pattern: WordPowerPattern): Promise<void>,

  // Charge les patterns appris depuis Neo4j
  loadLearnedPatterns(): Promise<WordPowerPattern[]>,
};
```

**Responsabilités :**

- Détection automatique du Dialogue_Register (entropie lexicale, densité conceptuelle, marqueurs syntaxiques)
- Sélection des figures de style selon l'échelle Karma : minimaliste (0–1) → sobre (1–2) → équilibré (2–3) → expressif (3–4)
- Injection de calembours, allitérations, glissements sémantiques, références culturelles implicites
- Garantie de correction sémantique : le sens n'est jamais altéré
- Apprentissage des patterns efficaces via Neo4j (`WordPowerPattern`)
- Opération entièrement silencieuse — aucune trace dans le prompt ou les logs utilisateur

### `routes/droid.cjs` (nouveau)

Router Express exposant les 6 endpoints REST du Droid.

```javascript
// Endpoints
POST   /api/droid/tasks                    → addDroidTask
GET    /api/droid/status                   → getDroidStatus (< 200ms)
GET    /api/droid/tasks                    → listTasks
GET    /api/droid/tasks/:taskId            → getTaskById
DELETE /api/droid/tasks/:taskId            → cancelTask
POST   /api/droid/tasks/:taskId/rollback   → rollbackTask
```

---

## Modèles de Données

### Task

```typescript
interface Task {
  id: string; // "task_{n}_{timestamp}"
  goal: string; // max 2000 caractères
  meta: Record<string, unknown>;
  status: TaskStatus; // pending | running | done | error | suspended | cancelled
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
  result?: unknown;
  error?: string;
  checkpoints?: Checkpoint[];
  stepRetries?: Record<string, number>;
  consecutiveFailures?: number;
  userId?: string;
}

type TaskStatus =
  | "pending"
  | "running"
  | "done"
  | "error"
  | "suspended"
  | "cancelled";
```

### Plan

```typescript
interface Plan {
  steps: PlanStep[];
}

interface PlanStep {
  skill: string; // ex: "a11d.fs.read", "a11d.web.search"
  payload: Record<string, unknown>;
  id?: string; // identifiant optionnel du step
}
```

### Checkpoint

```typescript
interface Checkpoint {
  id: string;
  taskId: string;
  createdAt: string;
  completedSteps: PlanStep[];
  failedSteps: PlanStep[];
  partialResults: unknown[];
  taskSnapshot: Task;
}
```

### AuditEvent

```typescript
interface AuditEvent {
  timestamp: string; // ISO 8601
  taskId: string;
  event: AuditEventType;
  skill?: string;
  payload?: string; // tronqué à 500 caractères
  result?: string; // tronqué à 500 caractères
  level: "INFO" | "WARN" | "ERROR";
}

type AuditEventType =
  | "task_created"
  | "task_started"
  | "task_done"
  | "task_error"
  | "task_suspended"
  | "task_cancelled"
  | "task_rollback"
  | "step_start"
  | "step_ok"
  | "step_failed"
  | "step_retry"
  | "step_blocked"
  | "security_violation"
  | "rate_limit_exceeded"
  | "checkpoint_created";
```

### KarmaStats

```typescript
interface KarmaStats {
  tasks_success_rate: number; // 0.0 à 1.0
  tasks_error_rate: number; // 0.0 à 1.0
  avg_step_latency_ms: number;
  artifacts_produced: number;
  tools_failed_count: number;
  consecutive_failures: number;
  window_start: string; // ISO 8601 (début fenêtre 24h)
}

interface KarmaState {
  current: number; // 0.0 à 4.0
  stats: KarmaStats;
  lastUpdated: string;
}
```

### WorldContext

```typescript
interface WorldContext {
  workspaceRoot: string;
  activeServices: string[]; // ["cerbere", "tts", "neo4j", ...]
  recentMemory: string[]; // 5 dernières entrées épisodiques
  neo4jNodes: Neo4jNode[]; // 5 nœuds les plus pertinents
  identityCore: string; // contenu de system_prompt.txt
  karma: number; // Karma courant
  timestamp: string;
}
```

### DroidStatus

```typescript
interface DroidStatus {
  loopRunning: boolean;
  lastRun: string | null;
  processedCount: number;
  karma: KarmaState;
  totals: {
    all: number;
    pending: number;
    running: number;
    done: number;
    error: number;
    suspended: number;
    cancelled: number;
  };
}
```

### WordPowerPattern

```typescript
type DialogueRegister =
  | "monotone"
  | "qualitatif"
  | "abstrait"
  | "ouvert"
  | "technique"
  | "poetique";

type WordPowerFigure =
  | "calembour" // jeu de mots sur homophonie ou polysémie
  | "alliteration" // répétition de sons consonantiques
  | "assonance" // répétition de sons vocaliques
  | "glissement" // déplacement sémantique subtil
  | "reference" // référence culturelle implicite (One Piece, Zelda, etc.)
  | "rythme_binaire" // structure en deux temps, équilibre phonique
  | "chiasme"; // inversion symétrique de deux éléments

interface WordPowerPattern {
  type: WordPowerFigure;
  register: DialogueRegister;
  karmaRange: [number, number]; // ex: [3.0, 4.0]
  example: string; // exemple de la figure appliquée
  successCount: number; // nombre de fois où ce pattern a généré un engagement positif
  createdAt: string; // ISO 8601
}
```

---

## Propriétés de Correction

_Une propriété est une caractéristique ou un comportement qui doit être vrai pour toutes les exécutions valides d'un système — essentiellement, un énoncé formel de ce que le système doit faire. Les propriétés servent de pont entre les spécifications lisibles par l'humain et les garanties de correction vérifiables par machine._

### Propriété 1 : Invariants structurels d'un Plan

_Pour tout_ Goal valide soumis au Planner, le Plan produit doit contenir entre 1 et 50 steps, chaque step ayant un champ `skill` de type string non-vide et un champ `payload` de type objet.

**Valide : Exigences 1.1**

### Propriété 2 : Validation des skills contre les prefixes autorisés

_Pour tout_ array de steps, la fonction de validation doit accepter exactement les steps dont le skill commence par un préfixe autorisé (`a11d.fs.`, `a11d.shell.`, `a11d.git.`, `a11d.tests.`, `a11d.vs.`, `a11d.qf.`, `a11d.ui.`, `a11d.web.`, `a11d.llm.`) et rejeter tous les autres.

**Valide : Exigences 1.4**

### Propriété 3 : Round-trip de sérialisation des Plans

_Pour tout_ Plan valide (steps avec skills valides et payloads objets), la sérialisation puis la désérialisation doit produire un Plan structurellement identique à l'original : `deserialize(serialize(plan))` ≡ `plan`.

**Valide : Exigences 9.5**

### Propriété 4 : Erreur descriptive sur step invalide

_Pour tout_ JSON de Plan contenant un step invalide (skill absent, skill non-string, ou payload non-objet) à un index quelconque, le désérialiseur doit retourner une erreur mentionnant l'index du step invalide.

**Valide : Exigences 9.3**

### Propriété 5 : Ordre FIFO des Tasks

_Pour toute_ liste de Tasks en statut `pending` avec des `createdAt` distincts, le Droid doit toujours sélectionner la Task dont le `createdAt` est le plus ancien (minimum lexicographique ISO 8601).

**Valide : Exigences 2.8**

### Propriété 6 : Transitions d'état des Tasks

_Pour toute_ Task en statut `pending` traitée par le Droid avec un Plan dont tous les steps réussissent, la Task doit passer au statut `done` et l'Audit_Trail doit contenir au minimum les événements `task_started` et `task_done` pour cette Task.

**Valide : Exigences 2.2, 2.4**

### Propriété 7 : Suspension après échecs consécutifs

_Pour tout_ Plan dont plus de 3 steps consécutifs échouent (après leurs retries), la Task associée doit passer au statut `suspended` (et non `error` ou `done`).

**Valide : Exigences 2.6**

### Propriété 8 : Retry exponentiel sur step en échec

_Pour tout_ step qui échoue, l'Executor doit effectuer exactement 2 tentatives supplémentaires (total 3 tentatives) avec des délais croissants (1s, 2s) avant de marquer le step `failed`.

**Valide : Exigences 2.5**

### Propriété 9 : Structure complète des événements Audit_Trail

_Pour tout_ événement enregistré dans l'Audit_Trail, l'objet résultant doit contenir les champs `timestamp` (string ISO 8601 valide), `taskId` (string non-vide), `event` (string non-vide), et `level` (parmi `INFO`, `WARN`, `ERROR`).

**Valide : Exigences 5.2**

### Propriété 10 : Safety_Gate bloque les steps high

_Pour tout_ step dont le `dangerLevel` est `high`, le Safety_Gate doit retourner un résultat bloquant (sans exécuter le step) sauf si une autorisation globale de session est active. Pour les steps `low` et `medium`, le Safety_Gate ne doit pas bloquer.

**Valide : Exigences 6.1**

### Propriété 11 : Confinement filesystem aux WORKSPACE_ROOTS

_Pour tout_ chemin filesystem fourni à l'Executor, si ce chemin (résolu en absolu) n'est pas contenu dans l'un des `WORKSPACE_ROOTS`, l'Executor doit bloquer le step et logger un événement `security_violation`.

**Valide : Exigences 6.4**

### Propriété 12 : Karma borné et formule correcte

_Pour toutes_ combinaisons de Karma_Stats valides (`tasks_success_rate` ∈ [0,1], `tasks_error_rate` ∈ [0,1], `consecutive_failures` ∈ ℕ), le Karma calculé par la formule `base_karma + (tasks_success_rate × 2.0) - (tasks_error_rate × 1.5) - (consecutive_failures × 0.25)` doit toujours être borné dans [0.0, 4.0] après application du clamp.

**Valide : Exigences 11.1**

### Propriété 13 : Karma_Delta appliqué correctement

_Pour toute_ séquence d'événements Karma (Task done, step failed, Task suspended, artefact produit, timeout), le Karma résultant doit correspondre à l'application successive des deltas définis (+0.25, -0.25, -0.5, +0.1, -0.1) sur le Karma initial, avec clamp dans [0.0, 4.0] après chaque application.

**Valide : Exigences 10.4, 11.2, 11.3, 11.4, 11.5, 11.6**

### Propriété 14 : Clé Redis du Plan

_Pour tout_ taskId valide (string non-vide), le Plan persisté dans Redis doit être stocké sous la clé exacte `plan:{taskId}` avec un TTL de 3600 secondes.

**Valide : Exigences 1.7**

### Propriété 15 : Correction sémantique après enrichissement Word_Power

_Pour tout_ texte valide enrichi par le Word_Power_Engine, le sens sémantique de la réponse enrichie doit être équivalent à celui de la réponse originale — les figures de style ne doivent jamais altérer la signification, introduire d'ambiguïté bloquante, ou rendre la réponse incompréhensible. Formellement : `semanticEquivalent(enrich(text, karma, register), text) === true` pour tout texte, karma ∈ [0.0, 4.0], et register valide.

**Valide : Exigences 12.9**

---

## Gestion des Erreurs

### Stratégie par niveau de danger

| dangerLevel | Échec step              | Retry       | Notification                |
| ----------- | ----------------------- | ----------- | --------------------------- |
| `low`       | Logger + retry auto     | 2× (1s, 2s) | Non                         |
| `medium`    | Logger + retry auto     | 2× (1s, 2s) | Non                         |
| `high`      | Logger + marquer failed | Aucun       | Oui (description + options) |

### Circuit breaker du Droid

```
Compteur global d'erreurs
    │
    ├─ < 10 erreurs / 60s → fonctionnement normal
    │
    └─ ≥ 10 erreurs / 60s → mode dégradé
           │
           ├─ Pause boucle 30s
           ├─ Log WARN dans Audit_Trail
           └─ Reprise automatique après 30s
```

### Fallbacks de disponibilité

| Service             | Indisponible      | Fallback                                       |
| ------------------- | ----------------- | ---------------------------------------------- |
| Redis/Qflush        | Connexion échouée | Fichier local `a11d-tasks.json`                |
| Neo4j               | Connexion échouée | Fallback JSON local (`knowledge-graph/*.json`) |
| Cerbère (port 4545) | HTTP error        | 3 retries × 2s → Task `error`                  |
| Horn/Qflush         | `scream()` échoue | Appel direct au tools-dispatcher               |

### Gestion des erreurs LLM (Planner)

```
Appel LLM
    │
    ├─ JSON valide → Plan validé → OK
    │
    ├─ JSON invalide (tentative 1)
    │       │
    │       └─ Retry avec prompt de correction
    │               │
    │               ├─ JSON valide → Plan validé → OK
    │               │
    │               └─ JSON invalide (tentative 2)
    │                       │
    │                       └─ Retry final
    │                               │
    │                               ├─ JSON valide → OK
    │                               └─ Échec → Erreur structurée
    │
    └─ Timeout (30s) → Erreur structurée
```

---

## Stratégie de Test

### Approche duale

Le système utilise deux types de tests complémentaires :

- **Tests unitaires** : exemples concrets, cas limites, comportements d'erreur spécifiques
- **Tests de propriétés (PBT)** : propriétés universelles vérifiées sur des centaines d'inputs générés aléatoirement

La bibliothèque PBT choisie est **[fast-check](https://github.com/dubzzz/fast-check)** (Node.js, CommonJS compatible, mature).

### Tests de propriétés

Chaque propriété du document est implémentée comme un test PBT avec minimum **100 itérations**.

Format de tag : `// Feature: a11-autonomous-action-system, Property {N}: {texte}`

**Propriété 1 — Invariants structurels d'un Plan**

```javascript
// Feature: a11-autonomous-action-system, Property 1: invariants structurels d'un Plan
fc.assert(
  fc.asyncProperty(
    fc.string({ minLength: 1, maxLength: 200 }), // Goal
    async (goal) => {
      const plan = await mockPlanner.getPlan({ goal });
      return (
        plan.steps.length >= 1 &&
        plan.steps.length <= 50 &&
        plan.steps.every(
          (s) => typeof s.skill === "string" && s.skill.length > 0,
        ) &&
        plan.steps.every(
          (s) => s.payload !== null && typeof s.payload === "object",
        )
      );
    },
  ),
  { numRuns: 100 },
);
```

**Propriété 3 — Round-trip sérialisation**

```javascript
// Feature: a11-autonomous-action-system, Property 3: round-trip sérialisation des Plans
fc.assert(
  fc.property(
    fc.array(
      fc.record({
        skill: fc.constantFrom(
          "a11d.fs.read",
          "a11d.web.search",
          "a11d.shell.run",
        ),
        payload: fc.object(),
        id: fc.option(fc.string()),
      }),
      { minLength: 1, maxLength: 50 },
    ),
    (steps) => {
      const plan = { steps };
      const serialized = planSerializer.serialize(plan);
      const deserialized = planSerializer.deserialize(serialized);
      return JSON.stringify(deserialized) === JSON.stringify(plan);
    },
  ),
  { numRuns: 200 },
);
```

**Propriété 12 — Karma borné**

```javascript
// Feature: a11-autonomous-action-system, Property 12: Karma borné dans [0.0, 4.0]
fc.assert(
  fc.property(
    fc.record({
      tasks_success_rate: fc.float({ min: 0, max: 1 }),
      tasks_error_rate: fc.float({ min: 0, max: 1 }),
      consecutive_failures: fc.nat({ max: 20 }),
    }),
    (stats) => {
      const karma = karmaEngine.calculateFromStats(stats);
      return karma >= 0.0 && karma <= 4.0;
    },
  ),
  { numRuns: 500 },
);
```

### Tests unitaires (exemples)

| Test                                                 | Critère couvert |
| ---------------------------------------------------- | --------------- |
| Planner retourne `need_user` sur Goal vide           | 1.3             |
| Planner retente 2× sur JSON LLM invalide             | 1.5             |
| Droid démarre la boucle avec `A11_DROID_INTERVAL_MS` | 2.1             |
| Executor appelle `scream()` avec le bon skill        | 2.3             |
| Fallback JSON quand Redis indisponible               | 4.5             |
| Endpoint `GET /api/droid/status` répond < 200ms      | 5.3             |
| TTS vocalise `[SFX:victory]` quand Karma > 0         | 8.6             |
| Showcase génère ≥5 catégories de tools               | 3.2             |

### Tests d'intégration

| Test                                                | Critère couvert |
| --------------------------------------------------- | --------------- |
| World_Context inclut les nœuds Neo4j pertinents     | 1.2, 7.2        |
| Droid publie `a11:droid:started` dans Redis         | 7.1             |
| Task complétée écrit un nœud dans Neo4j             | 7.3             |
| Karma_Stats persistées dans Redis avec TTL 86400s   | 11.7            |
| Executor dispatche via Horn quand Qflush disponible | 7.6             |

### Couverture cible

- Modules `lib/karma-engine.cjs`, `lib/plan-serializer.cjs` : > 90%
- Module `a11-droid.cjs` (logique de file) : > 80%
- Module `a11-plan-executor.cjs` (Safety_Gate, retry) : > 80%
- Routes REST : tests d'intégration sur tous les endpoints
