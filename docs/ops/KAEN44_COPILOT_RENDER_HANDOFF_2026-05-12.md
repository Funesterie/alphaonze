# Kaen44 Copilot / Render Handoff - 2026-05-12

## Goal

Historical handoff for the platform-level routing issue:

- Hetzner origin is healthy.
- A11 MCP and Cerbere stats are healthy locally and on `a11.funesterie.pro`.
- Kaen44 is now a separate backend on Hetzner.
- Public Cloudflare traffic to `funesterie.me/api/*` returned `401` before it reached the Kaen44 origin path.
- Resolved on 2026-05-13 by routing the affected hostnames through the dedicated `kaen44-hetzner` Cloudflare Tunnel.

No secrets should be pasted into GitHub, Copilot, Render, logs, or comments.

## Current Verified State

Hetzner host:

- SSH target: `deploy@62.238.43.32`
- Hostname: `a11-prod-finland-2`
- Active release: `/home/deploy/a11-prod/current`

Docker services:

- `a11-backend`: healthy, internal port `3000`
- `kaen44-backend`: healthy, internal port `3001`
- `a11-caddy`: public ports `80` and `443`
- `a11-postgres`: healthy
- `a11-redis`: healthy
- `a11-voice`: healthy

Confirmed good:

- `https://a11.funesterie.pro/health` -> `200`
- `https://a11.funesterie.pro/api/llm/stats` -> `200`, Cerbere router JSON
- `https://k44.funesterie.me/health` -> `200`
- `https://k44.funesterie.me/` -> `200`, title `Kaen44 - Assistante bureau Funesterie`
- From Hetzner origin with `Host: k44.funesterie.me`, `http://127.0.0.1/api/llm/stats` -> `200`
- From Hetzner origin with `Host: k44.funesterie.me`, `http://62.238.43.32/api/llm/stats` -> `200`
- Render fallback `https://kaen44-api.onrender.com/health` -> `200`
- Render fallback `https://kaen44-api.onrender.com/api/llm/stats` -> `200`, Cerbere router JSON
- Render fallback authenticated `POST /api/llm/chat` -> `200`, reply `OK_RENDER`
- Public Cloudflare `https://k44.funesterie.me/api/llm/stats` -> `200`, `via: 1.1 Caddy`
- Public Cloudflare `https://kaen44.funesterie.me/api/llm/stats` -> `200`, `via: 1.1 Caddy`
- Public Cloudflare `https://funesterie.me/api/llm/stats` -> `200`, `via: 1.1 Caddy`
- Public Cloudflare `https://www.funesterie.me/api/llm/stats` -> `200`, `via: 1.1 Caddy`

Render service now live:

- Workspace: `funesterie`
- Service: `kaen44-api`
- Service id: `srv-d81q1fmk1jcs73cej5t0`
- Dashboard: `https://dashboard.render.com/web/srv-d81q1fmk1jcs73cej5t0`
- Latest live deploy: `dep-d81qdil0lvsc73bsnv8g`
- Live commit: `3df2e363c5853734a90937be7c9ab293503cbad6`
- Commit message: `fix(render): sync backend npm lock`
- Runtime LLM path: Together AI through the OpenAI-compatible client
- Runtime model: `meta-llama/Llama-3.3-70B-Instruct-Turbo`

Provider checks, without printing secrets:

- Together: `200`, usable
- DeepSeek: `402 Insufficient Balance`
- Groq: `401 invalid_api_key`
- xAI: `403`

Public Cloudflare path status:

- Resolved. The previous `401` was bypassed by routing the hostnames through the dedicated `kaen44-hetzner` tunnel.
- Tunnel runbook: `docs/ops/KAEN44_CLOUDFLARED_TUNNEL_2026-05-13.md`
- Compose file: `a11/backend/apps/server/docker-compose.kaen44-cloudflared.yml`
- Config template: `a11/backend/apps/server/cloudflared/kaen44-hetzner-config.example.yml`

Important historical observation:

