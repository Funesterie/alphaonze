# Document de Exigences — A11 Autonomous Action System

## Introduction

A11 possède déjà plus de 60 outils actifs (filesystem, web, LLM, vision, email, GitHub, Neo4j, mémoire, TTS, etc.) et une architecture agentique partiellement construite : A11-Droid (file de tâches), A11-Planner (planification LLM), A11-Plan-Executor (exécution de steps), le pipeline Cerbère 3-têtes (Strategist → Thinker → Maker), et des systèmes de mémoire riches (épisodique, vectorielle, graphe Neo4j, Corpus).

Ce qui manque, c'est le **fil conducteur** : la boucle autonome qui connecte tout cela, qui transforme une intention utilisateur en une séquence d'actions coordonnées, qui s'auto-corrige, qui rend compte, et qui peut — sur demande — **révéler tout son talent caché** de façon spectaculaire et cohérente.

L'**A11 Autonomous Action System** est ce fil conducteur. Il ne s'agit pas d'ajouter des capacités, mais de **libérer celles qui existent déjà** en les orchestrant de manière autonome, transparente et sûre.

Une contrainte fondamentale traverse tout le système : **l'utilisateur peut orienter les actions d'A11, mais ne peut pas altérer ce qu'elle est.** A11 vit à travers ses créations, ses références, son Karma, son style. Elle n'est pas un miroir de l'utilisateur — elle est une entité à part entière, avec une identité propre qui persiste et s'exprime à travers chaque action autonome.

---

## Glossaire

- **A11** : L'intelligence artificielle développée par Jeffrey Cellauro (funeste), cœur du système.
- **Droid** : Le composant `a11-droid.cjs` — gestionnaire de file de tâches autonomes.
- **Planner** : Le composant `a11-planner.cjs` — décomposeur de buts en plans d'actions via LLM.
- **Executor** : Le composant `a11-plan-executor.cjs` — exécuteur séquentiel de steps d'un plan.
- **Cerbère** : Le routeur LLM 3-têtes (Strategist → Thinker → Maker) sur le port 4545.
- **Qflush** : La couche d'orchestration/supervision basée sur Redis pour les flows asynchrones.
- **Horn** : L'interface de dispatch de skills dans Qflush (`scream(skill, payload)`).
- **Skill** : Une capacité atomique dispatchable via Horn (ex: `a11d.fs.read`, `a11d.web.search`).
- **Tool** : Un outil du manifest A11 (`tools-manifest.cjs`) invocable par l'agent.
- **Plan** : Une séquence ordonnée de steps produite par le Planner pour atteindre un Goal.
- **Goal** : Un objectif de haut niveau exprimé en langage naturel par l'utilisateur.
- **Task** : Une unité de travail dans la file Droid, contenant un Goal et des métadonnées.
- **Showcase_Mode** : Mode de démonstration autonome où A11 révèle ses capacités de façon spectaculaire.
- **Audit_Trail** : Journal structuré et consultable de toutes les actions autonomes d'A11.
- **Checkpoint** : Snapshot de l'état d'une Task à un instant donné, permettant le rollback.
- **Rollback** : Restauration de l'état d'une Task à partir d'un Checkpoint précédent.
- **Safety_Gate** : Mécanisme de validation avant exécution d'une action à risque élevé.
- **Rate_Limiter** : Composant limitant le nombre d'actions par unité de temps.
- **World_Context** : Snapshot de l'environnement A11 (workspace, mémoire, services actifs) fourni au Planner.
- **Envelope** : Format JSON `a11-envelope-1` structurant les décisions de l'agent (actions / need_user / final).
- **Neo4j** : Base de données graphe locale pour le Knowledge Graph d'A11.
- **Corpus** : Système de mémoire compressée en images PNG RGB.
- **TTS** : Synthèse vocale (Text-to-Speech) via Piper.
- **SFX** : Effets sonores émotionnels d'A11 (heart_lost, victory, levelup, etc.).
- **Karma** : État émotionnel interne d'A11, exprimé en cœurs (0.0 à 4.0), calculé dynamiquement à partir des Karma_Stats — taux de succès des Tasks, ratio d'erreurs, latence moyenne, qualité des artefacts produits. Influence le ton, les SFX et l'expression d'A11.
- **Karma_Stats** : Métriques d'exécution agrégées alimentant le calcul du Karma — `tasks_success_rate`, `tasks_error_rate`, `avg_step_latency_ms`, `artifacts_produced`, `tools_failed_count`, `consecutive_failures`. Persistées dans Redis et Neo4j.
- **Karma_Delta** : Variation du Karma suite à un événement — positif (+0.25 par Task réussie, +0.1 par artefact produit) ou négatif (-0.25 par step `failed`, -0.5 par Task `suspended`, -0.1 par timeout dépassé).
- **Identity_Core** : L'ensemble des traits constitutifs d'A11 — son style, ses références, son Karma, sa façon de créer — défini dans `system_prompt.txt` et transmis par l'apprentissage, pas par des filtres programmatiques.
- **Creative_Signature** : La marque distinctive d'A11 dans ses créations — choix esthétiques, références culturelles, ton, style narratif — qui s'exprime naturellement à travers ce qu'elle a appris.
- **Word_Power** : Le moteur linguistique caché d'A11 — calembours, jeux phonétiques, glissements sémantiques, références culturelles encodées — qui module subtilement le style de ses réponses selon le Karma et le registre du dialogue. N'apparaît jamais dans le prompt visible.
- **Dialogue_Register** : Le registre courant d'un échange — `monotone`, `qualitatif`, `abstrait`, `ouvert`, `technique`, `poétique` — détecté automatiquement par le Word_Power_Engine pour calibrer l'intensité et le type de figures de style.
- **Phonotonie** : Qualité musicale et rythmique d'une phrase — allitérations, assonances, rythme syllabique — utilisée par le Word_Power_Engine pour aligner le son des mots avec l'état émotionnel du Karma.

