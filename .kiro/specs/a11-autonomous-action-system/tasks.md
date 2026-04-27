# Plan d'Implémentation — A11 Autonomous Action System

## Vue d'ensemble

Ce plan transforme le design technique en une série de tâches de code incrémentales. Chaque tâche s'appuie sur la précédente et se termine par un câblage complet. L'ordre suit la dépendance naturelle des composants : modules utilitaires → couche Droid → Planner → Executor → routes REST → intégration server.cjs.

Tous les fichiers sont en CommonJS (`.cjs`), Node.js >= 20. Les tests utilisent `node:test` + `fast-check` pour les PBT, dans `test/a11-autonomous-action-system.node.test.cjs`.

---

## Tâches

- [x] 1. Créer `lib/plan-serializer.cjs` — sérialiseur/désérialiseur de Plans
  - [x] 1.1 Implémenter les fonctions `serialize(plan)`, `deserialize(json)` et `validate(plan)`
    - `serialize` : JSON.stringify avec indentation 2 espaces, conforme au schéma `{ steps: Array<{ skill, payload, id? }> }`
    - `deserialize` : parse JSON, valide chaque step (skill string non-vide, payload objet), retourne une erreur descriptive avec l'index du step invalide si la validation échoue
    - `validate` : retourne `{ valid: boolean, errors: string[] }` avec les raisons de rejet
    - Exporter via `module.exports = { serialize, deserialize, validate }`
    - _Exigences : 9.1, 9.2, 9.3, 9.4_

  - [x] 1.2 Écrire le test de propriété — round-trip de sérialisation (Propriété 3)
    - **Propriété 3 : Round-trip de sérialisation des Plans**
    - **Valide : Exigence 9.5**
    - `// Feature: a11-autonomous-action-system, Property 3: round-trip sérialisation des Plans`
    - Générer des Plans valides avec `fc.array(fc.record({ skill: fc.constantFrom(...allowedSkills), payload: fc.object(), id: fc.option(fc.string()) }), { minLength: 1, maxLength: 50 })`
    - Vérifier que `JSON.stringify(deserialize(serialize(plan))) === JSON.stringify(plan)` pour 200 runs

  - [x] 1.3 Écrire le test de propriété — erreur descriptive sur step invalide (Propriété 4)
    - **Propriété 4 : Erreur descriptive sur step invalide**
    - **Valide : Exigence 9.3**
    - `// Feature: a11-autonomous-action-system, Property 4: erreur descriptive sur step invalide`
    - Générer des Plans avec au moins un step invalide (skill absent, skill non-string, payload non-objet) à un index aléatoire
    - Vérifier que `deserialize()` retourne une erreur mentionnant l'index du step invalide pour 100 runs

  - [x] 1.4 Écrire le test de propriété — validation des skills contre les préfixes autorisés (Propriété 2)
    - **Propriété 2 : Validation des skills contre les préfixes autorisés**
    - **Valide : Exigence 1.4**
    - `// Feature: a11-autonomous-action-system, Property 2: validation des skills contre les préfixes autorisés`
    - Générer des strings de skills aléatoires et vérifier que `validate()` accepte exactement ceux commençant par un préfixe autorisé (`a11d.fs.`, `a11d.shell.`, `a11d.git.`, `a11d.tests.`, `a11d.vs.`, `a11d.qf.`, `a11d.ui.`, `a11d.web.`, `a11d.llm.`) et rejette tous les autres pour 200 runs

