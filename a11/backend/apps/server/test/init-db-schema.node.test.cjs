'use strict';
/**
 * Bug Condition Exploration Test — fact_key Column Missing After init-db.cjs
 *
 * Validates: Requirements 1.1, 1.2, 1.3
 *
 * CRITICAL: These tests MUST FAIL on unfixed code.
 * Failure confirms the bug exists (schema mismatch between init-db.cjs and server.cjs).
 * DO NOT attempt to fix the test or the code when it fails.
 *
 * Strategy: static analysis of SQL strings in source files — no real DB connection needed.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const INIT_DB_PATH = path.resolve(__dirname, '..', 'init-db.cjs');
const SERVER_PATH  = path.resolve(__dirname, '..', 'server.cjs');

const initDbSource = fs.readFileSync(INIT_DB_PATH, 'utf8');
const serverSource = fs.readFileSync(SERVER_PATH, 'utf8');

// ---------------------------------------------------------------------------
// Helper: extract the CREATE TABLE ... user_facts (...) block from a source
// ---------------------------------------------------------------------------
function extractCreateTableUserFacts(source) {
  // Match from "CREATE TABLE IF NOT EXISTS user_facts" up to the closing ");"
  const match = source.match(
    /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+user_facts\s*\([\s\S]*?\)/i
  );
  return match ? match[0] : null;
}

// ---------------------------------------------------------------------------
// Test Case 1 — Base vierge
// Parse the CREATE TABLE IF NOT EXISTS user_facts SQL from init-db.cjs and
// assert that fact_key is present in the column list.
// FAILS on unfixed code (only `fact TEXT` is defined there).
// ---------------------------------------------------------------------------
test('Test Case 1 — Base vierge: init-db.cjs CREATE TABLE user_facts doit définir fact_key', () => {
  const createTableSql = extractCreateTableUserFacts(initDbSource);

  assert.ok(
    createTableSql !== null,
    'init-db.cjs doit contenir un bloc CREATE TABLE IF NOT EXISTS user_facts'
  );

  // The column fact_key must appear in the CREATE TABLE definition
  assert.ok(
    /\bfact_key\b/.test(createTableSql),
    `COUNTEREXAMPLE: init-db.cjs définit user_facts sans la colonne fact_key.\n` +
    `Schéma trouvé:\n${createTableSql}\n` +
    `→ Cause confirmée: la définition CREATE TABLE utilise l'ancien schéma (fact TEXT).`
  );
});

// ---------------------------------------------------------------------------
// Test Case 2 — Base existante avec ancien schéma
// Verify that init-db.cjs contains ALTER TABLE user_facts ADD COLUMN IF NOT EXISTS fact_key
// to handle databases that already have the old schema.
// FAILS on unfixed code (no ALTER TABLE for fact_key).
// ---------------------------------------------------------------------------
test('Test Case 2 — Base existante: init-db.cjs doit contenir ALTER TABLE user_facts ADD COLUMN IF NOT EXISTS fact_key', () => {
  const hasAlterFactKey = /ALTER\s+TABLE\s+user_facts\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+fact_key/i.test(
    initDbSource
  );

  assert.ok(
    hasAlterFactKey,
    `COUNTEREXAMPLE: init-db.cjs ne contient aucun ALTER TABLE user_facts ADD COLUMN IF NOT EXISTS fact_key.\n` +
    `→ Cause confirmée: les bases existantes avec l'ancien schéma (fact TEXT) ne seront pas migrées.\n` +
    `→ La colonne fact_key restera absente après exécution de init-db.cjs sur une base existante.`
  );
});

// ---------------------------------------------------------------------------
// Test Case 3 — Requête runtime (mismatch confirmation)
// Verify that:
//   (a) server.cjs INSERT SQL references fact_key  (runtime expects it)
//   (b) init-db.cjs CREATE TABLE does NOT define fact_key  (init script omits it)
// Both conditions together confirm the schema mismatch that causes the 502 error.
// FAILS on unfixed code because (b) is true — confirming the bug.
// ---------------------------------------------------------------------------
test('Test Case 3 — Requête runtime: server.cjs référence fact_key mais init-db.cjs ne le définit pas (mismatch)', () => {
  // (a) server.cjs must reference fact_key in its INSERT SQL
  const serverInsertReferencesFactKey = /INSERT\s+INTO\s+user_facts[\s\S]*?fact_key/i.test(serverSource);
  assert.ok(
    serverInsertReferencesFactKey,
    'server.cjs doit référencer fact_key dans son INSERT INTO user_facts'
  );

  // (b) init-db.cjs CREATE TABLE must NOT define fact_key — this is the bug condition
  const createTableSql = extractCreateTableUserFacts(initDbSource);
  assert.ok(
    createTableSql !== null,
    'init-db.cjs doit contenir un bloc CREATE TABLE IF NOT EXISTS user_facts'
  );

  const initDbDefinesFactKey = /\bfact_key\b/.test(createTableSql);

  // This assertion FAILS on unfixed code (initDbDefinesFactKey is false → mismatch confirmed)
  assert.ok(
    initDbDefinesFactKey,
    `COUNTEREXAMPLE: Mismatch de schéma confirmé.\n` +
    `  server.cjs INSERT référence fact_key: OUI\n` +
    `  init-db.cjs CREATE TABLE définit fact_key: NON\n` +
    `→ Toute requête INSERT/SELECT sur user_facts.fact_key échouera avec:\n` +
    `  ERROR: column "fact_key" does not exist\n` +
    `→ Cela provoque l'erreur 502 sur l'ensemble du pipeline de chat.`
  );
});

// ===========================================================================
// PRESERVATION PROPERTY TESTS — Task 2
// Validates: Requirements 3.1, 3.2, 3.3, 3.4
//
// These tests MUST PASS on unfixed code — they verify baseline behaviors
// that the fix must not break.
// ===========================================================================

// ---------------------------------------------------------------------------
// Property 2a — Autres tables inaffectées
// Parse all CREATE TABLE IF NOT EXISTS SQL strings from init-db.cjs for
// tables other than user_facts and assert their expected column definitions
// are present. Ensures the fix does not accidentally alter other tables.
// PASSES on unfixed code (these tables are correct and untouched).
// ---------------------------------------------------------------------------
test('Property 2a — Autres tables inaffectées: les tables hors user_facts ont leurs colonnes attendues', () => {
  // Expected columns per table (subset — key columns that must be present)
  const tableExpectations = [
    {
      table: 'users',
      columns: ['id', 'username', 'password_hash', 'email', 'role', 'created_at', 'updated_at']
    },
    {
      table: 'messages',
      columns: ['id', 'user_id', 'conversation_id', 'role', 'content', 'created_at']
    },
    {
      table: 'user_memory',
      columns: ['user_id', 'summary', 'updated_at']
    },
    {
      table: 'files',
      columns: ['id', 'user_id', 'filename', 'storage_key', 'content_type', 'size_bytes', 'url', 'created_at']
    },
    {
      table: 'user_tasks',
      columns: ['id', 'user_id', 'title', 'description', 'status', 'created_at', 'updated_at']
    },
    {
      table: 'conversation_resources',
      columns: ['id', 'user_id', 'conversation_id', 'resource_kind', 'filename', 'storage_key', 'url', 'created_at']
    },
    {
      table: 'a11_pending_clarifications',
      columns: ['id', 'user_id', 'conversation_id', 'original_prompt', 'clarification_question', 'status', 'created_at']
    },
    {
      table: 'a11_external_resource_cache',
      columns: ['cache_key', 'image_url', 'cached_at', 'expires_at']
    }
  ];

  // Helper: extract the full CREATE TABLE block for a given table name.
  // The SQL is stored in a template literal ending with `)` followed by a backtick.
  // We match from CREATE TABLE IF NOT EXISTS <table> up to the closing ")`" to
  // capture the entire column list regardless of nested parentheses in defaults.
  function extractCreateTable(source, tableName) {
    // Match the template literal value: from CREATE TABLE ... up to the closing backtick
    // Pattern: CREATE TABLE IF NOT EXISTS <table> ( ... )` (end of template literal)
    const regex = new RegExp(
      `(CREATE\\s+TABLE\\s+IF\\s+NOT\\s+EXISTS\\s+${tableName}\\s*\\([\\s\\S]*?)\\s*\``,
      'i'
    );
    const match = source.match(regex);
    return match ? match[1] : null;
  }

  for (const { table, columns } of tableExpectations) {
    const createSql = extractCreateTable(initDbSource, table);

    assert.ok(
      createSql !== null,
      `init-db.cjs doit contenir un bloc CREATE TABLE IF NOT EXISTS ${table}`
    );

    for (const col of columns) {
      assert.ok(
        new RegExp(`\\b${col}\\b`).test(createSql),
        `Table ${table}: la colonne "${col}" doit être présente dans la définition CREATE TABLE.\n` +
        `Schéma trouvé:\n${createSql}`
      );
    }
  }
});

// ---------------------------------------------------------------------------
// Property 2b — Idempotence syntaxique des ALTER TABLE
// Assert that every ALTER TABLE statement in init-db.cjs uses
// ADD COLUMN IF NOT EXISTS (not bare ADD COLUMN).
// On unfixed code there are NO ALTER TABLE statements at all, so this test
// PASSES vacuously (0 ALTER TABLE statements = 0 violations).
// PASSES on unfixed code.
// ---------------------------------------------------------------------------
test('Property 2b — Idempotence syntaxique: tout ALTER TABLE utilise ADD COLUMN IF NOT EXISTS', () => {
  // Find all ALTER TABLE ... ADD COLUMN ... statements
  const alterTableMatches = initDbSource.match(
    /ALTER\s+TABLE\s+\w+\s+ADD\s+COLUMN\b[^;]*/gi
  ) || [];

  // Every ALTER TABLE ADD COLUMN must use IF NOT EXISTS
  const violations = alterTableMatches.filter(
    stmt => !/ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS/i.test(stmt)
  );

  assert.strictEqual(
    violations.length,
    0,
    `COUNTEREXAMPLE: ${violations.length} instruction(s) ALTER TABLE ADD COLUMN sans IF NOT EXISTS trouvée(s):\n` +
    violations.map(v => `  → ${v.trim()}`).join('\n') + '\n' +
    `→ Ces instructions échoueraient lors d'une deuxième exécution de init-db.cjs (colonne déjà existante).`
  );
});