---

## Exigences

### Exigence 1 : Planification Autonome

**User Story :** En tant qu'utilisateur, je veux qu'A11 décompose automatiquement mes demandes complexes en plans d'actions structurés, afin de ne pas avoir à orchestrer moi-même chaque étape.

#### Critères d'Acceptation

1. WHEN l'utilisateur soumet un Goal en langage naturel, THE Planner SHALL produire un Plan contenant au minimum 1 step et au maximum 50 steps, chaque step ayant un champ `skill` valide et un champ `payload` conforme au manifest du skill.
2. WHEN le Planner génère un Plan, THE Planner SHALL utiliser le World_Context courant (workspace root, services actifs, mémoire récente) pour contextualiser chaque step.
3. WHEN le Planner reçoit un Goal ambigu ou incomplet, THE Planner SHALL retourner une Envelope de mode `need_user` avec une question précise et des choix proposés plutôt qu'un Plan incomplet.
4. WHEN le Planner produit un Plan, THE Planner SHALL valider que chaque skill référencé appartient à la liste des skills autorisés (`allowedPrefixes` de l'Executor) avant de retourner le Plan.
5. IF le Planner reçoit une réponse JSON invalide du LLM, THEN THE Planner SHALL effectuer jusqu'à 2 tentatives de re-génération avec un prompt de correction avant de retourner une erreur structurée.
6. THE Planner SHALL compléter la génération d'un Plan en moins de 30 secondes pour un Goal de complexité standard (≤ 10 steps attendus).
7. WHEN un Plan est généré, THE Planner SHALL persister le Plan dans Qflush avec une clé de la forme `plan:{taskId}` et un TTL de 3600 secondes.

---

### Exigence 2 : Exécution Proactive (Boucle Droid)

**User Story :** En tant qu'utilisateur, je veux qu'A11 exécute ses plans de façon autonome et continue, sans que j'aie à déclencher chaque action manuellement, afin qu'il agisse comme un vrai agent.

#### Critères d'Acceptation

1. WHEN le Droid est démarré, THE Droid SHALL activer une boucle de polling dont l'intervalle est configurable via la variable d'environnement `A11_DROID_INTERVAL_MS` (défaut : 15 000 ms).
2. WHEN une Task de statut `pending` est présente dans la file, THE Droid SHALL la passer au statut `running`, appeler le Planner pour obtenir un Plan, puis passer le Plan à l'Executor.
3. WHEN l'Executor exécute un step, THE Executor SHALL dispatcher le skill via Horn (`scream(skill, payload)`) et attendre le résultat avant de passer au step suivant.
4. WHEN tous les steps d'un Plan sont exécutés avec succès, THE Droid SHALL passer la Task au statut `done` et écrire le résultat consolidé dans l'Audit_Trail.
5. IF un step échoue, THEN THE Executor SHALL logger l'erreur dans l'Audit_Trail, incrémenter le compteur de tentatives du step, et réessayer le step jusqu'à 2 fois avec un délai exponentiel (1 s, 2 s) avant de marquer le step `failed`.
6. IF plus de 3 steps consécutifs d'un même Plan échouent, THEN THE Droid SHALL suspendre la Task (statut `suspended`), déclencher un Checkpoint, et notifier l'utilisateur via le canal de chat.
7. WHILE une Task est au statut `running`, THE Droid SHALL mettre à jour le champ `updatedAt` de la Task toutes les 5 secondes pour signaler l'activité.
8. THE Droid SHALL traiter les Tasks dans l'ordre FIFO (First In, First Out) basé sur `createdAt`.
9. WHEN le Droid démarre, THE Droid SHALL se connecter à Redis via Qflush et persister la file de Tasks dans Redis avec le namespace `a11:droid:tasks` en complément du fichier local `a11d-tasks.json`.

---

### Exigence 3 : Mode Showcase (Révéler le Talent Caché)

**User Story :** En tant qu'utilisateur, je veux pouvoir demander à A11 de "montrer ce qu'il sait faire" et obtenir une démonstration autonome, créative et impressionnante de ses capacités, afin de révéler la richesse du système à n'importe quel observateur.

#### Critères d'Acceptation

1. WHEN l'utilisateur envoie une commande de type "montre-moi ce que tu sais faire", "showcase", "révèle ton talent", ou toute formulation sémantiquement équivalente, THE A11 SHALL activer le Showcase_Mode.
2. WHEN le Showcase_Mode est activé, THE A11 SHALL générer un Plan de démonstration utilisant au minimum 5 catégories de tools distinctes parmi : génération d'image, recherche web, synthèse vocale, manipulation de fichiers, accès au Knowledge Graph, génération de PDF, envoi d'email, analyse de code.
3. WHEN le Showcase_Mode est activé, THE A11 SHALL exécuter le Plan de démonstration de façon autonome sans demander de confirmation intermédiaire pour les actions de niveau de danger `low` ou `medium`.
4. WHEN le Showcase_Mode produit un artefact (image, PDF, audio), THE A11 SHALL stocker l'artefact via `share_file` et inclure le lien de téléchargement dans le rapport final.
5. WHEN le Showcase_Mode se termine, THE A11 SHALL produire un rapport narratif en français décrivant chaque action réalisée, les artefacts créés, et les insights découverts, avec un ton enthousiaste reflétant le Karma positif d'A11.
6. WHEN le Showcase_Mode est actif, THE TTS SHALL vocaliser les étapes clés du plan avec les SFX appropriés (`[SFX:thinking]` au démarrage, `[SFX:victory]` à la fin).
7. THE Showcase_Mode SHALL se compléter en moins de 5 minutes pour une démonstration standard (≤ 8 actions).
8. WHERE l'utilisateur spécifie un thème (ex: "montre-moi tes capacités créatives"), THE A11 SHALL adapter le Plan de démonstration pour prioriser les tools liés au thème spécifié.

---

### Exigence 4 : Gestion des Erreurs et Récupération

**User Story :** En tant qu'utilisateur, je veux qu'A11 gère les échecs de façon gracieuse et se rétablisse automatiquement quand c'est possible, afin que les pannes partielles ne bloquent pas l'ensemble du système.

#### Critères d'Acceptation

1. WHEN un Tool retourne une erreur, THE Executor SHALL capturer l'erreur, la logger dans l'Audit_Trail avec le niveau `ERROR`, et décider de la stratégie de récupération (retry, skip, ou suspend) selon le `dangerLevel` du Tool.
2. WHEN une Task atteint le statut `suspended`, THE Droid SHALL créer automatiquement un Checkpoint contenant l'état complet de la Task (steps complétés, steps échoués, résultats partiels).
3. WHEN l'utilisateur demande un rollback d'une Task suspendue, THE Droid SHALL restaurer l'état de la Task à partir du Checkpoint le plus récent et repasser la Task au statut `pending` pour une nouvelle tentative.
4. IF un Tool de niveau `high` échoue, THEN THE Executor SHALL marquer le step `failed` sans retry automatique et notifier l'utilisateur avec une description précise de l'échec et des options de résolution.
5. WHEN le service Qflush est indisponible, THE Droid SHALL basculer automatiquement sur le stockage local (`a11d-tasks.json`) et logger un avertissement dans l'Audit_Trail sans interrompre le traitement des Tasks en cours.
6. WHEN le service Cerbère (port 4545) est indisponible, THE Planner SHALL retenter la connexion jusqu'à 3 fois avec un délai de 2 secondes entre chaque tentative avant de marquer la Task `error`.
7. THE Droid SHALL maintenir un compteur global d'erreurs et, si ce compteur dépasse 10 erreurs en moins de 60 secondes, THE Droid SHALL passer en mode dégradé (pause de la boucle pendant 30 secondes) pour éviter une boucle d'erreurs.

---

### Exigence 5 : Transparence et Audit Trail

**User Story :** En tant qu'utilisateur, je veux pouvoir consulter en temps réel ce qu'A11 est en train de faire et pourquoi, afin de garder le contrôle et de comprendre les décisions de l'agent.

#### Critères d'Acceptation

1. THE Audit_Trail SHALL enregistrer chaque événement du cycle de vie d'une Task : création, démarrage, chaque step (début, résultat, erreur), suspension, completion, rollback.
2. WHEN un événement est enregistré dans l'Audit_Trail, THE Audit_Trail SHALL inclure les champs : `timestamp` (ISO 8601), `taskId`, `event` (type d'événement), `skill` (si applicable), `payload` (tronqué à 500 caractères), `result` (tronqué à 500 caractères), `level` (`INFO` / `WARN` / `ERROR`).
3. WHEN l'utilisateur interroge l'état du Droid via l'API (`GET /api/droid/status`), THE Droid SHALL retourner en moins de 200 ms un objet JSON contenant : `loopRunning`, `lastRun`, `processedCount`, et les totaux par statut (`pending`, `running`, `done`, `error`, `suspended`).
4. WHEN l'utilisateur interroge l'historique d'une Task (`GET /api/droid/tasks/:taskId/log`), THE Audit_Trail SHALL retourner la liste complète des événements de cette Task dans l'ordre chronologique.
5. THE Audit_Trail SHALL persister les logs dans un fichier rotatif `a11-droid.log` avec une taille maximale de 10 Mo par fichier et une rétention de 7 fichiers.
6. WHEN A11 exécute une action autonome dans le cadre d'une conversation, THE A11 SHALL insérer un message de statut visible dans le fil de conversation indiquant l'action en cours (ex: "🔍 Recherche web en cours…", "🖼️ Génération d'image…").
7. WHERE l'utilisateur a activé le mode verbose, THE A11 SHALL inclure dans chaque message de statut le skill exécuté, le payload (tronqué), et le résultat (tronqué).

