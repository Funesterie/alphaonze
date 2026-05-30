# Project Structure

This is a monorepo at `D:\projets\funesterie` (Git root: `Funesterie/funesterie`, branch `master`). The VS Code workspace file `funesterie.code-workspace` splits it into named roots.

## Top-Level Layout

```
funesterie/
  a11/
    backend/apps/server/   ← Backend API (Railway deploy root)
    backend/apps/tts/      ← Local TTS service (Piper)
    backend/libs/          ← @nossen/qflush published library
    frontend/apps/web/     ← Frontend SPA (Netlify deploy root)
    launchers/             ← Windows orchestration scripts
    runtime/               ← Generated local runtime (gitignored)
    a11_memory/            ← Persistent conversation memory (gitignored)
  spaces/                  ← Hugging Face Gradio space
  scripts/                 ← Repo-level utility scripts
  bootstrap.ps1 / .bat     ← Workspace bootstrap entrypoint
  deploy-a11-prod.ps1/.bat ← Production deploy entrypoint
```

## Backend Server (`a11/backend/apps/server`)

```
server.cjs              ← Express app entrypoint (all wiring here)
src/
  a11/                  ← A11-specific core logic
  auth/                 ← Auth store (local JWT)
  bootstrap/            ← Startup helpers
  chat/                 ← Chat pipeline
  core/                 ← Shared core utilities
  image/                ← Image generation pipeline
  integrations/         ← Third-party integrations
  knowledge/            ← Knowledge/memory layer
  mask/                 ← SD prompt building, semantic analysis
  memory/               ← Conversation memory
  middleware/           ← nezAuth, jwt-auth
  network/              ← Bind config
  providers/            ← LLM provider adapters
  routes/               ← Express routers (one file per route group)
  security/             ← Admin access control
  tts/                  ← TTS integration
  video/                ← Video generation pipeline
lib/                    ← Shared server utilities (file storage, artifacts, email, etc.)
routes/                 ← Legacy/top-level route files
middleware/             ← Legacy middleware
utils/                  ← Misc utilities (Slack notify, etc.)
config/                 ← Runtime config builders
agent/                  ← Agent/tool-calling layer
providers/              ← Provider files (openai.ts compiled on startup)
tools/                  ← Local tool scripts (SD, vision/Janus)
test/                   ← Contract tests (*.node.test.cjs)
tests/                  ← E2E tests
```

## Frontend (`a11/frontend/apps/web/src`)

```
src/
  App.tsx               ← Root component (chat UI, auth, panels)
  main.tsx              ← React entry point
  components/           ← UI components (panels, modals, etc.)
  pages/                ← Page-level components
  lib/                  ← API client, speech, importer utilities
  config/               ← Frontend config
```

## QFlush Library (`a11/backend/libs/src`)

```
src/
  chain/        ← SmartChain pipeline
  cli/          ← CLI entry
  commands/     ← CLI commands
  compose/      ← Composition helpers
  cortex/       ← CORTEX module
  decoders/     ← Data decoders
  lib/          ← Shared lib utilities
  piccolo/      ← PICCOLO module
  rome/         ← ROME engine (index, linker, logic)
  services/     ← Service layer
  spyder/       ← SPYDER module
  supervisor/   ← Process supervisor
  tools/        ← Tool definitions
  types/        ← TypeScript types
  utils/        ← Utilities
```

## Routing Rules (where to make changes)

| Problem area | Location |
|---|---|
| UI / React / UX | `a11/frontend/apps/web/src` |
| API route / 502 | `a11/backend/apps/server/src/routes` |
| Chat pipeline | `a11/backend/apps/server/src/chat` |
| Image/SD pipeline | `a11/backend/apps/server/src/image` or `src/mask` |
| Video pipeline | `a11/backend/apps/server/src/video` |
| Auth / JWT | `a11/backend/apps/server/src/auth` or `src/middleware` |
| Memory / history | `a11/backend/apps/server/src/memory` |
| Local launch / tunnel | `a11/launchers` |
| QFlush / ROME logic | `a11/backend/libs/src` |

## Key Conventions

- Backend files use `.cjs` extension (CommonJS); never use ES module syntax (`import`/`export`) in server files
- Frontend uses TypeScript with strict mode; path alias `@` maps to `src/`
- Route modules export a factory function `createXxxRouter(deps)` that returns an Express Router
- Env vars are normalized at startup in `server.cjs` via `adoptEnvAlias` / `normalizeEnvVar`
- Do not put Windows absolute paths in Railway environment variables
- `a11/runtime/` and `a11/a11_memory/` are local-only and gitignored — never commit generated runtime files
- The `dragon` and `a11desktoptauri` directories are legacy; do not add new code there