- [x] 2. Créer `lib/karma-engine.cjs` — moteur de calcul du Karma
  - [x] 2.1 Implémenter la formule Karma et le clamp [0.0, 4.0]
    - Fonction `calculateFromStats(stats: KarmaStats): number` : `base_karma + (tasks_success_rate × 2.0) - (tasks_error_rate × 1.5) - (consecutive_failures × 0.25)`, clampé dans [0.0, 4.0]
    - `base_karma` = 2.0 (valeur neutre par défaut)
    - Exporter `calculateFromStats` pour les tests unitaires
    - _Exigences : 11.1_

  - [x] 2.2 Écrire le test de propriété — Karma borné (Propriété 12)
    - **Propriété 12 : Karma borné dans [0.0, 4.0]**
    - **Valide : Exigence 11.1**
    - `// Feature: a11-autonomous-action-system, Property 12: Karma borné dans [0.0, 4.0]`
    - Générer des `KarmaStats` avec `fc.record({ tasks_success_rate: fc.float({ min: 0, max: 1 }), tasks_error_rate: fc.float({ min: 0, max: 1 }), consecutive_failures: fc.nat({ max: 20 }) })`
    - Vérifier que `calculateFromStats(stats) >= 0.0 && calculateFromStats(stats) <= 4.0` pour 500 runs

  - [x] 2.3 Implémenter `applyDelta(event)`, `recalculate()`, `getStats()`, `getCurrentKarma()`, `persistStats()`
    - `applyDelta` : applique les deltas définis (+0.25 task done, -0.25 step failed, -0.5 task suspended, +0.1 artefact produit, -0.1 timeout) et clamp après chaque application
    - `recalculate` : recalcule le Karma depuis les `KarmaStats` courantes via `calculateFromStats`
    - `getStats` : retourne les `KarmaStats` courantes (depuis Redis si disponible, sinon mémoire)
    - `getCurrentKarma` : retourne le Karma courant (depuis Redis `a11:karma:current`, sinon recalcule)
    - `persistStats` : écrit dans Redis `a11:karma:stats` avec TTL 86400s
    - Fallback en mémoire si Redis indisponible
    - _Exigences : 10.3, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7_

  - [x] 2.4 Écrire le test de propriété — Karma_Delta appliqué correctement (Propriété 13)
    - **Propriété 13 : Karma_Delta appliqué correctement**
    - **Valide : Exigences 10.4, 11.2, 11.3, 11.4, 11.5, 11.6**
    - `// Feature: a11-autonomous-action-system, Property 13: Karma_Delta appliqué correctement`
    - Générer des séquences d'événements Karma (task_done, step_failed, task_suspended, artifact_produced, timeout) avec un Karma initial aléatoire dans [0.0, 4.0]
    - Vérifier que le Karma résultant correspond à l'application successive des deltas avec clamp après chaque étape pour 200 runs

- [x] 3. Point de contrôle — Vérifier que les modules utilitaires sont fonctionnels
  - S'assurer que tous les tests des tâches 1 et 2 passent. Poser des questions à l'utilisateur si nécessaire.

