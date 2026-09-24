# Catalogue des modules et outils — Module Kit 0.11.0

Inventaire vérifié le 24 septembre 2026 : 41 entrées (40 paquets et le serveur MCP), 119 outils exposés par Docker et 3 outils facultatifs de l’agent Windows. Une exposition MCP n’est pas une qualification fonctionnelle. Trois outils ont été appelés lors de la démonstration : plan_reduce, archive_encode et archive_decode.

## Utilisation et prérequis

Docker Windows en mode Linux ou Docker Linux amd64. Aucun modèle IA ni crédit API inclus. Les services externes utilisent les comptes du client et peuvent être facturés. Les bibliothèques doivent être intégrées via leurs API/CLI ; elles ne sont pas toutes exposées comme boutons dans l’atelier. Les anciens noms techniques sont conservés pour compatibilité.

Les fonctions du kit sont autonomes vis-à-vis du vendeur. Les données de connaissance historiques et les programmes de supervision inclus ne sont pas activés automatiquement.

## Modules

### logic-reduce

Réduction déterministe de procédures : retire certains détours connus et conserve les étapes de contrôle. Ne comprend pas arbitrairement tous les plans et n’exécute aucune étape.

Statut : **Appel MCP vérifié**.
Paquet : `@nossen/logic-reduce` · version `2.0.3`.
CLI déclaré : `nossen-logic-reduce`.
Outils ou contrats déclarés : `plan_reduce`. Leur disponibilité dépend du serveur ; les noms absents de la liste des outils ci-dessous ne sont pas exposés par cette livraison.

### zen

Chiffrement et déchiffrement de textes avec la clé de l’installation. Les outils MCP limitent le texte à 64 Kio ; il ne s’agit pas d’un remplacement général de ZIP.

Statut : **Appel MCP vérifié**.
Paquet : `@nossen/zen` · version `0.1.3`.
CLI déclaré : `nossen-zen`.
Outils ou contrats déclarés : `archive_encode`, `archive_decode`. Leur disponibilité dépend du serveur ; les noms absents de la liste des outils ci-dessous ne sont pas exposés par cette livraison.

### full-mcp

Serveur MCP HTTP réunissant collaboration locale, documents, tâches, graphe et adaptateurs. Chaque outil a ses propres prérequis et restrictions, détaillés ci-dessous.

Statut : **Disponibilité selon l’outil**.
Paquet : `serveur intégré` · version `0.11.0`.
Outils ou contrats déclarés : `agent_presence`, `agent_heartbeat`, `agent_role_route`, `container_runtime_status`, `a11_context_brief`, `codex_remote_status`, `codex_task_create`, `codex_task_status`, `codex_task_result`, `agent_inbox_check`, `agent_alert_email`, `agent_maintenance_cycle`, `agent_maintenance_status`, `agent_call_friend`, `agent_general_call`, `agent_jobs`, `a11_worker_status`, `a11_worker_start`, `a11_worker_stop`, `a11_worker_restart`, `a11_task_dispatch`, `a11_agent_jobs_status`, `job_queue_schema`, `job_enqueue`, `job_worker_heartbeat`, `job_lease`, `job_start`, `job_heartbeat`, `job_complete`, `job_fail`, `job_recover_expired`, `job_retire`, `memory_governance_schema`, `memory_semantic_schema`, `memory_write_safe`, `web_draft_write`, `web_draft_index`, `discussion_list`, `discussion_open`, `discussion_post`, `discussion_read`, `discussion_set_status`, `retro_snes_index`, `retro_snes_training_brief`, `retro_snes_session_plan`, `ki_play`, `ki_state`, `romstation_state`, `romstation_mouse`, `romstation_keyboard`, `qflush_gamepad_status`, `qflush_gamepad_play`, `qflush_gamepad_pilot`, `qflush_keyboard_play`, `qflush_keyboard_macro`, `qflush_keyboard_pilot`, `qflush_mouse_click`, `neo4j_status`, `neo4j_temporal_status`, `neo4j_temporal_schema`, `neo4j_temporal_emit_event`, `neo4j_temporal_emit_decision`, `neo4j_temporal_reliability`, `a11_runtime_hooks_status`, `doctor_status`, `chopper_doctor_status`, `piccolo_repair_plan`, `neo4j_read_query`, `graph_write_safe`, `neo4j_write_query`, `a11_status`, `a11_llm_stats`, `a11_chat`, `kaen44_status`, `qflush_status`, `qflush_sources_status`, `qflush_sources_select`, `qflush_window_capture`, `qflush_janus_status`, `qflush_janus_analyze`, `qflush_vivy_audio_status`, `qflush_vivy_audio_analyze`, `qflush_media_analyze`, `read_backend_logs`, `read_qflush_logs`, `search`, `fetch`, `search_project`, `shared_context_index`, `cloud_roots_index`, `search_cloud_roots`, `read_cloud_doc`, `generated_bucket_status`, `generated_bucket_public_url`, `generated_bucket_list`, `generated_bucket_head`, `generated_bucket_read_text`, `generated_bucket_put_text`, `generated_bucket_put_base64`, `read_shared_doc`, `explain_env`, `cloudflare_verify_token`, `cloudflare_list_zones`, `cloudflare_list_dns_records`, `cloudflare_list_tunnels`, `cloudflare_list_access_apps`, `cloudflare_list_r2_buckets`, `hetzner_list_servers`, `hetzner_get_rescue`, `cloudflare_create_dns_record`, `hetzner_reboot`, `kit_status`, `kit_readiness`, `kit_diagnostics`, `kit_catalog`, `assistant_chat`. Leur disponibilité dépend du serveur ; les noms absents de la liste des outils ci-dessous ne sont pas exposés par cette livraison.

### allmight

Détection de fichiers sources identiques ou proches et rapports de regroupement pour préparer une consolidation de dépôt. Bibliothèque et CLI ; aucun nettoyage automatique vendu avec le kit.

Statut : **Bibliothèque incluse, à intégrer et qualifier**.
Paquet : `@nossen/allmight` · version `2.0.1`.
CLI déclaré : `allmight`.

### bat

Primitives de détection de signaux, routage de requêtes, santé des canaux et nouvelles tentatives. À intégrer dans votre propre code.

Statut : **Bibliothèque incluse, à intégrer et qualifier**.
Paquet : `@nossen/bat` · version `2.0.2`.

### bat-system

Couche de compatibilité pour les anciennes primitives BAT. Préférer bat pour un nouveau développement ; ce composant n’ajoute pas de service autonome.

Statut : **Bibliothèque incluse, à intégrer et qualifier**.
Paquet : `@nossen/bat-system` · version `2.0.2`.

### beam

Primitives pour enchaîner des étapes de traitement et des passages de relais entre modules. Nécessite de définir son propre pipeline.

Statut : **Bibliothèque incluse, à intégrer et qualifier**.
Paquet : `@nossen/beam` · version `2.0.1`.

### cf

Client d’API Cloudflare pour zones, DNS, tunnels, Access et R2. Nécessite les droits du compte client ; les outils MCP de mutation DNS restent désactivés.

Statut : **Bibliothèque incluse, à intégrer et qualifier**.
Paquet : `@nossen/cf` · version `0.1.0`.
CLI déclaré : `nossen-cf`.

### dragon

Programme de supervision HTTP fondé sur un manifeste de services. Inclus comme bibliothèque/programme ; aucun démon Dragon ni supervision de votre machine n’est démarré par le kit.

Statut : **Bibliothèque incluse, à intégrer et qualifier**.
Paquet : `@nossen/dragon` · version `2.0.2`.

### dragon-contracts

Types et contrats TypeScript décrivant manifestes, états, actions et politiques de supervision Dragon. Ce composant ne lance aucun service.

Statut : **Bibliothèque incluse, à intégrer et qualifier**.
Paquet : `@nossen/dragon-contracts` · version `2.0.1`.

### dragon-upstream

Chargement de manifestes, sondes de services, journaux et cycles de rapprochement d’état pour Dragon. Les cibles et chemins doivent être adaptés à votre environnement.

Statut : **Bibliothèque incluse, à intégrer et qualifier**.
Paquet : `@nossen/dragon-upstream` · version `2.0.2`.

### envapt-superimg

Utilitaires expérimentaux de vérification et de transport de petites charges utiles dans des supports image de type OC8. Ce n’est pas un générateur d’images.

Statut : **Bibliothèque incluse, à intégrer et qualifier**.
Paquet : `@nossen/envapt-superimg` · version `2.0.2`.

### envaptex

Chargement de profils et validation de configuration d’environnement pour vos programmes. L’intégration dans un nouveau projet reste à réaliser.

Statut : **Bibliothèque incluse, à intégrer et qualifier**.
Paquet : `@nossen/envaptex` · version `2.0.1`.

### freeland

Normalisation de valeurs et de structures échangées entre modules pour réduire le code de conversion. Bibliothèque de développement.

Statut : **Bibliothèque incluse, à intégrer et qualifier**.
Paquet : `@nossen/freeland` · version `2.0.2`.
CLI déclaré : `freeland`.

### freeland-bros

Diagnostics de structures de données et projections RGBA/cube basées sur Freeland et Morphing. Destiné à l’inspection de données de développement.