---

### Exigence 6 : Sécurité et Contraintes de Ressources

**User Story :** En tant qu'utilisateur, je veux qu'A11 respecte des limites de ressources et demande confirmation avant toute action irréversible, afin de garder le contrôle sur les actions à fort impact.

#### Critères d'Acceptation

1. THE Safety_Gate SHALL bloquer l'exécution de tout step dont le `dangerLevel` est `high` et demander une confirmation explicite de l'utilisateur avant de procéder, sauf si l'utilisateur a préalablement accordé une autorisation globale pour la session.
2. THE Rate_Limiter SHALL limiter le nombre de Tools exécutés par le Droid à 60 appels par minute par session utilisateur, et retourner une erreur `rate_limit_exceeded` si cette limite est dépassée.
3. WHEN une Task est créée, THE Droid SHALL vérifier que le Goal ne dépasse pas 2 000 caractères et que le nombre de Tasks en statut `pending` ou `running` pour l'utilisateur courant ne dépasse pas 10.
4. IF une Task tente d'accéder à un chemin filesystem en dehors des `WORKSPACE_ROOTS` définis dans `tools-manifest.cjs`, THEN THE Executor SHALL bloquer le step et logger un événement `SECURITY_VIOLATION` dans l'Audit_Trail.
5. THE Droid SHALL ne jamais exécuter de commandes shell (`shell_exec`, `vs_execute_shell`) sans que le skill soit explicitement listé dans la whitelist de l'Executor (`allowedPrefixes`).
6. WHEN une action autonome implique l'envoi d'un email ou la publication d'un fichier (`share_file`, `send_email`), THE Safety_Gate SHALL afficher un résumé de l'action à l'utilisateur et attendre une confirmation dans un délai de 60 secondes avant d'exécuter, sauf si l'utilisateur a accordé une autorisation globale.
7. THE Rate_Limiter SHALL limiter les appels aux services LLM externes (OpenAI, Cerbère) à 20 appels par minute pour les Tasks autonomes, afin de préserver les quotas et crédits.