// ---------------------------------------------------------------------------
// Property 2c — Index idempotents
// Assert that every CREATE INDEX statement in init-db.cjs uses
// CREATE INDEX IF NOT EXISTS — ensures no error on repeated execution.
// PASSES on unfixed code (all existing indexes already use IF NOT EXISTS).
// ---------------------------------------------------------------------------
test('Property 2c — Index idempotents: tout CREATE INDEX utilise IF NOT EXISTS', () => {
  // Find all CREATE INDEX statements (with or without IF NOT EXISTS)
  const createIndexMatches = initDbSource.match(
    /CREATE\s+(?:UNIQUE\s+)?INDEX\b[^;]*/gi
  ) || [];

  assert.ok(
    createIndexMatches.length > 0,
    'init-db.cjs doit contenir au moins un CREATE INDEX'
  );

  // Every CREATE INDEX must use IF NOT EXISTS
  const violations = createIndexMatches.filter(
    stmt => !/CREATE\s+(?:UNIQUE\s+)?INDEX\s+IF\s+NOT\s+EXISTS/i.test(stmt)
  );

  assert.strictEqual(
    violations.length,
    0,
    `COUNTEREXAMPLE: ${violations.length} instruction(s) CREATE INDEX sans IF NOT EXISTS trouvée(s):\n` +
    violations.map(v => `  → ${v.trim().slice(0, 120)}`).join('\n') + '\n' +
    `→ Ces instructions échoueraient lors d'une deuxième exécution de init-db.cjs (index déjà existant).`
  );
});