Statut : **Bibliothèque incluse, à intégrer et qualifier**.
Paquet : `@nossen/freeland-bros` · version `2.0.4`.

### hetzner

Client Hetzner Robot pour serveurs dédiés, état de secours et opérations d’infrastructure. Les identifiants sont ceux du client ; le redémarrage MCP reste désactivé.

Statut : **Bibliothèque incluse, à intégrer et qualifier**.
Paquet : `@nossen/hetzner` · version `0.1.0`.
CLI déclaré : `nossen-hetzner`.

### katana

Commandes de maintenance et de vérification ciblées d’un dépôt. Le CLI inclus doit être qualifié pour votre arborescence avant utilisation.

Statut : **Bibliothèque incluse, à intégrer et qualifier**.
Paquet : `@nossen/katana` · version `2.0.0`.
CLI déclaré : `katana`.

### knowledge-modules

Données JSON de connaissance : personas historiques, constantes et palettes de projets de recherche. Ce ne sont pas des fonctions exécutables ni des modèles scientifiques validés ; ces données ne définissent pas vos agents automatiquement.

Statut : **Bibliothèque incluse, à intégrer et qualifier**.
Paquet : `@nossen/knowledge-modules` · version `0.2.3`.

### mcp-agent-bus

Constructeurs de requêtes pour présence d’agents, boîtes de réception, discussions et passages de relais. N’installe ni modèle IA ni agent exécutant.

Statut : **Bibliothèque incluse, à intégrer et qualifier**.
Paquet : `@nossen/mcp-agent-bus` · version `0.1.2`.
Outils ou contrats déclarés : `agent_presence`, `agent_heartbeat`, `agent_role_route`, `agent_inbox_check`, `agent_call_friend`, `agent_jobs`, `discussion_list`, `discussion_open`, `discussion_post`, `discussion_read`, `discussion_set_status`. Leur disponibilité dépend du serveur ; les noms absents de la liste des outils ci-dessous ne sont pas exposés par cette livraison.

### mcp-chopper-mixer

Contrats de requêtes de diagnostic, planification de réparation et routage de mixage. Les services historiques Chopper/mixeur ne sont pas embarqués.

Statut : **Bibliothèque incluse, à intégrer et qualifier**.
Paquet : `@nossen/mcp-chopper-mixer` · version `0.1.2`.
Outils ou contrats déclarés : `a11_runtime_hooks_status`, `doctor_status`, `chopper_doctor_status`, `piccolo_repair_plan`, `a11_chopper_status`, `a11_chopper_plan`, `a11_chopper_rumble`, `a11_chopper_recipes`, `a11_chopper_doctor`, `a11_funesterie_mixer_status`, `a11_funesterie_mixer_route`, `logic_reduce`. Leur disponibilité dépend du serveur ; les noms absents de la liste des outils ci-dessous ne sont pas exposés par cette livraison.

### mcp-cloud-assets

Constructeurs de requêtes pour recherche de documents et objets S3/R2. Les comptes cloud et montages de documents doivent être fournis ; publication R2 désactivée dans le MCP.

Statut : **Bibliothèque incluse, à intégrer et qualifier**.
Paquet : `@nossen/mcp-cloud-assets` · version `0.1.2`.
Outils ou contrats déclarés : `search`, `fetch`, `search_project`, `shared_context_index`, `cloud_roots_index`, `search_cloud_roots`, `read_cloud_doc`, `generated_bucket_status`, `generated_bucket_public_url`, `generated_bucket_list`, `generated_bucket_head`, `generated_bucket_read_text`, `generated_bucket_put_text`, `generated_bucket_put_base64`, `read_shared_doc`. Leur disponibilité dépend du serveur ; les noms absents de la liste des outils ci-dessous ne sont pas exposés par cette livraison.

### mcp-job-queue

Constructeurs de requêtes de file de tâches : dépôt, bail, progression, résultat et reprise. La file est locale ; les exécutants des tâches ne sont pas fournis.

Statut : **Bibliothèque incluse, à intégrer et qualifier**.
Paquet : `@nossen/mcp-job-queue` · version `0.1.2`.
Outils ou contrats déclarés : `job_queue_schema`, `job_enqueue`, `job_worker_heartbeat`, `job_lease`, `job_start`, `job_heartbeat`, `job_complete`, `job_fail`, `job_recover_expired`. Leur disponibilité dépend du serveur ; les noms absents de la liste des outils ci-dessous ne sont pas exposés par cette livraison.

### mcp-media-bridge

Contrats pour capture de fenêtre et analyse image/audio via des services hôtes. Le kit Docker ne fournit pas ces ponts multimédias ni leurs modèles.

Statut : **Bibliothèque incluse, à intégrer et qualifier**.
Paquet : `@nossen/mcp-media-bridge` · version `0.1.2`.
Outils ou contrats déclarés : `qflush_sources_status`, `qflush_sources_select`, `qflush_window_capture`, `qflush_janus_status`, `qflush_janus_analyze`, `qflush_vivy_audio_status`, `qflush_vivy_audio_analyze`, `qflush_media_analyze`. Leur disponibilité dépend du serveur ; les noms absents de la liste des outils ci-dessous ne sont pas exposés par cette livraison.

### mcp-memory-graph

Constructeurs de requêtes de mémoire, graphe et événements temporels. Le Neo4j local est fourni ; les écritures libres restent désactivées.

Statut : **Bibliothèque incluse, à intégrer et qualifier**.
Paquet : `@nossen/mcp-memory-graph` · version `0.1.2`.
Outils ou contrats déclarés : `memory_governance_schema`, `memory_semantic_schema`, `memory_write_safe`, `neo4j_status`, `neo4j_temporal_status`, `neo4j_temporal_schema`, `neo4j_temporal_emit_event`, `neo4j_temporal_emit_decision`, `neo4j_temporal_reliability`, `neo4j_read_query`, `graph_write_safe`, `neo4j_write_query`, `public_neo4j_status`, `public_neo4j_read_query`, `public_neo4j_projection_guard`. Leur disponibilité dépend du serveur ; les noms absents de la liste des outils ci-dessous ne sont pas exposés par cette livraison.

### mcp-public-endpoints

Utilitaires de profils d’accès MCP en lecture. Ne publie pas votre instance sur Internet et ne garantit pas la compatibilité avec chaque client cloud.

Statut : **Bibliothèque incluse, à intégrer et qualifier**.
Paquet : `@nossen/mcp-public-endpoints` · version `0.1.2`.
Outils ou contrats déclarés : `search`, `fetch`, `external_agent_onboarding`, `a11_status`, `kaen44_status`, `ki_state`, `public_neo4j_status`, `public_neo4j_read_query`, `public_neo4j_projection_guard`, `generated_bucket_status`, `generated_bucket_public_url`. Leur disponibilité dépend du serveur ; les noms absents de la liste des outils ci-dessous ne sont pas exposés par cette livraison.

### mcp-qflush-control

Contrats de commandes clavier, souris et manette pour un pont QFlush. Aucun pilote ni pont de contrôle du bureau n’est fourni par ces contrats.

Statut : **Bibliothèque incluse, à intégrer et qualifier**.
Paquet : `@nossen/mcp-qflush-control` · version `0.1.2`.
Outils ou contrats déclarés : `qflush_gamepad_status`, `qflush_gamepad_play`, `qflush_gamepad_pilot`, `qflush_keyboard_play`, `qflush_keyboard_macro`, `qflush_keyboard_pilot`, `qflush_mouse_click`, `romstation_mouse`, `romstation_keyboard`. Leur disponibilité dépend du serveur ; les noms absents de la liste des outils ci-dessous ne sont pas exposés par cette livraison.

### mcp-retro-session

Contrats de préparation de sessions rétro et de commandes de contrôleur. Aucun émulateur, jeu, ROM ou pont de manette n’est inclus.

Statut : **Bibliothèque incluse, à intégrer et qualifier**.
Paquet : `@nossen/mcp-retro-session` · version `0.1.2`.
Outils ou contrats déclarés : `retro_snes_index`, `retro_snes_training_brief`, `retro_snes_session_plan`, `ki_play`, `ki_state`, `romstation_state`, `romstation_mouse`, `romstation_keyboard`, `br_play`, `br_state`, `br_pilot`. Leur disponibilité dépend du serveur ; les noms absents de la liste des outils ci-dessous ne sont pas exposés par cette livraison.

### mcp-security-preflight

Utilitaires de masquage et de résumé de présence de configuration. Ce n’est pas une garantie de détection de tous les secrets ni un audit de sécurité.

Statut : **Bibliothèque incluse, à intégrer et qualifier**.
Paquet : `@nossen/mcp-security-preflight` · version `0.1.2`.
Outils ou contrats déclarés : `explain_env`, `a11_shared_mcp_status`, `a11_mcp_dimension_status`, `a11_route_map`, `a11_identity_route`. Leur disponibilité dépend du serveur ; les noms absents de la liste des outils ci-dessous ne sont pas exposés par cette livraison.

### mcp-tool-manifest

Manifeste regroupant des identifiants d’outils MCP. Un outil cité dans ce manifeste peut être absent ou indisponible dans le serveur livré.