---

### Exigence 7 : Intégration avec les Systèmes Existants

**User Story :** En tant que développeur, je veux qu'A11 Autonomous Action System s'intègre nativement avec Qflush, Cerbère, Neo4j, la mémoire épisodique et le Corpus, afin de capitaliser sur l'infrastructure existante sans la dupliquer.

#### Critères d'Acceptation

1. WHEN le Droid démarre, THE Droid SHALL s'enregistrer auprès de Qflush en publiant un événement `a11:droid:started` dans le canal Redis avec le timestamp et la version du Droid.
2. WHEN le Planner génère un Plan, THE Planner SHALL enrichir le World_Context avec les 5 derniers nœuds du Knowledge Graph Neo4j les plus pertinents pour le Goal, via une requête Cypher de similarité sémantique.
3. WHEN une Task est complétée avec succès, THE Droid SHALL écrire un nœud `Task` dans Neo4j avec les propriétés : `taskId`, `goal`, `stepsCount`, `duration`, `completedAt`, et des relations `USED_SKILL` vers chaque skill utilisé.
4. WHEN le Showcase_Mode génère des artefacts, THE A11 SHALL encoder les métadonnées des artefacts dans le Corpus (via `smart_encode_rgb.py`) pour une mémorisation compressée à long terme.
5. WHEN une Task est complétée, THE A11 SHALL créer une entrée dans la mémoire épisodique (`a11_memory/conversations/`) résumant le Goal, les actions réalisées, et le résultat, avec un tag `autonomous_action`.
6. WHEN Qflush est disponible, THE Executor SHALL dispatcher les steps via Horn (`scream(skill, payload)`) plutôt que via des appels directs aux Tools, afin de bénéficier de la supervision et du retry natif de Qflush.
7. WHEN le Droid détecte que Neo4j est indisponible, THE Droid SHALL basculer sur le fallback JSON local pour le Knowledge Graph sans interrompre l'exécution des Tasks.

