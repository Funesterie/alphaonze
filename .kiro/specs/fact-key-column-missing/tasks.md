# Implementation Plan

- [x] 1. Write bug condition exploration test
  - **Property 1: Bug Condition** - fact_key Column Missing After init-db.cjs
  - **CRITICAL**: This test MUST FAIL on unfixed code — failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior — it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate que init-db.cjs crée user_facts sans la colonne fact_key
  - **Scoped PBT Approach**: Scope the property to the three concrete failing cases (base vierge, base avec ancien schéma, exécution répétée) for reproducibility
  - Create test file: `test/init-db-schema.node.test.cjs`
  - Use Node.js native test runner (`node:test` + `node:assert/strict`) — same pattern as existing tests
  - **Test Case 1 — Base vierge**: Parse the `CREATE TABLE IF NOT EXISTS user_facts` SQL string from `init-db.cjs` and assert that `fact_key` is present in the column list → FAILS on unfixed code (only `fact TEXT` is defined)
  - **Test Case 2 — Base existante avec ancien schéma**: Verify that `init-db.cjs` contains `ALTER TABLE user_facts ADD COLUMN IF NOT EXISTS fact_key` → FAILS on unfixed code (no ALTER TABLE for fact_key)
  - **Test Case 3 — Requête runtime**: Verify that the INSERT SQL in `server.cjs` references `fact_key` and that the CREATE TABLE in `init-db.cjs` does NOT define it → FAILS on unfixed code (confirms the mismatch)
  - Run test on UNFIXED code: `node --test ./test/init-db-schema.node.test.cjs`
  - **EXPECTED OUTCOME**: Tests FAIL (this is correct — it proves the bug exists)
  - Document counterexamples found: e.g., "init-db.cjs defines user_facts with `fact TEXT` only — fact_key absent"
  - Mark task complete when test is written, run, and failure is documented
  - _Requirements: 1.1, 1.2, 1.3_