- [x] 4. Modifier `a11-droid.cjs` — connexion Redis/Qflush, Checkpoints, circuit breaker
  - [x] 4.1 Connecter Redis via `src/qflush-integration.cjs` et implémenter la persistance duale
    - Au démarrage de `startDroidLoop`, appeler `setupA11Supervisor()` depuis `src/qflush-integration.cjs`
    - Publier l'événement `a11:droid:started` dans Redis avec timestamp et version
    - Persister la file de Tasks dans Redis sous `a11:droid:tasks` (namespace) en complément du fichier local `a11d-tasks.json`
    - Implémenter `loadTasks()` et `saveTasks()` avec fallback automatique sur le fichier local si Redis est indisponible
    - _Exigences : 2.9, 7.1, 4.5_

  - [x] 4.2 Implémenter `getTaskById`, `listTasks`, `cancelTask`, `rollbackTask`, `createCheckpoint`, `stopDroidLoop`
    - `getTaskById(taskId)` : cherche dans Redis puis fichier local
    - `listTasks(filter?)` : filtre par statut, retourne dans l'ordre FIFO (`createdAt` croissant)
    - `cancelTask(taskId)` : passe au statut `cancelled` dans un délai de 2s, sans interrompre le step en cours
    - `rollbackTask(taskId)` : restaure depuis le Checkpoint le plus récent, repasse au statut `pending`
    - `createCheckpoint(taskId)` : snapshot complet (steps complétés, échoués, résultats partiels, snapshot Task)
    - `stopDroidLoop()` : arrête l'intervalle proprement
    - _Exigences : 2.8, 4.2, 4.3, 8.3, 8.4_

  - [x] 4.3 Implémenter le circuit breaker et la mise à jour `updatedAt` pendant l'exécution
    - Compteur global d'erreurs : si ≥ 10 erreurs en 60s → pause boucle 30s + log WARN dans Audit_Trail
    - Reprise automatique après 30s
    - Pendant l'exécution d'une Task (`running`), mettre à jour `updatedAt` toutes les 5s via `setInterval`
    - Vérifier que le Goal ne dépasse pas 2000 caractères et que le nombre de Tasks `pending`/`running` ne dépasse pas 10 à la création
    - _Exigences : 4.7, 2.7, 6.3_

  - [x] 4.4 Écrire le test de propriété — ordre FIFO des Tasks (Propriété 5)
    - **Propriété 5 : Ordre FIFO des Tasks**
    - **Valide : Exigence 2.8**
    - `// Feature: a11-autonomous-action-system, Property 5: ordre FIFO des Tasks`
    - Générer des listes de Tasks `pending` avec des `createdAt` ISO 8601 distincts dans un ordre aléatoire
    - Vérifier que `listTasks({ status: 'pending' })[0]` est toujours la Task avec le `createdAt` minimum lexicographique pour 200 runs

  - [x] 4.5 Écrire des tests unitaires pour le circuit breaker et le fallback Redis
    - Tester que le fallback sur `a11d-tasks.json` s'active quand Redis est indisponible (mock Redis)
    - Tester que le circuit breaker passe en mode dégradé après 10 erreurs en 60s
    - _Exigences : 4.5, 4.7_

- [x] 5. Modifier `a11-planner.cjs` — World_Context, Identity_Core, retry LLM, persistance Redis
  - [x] 5.1 Convertir en CommonJS et implémenter `buildWorldContext(task)`
    - Convertir le fichier de ESM (`import`) en CommonJS (`require`) — le fichier actuel utilise `import fetch` et `export async function`
    - `buildWorldContext(task)` : construit `{ workspaceRoot, activeServices, recentMemory, neo4jNodes, identityCore, karma, timestamp }`
    - Lire `system_prompt.txt` depuis `__dirname` pour `identityCore`
    - Récupérer les 5 derniers nœuds Neo4j pertinents via requête Cypher (avec fallback JSON local si Neo4j indisponible)
    - Récupérer les 5 dernières entrées de mémoire épisodique
    - Récupérer le Karma courant via `KarmaEngine.getCurrentKarma()`
    - _Exigences : 1.2, 7.2, 10.5_

  - [x] 5.2 Injecter l'Identity_Core en priorité absolue et implémenter le retry LLM
    - Injecter `identityCore` (contenu de `system_prompt.txt`) comme premier message `system` avant tout contexte utilisateur ou Goal
    - Retry LLM : max 2 tentatives supplémentaires sur JSON invalide, avec prompt de correction explicite
    - Timeout 30s sur la génération (via `AbortController` ou `Promise.race`)
    - Valider les skills du Plan contre `allowedPrefixes` avant de retourner
    - Retourner une Envelope `need_user` si le Goal est ambigu ou vide
    - _Exigences : 1.1, 1.3, 1.4, 1.5, 1.6, 10.5_

  - [x] 5.3 Persister le Plan dans Redis et gérer le fallback Cerbère
    - Après génération d'un Plan valide, le persister dans Redis sous `plan:{taskId}` avec TTL 3600s via `PlanSerializer.serialize(plan)`
    - Retry Cerbère : 3 tentatives × 2s si HTTP error avant de marquer la Task `error`
    - _Exigences : 1.7, 4.6_

  - [x] 5.4 Écrire le test de propriété — invariants structurels d'un Plan (Propriété 1)
    - **Propriété 1 : Invariants structurels d'un Plan**
    - **Valide : Exigence 1.1**
    - `// Feature: a11-autonomous-action-system, Property 1: invariants structurels d'un Plan`
    - Utiliser un mock Planner qui génère des Plans à partir de Goals aléatoires
    - Vérifier que `plan.steps.length >= 1 && plan.steps.length <= 50` et que chaque step a `skill` string non-vide et `payload` objet pour 100 runs

  - [x] 5.5 Écrire le test de propriété — clé Redis du Plan (Propriété 14)
    - **Propriété 14 : Clé Redis du Plan**
    - **Valide : Exigence 1.7**
    - `// Feature: a11-autonomous-action-system, Property 14: clé Redis du Plan`
    - Générer des `taskId` valides (strings non-vides) aléatoires
    - Vérifier que le Plan est stocké sous la clé exacte `plan:{taskId}` avec TTL 3600s (mock Redis) pour 100 runs