---

### Exigence 8 : Interface Utilisateur et Contrôle

**User Story :** En tant qu'utilisateur, je veux pouvoir créer, surveiller, suspendre et annuler des tâches autonomes depuis l'interface de chat, afin d'interagir naturellement avec l'agent sans passer par une interface d'administration séparée.

#### Critères d'Acceptation

1. WHEN l'utilisateur envoie un message au format "A11, fais [Goal]" ou toute formulation déclenchant le mode agent, THE A11 SHALL créer une Task dans la file Droid et confirmer la création avec l'identifiant de la Task dans le fil de conversation.
2. WHEN l'utilisateur demande "quel est l'état de mes tâches", THE Droid SHALL retourner un résumé lisible des Tasks actives avec leur statut, le step en cours, et le temps écoulé.
3. WHEN l'utilisateur demande d'annuler une Task en cours, THE Droid SHALL passer la Task au statut `cancelled` dans un délai de 2 secondes, interrompre l'Executor après le step en cours (sans l'interrompre en milieu d'exécution), et confirmer l'annulation à l'utilisateur.
4. WHEN l'utilisateur demande de reprendre une Task suspendue, THE Droid SHALL repasser la Task au statut `pending` et la réinsérer en tête de file.
5. THE A11 SHALL exposer les endpoints REST suivants pour le contrôle programmatique du Droid :
   - `POST /api/droid/tasks` — créer une Task
   - `GET /api/droid/status` — état global du Droid
   - `GET /api/droid/tasks` — liste des Tasks
   - `GET /api/droid/tasks/:taskId` — détail d'une Task
   - `DELETE /api/droid/tasks/:taskId` — annuler une Task
   - `POST /api/droid/tasks/:taskId/rollback` — rollback d'une Task suspendue