- [x] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - Idempotence and Non-Destructive Migration
  - **IMPORTANT**: Follow observation-first methodology — observe behavior on UNFIXED code for non-buggy inputs
  - Add preservation tests to `test/init-db-schema.node.test.cjs`
  - **Observe on unfixed code**:
    - The SQL for `users`, `messages`, `user_memory`, `files`, `user_tasks`, `conversation_resources` tables is unchanged
    - The `CREATE TABLE IF NOT EXISTS` pattern is used throughout (idempotent by design)
    - The `CREATE INDEX IF NOT EXISTS` pattern is used for all indexes (idempotent by design)
    - The admin creation uses `ON CONFLICT DO NOTHING` (idempotent by design)
  - **Property 2a — Autres tables inaffectées**: Parse all `CREATE TABLE IF NOT EXISTS` SQL strings from `init-db.cjs` for tables other than `user_facts` and assert their column definitions are unchanged (users, messages, user_memory, files, user_tasks, conversation_resources, a11_pending_clarifications, a11_external_resource_cache)
  - **Property 2b — Idempotence syntaxique**: Assert that every `ALTER TABLE` statement in `init-db.cjs` uses `ADD COLUMN IF NOT EXISTS` (not `ADD COLUMN`) — ensures no error on repeated execution
  - **Property 2c — Index idempotents**: Assert that every `CREATE INDEX` statement in `init-db.cjs` uses `CREATE INDEX IF NOT EXISTS` — ensures no error on repeated execution
  - Run tests on UNFIXED code: `node --test ./test/init-db-schema.node.test.cjs`
  - **EXPECTED OUTCOME**: Preservation tests PASS on unfixed code (confirms baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [x] 3. Fix init-db.cjs — schéma complet user_facts + migrations additives + index manquant
  - [x] 3.1 Remplacer la définition CREATE TABLE user_facts dans init-db.cjs
    - Ouvrir `funesterie/a11/backend/apps/server/init-db.cjs`
    - Remplacer l'entrée `user_facts` dans le tableau `tables` par le schéma complet attendu par `server.cjs` :
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
    - _Bug_Condition: isBugCondition(tableSchema) → 'fact_key' NOT IN tableSchema.columnNames_
    - _Expected_Behavior: après exécution, user_facts contient fact_key, fact_value, confidence, relevance_score, source, last_seen_at, last_used_at, UNIQUE(user_id, fact_key)_
    - _Requirements: 2.2, 2.3_

  - [x] 3.2 Ajouter les migrations additives ALTER TABLE après le CREATE TABLE
    - Ajouter les entrées suivantes dans le tableau `tables`, après l'entrée `user_facts` et avant `idx_user_facts` :
      ```javascript
      { name: 'migrate_user_facts_fact_key',    sql: `ALTER TABLE user_facts ADD COLUMN IF NOT EXISTS fact_key TEXT` },
      { name: 'migrate_user_facts_fact_value',  sql: `ALTER TABLE user_facts ADD COLUMN IF NOT EXISTS fact_value TEXT` },
      { name: 'migrate_user_facts_confidence',  sql: `ALTER TABLE user_facts ADD COLUMN IF NOT EXISTS confidence REAL` },
      { name: 'migrate_user_facts_source',      sql: `ALTER TABLE user_facts ADD COLUMN IF NOT EXISTS source TEXT` },
      { name: 'migrate_user_facts_last_seen',   sql: `ALTER TABLE user_facts ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMP DEFAULT NOW()` },
      { name: 'migrate_user_facts_last_used',   sql: `ALTER TABLE user_facts ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMP` },
      ```
    - Ces instructions couvrent le cas où la table existe déjà avec l'ancien schéma (`fact TEXT`)
    - Chaque instruction utilise `ADD COLUMN IF NOT EXISTS` pour garantir l'idempotence
    - _Preservation: migration additive — aucune colonne ni donnée existante n'est supprimée_
    - _Requirements: 2.3, 3.2, 3.4_

  - [x] 3.3 Ajouter l'index manquant idx_user_facts_user_updated
    - Ajouter l'entrée suivante dans le tableau `tables`, après les migrations ALTER TABLE et avant ou après `idx_user_facts` :
      ```javascript
      { name: 'idx_user_facts_updated', sql: `CREATE INDEX IF NOT EXISTS idx_user_facts_user_updated ON user_facts (user_id, updated_at DESC)` },
      ```
    - Cet index est présent dans `server.cjs` (ligne ~1266) mais absent de `init-db.cjs`
    - _Requirements: 2.3_

  - [x] 3.4 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - fact_key Column Present After Migration
    - **IMPORTANT**: Re-run the SAME test from task 1 — do NOT write a new test
    - The test from task 1 encodes the expected behavior (fact_key present, ALTER TABLE present, no mismatch)
    - Run: `node --test ./test/init-db-schema.node.test.cjs`
    - **EXPECTED OUTCOME**: Tests PASS (confirms bug is fixed — fact_key is now defined in init-db.cjs)
    - _Requirements: 2.2, 2.3_

  - [x] 3.5 Verify preservation tests still pass
    - **Property 2: Preservation** - Other Tables and Idempotence Unchanged
    - **IMPORTANT**: Re-run the SAME tests from task 2 — do NOT write new tests
    - Run: `node --test ./test/init-db-schema.node.test.cjs`
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions — other tables untouched, idempotence preserved)
    - Confirm all tests still pass after fix (no regressions)
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [x] 4. Checkpoint — Ensure all tests pass
  - Run the full contract test suite: `node --test ./test/*.node.test.cjs`
  - Verify `init-db-schema.node.test.cjs` passes entirely (Property 1 + Property 2)
  - Verify no regression in existing contract tests
  - Ensure all tests pass; ask the user if questions arise

- [x] 5. Deploy to Railway
  - Commit the changes to `init-db.cjs` and the new test file
  - Push to `master` branch (Railway auto-deploys from `Funesterie/funesterie`, root `a11/backend/apps/server`)
  - Verify Railway build succeeds (no build step needed — direct Node.js execution)
  - After deploy, trigger `npm run db:init` on Railway (or verify it runs as start command) to apply the schema migration
  - Monitor Railway logs for: `✓ Table: user_facts`, `✓ migrate_user_facts_fact_key`, `✓ migrate_user_facts_fact_value`, etc.
  - Test the chat pipeline: send a message via the A11 frontend and verify no 502 error
  - Verify in Railway PostgreSQL that `user_facts` now has columns `fact_key`, `fact_value`, `confidence`, `last_seen_at`, `last_used_at`
  - _Requirements: 2.1, 2.2_