- [x] 6. Modifier `a11-plan-executor.cjs` — Safety_Gate, Horn/Qflush, Karma_Engine, Audit_Trail
  - [x] 6.1 Convertir en CommonJS et implémenter le Safety_Gate
    - Convertir le fichier de ESM en CommonJS
    - `Safety_Gate` : avant chaque step, vérifier le `dangerLevel` du skill
      - `high` → bloquer et notifier l'utilisateur (sauf autorisation globale de session active)
      - `low` / `medium` → laisser passer
    - Vérifier que le chemin filesystem (si applicable) est contenu dans `WORKSPACE_ROOTS` ; sinon bloquer et logger `security_violation`
    - Vérifier la whitelist `allowedPrefixes` avant dispatch
    - _Exigences : 6.1, 6.4, 6.5_

  - [x] 6.2 Implémenter le Rate_Limiter et le dispatch via Horn avec fallback
    - Rate_Limiter : 60 appels/min par session → retourner `rate_limit_exceeded` si dépassé
    - Rate_Limiter LLM : 20 appels/min pour les appels LLM externes
    - Dispatch via `Horn.scream(skill, payload)` quand Qflush disponible (`globalThis.__QFLUSH_AVAILABLE`)
    - Fallback : appel direct au tools-dispatcher si Horn indisponible
    - _Exigences : 2.3, 6.2, 6.7, 7.6_

  - [x] 6.3 Implémenter le retry exponentiel, le compteur d'échecs consécutifs et la suspension
    - Retry exponentiel : 2 tentatives supplémentaires (délais 1s, 2s) avant de marquer le step `failed`
    - Compteur d'échecs consécutifs : si > 3 steps consécutifs échouent → suspendre la Task (statut `suspended`), déclencher un Checkpoint, notifier l'utilisateur
    - Pas de retry automatique pour les steps `high`
    - _Exigences : 2.5, 2.6, 4.1, 4.4_

  - [x] 6.4 Implémenter l'Audit_Trail et l'intégration Karma_Engine
    - Remplacer `writeLog` par une fonction `AuditTrail.log(event: AuditEvent)` qui écrit dans le fichier rotatif `a11-droid.log` (max 10 Mo, 7 fichiers)
    - Chaque événement doit contenir : `timestamp` (ISO 8601), `taskId`, `event`, `skill?`, `payload?` (tronqué 500 chars), `result?` (tronqué 500 chars), `level`
    - Appeler `KarmaEngine.applyDelta(event)` après chaque événement significatif (step_ok, step_failed, task_done, task_suspended)
    - Écrire un nœud `Task` dans Neo4j à la complétion (avec fallback JSON local si Neo4j indisponible)
    - Créer une entrée mémoire épisodique avec tag `autonomous_action` et champ `a11_perspective`
    - _Exigences : 2.4, 5.1, 5.2, 5.5, 7.3, 7.5, 10.6_

  - [x] 6.5 Écrire le test de propriété — transitions d'état des Tasks (Propriété 6)
    - **Propriété 6 : Transitions d'état des Tasks**
    - **Valide : Exigences 2.2, 2.4**
    - `// Feature: a11-autonomous-action-system, Property 6: transitions d'état des Tasks`
    - Générer des Plans avec N steps qui réussissent tous (mock Horn)
    - Vérifier que la Task passe au statut `done` et que l'Audit_Trail contient `task_started` et `task_done` pour 100 runs

  - [x] 6.6 Écrire le test de propriété — suspension après échecs consécutifs (Propriété 7)
    - **Propriété 7 : Suspension après échecs consécutifs**
    - **Valide : Exigence 2.6**
    - `// Feature: a11-autonomous-action-system, Property 7: suspension après échecs consécutifs`
    - Générer des Plans avec plus de 3 steps consécutifs qui échouent (mock Horn qui rejette)
    - Vérifier que la Task passe au statut `suspended` (et non `error` ou `done`) pour 100 runs

  - [x] 6.7 Écrire le test de propriété — retry exponentiel (Propriété 8)
    - **Propriété 8 : Retry exponentiel sur step en échec**
    - **Valide : Exigence 2.5**
    - `// Feature: a11-autonomous-action-system, Property 8: retry exponentiel sur step en échec`
    - Générer des steps qui échouent systématiquement (mock Horn qui rejette toujours)
    - Vérifier que Horn est appelé exactement 3 fois (1 initial + 2 retries) avec des délais croissants pour 100 runs

  - [x] 6.8 Écrire le test de propriété — structure des événements Audit_Trail (Propriété 9)
    - **Propriété 9 : Structure complète des événements Audit_Trail**
    - **Valide : Exigence 5.2**
    - `// Feature: a11-autonomous-action-system, Property 9: structure complète des événements Audit_Trail`
    - Générer des événements Audit_Trail aléatoires via l'Executor (mock)
    - Vérifier que chaque événement contient `timestamp` (ISO 8601 valide), `taskId` (non-vide), `event` (non-vide), `level` (parmi INFO/WARN/ERROR) pour 200 runs

  - [x] 6.9 Écrire le test de propriété — Safety_Gate bloque les steps high (Propriété 10)
    - **Propriété 10 : Safety_Gate bloque les steps high**
    - **Valide : Exigence 6.1**
    - `// Feature: a11-autonomous-action-system, Property 10: Safety_Gate bloque les steps high`
    - Générer des steps avec `dangerLevel` aléatoire parmi `low`, `medium`, `high`
    - Vérifier que les steps `high` sont bloqués (sans appel Horn) et que les steps `low`/`medium` ne sont pas bloqués pour 200 runs

  - [x] 6.10 Écrire le test de propriété — confinement filesystem (Propriété 11)
    - **Propriété 11 : Confinement filesystem aux WORKSPACE_ROOTS**
    - **Valide : Exigence 6.4**
    - `// Feature: a11-autonomous-action-system, Property 11: confinement filesystem aux WORKSPACE_ROOTS`
    - Générer des chemins filesystem aléatoires (dans et hors des WORKSPACE_ROOTS)
    - Vérifier que les chemins hors WORKSPACE_ROOTS sont bloqués avec un événement `security_violation` pour 200 runs