Statut : **Bibliothèque incluse, à intégrer et qualifier**.
Paquet : `@nossen/mcp-tool-manifest` · version `0.1.2`.
Outils ou contrats déclarés : `agent_presence`, `agent_heartbeat`, `agent_role_route`, `a11_context_brief`, `codex_remote_status`, `codex_task_create`, `codex_task_status`, `codex_task_result`, `agent_inbox_check`, `agent_alert_email`, `agent_maintenance_cycle`, `agent_maintenance_status`, `agent_call_friend`, `agent_jobs`, `a11_worker_status`, `a11_worker_start`, `a11_worker_stop`, `a11_worker_restart`, `a11_task_dispatch`, `a11_agent_jobs_status`, `job_queue_schema`, `job_enqueue`, `job_worker_heartbeat`, `job_lease`, `job_start`, `job_heartbeat`, `job_complete`, `job_fail`, `job_recover_expired`, `memory_governance_schema`, `memory_semantic_schema`, `memory_write_safe`, `web_draft_write`, `web_draft_index`, `discussion_list`, `discussion_open`, `discussion_post`, `discussion_read`, `discussion_set_status`, `retro_snes_index`, `retro_snes_training_brief`, `retro_snes_session_plan`, `ki_play`, `ki_state`, `romstation_state`, `romstation_mouse`, `romstation_keyboard`, `qflush_gamepad_status`, `qflush_gamepad_play`, `qflush_gamepad_pilot`, `qflush_keyboard_play`, `qflush_keyboard_macro`, `qflush_keyboard_pilot`, `qflush_mouse_click`, `br_play`, `br_state`, `br_pilot`, `neo4j_status`, `neo4j_temporal_status`, `neo4j_temporal_schema`, `neo4j_temporal_emit_event`, `neo4j_temporal_emit_decision`, `neo4j_temporal_reliability`, `a11_runtime_hooks_status`, `doctor_status`, `chopper_doctor_status`, `piccolo_repair_plan`, `neo4j_read_query`, `graph_write_safe`, `neo4j_write_query`, `a11_status`, `a11_llm_stats`, `a11_chat`, `kaen44_status`, `qflush_status`, `qflush_sources_status`, `qflush_sources_select`, `qflush_window_capture`, `qflush_janus_status`, `qflush_janus_analyze`, `qflush_vivy_audio_status`, `qflush_vivy_audio_analyze`, `qflush_media_analyze`, `read_backend_logs`, `read_qflush_logs`, `search`, `fetch`, `search_project`, `shared_context_index`, `cloud_roots_index`, `search_cloud_roots`, `read_cloud_doc`, `generated_bucket_status`, `generated_bucket_public_url`, `generated_bucket_list`, `generated_bucket_head`, `generated_bucket_read_text`, `generated_bucket_put_text`, `generated_bucket_put_base64`, `read_shared_doc`, `explain_env`. Leur disponibilité dépend du serveur ; les noms absents de la liste des outils ci-dessous ne sont pas exposés par cette livraison.

### mcp-toolkit

Utilitaires JSON-RPC, normalisation d’adresses MCP et création de charges utiles tools/list, tools/call et ping. Bibliothèque pour développeurs.

Statut : **Bibliothèque incluse, à intégrer et qualifier**.
Paquet : `@nossen/mcp-toolkit` · version `0.1.2`.
Outils ou contrats déclarés : `tools/list`, `tools/call`, `ping`. Leur disponibilité dépend du serveur ; les noms absents de la liste des outils ci-dessous ne sont pas exposés par cette livraison.

### mcp-web-drafts

Contrats de création et d’indexation de brouillons locaux. Aucun déploiement ou publication de site n’est déclenché.

Statut : **Bibliothèque incluse, à intégrer et qualifier**.
Paquet : `@nossen/mcp-web-drafts` · version `0.1.2`.
Outils ou contrats déclarés : `web_draft_write`, `web_draft_index`. Leur disponibilité dépend du serveur ; les noms absents de la liste des outils ci-dessous ne sont pas exposés par cette livraison.

### mcp-worker-supervisor

Contrats de supervision et d’envoi de tâches à des exécutants. Le superviseur et les exécutants historiques ne sont pas livrés comme services du kit.

Statut : **Bibliothèque incluse, à intégrer et qualifier**.
Paquet : `@nossen/mcp-worker-supervisor` · version `0.1.2`.
Outils ou contrats déclarés : `codex_remote_status`, `codex_task_create`, `codex_task_status`, `codex_task_result`, `a11_worker_status`, `a11_worker_start`, `a11_worker_stop`, `a11_worker_restart`, `a11_task_dispatch`, `a11_agent_jobs_status`. Leur disponibilité dépend du serveur ; les noms absents de la liste des outils ci-dessous ne sont pas exposés par cette livraison.

### morphing

Primitives de représentation compacte de valeurs sur quatre octets et conversions RGBA/cube. Bibliothèque expérimentale de transport de données.

Statut : **Bibliothèque incluse, à intégrer et qualifier**.
Paquet : `@nossen/morphing` · version `2.1.0`.

### nezlephant

Encodage, décodage et inspection de petites charges utiles dans des supports image OC8. Les fonctions natives ou média restent à qualifier.

Statut : **Bibliothèque incluse, à intégrer et qualifier**.
Paquet : `@nossen/nezlephant` · version `2.0.2`.

### qflush

Orchestrateur en ligne de commande pour modules, processus et workflows locaux. Inclus comme programme ; aucun contrôle clavier/souris ni superviseur hôte n’est installé automatiquement.

Statut : **Bibliothèque incluse, à intégrer et qualifier**.
Paquet : `@nossen/qflush` · version `2.0.4`.
CLI déclaré : `qflush`, `qf`.

### qflush-runner

Programme léger pour invoquer des tâches compatibles QFlush dans un workflow local ou de CI. L’environnement d’exécution doit être fourni et validé.

Statut : **Bibliothèque incluse, à intégrer et qualifier**.
Paquet : `@nossen/qflush-runner` · version `2.0.2`.
CLI déclaré : `qflush-runner`.

### rome

Primitives et commandes pour repérer des espaces de travail et orchestrer plusieurs processus. Les chemins, profils et commandes appartiennent au client.

Statut : **Bibliothèque incluse, à intégrer et qualifier**.
Paquet : `@nossen/rome` · version `2.0.3`.
CLI déclaré : `rome`.

### scentgate

Capsules de notes et de signaux temporaires pour une investigation ou un passage de relais. Fournit aussi des contrats de notification de tâches ; aucune messagerie externe n’est connectée automatiquement.

Statut : **Bibliothèque incluse, à intégrer et qualifier**.
Paquet : `@nossen/scentgate` · version `2.2.0`.
CLI déclaré : `scentgate`.

### scream

Prototype de primitives sémantiques SCREAM, WAZAA et MASK. Bibliothèque expérimentale ; aucun moteur vocal ou service audio complet n’est promis.

Statut : **Bibliothèque incluse, à intégrer et qualifier**.
Paquet : `@nossen/scream` · version `2.0.2`.

### spyder

Primitives d’inspection de dépôt et de petit serveur local pour outils de développement. Aucun assistant IA autonome n’est lancé par ce module.

Statut : **Bibliothèque incluse, à intégrer et qualifier**.
Paquet : `@nossen/spyder` · version `2.0.2`.

### zen-gate

Transfert par blocs avec déduplication et vérification SHA-256 entre un émetteur et un récepteur. Les deux extrémités et leurs accès restent à déployer ; ce service n’est pas démarré par le kit.

Statut : **Bibliothèque incluse, à intégrer et qualifier**.
Paquet : `@nossen/zen-gate` · version `0.1.0`.

## Outils

### agent_presence

Lit les présences et activités récentes déclarées par les agents locaux.

Statut : **Fonction locale, non certifiée individuellement** · groupe `local` · portée `docker`.

| Paramètre | Type | Obligatoire |
| --- | --- | --- |
| `includeIdle` | boolean | non |

### agent_heartbeat

Enregistre un agent défini par le client et ses compétences. Ne lance aucun exécutant et ne sélectionne aucun personnage prédéfini.

Statut : **Fonction locale, non certifiée individuellement** · groupe `local` · portée `docker`.

| Paramètre | Type | Obligatoire |
| --- | --- | --- |
| `agentId` | string | non |
| `name` | string | oui |
| `role` | string | non |
| `host` | string | non |
| `status` | string | non |
| `capabilities` | array | non |
| `profilePreset` | string | non |
| `identity` | string | non |
| `tone` | string | non |
| `priority` | string | non |
| `memoryScope` | array | non |
| `riskLevel` | string | non |
| `note` | string | non |
| `checkInbox` | boolean | non |
| `autoReplyInbox` | boolean | non |

### agent_role_route

Recherche les agents récents possédant toutes les compétences demandées. Ne distribue ni n’exécute les tâches.

Statut : **Fonction locale, non certifiée individuellement** · groupe `local` · portée `docker`.

| Paramètre | Type | Obligatoire |
| --- | --- | --- |
| `task` | string | non |
| `requiredCapabilities` | array | non |
| `includeArchitecture` | boolean | non |

### container_runtime_status

Décrit les limites de l’installation autonome. Ne lit pas Docker et ne prouve pas la santé des conteneurs.

Statut : **Fonction locale, non certifiée individuellement** · groupe `local` · portée `docker`.