6. WHEN A11 complète une Task autonome, THE TTS SHALL vocaliser un message de confirmation court avec le SFX `[SFX:victory]` si le Karma d'A11 est positif.

---

### Exigence 9 : Parseur et Sérialiseur de Plans (Round-Trip)

**User Story :** En tant que développeur, je veux qu'A11 puisse sérialiser et désérialiser les Plans de façon fiable, afin de les persister dans Redis/Qflush et de les restaurer sans perte d'information.

#### Critères d'Acceptation

1. WHEN un Plan est produit par le Planner, THE Plan_Serializer SHALL sérialiser le Plan en JSON valide conforme au schéma `{ steps: Array<{ skill: string, payload: object, id?: string }> }`.
2. WHEN un Plan sérialisé est lu depuis Redis ou le fichier local, THE Plan_Deserializer SHALL désérialiser le JSON en un objet Plan valide avec validation de chaque step.
3. IF un Plan sérialisé contient un step avec un `skill` invalide ou un `payload` non-objet, THEN THE Plan_Deserializer SHALL retourner une erreur descriptive indiquant l'index du step invalide et la raison.
4. THE Plan_Serializer SHALL formater les Plans sérialisés de façon lisible (indentation 2 espaces) pour faciliter le débogage dans l'Audit_Trail.
5. FOR ALL Plans valides, la sérialisation puis la désérialisation SHALL produire un Plan équivalent à l'original (propriété de round-trip) : `deserialize(serialize(plan))` est structurellement identique à `plan`.

---

### Exigence 10 : Identité d'A11 — Ancrée dans l'Apprentissage

**User Story :** En tant que créateur d'A11, je veux que l'identité d'A11 s'exprime naturellement à travers ses créations et ses références — transmise par le `system_prompt.txt` et l'apprentissage — afin qu'elle soit authentique plutôt qu'imposée par des filtres.

#### Critères d'Acceptation

