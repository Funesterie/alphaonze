# Bugfix Requirements Document

## Introduction

L'API A11 retourne une erreur 502 (`column "fact_key" does not exist`) lors de tout appel au pipeline de chat. La cause racine est un désalignement de schéma entre deux sources de vérité :

- **`init-db.cjs`** (script de migration exécuté sur Railway) définit la table `user_facts` avec une colonne `fact` (ancien schéma simplifié).
- **`server.cjs`** (runtime) tente de créer et d'interroger `user_facts` avec les colonnes `fact_key`, `fact_value`, `confidence`, `source`, `last_seen_at`, `last_used_at` (nouveau schéma enrichi).

Comme `init-db.cjs` a été exécuté en premier sur Railway (ou que la table existait déjà avec l'ancien schéma), la colonne `fact_key` est absente de la base de données PostgreSQL de production. Toute requête SQL qui référence `fact_key` échoue avec une erreur 502.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN un utilisateur envoie un message au chat A11 THEN le système retourne une erreur 502 avec le message `column "fact_key" does not exist`

1.2 WHEN le serveur tente d'insérer ou de lire des faits utilisateur (`user_facts`) THEN le système échoue avec une erreur PostgreSQL car la colonne `fact_key` n'existe pas dans la table en production

1.3 WHEN `init-db.cjs` est exécuté sur une base vierge THEN le système crée `user_facts` avec le schéma ancien (`fact TEXT`) au lieu du schéma attendu par `server.cjs` (`fact_key TEXT NOT NULL`, `fact_value TEXT NOT NULL`, etc.)

### Expected Behavior (Correct)

2.1 WHEN un utilisateur envoie un message au chat A11 THEN le système SHALL traiter la requête sans erreur 502 liée à la colonne `fact_key`

2.2 WHEN le serveur tente d'insérer ou de lire des faits utilisateur THEN le système SHALL exécuter les requêtes SQL sur `fact_key` et `fact_value` sans erreur, car ces colonnes existent dans la table `user_facts` en production

2.3 WHEN `init-db.cjs` est exécuté sur une base vierge ou existante THEN le système SHALL créer ou migrer `user_facts` avec le schéma complet attendu par `server.cjs` : colonnes `fact_key`, `fact_value`, `confidence`, `relevance_score`, `source`, `last_seen_at`, `last_used_at`, et la contrainte `UNIQUE (user_id, fact_key)`

### Unchanged Behavior (Regression Prevention)

3.1 WHEN un utilisateur s'authentifie et envoie un message THEN le système SHALL CONTINUE TO retourner une réponse LLM valide via le pipeline de chat

3.2 WHEN la table `user_facts` contient des données existantes avec l'ancien schéma (`fact TEXT`) THEN le système SHALL CONTINUE TO démarrer sans perte de données (migration additive, pas destructive)

3.3 WHEN les autres tables (`users`, `messages`, `user_memory`, `files`, `user_tasks`, etc.) sont interrogées THEN le système SHALL CONTINUE TO fonctionner normalement sans régression

3.4 WHEN `init-db.cjs` est exécuté plusieurs fois (idempotence) THEN le système SHALL CONTINUE TO ne pas échouer ni dupliquer les colonnes ou index existants