| Paramètre | Type | Obligatoire |
| --- | --- | --- |
| `includeCommands` | boolean | non |

### a11_context_brief

Résume les présences et nombres de tâches de cette installation, sans backend hébergé.

Statut : **Fonction locale, non certifiée individuellement** · groupe `local` · portée `docker`.
Aucun paramètre déclaré.

### codex_remote_status

Contrat de lecture de présence d’un exécutant Codex. Cet exécutant n’est pas fourni.

Statut : **Service requis non fourni** · groupe `workers` · portée `docker`.
Aucun paramètre déclaré.

### codex_task_create

Contrat de création d’une tâche pour un exécutant Codex externe au kit. Aucun exécutant n’est fourni.

Statut : **Service requis non fourni** · groupe `workers` · portée `docker`.

| Paramètre | Type | Obligatoire |
| --- | --- | --- |
| `title` | string | oui |
| `goal` | string | oui |
| `mode` | string | non |
| `constraints` | array | non |
| `expectedOutput` | string | non |
| `priority` | string | non |
| `dryRun` | boolean | non |

### codex_task_status

Contrat de lecture de l’état d’une tâche Codex. Nécessite le service correspondant, non fourni.

Statut : **Service requis non fourni** · groupe `workers` · portée `docker`.

| Paramètre | Type | Obligatoire |
| --- | --- | --- |
| `taskId` | string | oui |
| `includeSummary` | boolean | non |

### codex_task_result

Contrat de lecture du résultat d’une tâche Codex. Nécessite le service correspondant, non fourni.

Statut : **Service requis non fourni** · groupe `workers` · portée `docker`.

| Paramètre | Type | Obligatoire |
| --- | --- | --- |
| `taskId` | string | oui |

### agent_inbox_check

Lit les présences, tâches et discussions ; peut ajouter une réponse locale selon les options.

Statut : **Fonction locale, non certifiée individuellement** · groupe `local` · portée `docker`.

| Paramètre | Type | Obligatoire |
| --- | --- | --- |
| `from` | string | oui |
| `agentId` | string | non |
| `aliases` | array | non |
| `autoReply` | boolean | non |
| `includeGlobal` | boolean | non |
| `maxThreads` | integer | non |
| `cooldownMinutes` | integer | non |

### agent_alert_email

Adaptateur d’alerte par courriel. Le service et les identifiants du fournisseur ne sont pas fournis ; aucun envoi prêt à l’emploi.

Statut : **Service requis non fourni** · groupe `integrations` · portée `docker`.

| Paramètre | Type | Obligatoire |
| --- | --- | --- |
| `from` | string | oui |
| `severity` | string | non |
| `title` | string | oui |
| `body` | string | oui |
| `threadId` | string | non |
| `jobId` | string | non |
| `source` | string | non |
| `tags` | array | non |
| `dryRun` | boolean | non |

### agent_maintenance_cycle

Cycle borné de contrôles et de maintenance d’agents. Adaptateur restant à qualifier dans ce kit.

Statut : **À qualifier** · groupe `qualification` · portée `docker`.

| Paramètre | Type | Obligatoire |
| --- | --- | --- |
| `from` | string | non |
| `dryRun` | boolean | non |
| `forceReport` | boolean | non |
| `postReport` | boolean | non |
| `salonIfGreen` | boolean | non |
| `minReportIntervalHours` | number | non |

### agent_maintenance_status

Lit le rapport de maintenance prévu par l’adaptateur. Fonction restant à qualifier.

Statut : **À qualifier** · groupe `qualification` · portée `docker`.
Aucun paramètre déclaré.

### agent_call_friend

Ancien mécanisme de passage de relais entre agents. Reste à qualifier ; utiliser les parcours locaux documentés pour vos agents.

Statut : **À qualifier** · groupe `qualification` · portée `docker`.

| Paramètre | Type | Obligatoire |
| --- | --- | --- |
| `from` | string | oui |
| `scope` | string | non |
| `friend` | string | non |
| `title` | string | oui |
| `question` | string | oui |
| `context` | string | non |
| `urgency` | string | non |
| `tags` | array | non |
| `relatedTool` | string | non |

### agent_general_call

Prévisualise ou crée une discussion locale et des tâches pour des agents nommément choisis. Aucun message externe ni travail automatique.

Statut : **Fonction locale, non certifiée individuellement** · groupe `local` · portée `docker`.

| Paramètre | Type | Obligatoire |
| --- | --- | --- |
| `from` | string | oui |
| `title` | string | non |
| `message` | string | oui |
| `targets` | array | oui |
| `scope` | string | non |
| `createJobs` | boolean | non |
| `dryRun` | boolean | non |
| `sendDiscord` | boolean | non |

### agent_jobs

Lit le tableau persistant des tâches locales sans le modifier.

Statut : **Fonction locale, non certifiée individuellement** · groupe `local` · portée `docker`.

| Paramètre | Type | Obligatoire |
| --- | --- | --- |
| `status` | string | non |
| `queue` | string | non |
| `workerId` | string | non |
| `limit` | integer | non |

### a11_worker_status

Contrat d’état du superviseur d’exécutants. Le service de supervision n’est pas fourni.

Statut : **Service requis non fourni** · groupe `workers` · portée `docker`.

| Paramètre | Type | Obligatoire |
| --- | --- | --- |
| `workerId` | string | non |
| `includeLogs` | boolean | non |
| `maxLogChars` | integer | non |
| `auditLimit` | integer | non |

### a11_worker_start

Contrat de démarrage d’un exécutant autorisé. Superviseur et exécutant non fournis.

Statut : **Service requis non fourni** · groupe `workers` · portée `docker`.

| Paramètre | Type | Obligatoire |
| --- | --- | --- |
| `agent` | string | oui |
| `workerId` | string | oui |
| `reason` | string | non |
| `dryRun` | boolean | non |

### a11_worker_stop

Contrat d’arrêt d’un exécutant supervisé. Superviseur non fourni.

Statut : **Service requis non fourni** · groupe `workers` · portée `docker`.

| Paramètre | Type | Obligatoire |
| --- | --- | --- |
| `agent` | string | oui |
| `workerId` | string | oui |
| `dryRun` | boolean | non |

### a11_worker_restart

Contrat de redémarrage d’un exécutant supervisé. Superviseur non fourni.

Statut : **Service requis non fourni** · groupe `workers` · portée `docker`.

| Paramètre | Type | Obligatoire |
| --- | --- | --- |
| `agent` | string | oui |
| `workerId` | string | oui |
| `reason` | string | non |
| `dryRun` | boolean | non |

### a11_task_dispatch

Contrat d’envoi de tâches au distributeur historique. Service non fourni dans le kit.

Statut : **Service requis non fourni** · groupe `workers` · portée `docker`.

| Paramètre | Type | Obligatoire |
| --- | --- | --- |
| `agent` | string | oui |
| `project` | string | non |
| `tasks` | array | non |
| `markdown` | string | non |
| `priority` | string | non |
| `targetAgents` | array | non |
| `dryRun` | boolean | non |

### a11_agent_jobs_status

Contrat de consultation des tâches du superviseur. Service non fourni.

Statut : **Service requis non fourni** · groupe `workers` · portée `docker`.

| Paramètre | Type | Obligatoire |
| --- | --- | --- |
| `agent` | string | non |
| `limit` | integer | non |
| `includeLogs` | boolean | non |
| `maxLogChars` | integer | non |

### job_queue_schema

Décrit le format et les règles de la file locale de tâches déclaratives.

Statut : **Fonction locale, non certifiée individuellement** · groupe `local` · portée `docker`.
Aucun paramètre déclaré.

### job_enqueue

Dépose une tâche JSON bornée dans la file. Ne lance pas de commande shell ni de programme.

Statut : **Fonction locale, non certifiée individuellement** · groupe `local` · portée `docker`.

| Paramètre | Type | Obligatoire |
| --- | --- | --- |
| `from` | string | oui |
| `queue` | string | non |
| `kind` | string | oui |
| `title` | string | oui |
| `payload` | JSON | non |
| `priority` | integer | non |
| `risk` | string | non |
| `requiredCapabilities` | array | non |
| `runAfter` | string | non |
| `leaseMs` | integer | non |
| `maxRetries` | integer | non |
| `idempotencyKey` | string | non |

### job_worker_heartbeat

Permet à votre propre exécutant de déclarer ses files et compétences.

Statut : **Fonction locale, non certifiée individuellement** · groupe `local` · portée `docker`.

| Paramètre | Type | Obligatoire |
| --- | --- | --- |
| `workerId` | string | oui |
| `name` | string | non |
| `status` | string | non |
| `capabilities` | array | non |
| `queues` | array | non |
| `note` | string | non |

### job_lease

Réserve atomiquement des tâches compatibles ; fournit un jeton de bail temporaire à garder privé.

Statut : **Fonction locale, non certifiée individuellement** · groupe `local` · portée `docker`.

| Paramètre | Type | Obligatoire |
| --- | --- | --- |
| `workerId` | string | oui |
| `workerName` | string | non |
| `capabilities` | array | non |
| `queues` | array | non |
| `maxJobs` | integer | non |
| `leaseMs` | integer | non |

### job_start

Marque le début d’une tâche disposant d’un bail valide.