- Origin Caddy returns `200` for the same host/path over HTTP.
- Recent Kaen44 container logs did not show the public Cloudflare `/api/llm/stats` hit.
- Public Cloudflare responses include `server: cloudflare` and `X-Powered-By: Express`.
- The public `401` body is `A11_JWT_Missing`, so Cloudflare is reaching an Express app, but likely not the same Hetzner Caddy/Kaen44 origin route that returns `200` by Host-header.
- This points first to a Worker, Origin Rule, Transform Rule, tunnel route, stale target, or another proxy layer sending `funesterie.me/api/*` to an older/protected Express backend.

## Code Fix Already Applied

The MCP `a11_llm_stats` failure was caused by an accidental broad JWT mount:

```js
app.use('/api', verifyJWT, createPortraitFramebookRouter());
```

That protected everything registered after it under `/api`, including `/api/llm/stats`.

Fixed shape:

```js
app.use('/api', createPortraitFramebookRouter({ verifyJWT }));
```

And in the route:

```js
router.get('/a11/portrait-framebook', ...routeHandlers, (_req, res) => {
  res.json(buildPortraitFramebook());
});
```

Local verification:

- `node --check server.cjs` OK
- `node --check routes/portrait-framebook.cjs` OK
- `node --test test/portrait-framebook.node.test.cjs` OK
- MCP `a11_llm_stats` now returns Cerbere stats.

## Copilot Task

Ask Copilot/GitHub to help with this precise work:

1. Review the A11/Kaen44 split deployment changes.
2. Make the Hetzner split reproducible from source:
   - `kaen44-backend` service
   - Caddy host routing
   - separate runtime/log/upload volumes
   - no secret leakage
3. Add a smoke script that proves:
   - A11 `/health` and `/api/llm/stats`
   - Kaen44 `/health`, `/`, and `/api/llm/stats`
   - Caddy host-based origin route for `k44.funesterie.me`
4. Add optional safe request logging in Caddy or backend for host/path/status only, not headers or tokens.
5. Diagnose why Cloudflare returns `401` on `funesterie.me/api/*` while the Hetzner origin returns `200`.

Suggested GitHub issue title:

```text
Kaen44 split is healthy on Hetzner, but Cloudflare returns 401 for funesterie.me/api/*
```

Suggested labels:

```text
ops, deployment, cloudflare, kaen44, needs-copilot
```

## Render Fallback

Render is now available as an API-only fallback for Kaen44 if Cloudflare rules are hard to unwind quickly.

Use:

```text
docs/ops/render-kaen44-api-blueprint.yaml
```

Current status:

- `kaen44-api` is deployed and live at `https://kaen44-api.onrender.com`.
- `/health` and `/api/llm/stats` are both returning `200`.
- Authenticated `/api/llm/chat` returns `200` using Together and model `meta-llama/Llama-3.3-70B-Instruct-Turbo`.
- The first deploy failed because `patch-package` was still treated as a dev dependency while Render ran `npm install --omit=dev`.
- The live deploy is fixed by `3df2e363c5853734a90937be7c9ab293503cbad6`, which syncs the backend npm lock and dependency placement.
- Render secrets were synced through the Render API, with only key names/status printed locally.

Recommended routing:

- Keep the UI on Hetzner.
- Route only `/api/*` to Render if needed.
- Keep secrets in the Render Dashboard only.

Why API-only first:

- The current backend can expose `/health` and `/api/llm/stats` without needing the frontend `web/dist`.
- Serving the full UI from Render requires a frontend build/deploy pass.
- The urgent breakage is `/api/*`, not the Kaen44 root page.

## Manual Cloudflare Checklist

Check these for `funesterie.me`, `k44.funesterie.me`, and `kaen44.funesterie.me`:

1. Workers Routes matching `*funesterie.me/api/*`
2. Cloudflare Access applications or policies
3. WAF custom rules returning/challenging `401`
4. Transform Rules rewriting host/path/headers
5. Page Rules or Rulesets affecting `/api/*`
6. Origin Rules overriding the target origin
7. Cache Rules or stale config for `/api/*`
8. DNS proxy mode and SSL/TLS mode for the subdomains

Expected routing after fix:

- `k44.funesterie.me/` -> Hetzner `kaen44-backend:3001`
- `k44.funesterie.me/api/*` -> Hetzner `kaen44-backend:3001`, or Render `kaen44-api` if using fallback
- `a11.funesterie.pro/*` -> Hetzner `a11-backend:3000`
