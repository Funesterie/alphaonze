# Audit de réalité — BLOOP, SCENT GATE et EKKO

Date de vérification : 2026-08-05

Ce document tranche le conflit entre le récapitulatif « EKKO des baleines » et les contrats déjà présents dans le dépôt. Le code existant reste la source de vérité.

## Ce qui existait réellement

### BLOOP

`scripts/nossen/nossen-bloop.cjs` est un sonar de mémoire et d'intégrité Neo4j. Il relit des empreintes déjà enregistrées, vérifie uniquement des chemins et URL autorisés, puis écrit un rapport borné dans `runtime/nossen/bloop`.

Il ne génère pas de secrets, ne brute-force rien et n'est pas un protocole de notification de jobs. Le « petit signal signé JOB_READY » du récapitulatif était donc une proposition, pas le BLOOP existant.

### SCENT GATE

`@nossen/scentgate` est une capsule de recherche éphémère : contexte borné, durée de vie courte, aucun shell, aucun socket Docker, destruction en sortie et aucune conservation des bruts.

La version 2.1.0 ajoute un sous-contrat compatible de signaux de jobs fermés et signés :

- types autorisés uniquement : `job.completed`, `job.failed`, `job.cancelled` ;
- HMAC-SHA-256 avec secret serveur d'au moins 32 octets ;
- audience exacte, expiration courte et nonce anti-rejeu ;
- empreinte SHA-256 du résultat terminé ;
- aucun texte libre exécutable et aucun secret dans l'enveloppe.

Ce sous-contrat ne renomme ni BLOOP, ni EKKO, ni la capsule SCENT GATE historique.

### EKKO

`a11/backend/apps/ekko` et `src/routes/ekko.cjs` forment un module d'écoute audio système : capture, VAD/transcription, ingestion d'événements et effacement privé. EKKO n'était pas une couche de transport générique au-dessus de Discord, Telegram et MCP.

Le terme « EKKO des baleines » est donc une idée d'architecture en collision avec un module réel. Il ne doit pas remplacer le contrat existant sans migration et nouveau nom explicites.

## Ce qui est retenu du récapitulatif

Le diagnostic 524 est valide : une génération longue ne doit pas garder une requête Cloudflare ouverte. La route V11Pan applique désormais le motif sûr :

1. `POST` authentifié ;
2. réservation atomique du quota du compte ;
3. réponse immédiate `202` avec `jobId` et `statusUrl` ;
4. traitement en arrière-plan à concurrence bornée ;
5. polling authentifié et isolé par propriétaire ;
6. signal SCENT GATE signé à la fin, en échec ou à l'annulation.

QFlush reste une option de file distribuée future. La mise en production actuelle n'invente pas une dépendance QFlush si la file locale bornée suffit au job V11Pan.

## Frontière persona / couleur sonore

L'ADN persona décrit l'identité, le comportement, la voix et le langage. La couleur sonore décrit une chanson. Si l'utilisateur ne choisit aucune couleur, le champ reste vide et Vivy choisit depuis la matière du morceau. Une couleur Pulsar portée par un Holocron est un attribut symbolique de persona, pas un décor musical automatique.
