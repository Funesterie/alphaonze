# Railway recovery runbook - 2026-05-16

## Current state

- Railway CLI is logged in as `contact@funesterie.me`.
- This backup Railway account currently sees no projects with `railway project list --json`.
- Local Railway CLI has no linked project in this repository yet.
- Railway remote MCP was installed for Codex/Claude; Copilot config was repaired manually with a `railway` remote MCP entry.
- Local SSH public key `Djeff PC - Funesterie dev` was registered with Railway.

## Important distinction

- `postgres.railway.internal` works only inside Railway private networking.
- From this PC or any external client, PostgreSQL recovery must use the Railway PostgreSQL TCP proxy host/port.
- Do not paste or dump Railway tokens, Postgres URLs, `.env` files, API keys, or credentials into agent chats.

## Required human action

To recover the old Railway/n8n/A11 project, one of these must happen:

1. Log the CLI/browser into the original Railway account/workspace that owns the project.
2. Invite `contact@funesterie.me` to the original Railway workspace/project.
3. If the old project is gone or billing-locked, create a new Railway project and restore from exported backups.

## Safe Postgres/n8n recovery procedure

1. Open Railway dashboard with the account that owns the old project.
2. Select the project, then the PostgreSQL service.
3. Go to Settings -> Networking.
4. Create or reveal a TCP proxy for port `5432`.
5. Use the TCP proxy domain and port from your PC. Do not use `postgres.railway.internal` externally.
6. Export in read-only mode first:
   - `pg_dump --schema-only` for structure.
   - `pg_dump --data-only --table=<known_n8n_table>` only after verifying target tables.
7. For n8n, prioritize tables for workflows, credentials metadata, executions, variables, and settings. Do not expose credential payloads to agents.

## Token rebuild policy

Recreate tokens rather than recovering old local secrets:

- `RAILWAY_TOKEN` / `RAILWAY_API_TOKEN` for CI/agents.
- GitHub token scopes only as needed, not all scopes.
- Database credentials from Railway UI or new generated variables.
- OAuth clients from provider consoles.
- MCP tokens from the trusted Hetzner/A11 runtime only.

## Variable inventory

Run:

```powershell
powershell -ExecutionPolicy Bypass -File D:\projets\funesterie\scripts\railway\Get-RailwayRecoveryInventory.ps1 -OutFile D:\projets\funesterie\docs\ops_tmp\railway-variable-inventory.json
```

The script prints and writes variable names only, never values.

## Next checks once project is visible

```powershell
railway project list --json
railway link --project <PROJECT_ID> --environment production
railway service list --json
railway variable list --service <SERVICE> --json
```

Warning: `railway variable list --json` prints raw values. For agent usage, capture only names or run a redaction wrapper.