- [x] 7. Point de contrôle — Vérifier que le cœur agentique est fonctionnel
  - S'assurer que tous les tests des tâches 4, 5 et 6 passent. Poser des questions à l'utilisateur si nécessaire.

- [x] 8. Créer `routes/droid.cjs` — 6 endpoints REST du Droid
  - [x] 8.1 Implémenter les 6 endpoints Express et les brancher sur `a11-droid.cjs`
    - `POST /api/droid/tasks` → `addDroidTask({ goal, meta })` avec validation (goal ≤ 2000 chars, max 10 tasks pending/running)
    - `GET /api/droid/status` → `getDroidStatus()` incluant `karma: { current, stats }` ; doit répondre en < 200ms
    - `GET /api/droid/tasks` → `listTasks(filter?)` avec filtre optionnel par statut
    - `GET /api/droid/tasks/:taskId` → `getTaskById(taskId)` avec 404 si non trouvé
    - `DELETE /api/droid/tasks/:taskId` → `cancelTask(taskId)` avec confirmation
    - `POST /api/droid/tasks/:taskId/rollback` → `rollbackTask(taskId)` avec 400 si Task non suspendue
    - Exporter via `module.exports = createDroidRouter` (factory function recevant `{ droid }`)
    - _Exigences : 8.5, 5.3, 6.3_

  - [x] 8.2 Écrire des tests d'intégration pour les 6 endpoints
    - Tester chaque endpoint avec des mocks de `a11-droid.cjs`
    - Vérifier les codes HTTP (200, 201, 400, 404), la structure des réponses JSON
    - Vérifier que `GET /api/droid/status` répond en < 200ms
    - _Exigences : 5.3, 8.5_