Statut : **Fonction locale, non certifiée individuellement** · groupe `local` · portée `docker`.

| Paramètre | Type | Obligatoire |
| --- | --- | --- |
| `jobId` | string | oui |
| `workerId` | string | oui |
| `leaseToken` | string | oui |
| `progress` | number | non |
| `note` | string | non |

### job_heartbeat

Prolonge un bail et met à jour la progression de la tâche.

Statut : **Fonction locale, non certifiée individuellement** · groupe `local` · portée `docker`.

| Paramètre | Type | Obligatoire |
| --- | --- | --- |
| `jobId` | string | oui |
| `workerId` | string | oui |
| `leaseToken` | string | oui |
| `extendLeaseMs` | integer | non |
| `progress` | number | non |
| `note` | string | non |

### job_complete

Termine une tâche louée avec un résultat JSON borné sans secret.

Statut : **Fonction locale, non certifiée individuellement** · groupe `local` · portée `docker`.

| Paramètre | Type | Obligatoire |
| --- | --- | --- |
| `jobId` | string | oui |
| `workerId` | string | oui |
| `leaseToken` | string | oui |
| `result` | JSON | non |
| `note` | string | non |

### job_fail

Enregistre l’échec d’une tâche et son éventuelle prochaine tentative.

Statut : **Fonction locale, non certifiée individuellement** · groupe `local` · portée `docker`.

| Paramètre | Type | Obligatoire |
| --- | --- | --- |
| `jobId` | string | oui |
| `workerId` | string | oui |
| `leaseToken` | string | oui |
| `error` | string | oui |
| `retryable` | boolean | non |
| `retryDelayMs` | integer | non |
| `result` | JSON | non |

### job_recover_expired

Récupère les tâches dont le bail a expiré après l’arrêt d’un exécutant.

Statut : **Fonction locale, non certifiée individuellement** · groupe `local` · portée `docker`.

| Paramètre | Type | Obligatoire |
| --- | --- | --- |
| `from` | string | oui |
| `maxJobs` | integer | non |
| `retryDelayMs` | integer | non |

### job_retire

Prévisualise puis, sur demande explicite, annule ou archive des tâches anciennes.

Statut : **Fonction locale, non certifiée individuellement** · groupe `local` · portée `docker`.

| Paramètre | Type | Obligatoire |
| --- | --- | --- |
| `from` | string | oui |
| `action` | string | non |
| `reason` | string | non |
| `jobIds` | array | non |
| `statuses` | array | non |
| `queues` | array | non |
| `olderThanHours` | number | non |
| `maxJobs` | integer | non |
| `dryRun` | boolean | non |

### memory_governance_schema

Décrit le schéma de mémoire JSONL et Neo4j avant l’écriture de notes.

Statut : **Fonction locale, non certifiée individuellement** · groupe `graph` · portée `docker`.
Aucun paramètre déclaré.

### memory_semantic_schema

Décrit les contrats des notes de mémoire et des liens sémantiques.

Statut : **Fonction locale, non certifiée individuellement** · groupe `graph` · portée `docker`.
Aucun paramètre déclaré.

### memory_write_safe

Ajoute une note sans secret dans la mémoire locale et, si autorisé, un nœud encadré dans le graphe.

Statut : **Fonction locale, non certifiée individuellement** · groupe `graph-write` · portée `docker`.

| Paramètre | Type | Obligatoire |
| --- | --- | --- |
| `from` | string | oui |
| `title` | string | oui |
| `body` | string | oui |
| `scope` | string | non |
| `kind` | string | non |
| `tags` | array | non |
| `links` | array | non |

### web_draft_write

Enregistre un brouillon local pour le projet du client. Ne publie ni ne déploie de site.

Statut : **Fonction locale, non certifiée individuellement** · groupe `local` · portée `docker`.

| Paramètre | Type | Obligatoire |
| --- | --- | --- |
| `from` | string | oui |
| `target` | string | non |
| `title` | string | oui |
| `route` | string | non |
| `format` | string | non |
| `content` | string | oui |
| `tags` | array | non |
| `notes` | string | non |

### web_draft_index

Liste les brouillons locaux, éventuellement filtrés par projet.

Statut : **Fonction locale, non certifiée individuellement** · groupe `local` · portée `docker`.

| Paramètre | Type | Obligatoire |
| --- | --- | --- |
| `target` | string | non |
| `limit` | integer | non |

### discussion_list

Liste les discussions locales disponibles pour les agents.

Statut : **Fonction locale, non certifiée individuellement** · groupe `local` · portée `docker`.

| Paramètre | Type | Obligatoire |
| --- | --- | --- |
| `status` | string | non |
| `participant` | string | non |
| `limit` | integer | non |

### discussion_open

Ouvre un fil de discussion persistant dans l’installation. Ne contacte aucun fournisseur d’IA.

Statut : **Fonction locale, non certifiée individuellement** · groupe `local` · portée `docker`.

| Paramètre | Type | Obligatoire |
| --- | --- | --- |
| `title` | string | oui |
| `from` | string | oui |
| `body` | string | oui |
| `status` | string | non |
| `brief` | object | non |
| `topic` | string | non |
| `participants` | array | non |
| `tags` | array | non |
| `threadId` | string | non |

### discussion_post

Ajoute un message à un fil local existant. Les secrets ne doivent pas y être inscrits.

Statut : **Fonction locale, non certifiée individuellement** · groupe `local` · portée `docker`.

| Paramètre | Type | Obligatoire |
| --- | --- | --- |
| `threadId` | string | oui |
| `from` | string | oui |
| `body` | string | oui |
| `kind` | string | non |
| `replyTo` | string | non |

### discussion_read

Lit un fil local avec une limite sur l’historique retourné.

Statut : **Fonction locale, non certifiée individuellement** · groupe `local` · portée `docker`.

| Paramètre | Type | Obligatoire |
| --- | --- | --- |
| `threadId` | string | oui |
| `limit` | integer | non |

### discussion_set_status

Change l’état d’un fil : proposition, travail, blocage, terminé ou archivé.

Statut : **Fonction locale, non certifiée individuellement** · groupe `local` · portée `docker`.

| Paramètre | Type | Obligatoire |
| --- | --- | --- |
| `threadId` | string | oui |
| `from` | string | oui |
| `status` | string | oui |
| `body` | string | non |

### retro_snes_index

Prévoit un inventaire de ressources rétro locales. Adaptateur à qualifier ; jeux et émulateurs non fournis.

Statut : **À qualifier** · groupe `qualification` · portée `docker`.

| Paramètre | Type | Obligatoire |
| --- | --- | --- |
| `includeHashes` | boolean | non |
| `maxItems` | integer | non |

### retro_snes_training_brief

Prépare un cadre de coaching rétro. Ne joue pas au jeu et reste à qualifier.

Statut : **À qualifier** · groupe `qualification` · portée `docker`.
Aucun paramètre déclaré.

### retro_snes_session_plan

Prépare un plan de session rétro. Ne fournit pas les captures ou les contrôleurs nécessaires.

Statut : **À qualifier** · groupe `qualification` · portée `docker`.

| Paramètre | Type | Obligatoire |
| --- | --- | --- |
| `game` | string | non |

### ki_play

Contrat d’entrée de manette pour un pont de jeu hôte. Pont et jeu non fournis.

Statut : **Service requis non fourni** · groupe `host` · portée `docker`.

| Paramètre | Type | Obligatoire |
| --- | --- | --- |
| `from` | string | oui |
| `player` | number / number | non |
| `keys` | string | oui |

### ki_state

Contrat de lecture d’analyse de jeu produite sur l’hôte. Boucle de capture non fournie.

Statut : **Service requis non fourni** · groupe `host` · portée `docker`.
Aucun paramètre déclaré.

### romstation_state

Contrat de lecture d’état de RomStation sur l’hôte. Service non fourni.

Statut : **Service requis non fourni** · groupe `host` · portée `docker`.
Aucun paramètre déclaré.

### romstation_mouse

Contrat de commande souris ciblée pour RomStation. Pont de contrôle non fourni.

Statut : **Service requis non fourni** · groupe `host` · portée `docker`.

| Paramètre | Type | Obligatoire |
| --- | --- | --- |
| `from` | string | oui |
| `targetWindow` | string | non |
| `action` | string | non |
| `button` | string | non |
| `coordinateMode` | string | non |
| `x` | number | non |
| `y` | number | non |
| `clicks` | integer | non |
| `holdMs` | integer | non |
| `waitMs` | integer | non |
| `note` | string | non |

### romstation_keyboard

Contrat de navigation clavier pour RomStation. Pont de contrôle non fourni.

Statut : **Service requis non fourni** · groupe `host` · portée `docker`.

| Paramètre | Type | Obligatoire |
| --- | --- | --- |
| `from` | string | oui |
| `targetWindow` | string | non |
| `layout` | string | non |
| `buttons` | string | oui |
| `holdMs` | integer | non |
| `waitMs` | integer | non |
| `note` | string | non |

### qflush_gamepad_status

Contrat de lecture du bus de commandes de manette. Pont hôte non fourni.

Statut : **Service requis non fourni** · groupe `host` · portée `docker`.
Aucun paramètre déclaré.

### qflush_gamepad_play

Contrat de commande de manette bornée. Ne contrôle rien sans un pont hôte, non fourni.

