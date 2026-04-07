# Admin Cleanup Endpoint Example

This file documents the secure admin endpoint for cleaning up test/smoke/demo data in Postgres.

## Files
- `scripts/cleanup-test-smoke-data-lib.mjs`: Core cleanup logic (importable)
- `scripts/cleanup-test-smoke-data.mjs`: CLI wrapper for terminal use
- `src/admin-cleanup-endpoint-example.mjs`: Example Express router for admin API

## Usage

### 1. Library
Import and call `runCleanupTestData({ dryRun, verbose, connectionString })` from anywhere (CLI, API, etc).

### 2. CLI
```sh
node scripts/cleanup-test-smoke-data.mjs           # Dry-run (default)
node scripts/cleanup-test-smoke-data.mjs --apply   # Actually delete
```

### 3. Admin API Endpoint
- POST `/admin/cleanup-test-data` (body: `{ apply: true|false }`)
- Requires admin authentication (see `requireAdmin` middleware)
- Returns JSON with dry-run or deletion results

## Security & Safety
- Always require admin authentication for this endpoint
- Always run a dry-run before applying destructive changes
- Log all actions and results
- Never expose raw SQL or allow arbitrary queries from the frontend
- Whitelist only test/smoke/demo data for deletion

## Example Request
```http
POST /admin/cleanup-test-data
Content-Type: application/json
Authorization: Bearer <admin-token>

{
  "apply": false
}
```

## Example Response (dry-run)
```json
{
  "dryRun": true,
  "totalPlanned": 42,
  "plans": [
    { "table": "users", "count": 10 },
    { "table": "messages", "count": 32 }
  ],
  "deleted": 0,
  "message": "Dry-run complete. No data deleted."
}
```