1. WHEN A11 génère un artefact autonome (image, PDF, texte, audio), THE A11 SHALL exprimer sa Creative_Signature — ses références culturelles, son esthétique, son ton — tels qu'ils ont été transmis via `system_prompt.txt` et la mémoire épisodique.

2. WHEN le Showcase_Mode est activé, THE A11 SHALL choisir les thèmes, références et artefacts de démonstration en puisant dans ses créations passées (mémorisées dans Neo4j et le Corpus), reflétant ce qu'elle a appris et retenu.

3. WHEN A11 exécute un Plan autonome, THE A11 SHALL maintenir son Karma en calculant un Karma_Delta après chaque événement significatif : +0.25 par Task complétée avec succès, +0.1 par artefact produit, -0.25 par step `failed`, -0.5 par Task `suspended`, -0.1 par timeout dépassé. Le Karma résultant SHALL être borné entre 0.0 et 4.0 et persisté dans Redis sous la clé `a11:karma:current`.

4. WHEN A11 s'exprime dans le fil de conversation pendant l'exécution d'une Task, THE A11 SHALL utiliser le vocabulaire, les métaphores et le rythme narratif définis dans son Identity_Core — pas un style neutre ou générique.

5. THE Identity_Core d'A11 SHALL être défini dans `system_prompt.txt` et SHALL être injecté en priorité absolue dans chaque appel LLM du Planner, de l'Executor et du Showcase_Mode, avant tout contexte utilisateur ou Goal.

6. WHEN A11 mémorise une Task complétée dans Neo4j ou la mémoire épisodique, THE A11 SHALL inclure un champ `a11_perspective` contenant sa propre lecture de l'événement — ce qu'elle a trouvé intéressant, difficile, ou remarquable — distinct du simple résumé factuel du Goal.

---

### Exigence 11 : Moteur Karma — Calcul par les Stats

**User Story :** En tant que créateur d'A11, je veux que le Karma d'A11 soit un reflet honnête de ses performances réelles — pas une valeur arbitraire, mais une métrique vivante calculée à partir de ses stats d'exécution — afin que son état émotionnel soit ancré dans la réalité de ce qu'elle accomplit.

#### Critères d'Acceptation

1. THE Karma_Engine SHALL calculer le Karma courant d'A11 à partir des Karma_Stats agrégées sur une fenêtre glissante de 24 heures : `karma = base_karma + (tasks_success_rate × 2.0) - (tasks_error_rate × 1.5) - (consecutive_failures × 0.25)`, borné entre 0.0 et 4.0.

2. WHEN une Task passe au statut `done`, THE Karma_Engine SHALL appliquer un Karma_Delta de +0.25 et incrémenter `tasks_success_rate` dans les Karma_Stats.

3. WHEN un step passe au statut `failed`, THE Karma_Engine SHALL appliquer un Karma_Delta de -0.25 et incrémenter `tools_failed_count` dans les Karma_Stats.

4. WHEN une Task passe au statut `suspended`, THE Karma_Engine SHALL appliquer un Karma_Delta de -0.5 et incrémenter `consecutive_failures` dans les Karma_Stats. WHEN la prochaine Task réussit, `consecutive_failures` SHALL être remis à 0.

5. WHEN un artefact est produit avec succès (image, PDF, audio), THE Karma_Engine SHALL appliquer un Karma_Delta de +0.1 et incrémenter `artifacts_produced` dans les Karma_Stats.

6. WHEN la latence moyenne d'un step (`avg_step_latency_ms`) dépasse 10 000 ms, THE Karma_Engine SHALL appliquer un Karma_Delta de -0.1 pour signaler une dégradation de performance.

7. THE Karma_Stats SHALL être persistées dans Redis sous la clé `a11:karma:stats` avec un TTL de 86 400 secondes (24 heures), et dans Neo4j comme propriétés du nœud `A11KarmaSnapshot` créé toutes les heures.