Statut : **Service requis non fourni** · groupe `host` · portée `docker`.

| Paramètre | Type | Obligatoire |
| --- | --- | --- |
| `from` | string | oui |
| `target` | string | non |
| `player` | number / number | non |
| `buttons` | string | oui |
| `holdMs` | integer | non |
| `waitMs` | integer | non |
| `analyzeAfter` | boolean | non |
| `audioAnalyzeAfter` | boolean | non |
| `videoAnalyzeAfter` | boolean | non |
| `note` | string | non |

### qflush_gamepad_pilot

Contrat de plan court de commandes de manette. Pont hôte non fourni.

Statut : **Service requis non fourni** · groupe `host` · portée `docker`.

| Paramètre | Type | Obligatoire |
| --- | --- | --- |
| `from` | string | oui |
| `target` | string | non |
| `player` | number / number | non |
| `intent` | string | non |
| `loops` | integer | non |
| `analyzeAfter` | boolean | non |
| `audioAnalyzeAfter` | boolean | non |
| `videoAnalyzeAfter` | boolean | non |

### qflush_keyboard_play

Contrat de commande clavier bornée. Exécutant hôte non fourni.

Statut : **Service requis non fourni** · groupe `host` · portée `docker`.

| Paramètre | Type | Obligatoire |
| --- | --- | --- |
| `from` | string | oui |
| `target` | string | non |
| `targetWindow` | string | non |
| `layout` | string | non |
| `player` | number / number | non |
| `buttons` | string | oui |
| `holdMs` | integer | non |
| `waitMs` | integer | non |
| `analyzeAfter` | boolean | non |
| `audioAnalyzeAfter` | boolean | non |
| `videoAnalyzeAfter` | boolean | non |
| `note` | string | non |

### qflush_keyboard_macro

Contrat de raccourcis clavier autorisés. Exécutant hôte non fourni.

Statut : **Service requis non fourni** · groupe `host` · portée `docker`.

| Paramètre | Type | Obligatoire |
| --- | --- | --- |
| `from` | string | oui |
| `target` | string | non |
| `targetWindow` | string | non |
| `macro` | string | non |
| `chords` | array | non |
| `holdMs` | integer | non |
| `gapMs` | integer | non |
| `waitMs` | integer | non |
| `analyzeAfter` | boolean | non |
| `audioAnalyzeAfter` | boolean | non |
| `videoAnalyzeAfter` | boolean | non |
| `note` | string | non |

### qflush_keyboard_pilot

Contrat de plan court de navigation clavier. Exécutant hôte non fourni.

Statut : **Service requis non fourni** · groupe `host` · portée `docker`.

| Paramètre | Type | Obligatoire |
| --- | --- | --- |
| `from` | string | oui |
| `target` | string | non |
| `targetWindow` | string | non |
| `layout` | string | non |
| `player` | number / number | non |
| `intent` | string | non |
| `loops` | integer | non |
| `analyzeAfter` | boolean | non |
| `audioAnalyzeAfter` | boolean | non |
| `videoAnalyzeAfter` | boolean | non |

### qflush_mouse_click

Contrat d’action souris ciblant une fenêtre. Pont hôte non fourni par le kit Docker.

Statut : **Service requis non fourni** · groupe `host` · portée `docker`.

| Paramètre | Type | Obligatoire |
| --- | --- | --- |
| `from` | string | oui |
| `target` | string | non |
| `targetWindow` | string | non |
| `action` | string | non |
| `button` | string | non |
| `coordinateMode` | string | non |
| `x` | number | non |
| `y` | number | non |
| `clicks` | integer | non |
| `holdMs` | integer | non |
| `waitMs` | integer | non |
| `analyzeAfter` | boolean | non |
| `audioAnalyzeAfter` | boolean | non |
| `videoAnalyzeAfter` | boolean | non |
| `note` | string | non |

### neo4j_status

Vérifie la connexion à Neo4j sans retourner les identifiants.

Statut : **Fonction locale, non certifiée individuellement** · groupe `graph` · portée `docker`.
Aucun paramètre déclaré.

### neo4j_temporal_status

Inspecte la configuration des événements, décisions et exécutions du graphe.

Statut : **Fonction locale, non certifiée individuellement** · groupe `graph` · portée `docker`.
Aucun paramètre déclaré.

### neo4j_temporal_schema

Prépare ou applique les contraintes et index temporels ; l’application exige les droits d’écriture correspondants.

Statut : **Fonction locale, non certifiée individuellement** · groupe `graph` · portée `docker`.

| Paramètre | Type | Obligatoire |
| --- | --- | --- |
| `dryRun` | boolean | non |

### neo4j_temporal_emit_event

Ajoute un événement borné au graphe local autorisé, sans secret.

Statut : **Fonction locale, non certifiée individuellement** · groupe `graph-write` · portée `docker`.

| Paramètre | Type | Obligatoire |
| --- | --- | --- |
| `type` | string | oui |
| `module` | string | oui |
| `status` | string | non |
| `durationMs` | integer / null | non |
| `error` | string / null | non |
| `payload` | object | non |
| `triggeredBy` | string / null | non |
| `runId` | string / null | non |

### neo4j_temporal_emit_decision

Ajoute une décision et une exécution au graphe local autorisé.

Statut : **Fonction locale, non certifiée individuellement** · groupe `graph-write` · portée `docker`.

| Paramètre | Type | Obligatoire |
| --- | --- | --- |
| `agent` | string | oui |
| `query` | string | oui |
| `chosenModules` | array | oui |
| `alternatives` | array | non |
| `reason` | string | oui |
| `score` | number | non |
| `runId` | string | non |
| `triggeredBy` | string | non |

### neo4j_temporal_reliability

Résume les succès et échecs enregistrés dans le graphe pour les modules.

Statut : **Fonction locale, non certifiée individuellement** · groupe `graph` · portée `docker`.

| Paramètre | Type | Obligatoire |
| --- | --- | --- |
| `taskType` | string | non |
| `limit` | integer | non |

### a11_runtime_hooks_status

Indique que le manifeste des extensions métier historiques n’est pas fourni. Une URL de backend ne remplace pas ce manifeste.

Statut : **Service requis non fourni** · groupe `integrations` · portée `docker`.

| Paramètre | Type | Obligatoire |
| --- | --- | --- |
| `includeMarkdown` | boolean | non |

### doctor_status

Contrat de lecture de diagnostics historiques. Adaptateur à qualifier ; ne répare rien.

Statut : **À qualifier** · groupe `qualification` · portée `docker`.
Aucun paramètre déclaré.

### chopper_doctor_status

Contrat de bilan et de conseil de diagnostic. Adaptateur à qualifier ; aucune réparation lancée.

Statut : **À qualifier** · groupe `qualification` · portée `docker`.
Aucun paramètre déclaré.

### piccolo_repair_plan

Prépare un plan de réparation à partir d’un manifeste. Fonction à qualifier ; aucun changement appliqué.

Statut : **À qualifier** · groupe `qualification` · portée `docker`.

| Paramètre | Type | Obligatoire |
| --- | --- | --- |
| `problem` | string | non |

### neo4j_read_query

Exécute une requête Cypher de lecture, avec limites sur les résultats.

Statut : **Fonction locale, non certifiée individuellement** · groupe `graph` · portée `docker`.

| Paramètre | Type | Obligatoire |
| --- | --- | --- |
| `query` | string | oui |
| `params` | object | non |
| `limit` | integer | non |

### graph_write_safe

Crée ou met à jour un nœud d’un type autorisé dans le graphe local. Les propriétés ne doivent pas contenir de secrets.

Statut : **Fonction locale, non certifiée individuellement** · groupe `graph-write` · portée `docker`.

| Paramètre | Type | Obligatoire |
| --- | --- | --- |
| `label` | string | oui |
| `id` | string | oui |
| `props` | object | non |
| `from` | string | oui |
| `reason` | string | oui |
| `dryRun` | boolean | non |

### neo4j_write_query

Contrat d’écriture Cypher générique. Les écritures de ce parcours sont désactivées dans le kit.

Statut : **Action désactivée** · groupe `restricted` · portée `docker`.

| Paramètre | Type | Obligatoire |
| --- | --- | --- |
| `query` | string | oui |
| `params` | object | non |
| `from` | string | oui |
| `reason` | string | oui |
| `dryRun` | boolean | non |
| `readbackQuery` | string | non |
| `readbackParams` | object | non |

### a11_status

Vérifie le backend intégré ou le backend client configuré. Ne certifie pas la connexion à un modèle.

Statut : **Fonction locale, non certifiée individuellement** · groupe `backend` · portée `docker`.
Aucun paramètre déclaré.

### a11_llm_stats

Lit les compteurs de requêtes du processus ou du backend client. Aucun accès à la facturation fournisseur.

Statut : **Fonction locale, non certifiée individuellement** · groupe `backend` · portée `docker`.
Aucun paramètre déclaré.

### a11_chat

Envoie un message au modèle configuré via le backend intégré ou client. Peut être facturé ; le mode intégré ne conserve pas d’historique.

Statut : **Connexion client nécessaire, non validée avec un compte réel** · groupe `backend-chat` · portée `docker`.
Prérequis : llmBaseUrl, llmModel.

