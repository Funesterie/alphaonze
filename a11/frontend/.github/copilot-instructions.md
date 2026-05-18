# Copilot Instructions for A11 System (updated)

## Overview
- A11 is a local AI system: Node.js/Express backend (`apps/server`), Vite frontend (`apps/web`), Cloudflare Tunnel for remote access and a local supervisor `qflush` (repo: `D:\funesterie\a11\a11qflushrailway`).

## Key locations
- Backend: `apps/server/server.cjs`
- Frontend: `apps/web/`
- Tunnel config: user `.cloudflared/config.yml` or repo `.cloudflared/config.yml`
- Startup: `start-a11-system.ps1`
- Supervisor integration: `apps/server/src/qflush-integration.cjs`

## Start / dev
- Start everything: `pwsh -File start-a11-system.ps1`
- Backend dev: `cd apps/server && npm run dev`
- Frontend dev: `cd apps/web && npm run dev`

## Tunnel & Cloudflare
- Ensure `config.yml` maps `api.funesterie.me` -> `http://127.0.0.1:3000` and points to the tunnel credentials JSON.
- Debug: `cloudflared tunnel run <name> --config <config.yml> --loglevel debug`
- Create DNS public hostname: `cloudflared tunnel route dns <name> api.funesterie.me`

## Environment variables
- `PORT`, `UPSTREAM_ORIGIN`, `LLM_ROUTER_URL`, `LLAMA_BASE`, `CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET`, `QFLUSH_AUTO_START`.

## Supervision notes (important)
- Prefer launching submodules via Node API or `spawn(process.execPath, [cliPath])` instead of shell `npx` to avoid quoting/space issues on Windows.
- Supervisor code: `apps/server/src/a11-supervisor.cjs` and integration: `apps/server/src/qflush-integration.cjs`.
- qflush logs: `apps/server/.qflush/logs/`

## Troubleshooting quick checklist
- Verify backend health: `http://127.0.0.1:3000/health`.
- Check Cloudflared logs with `--loglevel debug` for tunnel issues.
- If publishing npm packages, ensure OTP or automation token is available.

## Security
- Do not commit credentials or sensitive tokens. Use service tokens for automated publish workflows.

## Commands summary
- `qflush start` — start modules via qflush
- `npm link` — test local package linking
- `npm publish --access public` — publish package (requires OTP if 2FA enabled)

If you want this shortened or translated, say so.
