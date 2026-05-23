# Funesterie Routing Source Of Truth

Date: 2026-05-23
Status: current operational routing notes. This file supersedes older Netlify/Railway-only notes when they conflict with live probes.

## Verified Live Surface

These probes were checked after PR #115 and PR #116:

| URL | Status | Evidence |
| --- | --- | --- |
| `https://funesterie.me/` | 200 | `server: cloudflare`, `via: 1.1 Caddy`, title `Alphaonze - A11 Funesterie` |
| `https://funesterie.me/privacy/` | 200 | `server: cloudflare`, `via: 1.1 Caddy`, standalone privacy page title |
| `https://funesterie.me/terms/` | 200 | `server: cloudflare`, `via: 1.1 Caddy`, standalone terms page title |
| `https://a11.funesterie.me/health` | 200 | `server: cloudflare`, `via: 1.1 Caddy` |
| `https://k44.funesterie.me/health` | 200 | `server: cloudflare`, `via: 1.1 Caddy` |
| `https://mcp.funesterie.me/health` | 200 | MCP health responds through Cloudflare edge |

## Decision

- Cloudflare is the public edge for `funesterie.me`, `a11.funesterie.me`, `k44.funesterie.me`, and `mcp.funesterie.me`.
- `funesterie.me`, `a11.funesterie.me`, and `k44.funesterie.me` are not Cloudflare Pages and are not Netlify for the active validation path. The live HTTP evidence includes `via: 1.1 Caddy`.
- The public web/legal pages are served by the Express backend and the embedded static web dist behind Caddy.
- Do not fix validation routing with Netlify `_redirects`, Cloudflare Pages `_redirects`, or Pages-only rules unless a fresh probe proves a Pages deployment is actually serving the hostname.
- For `/privacy/` and `/terms/`, the authoritative code path is `a11/backend/apps/server/server.cjs` plus `a11/frontend/apps/web/public/privacy/index.html` and `a11/frontend/apps/web/public/terms/index.html`.
- MCP (`mcp.funesterie.me`) is its own service path. Before changing MCP routing, read the preflight and inspect the a11mcp deployment docs/scripts.

## Deployment Path For Web Validation Fixes

For small validation fixes:

1. Patch in a clean worktree.
2. Run the targeted server test and the web build.
3. Merge a PR to `master`.
4. Deploy the backend/static files through the current Hetzner/Caddy path or the active deploy script after verifying preflight.
5. Reprobe the public URLs. Do not call it done from GitHub checks alone.

The active generated Caddy configuration is produced by `a11/ops/deploy-a11-prod-finland-2.ps1`.

## Agent Guardrail

If an agent proposes a fix using Netlify, Cloudflare Pages, `_redirects`, or a static-hosting rule:

1. Stop.
2. Probe the live URL headers first.
3. If `via: 1.1 Caddy` is present, patch Express/Caddy/static dist instead of Pages/Netlify.
4. Post the probe evidence in MCP before opening a PR.