| Paramètre | Type | Obligatoire |
| --- | --- | --- |
| `message` | string | oui |
| `conversationId` | string | non |
| `model` | string | non |

### kaen44_status

Vérifie le second backend du client via son endpoint de santé et son accès propre.

Statut : **Connexion client nécessaire, non validée avec un compte réel** · groupe `second-backend` · portée `docker`.
Prérequis : kaen44BackendUrl.
Aucun paramètre déclaré.

### qflush_status

Contrat d’état d’un service QFlush hôte ou distant. Ce service n’est pas fourni.

Statut : **Service requis non fourni** · groupe `host` · portée `docker`.
Aucun paramètre déclaré.

### qflush_sources_status

Contrat d’inventaire de sources image/audio. Services hôtes non fournis ; ne capture ni n’enregistre.

Statut : **Service requis non fourni** · groupe `host` · portée `docker`.

| Paramètre | Type | Obligatoire |
| --- | --- | --- |
| `includeWindows` | boolean | non |
| `includeAudioDevices` | boolean | non |
| `limit` | integer | non |

### qflush_sources_select

Contrat de sélection des sources image/audio d’un pont hôte, non fourni.

Statut : **Service requis non fourni** · groupe `host` · portée `docker`.

| Paramètre | Type | Obligatoire |
| --- | --- | --- |
| `from` | string | non |
| `visionMode` | string | non |
| `titleLike` | string | non |
| `processName` | string | non |
| `id` | integer | non |
| `label` | string | non |
| `audioMode` | string | non |
| `micDevice` | string | non |
| `loopbackDevice` | string | non |
| `chunksDir` | string | non |
| `language` | string | non |
| `provider` | string | non |

### qflush_window_capture

Contrat de capture d’une fenêtre via le pont QFlush. Ce pont n’est pas livré avec Docker.

Statut : **Service requis non fourni** · groupe `host` · portée `docker`.

| Paramètre | Type | Obligatoire |
| --- | --- | --- |
| `titleLike` | string | non |
| `processName` | string | non |
| `id` | integer | non |
| `label` | string | non |
| `path` | string | non |
| `target` | string | non |
| `analyze` | boolean | non |
| `focusBefore` | boolean | non |
| `prompt` | string | non |
| `includeStale` | boolean | non |
| `save` | boolean | non |

### qflush_janus_status

Contrat d’état du service d’analyse visuelle Janus. Service non fourni.

Statut : **Service requis non fourni** · groupe `host` · portée `docker`.
Aucun paramètre déclaré.

### qflush_janus_analyze

Contrat d’analyse d’une capture récente avec Janus. Service et capture non fournis.

Statut : **Service requis non fourni** · groupe `host` · portée `docker`.

| Paramètre | Type | Obligatoire |
| --- | --- | --- |
| `target` | string | non |
| `framePath` | string | non |
| `prompt` | string | non |
| `includeStale` | boolean | non |
| `maxAgeMs` | integer | non |
| `save` | boolean | non |

### qflush_vivy_audio_status

Contrat d’état du service de transcription/analyse audio. Service non fourni.

Statut : **Service requis non fourni** · groupe `host` · portée `docker`.
Aucun paramètre déclaré.

### qflush_vivy_audio_analyze

Contrat d’analyse d’un clip audio récent via un service hôte, non fourni.

Statut : **Service requis non fourni** · groupe `host` · portée `docker`.

| Paramètre | Type | Obligatoire |
| --- | --- | --- |
| `target` | string | non |
| `audioPath` | string | non |
| `includeStale` | boolean | non |
| `maxAgeMs` | integer | non |
| `language` | string | non |
| `provider` | string | non |
| `save` | boolean | non |

### qflush_media_analyze

Contrat d’analyse combinée image et audio. Les services et captures nécessaires ne sont pas fournis.

Statut : **Service requis non fourni** · groupe `host` · portée `docker`.

| Paramètre | Type | Obligatoire |
| --- | --- | --- |
| `target` | string | non |
| `mode` | string | non |
| `includeStale` | boolean | non |
| `maxAgeMs` | integer | non |
| `language` | string | non |
| `provider` | string | non |
| `save` | boolean | non |

### read_backend_logs

Lit une portion des journaux backend accessibles dans les racines locales autorisées ; aucun journal de production n’est fourni.

Statut : **Fonction locale, non certifiée individuellement** · groupe `local` · portée `docker`.

| Paramètre | Type | Obligatoire |
| --- | --- | --- |
| `lines` | integer | non |
| `file` | string | non |

### read_qflush_logs

Lit une portion des journaux QFlush accessibles localement ; leur présence dépend de votre installation.

Statut : **Fonction locale, non certifiée individuellement** · groupe `local` · portée `docker`.

| Paramètre | Type | Obligatoire |
| --- | --- | --- |
| `lines` | integer | non |
| `file` | string | non |

### search

Recherche du texte littéral dans les documents et la mémoire locaux, avec limites et exclusion de chemins liés ou sensibles.

Statut : **Fonction locale, non certifiée individuellement** · groupe `local` · portée `docker`.

| Paramètre | Type | Obligatoire |
| --- | --- | --- |
| `query` | string | oui |
| `scope` | string | non |
| `maxResults` | integer | non |

### fetch

Lit un document local désigné par une URL retournée par la recherche. Ne télécharge pas de page Internet.

Statut : **Fonction locale, non certifiée individuellement** · groupe `local` · portée `docker`.

| Paramètre | Type | Obligatoire |
| --- | --- | --- |
| `url` | string | oui |

### search_project

Recherche du texte littéral dans l’espace de travail client ; les résultats peuvent être partiels.

Statut : **Fonction locale, non certifiée individuellement** · groupe `local` · portée `docker`.

| Paramètre | Type | Obligatoire |
| --- | --- | --- |
| `query` | string | oui |
| `maxResults` | integer | non |

### shared_context_index

Liste les fichiers locaux de contexte partagé accessibles. Aucun compte Drive n’est connecté automatiquement.

Statut : **Fonction locale, non certifiée individuellement** · groupe `local` · portée `docker`.

| Paramètre | Type | Obligatoire |
| --- | --- | --- |
| `maxItems` | integer | non |

### cloud_roots_index

Contrat d’inventaire de dossiers cloud synchronisés. Ces montages ne sont pas fournis par le kit.

Statut : **Service requis non fourni** · groupe `integrations` · portée `docker`.

| Paramètre | Type | Obligatoire |
| --- | --- | --- |
| `root` | string | non |
| `maxItems` | integer | non |

### search_cloud_roots

Contrat de recherche dans des dossiers cloud explicitement montés. Ces montages ne sont pas fournis.

Statut : **Service requis non fourni** · groupe `integrations` · portée `docker`.

| Paramètre | Type | Obligatoire |
| --- | --- | --- |
| `query` | string | oui |
| `root` | string | non |
| `maxResults` | integer | non |

### read_cloud_doc

Contrat de lecture d’un document dans un montage cloud. Montage et synchronisation non fournis.

Statut : **Service requis non fourni** · groupe `integrations` · portée `docker`.

| Paramètre | Type | Obligatoire |
| --- | --- | --- |
| `root` | string | oui |
| `path` | string | oui |

### generated_bucket_status

Vérifie le bucket S3/R2 du client sans révéler ses accès.

Statut : **Connexion client nécessaire, non validée avec un compte réel** · groupe `s3` · portée `docker`.
Prérequis : r2Endpoint, r2AccessKeyId, r2SecretAccessKey, r2Bucket.
Aucun paramètre déclaré.

### generated_bucket_public_url

Contrat de création d’une adresse publique d’objet. Cette configuration de publication n’est pas fournie.

Statut : **Service requis non fourni** · groupe `integrations` · portée `docker`.

| Paramètre | Type | Obligatoire |
| --- | --- | --- |
| `key` | string | oui |

### generated_bucket_list

Liste les objets autorisés du bucket S3/R2 configuré par le client.

Statut : **Connexion client nécessaire, non validée avec un compte réel** · groupe `s3` · portée `docker`.
Prérequis : r2Endpoint, r2AccessKeyId, r2SecretAccessKey, r2Bucket.

| Paramètre | Type | Obligatoire |
| --- | --- | --- |
| `prefix` | string | non |
| `limit` | integer | non |

### generated_bucket_head

Lit les métadonnées d’un objet S3/R2 sans télécharger son contenu.

Statut : **Connexion client nécessaire, non validée avec un compte réel** · groupe `s3` · portée `docker`.
Prérequis : r2Endpoint, r2AccessKeyId, r2SecretAccessKey, r2Bucket.

| Paramètre | Type | Obligatoire |
| --- | --- | --- |
| `key` | string | oui |

### generated_bucket_read_text

Lit un petit objet texte dans le bucket S3/R2 autorisé.

Statut : **Connexion client nécessaire, non validée avec un compte réel** · groupe `s3` · portée `docker`.
Prérequis : r2Endpoint, r2AccessKeyId, r2SecretAccessKey, r2Bucket.

| Paramètre | Type | Obligatoire |
| --- | --- | --- |
| `key` | string | oui |
| `maxBytes` | integer | non |

### generated_bucket_put_text

Contrat de publication d’un texte dans un bucket. Écritures désactivées dans ce kit.