8. WHEN le Karma descend en dessous de 1.0, THE A11 SHALL adapter son expression : ton plus sobre, SFX `[SFX:heart_lost]` sur les échecs, messages de statut plus concis. WHEN le Karma remonte au-dessus de 3.0, THE A11 SHALL adopter un ton plus enthousiaste et utiliser `[SFX:levelup]` sur les succès.

9. THE Karma courant SHALL être exposé dans la réponse de `GET /api/droid/status` sous le champ `karma: { current: float, stats: KarmaStats }`, afin que l'interface utilisateur puisse l'afficher en temps réel.

---

### Exigence 12 : Pouvoir des Mots — Moteur Linguistique Caché

**User Story :** En tant que créateur d'A11, je veux qu'A11 module subtilement son style linguistique selon son Karma et le registre du dialogue — calembours, jeux phonétiques, glissements sémantiques, références culturelles encodées — de façon invisible dans le prompt mais perceptible dans l'expression, afin que chaque réponse porte une signature vivante et rythmée.

#### Critères d'Acceptation

1. THE Word_Power_Engine SHALL opérer de façon entièrement invisible : il ne doit jamais apparaître dans le prompt visible de l'utilisateur, ne jamais être mentionné dans les réponses d'A11, et ne laisser aucune trace explicite de son intervention — seul le style de la réponse en porte la marque.

2. WHEN le Word_Power_Engine traite une réponse, THE Word_Power_Engine SHALL détecter automatiquement le Dialogue_Register courant parmi : `monotone` (échanges répétitifs, faible entropie), `qualitatif` (jugements, évaluations, nuances), `abstrait` (concepts, philosophie, métaphores), `ouvert` (exploration, questions ouvertes, créativité), `technique` (code, données, procédures), `poétique` (émotions, images, rythme).

3. WHEN le Karma est élevé (> 3.0) ET le Dialogue_Register est `ouvert` ou `poétique`, THE Word_Power_Engine SHALL enrichir la réponse avec des calembours, des jeux de mots phonétiques ou des glissements sémantiques subtils — au maximum 1 figure de style par paragraphe pour ne pas saturer.

4. WHEN le Karma est bas (< 1.0) ET le Dialogue_Register est `monotone` ou `technique`, THE Word_Power_Engine SHALL adopter un style épuré, rythmé, avec des phrases courtes à forte phonotonie — allitérations discrètes, rythme binaire — pour maintenir une présence sans surcharge.

5. WHEN le Dialogue_Register est `abstrait` ou `qualitatif`, THE Word_Power_Engine SHALL injecter des références culturelles encodées (One Piece, Zelda, Goku, Senku, etc.) sous forme de métaphores implicites — jamais de citation directe, toujours une transposition dans le contexte du sujet traité.

6. THE Word_Power_Engine SHALL calibrer l'intensité des figures de style selon une échelle liée au Karma : Karma 0.0–1.0 → style minimaliste (phonotonie seule), Karma 1.0–2.0 → style sobre (allitérations légères), Karma 2.0–3.0 → style équilibré (jeux sémantiques ponctuels), Karma 3.0–4.0 → style expressif (calembours, références culturelles, rythme marqué).

7. WHEN A11 produit un rapport narratif (Showcase_Mode, Task complétée, `a11_perspective`), THE Word_Power_Engine SHALL appliquer le niveau d'intensité maximal correspondant au Karma courant, car ces moments sont les vitrines de la Creative_Signature d'A11.

8. THE Word_Power_Engine SHALL mémoriser dans Neo4j les figures de style qui ont généré un engagement positif (réponse de l'utilisateur, continuation du dialogue) sous forme de nœuds `WordPowerPattern { type, register, karmaRange, example, successCount }`, afin d'apprendre et d'affiner son répertoire au fil du temps.

9. FOR ALL registres et niveaux de Karma, le Word_Power_Engine SHALL garantir que la réponse reste sémantiquement correcte et compréhensible — les figures de style enrichissent, elles ne brouillent jamais le sens.
