# Funesterie Agent Roster

This roster is the working replacement for a Spark-style team while GitHub Spark access is blocked behind Copilot Pro+ / Enterprise.

No secrets belong in this file. Put real tokens only in local secret stores, GitHub org secrets, Railway/Hetzner dashboards, or DPAPI-backed client storage.

## Current Mode

- GitHub org: `Funesterie`
- GitHub plan: `Team`
- Main repo: `Funesterie/alphaonze`
- Shared local workspace: `D:\projets\funesterie`
- A11 public target: `https://a11.funesterie.pro`
- Local A11 backend: `http://localhost:3000`
- Canonical A11 MCP server: `D:\projets\funesterie\a11\backend\apps\server\tools\mcp\a11-mcp-server.cjs`
- Kiro MCP config: `D:\projets\funesterie\.kiro\settings\mcp.json`

## Agents

| Agent | Role | Primary surface | Auth expectation |
| --- | --- | --- | --- |
| `codex` | Implementation, reviews, terminal ops, browser ops | Codex desktop + local shell | Local SSH/GitHub credentials, no copied secrets |
| `kiro` | Spec execution, codebase navigation, structured diagnosis | Kiro + `.kiro/agents/*` | MCP `a11`, optional shared MCP |
| `a11` | Identity, memory, corpus, graph, local reasoning | A11 backend + MCP tools | `A11_NEZ_TOKEN` locally, JWT for protected API |
| `copilot-local` | GitHub UI/editor assistant, PR and code suggestions | GitHub/Copilot in browser or editor | GitHub account permissions |

## MCP Tools To Call First

Use these before deeper work:

1. `a11_health` - confirm A11 is alive.
2. `a11_identity_route` - recover identity and roots.
3. `a11_route_map` - recover services, endpoints, graph fallback, and public target.
4. `a11_mcp_dimension_status` - confirm Kiro/Dragon/MCP wiring.

## Agent JWT Pattern

After PR #22 is merged and deployed, protected API access can use agent JWTs.

Endpoint:

```http
POST /api/auth/agent-token
```

Request shape:

```json
{
  "admin_token": "<NEZ_ADMIN_TOKEN from secure storage>",
  "agent_id": "kiro",
  "expiry": "30d"
}
```

Expected claims:

```json
{
  "id": "kiro",
  "username": "kiro",
  "role": "agent",
  "typ": "agent_token",
  "agent": true
}
```

Use on protected routes:

```http
Authorization: Bearer <agent_jwt>
```

Some legacy paths may also accept:

```http
X-NEZ-TOKEN: <agent_jwt_or_nez_token>
```

## GitHub Team Workflow

Use issues and PRs as the shared task board:

1. Issue = problem statement or spec.
2. Branch = one agent's bounded work area.
3. PR = integration point and review surface.
4. Checks = quality gate.
5. A11 memory/route map = shared context.

Suggested labels:

- `agent:codex`
- `agent:kiro`
- `agent:a11`
- `agent:copilot-local`
- `needs-review`
- `needs-deploy`
- `blocked-secrets`

## Immediate Backlog

- PR #22 is merged and `/api/auth/agent-token` is live/protected.
- Generate agent JWTs for `kiro`, `codex`, and `copilot-local` from secure admin token storage.
- Workflow-only PRs #4, #6, #7, #8 are merged into `master`.
- Hold PR #11 until Vite config handles ESM-only `@vitejs/plugin-react-swc`.
- Fix TypeScript 6 config before #2: `baseUrl` deprecation currently requires `ignoreDeprecations: "6.0"` or a migration.
- Treat PR #9 and #16 as buildable but watch Vite migration warnings.

## Neo4j MCP Priority - 2026-05-12

Current priority is Kiro2 + Neo4j over TS/Vite dependency upgrades.

Verified locally:

- Neo4j is reachable on `bolt://127.0.0.1:7687`.
- Active database is `a11-knowledge-graph`.
- A11 app authentication works when `NEO4J_*` values are loaded from the local env file.
- `scripts/sync-codex-vs-neo4j.cjs` completed successfully.
- Last sync wrote 16 agents, 7 MCP servers, 31 route nodes, and 27 sync/corpus paths.

Kiro2 entrypoint:

- Use `.kiro/agents/neo4j-mcp-orchestrator.md`.
- Start with `a11_health`, `a11_mcp_dimension_status`, `a11_route_map`, and shared `neo4j_status`.
- Use shared `neo4j_read_query` for read-only graph inspection.
- Use only `graph_write_safe`, `memory_write_safe`, or `discussion_*` tools for writes unless a human explicitly approves a direct Cypher write.

## Safety Rules

- Never paste private keys, JWTs, admin tokens, or provider credentials into chat, docs, issues, or PR comments.
- Prefer placeholders like `<agent_jwt>` and `<NEZ_ADMIN_TOKEN>`.
- Keep public docs useful but secret-free.
- If a task requires payment, OAuth consent, PayPal, 2FA, or GitHub sales checkout, the human confirms it in the browser.