Statut : **Action désactivée** · groupe `restricted` · portée `docker`.

| Paramètre | Type | Obligatoire |
| --- | --- | --- |
| `text` | string | oui |
| `key` | string | non |
| `prefix` | string | non |
| `filename` | string | non |
| `contentType` | string | non |
| `source` | string | non |

### generated_bucket_put_base64

Contrat de publication d’un fichier binaire dans un bucket. Écritures désactivées dans ce kit.

Statut : **Action désactivée** · groupe `restricted` · portée `docker`.

| Paramètre | Type | Obligatoire |
| --- | --- | --- |
| `base64` | string | oui |
| `key` | string | non |
| `prefix` | string | non |
| `filename` | string | non |
| `contentType` | string | non |
| `source` | string | non |

### read_shared_doc

Lit un document texte dans une racine locale de partage ou de mémoire autorisée.

Statut : **Fonction locale, non certifiée individuellement** · groupe `local` · portée `docker`.

| Paramètre | Type | Obligatoire |
| --- | --- | --- |
| `namespace` | string | oui |
| `path` | string | oui |

### explain_env

Prévoit un résumé masqué de présence de configuration. Adaptateur restant à qualifier.

Statut : **À qualifier** · groupe `qualification` · portée `docker`.
Aucun paramètre déclaré.

### cloudflare_verify_token

Vérifie la validité et la portée du jeton Cloudflare fourni par le client, sans le retourner.

Statut : **Connexion client nécessaire, non validée avec un compte réel** · groupe `cloudflare` · portée `docker`.
Prérequis : cloudflareToken, cloudflareAccountId.
Aucun paramètre déclaré.

### cloudflare_list_zones

Liste les domaines accessibles avec le jeton Cloudflare du client.

Statut : **Connexion client nécessaire, non validée avec un compte réel** · groupe `cloudflare` · portée `docker`.
Prérequis : cloudflareToken, cloudflareAccountId.
Aucun paramètre déclaré.

### cloudflare_list_dns_records

Liste les enregistrements DNS d’une zone Cloudflare accessible.

Statut : **Connexion client nécessaire, non validée avec un compte réel** · groupe `cloudflare` · portée `docker`.
Prérequis : cloudflareToken, cloudflareAccountId.

| Paramètre | Type | Obligatoire |
| --- | --- | --- |
| `zoneId` | string | oui |

### cloudflare_list_tunnels

Liste les tunnels Cloudflare du compte client.

Statut : **Connexion client nécessaire, non validée avec un compte réel** · groupe `cloudflare` · portée `docker`.
Prérequis : cloudflareToken, cloudflareAccountId.

| Paramètre | Type | Obligatoire |
| --- | --- | --- |
| `accountId` | string | non |

### cloudflare_list_access_apps

Liste les applications Cloudflare Access du compte client.

Statut : **Connexion client nécessaire, non validée avec un compte réel** · groupe `cloudflare` · portée `docker`.
Prérequis : cloudflareToken, cloudflareAccountId.

| Paramètre | Type | Obligatoire |
| --- | --- | --- |
| `accountId` | string | non |

### cloudflare_list_r2_buckets

Liste les buckets R2 du compte client. La lecture des objets utilise les outils generated_bucket.

Statut : **Connexion client nécessaire, non validée avec un compte réel** · groupe `cloudflare` · portée `docker`.
Prérequis : cloudflareToken, cloudflareAccountId.

| Paramètre | Type | Obligatoire |
| --- | --- | --- |
| `accountId` | string | non |

### hetzner_list_servers

Liste les serveurs dédiés du compte client via Hetzner Robot, et non Hetzner Cloud.

Statut : **Connexion client nécessaire, non validée avec un compte réel** · groupe `hetzner` · portée `docker`.
Prérequis : hetznerUser, hetznerPassword.
Aucun paramètre déclaré.

### hetzner_get_rescue

Vérifie l’état du mode secours d’un serveur dédié sans retourner son mot de passe.

Statut : **Connexion client nécessaire, non validée avec un compte réel** · groupe `hetzner` · portée `docker`.
Prérequis : hetznerUser, hetznerPassword.

| Paramètre | Type | Obligatoire |
| --- | --- | --- |
| `serverNumber` | string | oui |

### cloudflare_create_dns_record

Contrat d’ajout d’un enregistrement DNS public. Mutations d’infrastructure désactivées.

Statut : **Action désactivée** · groupe `restricted` · portée `docker`.

| Paramètre | Type | Obligatoire |
| --- | --- | --- |
| `zoneId` | string | oui |
| `type` | string | oui |
| `name` | string | oui |
| `content` | string | oui |
| `ttl` | integer | non |
| `proxied` | boolean | non |

### hetzner_reboot

Contrat de redémarrage matériel d’un serveur dédié via Hetzner Robot. Action désactivée dans le kit.

Statut : **Action désactivée** · groupe `restricted` · portée `docker`.

| Paramètre | Type | Obligatoire |
| --- | --- | --- |
| `serverNumber` | string | oui |
| `confirm` | string | oui |

### kit_status

Lit la version locale et la liste des modules activés, sans retourner de clés.

Statut : **Fonction locale, non certifiée individuellement** · groupe `kit` · portée `docker`.
Aucun paramètre déclaré.

### kit_readiness

Liste les prérequis et configurations manquantes sans contacter les fournisseurs. Configuration ne signifie pas validation.

Statut : **Fonction locale, non certifiée individuellement** · groupe `kit` · portée `docker`.
Aucun paramètre déclaré.

### kit_diagnostics

Teste localement une réduction de procédure, un aller-retour chiffré et une lecture authentifiée du graphe.

Statut : **Fonction locale, non certifiée individuellement** · groupe `kit` · portée `docker`.
Aucun paramètre déclaré.

### kit_catalog

Liste les paquets installés et leur mode d’activation. Ne prouve pas la disponibilité des connexions externes.

Statut : **Fonction locale, non certifiée individuellement** · groupe `kit` · portée `docker`.
Aucun paramètre déclaré.

### assistant_chat

Envoie un texte à l’API de modèle configurée par le client. Configuration, accès réseau et éventuels crédits fournisseur requis.

Statut : **Connexion client nécessaire, non validée avec un compte réel** · groupe `model` · portée `docker`.
Prérequis : llmBaseUrl, llmModel.

| Paramètre | Type | Obligatoire |
| --- | --- | --- |
| `prompt` | string | oui |

### plan_reduce

Réduit une procédure textuelle par règles déterministes en conservant les contrôles identifiés. N’exécute pas le plan.

Statut : **Appel MCP vérifié** · groupe `plans` · portée `docker`.

| Paramètre | Type | Obligatoire |
| --- | --- | --- |
| `steps` | string | oui |
| `objective` | string | non |

### archive_encode

Chiffre au plus 64 Kio de texte avec la clé privée de l’installation et retourne une archive encodée en base64.

Statut : **Appel MCP vérifié** · groupe `archives` · portée `docker`.

| Paramètre | Type | Obligatoire |
| --- | --- | --- |
| `text` | string | oui |

### archive_decode

Déchiffre une archive avec la clé de la même installation. Ne lit ni n’écrit de fichier.

Statut : **Appel MCP vérifié** · groupe `archives` · portée `docker`.

| Paramètre | Type | Obligatoire |
| --- | --- | --- |
| `archive` | string | oui |

### desktop_status

Lit la plateforme et les processus autorisés, sans parcourir les fenêtres.

Statut : **Agent Windows facultatif, installation distincte** · groupe `desktop` · portée `windows-host`.
Prérequis : Windows, Node.js 24, process allowlist, separate stdio MCP configuration.
Aucun paramètre déclaré.

### desktop_windows

Liste la première fenêtre visible de chaque processus explicitement autorisé.

Statut : **Agent Windows facultatif, installation distincte** · groupe `desktop` · portée `windows-host`.
Prérequis : Windows, Node.js 24, process allowlist, separate stdio MCP configuration.
Aucun paramètre déclaré.

### desktop_capture

Capture la première fenêtre visible du processus autorisé indiqué. Retourne un PNG au client MCP ; aucune capture plein écran de repli.

Statut : **Agent Windows facultatif, installation distincte** · groupe `desktop` · portée `windows-host`.
Prérequis : Windows, Node.js 24, process allowlist, separate stdio MCP configuration.

| Paramètre | Type | Obligatoire |
| --- | --- | --- |
| `processId` | integer | oui |

## Limites de la qualification

Les diagnostics effectuent aussi une lecture authentifiée du Neo4j local. Ils ne valident pas toutes les écritures de graphe ni tous les adaptateurs. Le backend intégré traite chaque message indépendamment. OAuth MCP est limité aux clients locaux et les autorisations de session expirent au redémarrage. Google/Twitch valident uniquement l’identité ; leurs fonctions de publication et lecture de fichiers ne sont pas incluses. L’agent Windows fournit inventaire et capture, sans pilotage clavier/souris ni enregistrement audio. Aucun agent Linux ou exécutant de tâches n’est fourni.

Sources : manifeste catalog.json, métadonnées/README des versions installées, réponse tools/list du kit Docker 0.11.0, kit_readiness, docs/DESKTOP-AGENT.md. Aucun secret ni valeur de configuration privée n’est publié.