- [-] 9. Modifier `server.cjs` — monter les routes Droid et intégrer le Showcase_Mode
  - [ ] 9.1 Monter le router Droid et démarrer la boucle Droid au boot
    - Importer `createDroidRouter` depuis `./routes/droid.cjs`
    - Importer `a11-droid.cjs` et appeler `startDroidLoop(process.env.A11_DROID_INTERVAL_MS || 15000)` après l'initialisation des services
    - Monter le router : `app.use('/api/droid', createDroidRouter({ droid }))`
    - Protéger les routes avec le middleware `nezAuth` existant
    - _Exigences : 2.1, 8.5_

  - [~] 9.2 Implémenter la détection d'intent agent dans le pipeline chat
    - Dans le pipeline chat existant, ajouter une détection d'intent agent : si le message correspond à "A11, fais [Goal]" ou formulation équivalente, appeler `droid.addDroidTask({ goal })` et confirmer la création avec l'ID de la Task dans le fil de conversation
    - Insérer des messages de statut visibles dans le fil de conversation pendant l'exécution (`🔍 Recherche web en cours…`, `🖼️ Génération d'image…`, etc.)
    - _Exigences : 8.1, 5.6_

  - [~] 9.3 Implémenter la détection du Showcase_Mode dans le pipeline chat
    - Détecter les formulations "montre-moi ce que tu sais faire", "showcase", "révèle ton talent" et variantes sémantiques
    - Appeler `buildShowcasePlan(theme?)` dans `a11-planner.cjs` : consulte Neo4j (créations passées), Corpus (artefacts mémorisés), injecte Identity_Core, sélectionne ≥ 5 catégories de tools
    - Exécuter le Plan de démonstration (≤ 8 actions) sans confirmation pour les steps `low`/`medium`
    - Vocaliser via TTS : `[SFX:thinking]` au démarrage, `[SFX:victory]` à la fin
    - Produire un rapport narratif en français avec liens vers les artefacts
    - _Exigences : 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8_

  - [~] 9.4 Écrire des tests unitaires pour la détection d'intent agent et Showcase
    - Tester que les formulations agent déclenchent `addDroidTask` (mock droid)
    - Tester que les formulations showcase déclenchent `buildShowcasePlan` (mock planner)
    - Tester que le TTS vocalise `[SFX:victory]` quand Karma > 0 à la fin d'une Task
    - _Exigences : 8.1, 3.1, 8.6_

- [~] 10. Point de contrôle final — Vérifier l'intégration complète
  - S'assurer que tous les tests passent (`npm run test:contracts` dans `a11/backend/apps/server/`). Poser des questions à l'utilisateur si nécessaire.

- [ ] 11. Créer `lib/word-power-engine.cjs` — Moteur linguistique caché
  - [~] 11.1 Implémenter la détection du Dialogue_Register
    - Analyser le texte entrant pour détecter le registre parmi : `monotone`, `qualitatif`, `abstrait`, `ouvert`, `technique`, `poetique`
    - Indicateurs : entropie lexicale (diversité du vocabulaire), densité de marqueurs conceptuels, présence de questions ouvertes, densité technique (noms de fonctions, chiffres, syntaxe), marqueurs émotionnels
    - Retourner `{ register: DialogueRegister, confidence: number }`
    - _Exigences : 12.2_

  - [~] 11.2 Implémenter le sélecteur de figures de style selon le Karma
    - Mapper le Karma sur l'intensité : 0–1 → `minimaliste` (phonotonie seule), 1–2 → `sobre` (allitérations légères), 2–3 → `equilibre` (glissements sémantiques ponctuels), 3–4 → `expressif` (calembours, références culturelles, rythme marqué)
    - Sélectionner le type de figure (`WordPowerFigure`) selon le registre et l'intensité
    - Charger les patterns appris depuis Neo4j pour prioriser ceux avec `successCount` élevé
    - _Exigences : 12.3, 12.4, 12.5, 12.6_

  - [~] 11.3 Implémenter la fonction `enrich(text, karma, register)`
    - Appliquer la figure de style sélectionnée au texte — au maximum 1 figure par paragraphe
    - Garantir la correction sémantique : le sens ne doit jamais être altéré
    - Opérer en silence total : aucun log visible, aucune mention dans la réponse
    - Appliquer l'intensité maximale pour les rapports narratifs (Showcase, `a11_perspective`)
    - _Exigences : 12.1, 12.3, 12.4, 12.7, 12.9_

  - [~] 11.4 Implémenter l'apprentissage des patterns via Neo4j
    - `memorizePattern(pattern)` : écrire un nœud `WordPowerPattern` dans Neo4j avec `type`, `register`, `karmaRange`, `example`, `successCount`, `createdAt`
    - `loadLearnedPatterns()` : charger les patterns depuis Neo4j, triés par `successCount` décroissant
    - Fallback en mémoire locale si Neo4j indisponible
    - _Exigences : 12.8_

  - [~] 11.5 Intégrer le Word_Power_Engine dans le pipeline de réponse de `server.cjs`
    - Après génération de la réponse LLM et avant envoi au client, passer le texte par `WordPowerEngine.enrich(text, karma, register)`
    - Récupérer le Karma courant via `KarmaEngine.getCurrentKarma()`
    - Détecter le registre via `WordPowerEngine.detectRegister(userMessage)`
    - L'intégration doit être transparente : si le Word_Power_Engine échoue, retourner le texte original sans erreur
    - _Exigences : 12.1, 12.2, 12.3_

  - [~] 11.6 Écrire le test de propriété — correction sémantique après enrichissement (Propriété 15)
    - **Propriété 15 : Correction sémantique après enrichissement Word_Power**
    - **Valide : Exigence 12.9**
    - `// Feature: a11-autonomous-action-system, Property 15: correction sémantique après enrichissement`
    - Générer des textes aléatoires avec des registres et Karma variés
    - Vérifier que le texte enrichi contient tous les mots-clés sémantiques du texte original (aucun concept clé supprimé ou remplacé par un terme non-équivalent) pour 200 runs
    - Vérifier que la longueur du texte enrichi ne dépasse pas 150% de la longueur originale (pas de surcharge)

- [~] 12. Point de contrôle final étendu — Vérifier l'intégration complète avec Word_Power
  - S'assurer que tous les tests passent (`npm run test:contracts` dans `a11/backend/apps/server/`)
  - Vérifier manuellement que le style des réponses varie selon le Karma simulé (Karma 0.5 vs Karma 3.5)
  - Poser des questions à l'utilisateur si nécessaire

---

## Notes

- Les tâches marquées `*` sont optionnelles et peuvent être ignorées pour un MVP rapide
- Chaque tâche référence les exigences spécifiques pour la traçabilité
- Les points de contrôle garantissent une validation incrémentale
- Les tests de propriétés (PBT) valident les invariants universels ; les tests unitaires valident les cas concrets et les cas limites
- Le fichier de test unique est `test/a11-autonomous-action-system.node.test.cjs`
- La commande de test : `node --test ./test/a11-autonomous-action-system.node.test.cjs`
- Tous les modules sont en CommonJS (`.cjs`) — pas d'ESM, pas de `import`/`export`
