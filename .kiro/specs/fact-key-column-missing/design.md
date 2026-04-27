# fact-key-column-missing Bugfix Design

## Overview

Le bug provient d'un désalignement de schéma entre deux sources de vérité :

- **`init-db.cjs`** (script de migration Railway) crée `user_facts` avec l'ancien schéma simplifié : une seule colonne `fact TEXT`.
- **`server.cjs`** (runtime) attend le schéma enrichi : `fact_key TEXT NOT NULL`, `fact_value TEXT NOT NULL`, `confidence`, `relevance_score`, `source`, `last_seen_at`, `last_used_at`, et la contrainte `UNIQUE (user_id, fact_key)`.

Quand `init-db.cjs` est exécuté en premier sur Railway (ou que la table existe déjà avec l'ancien schéma), la colonne `fact_key` est absente. Toute requête SQL qui la référence échoue avec `column "fact_key" does not exist`, provoquant une erreur 502 sur l'ensemble du pipeline de chat.

La correction consiste à mettre à jour `init-db.cjs` pour qu'il crée ou migre `user_facts` vers le schéma complet attendu par `server.cjs`, de façon **additive** (sans perte de données) et **idempotente** (sans erreur si exécuté plusieurs fois).

## Glossary

- **Bug_Condition (C)** : La condition qui déclenche le bug — `init-db.cjs` est exécuté et la table `user_facts` résultante ne possède pas la colonne `fact_key`.
- **Property (P)** : Le comportement attendu après correction — après exécution de `init-db.cjs`, la table `user_facts` possède toutes les colonnes requises par `server.cjs`.
- **Preservation** : Les comportements existants qui ne doivent pas être altérés par la correction — les données existantes, les autres tables, et l'idempotence du script.
- **`init-db.cjs`** : Script Node.js dans `a11/backend/apps/server/` exécuté comme commande de démarrage sur Railway pour initialiser le schéma PostgreSQL.
- **`server.cjs`** : Serveur Express.js principal dans `a11/backend/apps/server/` qui contient le schéma de référence pour `user_facts` et toutes les requêtes SQL runtime.
- **Schéma enrichi** : Le schéma complet de `user_facts` tel que défini dans `server.cjs` : `fact_key`, `fact_value`, `confidence`, `relevance_score`, `source`, `last_seen_at`, `last_used_at`, `UNIQUE (user_id, fact_key)`.
- **Migration additive** : Ajout de colonnes sans supprimer ni modifier les colonnes existantes ni les données.
- **Idempotence** : Propriété d'une opération qui peut être exécutée plusieurs fois sans effet de bord supplémentaire (utilisation de `ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`, etc.).

## Bug Details

### Bug Condition

Le bug se manifeste quand `init-db.cjs` est exécuté sur une base de données vierge ou sur une base contenant déjà `user_facts` avec l'ancien schéma. Le script crée ou laisse en place une table `user_facts` sans la colonne `fact_key`, alors que `server.cjs` en a besoin pour toutes ses opérations sur les faits utilisateur.

**Formal Specification:**

```
FUNCTION isBugCondition(tableSchema)
  INPUT: tableSchema — liste des colonnes de la table user_facts après exécution de init-db.cjs
  OUTPUT: boolean

  RETURN 'fact_key' NOT IN tableSchema.columnNames
END FUNCTION
```

### Examples

- **Cas 1 — Base vierge** : `init-db.cjs` exécuté sur une base vide → crée `user_facts` avec `fact TEXT` → `fact_key` absente → `server.cjs` échoue avec `column "fact_key" does not exist` à la première requête sur `user_facts`.
- **Cas 2 — Base existante avec ancien schéma** : La table `user_facts` existe déjà avec `fact TEXT` → `CREATE TABLE IF NOT EXISTS` ne fait rien → `fact_key` toujours absente → même erreur 502.
- **Cas 3 — Exécution répétée** : `init-db.cjs` exécuté deux fois → sans `IF NOT EXISTS` sur les `ALTER TABLE`, la deuxième exécution échoue avec `column already exists`.
- **Cas 4 — Données existantes** : Des lignes existent dans `user_facts` avec l'ancien schéma → une migration destructive (`DROP TABLE`) causerait une perte de données.

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**

- Les données existantes dans `user_facts` (lignes avec l'ancien schéma `fact TEXT`) doivent être préservées — la migration est additive, pas destructive.
- Les autres tables (`users`, `messages`, `user_memory`, `files`, `user_tasks`, `conversation_resources`, etc.) ne doivent pas être affectées.
- Le script `init-db.cjs` doit rester idempotent : une deuxième exécution ne doit pas échouer ni dupliquer des colonnes ou des index.
- La création de l'admin par défaut (`Djeff`) doit continuer à fonctionner normalement.

**Scope:**
Tous les inputs qui ne concernent pas la table `user_facts` (autres tables, autres scripts, pipeline de chat pour des requêtes non liées aux faits) doivent être complètement inaffectés par cette correction.

**Note:** Le comportement correct attendu après correction est défini dans la section Correctness Properties (Property 1).

## Hypothesized Root Cause

Sur la base de l'analyse du bug, les causes les plus probables sont :

1. **Schéma obsolète dans `init-db.cjs`** : La définition de `user_facts` dans `init-db.cjs` n'a pas été mise à jour quand `server.cjs` a évolué vers le schéma enrichi. C'est la cause principale et la plus probable.
   - `init-db.cjs` définit : `fact TEXT, relevance_score FLOAT`
   - `server.cjs` attend : `fact_key TEXT NOT NULL, fact_value TEXT NOT NULL, confidence REAL, relevance_score REAL, source TEXT, last_seen_at TIMESTAMP, last_used_at TIMESTAMP, UNIQUE(user_id, fact_key)`

2. **Absence de migration additive** : `init-db.cjs` utilise uniquement `CREATE TABLE IF NOT EXISTS`, ce qui ne modifie pas une table existante. Il n'y a aucun `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` pour les colonnes manquantes.

3. **Divergence de type** : `relevance_score` est défini comme `FLOAT` dans `init-db.cjs` mais comme `REAL` dans `server.cjs`. Ce n'est pas bloquant (FLOAT et REAL sont compatibles en PostgreSQL) mais c'est une incohérence.

4. **Index manquant** : L'index `idx_user_facts_user_updated ON user_facts (user_id, updated_at DESC)` présent dans `server.cjs` est absent de `init-db.cjs`.

## Correctness Properties

Property 1: Bug Condition - Colonnes requises présentes après migration

_For any_ exécution de `init-db.cjs` sur une base vierge ou une base avec l'ancien schéma `user_facts`, la fonction de migration SHALL produire une table `user_facts` contenant toutes les colonnes requises par `server.cjs` : `fact_key`, `fact_value`, `confidence`, `relevance_score`, `source`, `last_seen_at`, `last_used_at`, ainsi que la contrainte `UNIQUE (user_id, fact_key)`.

**Validates: Requirements 2.2, 2.3**

Property 2: Preservation - Idempotence et non-destruction des données

_For any_ exécution répétée de `init-db.cjs` sur une base déjà migrée, et pour toute base contenant des données existantes dans `user_facts`, le script SHALL terminer sans erreur, sans dupliquer de colonnes ou d'index, et sans supprimer ni modifier les données existantes.

**Validates: Requirements 3.2, 3.4**

## Fix Implementation

### Changes Required

La correction est localisée dans un seul fichier.

**File**: `funesterie/a11/backend/apps/server/init-db.cjs`

**Function**: Tableau `tables` — entrée `user_facts`

**Specific Changes**:

1. **Remplacer la définition `CREATE TABLE IF NOT EXISTS user_facts`** : Remplacer l'ancien schéma (`fact TEXT`) par le schéma complet attendu par `server.cjs` :

   ```sql
   CREATE TABLE IF NOT EXISTS user_facts (
     id SERIAL PRIMARY KEY,
     user_id TEXT NOT NULL,
     fact_key TEXT NOT NULL,
     fact_value TEXT NOT NULL,
     confidence REAL,
     relevance_score REAL DEFAULT 0.5,
     source TEXT,
     created_at TIMESTAMP DEFAULT NOW(),
     updated_at TIMESTAMP DEFAULT NOW(),
     last_seen_at TIMESTAMP DEFAULT NOW(),
     last_used_at TIMESTAMP,
     UNIQUE (user_id, fact_key)
   )
   ```

2. **Ajouter des migrations additives `ALTER TABLE`** : Après le `CREATE TABLE IF NOT EXISTS`, ajouter des instructions `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` pour chaque colonne du nouveau schéma. Cela couvre le cas où la table existe déjà avec l'ancien schéma :

   ```sql
   ALTER TABLE user_facts ADD COLUMN IF NOT EXISTS fact_key TEXT;
   ALTER TABLE user_facts ADD COLUMN IF NOT EXISTS fact_value TEXT;
   ALTER TABLE user_facts ADD COLUMN IF NOT EXISTS confidence REAL;
   ALTER TABLE user_facts ADD COLUMN IF NOT EXISTS source TEXT;
   ALTER TABLE user_facts ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMP DEFAULT NOW();
   ALTER TABLE user_facts ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMP;
   ```

3. **Ajouter l'index manquant** : Ajouter l'entrée pour `idx_user_facts_user_updated` qui est présent dans `server.cjs` mais absent de `init-db.cjs` :

   ```sql
   CREATE INDEX IF NOT EXISTS idx_user_facts_user_updated
     ON user_facts (user_id, updated_at DESC)
   ```

4. **Conserver l'index existant** : L'entrée `idx_user_facts` (`idx_user_facts_user_relevance`) est déjà présente dans `init-db.cjs` — la conserver telle quelle.

5. **Ne pas toucher aux autres tables** : Toutes les autres entrées du tableau `tables` restent inchangées.

**Note sur la contrainte UNIQUE** : `ADD CONSTRAINT IF NOT EXISTS` n'est pas supporté directement en PostgreSQL < 9.5 pour les contraintes nommées. On utilisera une approche conditionnelle via `DO $$ ... $$` ou on s'appuiera sur le fait que `CREATE TABLE IF NOT EXISTS` avec `UNIQUE` dans la définition initiale suffit pour les nouvelles bases, et que les `ALTER TABLE ADD COLUMN IF NOT EXISTS` suffisent pour les bases existantes (la contrainte UNIQUE ne peut pas être ajoutée sans risque sur des données potentiellement dupliquées — à documenter comme limitation connue).

## Testing Strategy

### Validation Approach

La stratégie de test suit une approche en deux phases : d'abord vérifier que le bug est bien reproductible sur le code non corrigé (exploration), puis vérifier que la correction fonctionne et ne casse rien (fix checking + preservation checking).

### Exploratory Bug Condition Checking

**Goal**: Démontrer que `init-db.cjs` non corrigé produit une table `user_facts` sans la colonne `fact_key`. Confirmer ou infirmer l'analyse de cause racine.

**Test Plan**: Écrire un test qui exécute la logique de création de table de `init-db.cjs` sur une base de test en mémoire (ou mock), puis inspecte le schéma résultant pour vérifier l'absence de `fact_key`. Exécuter ce test sur le code NON CORRIGÉ pour observer l'échec.

**Test Cases**:

1. **Test schéma vierge** : Simuler l'exécution du `CREATE TABLE IF NOT EXISTS user_facts` de `init-db.cjs` et vérifier que `fact_key` est absente (confirmera le bug sur code non corrigé).
2. **Test requête runtime** : Simuler l'INSERT de `server.cjs` sur `user_facts` avec `fact_key` et vérifier qu'il échoue avec `column "fact_key" does not exist` (confirmera l'impact du bug).
3. **Test base existante** : Simuler une table `user_facts` existante avec `fact TEXT` et vérifier que `init-db.cjs` ne la migre pas (confirmera le cas 2 du bug).

**Expected Counterexamples**:

- La colonne `fact_key` est absente du schéma créé par `init-db.cjs` non corrigé.
- Cause confirmée : la définition `CREATE TABLE IF NOT EXISTS user_facts` dans `init-db.cjs` utilise l'ancien schéma et il n'y a pas de `ALTER TABLE` pour les colonnes manquantes.

### Fix Checking

**Goal**: Vérifier que pour tous les inputs où la condition de bug est vraie (table sans `fact_key`), le script corrigé produit le comportement attendu.

**Pseudocode:**

```
FOR ALL dbState WHERE isBugCondition(getTableSchema('user_facts', dbState)) DO
  run initDbCjs_fixed(dbState)
  schema := getTableSchema('user_facts', dbState)
  ASSERT 'fact_key' IN schema.columnNames
  ASSERT 'fact_value' IN schema.columnNames
  ASSERT 'confidence' IN schema.columnNames
  ASSERT 'last_seen_at' IN schema.columnNames
  ASSERT 'last_used_at' IN schema.columnNames
  ASSERT UNIQUE_CONSTRAINT('user_id', 'fact_key') IN schema.constraints
END FOR
```

### Preservation Checking

**Goal**: Vérifier que pour tous les inputs où la condition de bug ne s'applique pas (table déjà correcte, autres tables, exécutions répétées), le script corrigé produit le même résultat que l'original.

**Pseudocode:**

```
FOR ALL dbState WHERE NOT isBugCondition(getTableSchema('user_facts', dbState)) DO
  result_original := initDbCjs_original(dbState)
  result_fixed    := initDbCjs_fixed(dbState)
  ASSERT result_fixed.otherTables = result_original.otherTables
  ASSERT result_fixed.rowCount('user_facts') = result_original.rowCount('user_facts')
  ASSERT result_fixed.exitCode = 0
END FOR
```

**Testing Approach**: Les tests basés sur les propriétés (PBT) sont recommandés pour le preservation checking car :

- Ils génèrent automatiquement de nombreux états de base de données différents.
- Ils couvrent les cas limites (table vide, table avec données, exécutions répétées).
- Ils fournissent une garantie forte que le comportement est inchangé pour tous les inputs non-buggy.

**Test Cases**:

1. **Idempotence** : Exécuter `init-db.cjs` corrigé deux fois de suite et vérifier qu'il ne retourne pas d'erreur et ne duplique pas de colonnes.
2. **Préservation des données** : Insérer des lignes dans `user_facts` (ancien schéma), exécuter la migration, vérifier que les lignes sont toujours présentes.
3. **Autres tables inaffectées** : Vérifier que `users`, `messages`, `user_memory`, `files`, `user_tasks` ont le même schéma avant et après la migration.

### Unit Tests

- Tester que le `CREATE TABLE IF NOT EXISTS user_facts` corrigé contient bien `fact_key TEXT NOT NULL`.
- Tester que les `ALTER TABLE ADD COLUMN IF NOT EXISTS` sont présents pour chaque colonne du nouveau schéma.
- Tester le cas d'une table existante avec l'ancien schéma : après migration, toutes les colonnes requises sont présentes.
- Tester le cas d'une exécution répétée : pas d'erreur, pas de doublon.

### Property-Based Tests

- Générer des états de base de données aléatoires (table absente, table avec ancien schéma, table avec nouveau schéma) et vérifier que `fact_key` est toujours présente après migration.
- Générer des configurations de données existantes dans `user_facts` et vérifier que le nombre de lignes est préservé après migration.
- Tester que pour tout état initial, une double exécution de `init-db.cjs` produit le même résultat final qu'une exécution unique.

### Integration Tests

- Exécuter `init-db.cjs` corrigé contre une base PostgreSQL de test, puis exécuter les requêtes SQL de `server.cjs` sur `user_facts` et vérifier qu'elles réussissent.
- Tester le flux complet : migration → démarrage de `server.cjs` → appel au pipeline de chat → pas d'erreur 502.
- Tester la migration sur une base contenant des données avec l'ancien schéma et vérifier l'absence de perte de données.
