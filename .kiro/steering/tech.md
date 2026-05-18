# Tech Stack

## Backend (`a11/backend/apps/server`)

- **Runtime**: Node.js ≥ 20, CommonJS (`.cjs` files throughout)
- **Framework**: Express 4
- **Language**: JavaScript (CommonJS) for server code; TypeScript compiled to JS for the `libs` package
- **Key libraries**: `openai`, `axios`, `jsonwebtoken`, `bcrypt`, `pg` (PostgreSQL), `multer`, `sharp`, `tesseract.js`, `pdfkit`, `ws`, `nodemailer`/`resend`, `playwright`, `helmet`, `compression`, `cors`, `http-proxy-middleware`
- **Storage**: Cloudflare R2 (S3-compatible) via `@aws-sdk/client-s3`
- **Internal packages** (`@nossen/*`): `qflush`, `rome`, `bat`, `envaptex`, `freeland`, `nezlephant`
- **Entry point**: `server.cjs`
- **No build step** — server runs directly with `node server.cjs`

## Frontend (`a11/frontend/apps/web`)

- **Framework**: React 18 + TypeScript
- **Bundler**: Vite 5 with `@vitejs/plugin-react-swc`
- **Language**: TypeScript (strict)
- **Key libraries**: `react-markdown`
- **Dev server**: port `5173`, proxies `/api`, `/v1`, `/files` to `localhost:3000`
- **Path alias**: `@` → `/src`

## QFlush Library (`a11/backend/libs`)

- **Language**: TypeScript, compiled to CommonJS (`dist/`)
- **Build**: `tsc`
- **Test runner**: Vitest
- **Linter**: ESLint
- **Modules**: ROME (indexer/linker), SPYDER, CORTEX, NPZ (router), BAT (process manager), PICCOLO, SUPERVISOR

## Deployment

| Service | Platform | Source path |
|---------|----------|-------------|
| Backend API | Railway | `a11/backend/apps/server` |
| Frontend | Netlify | `a11/frontend` |
| Local LLM | Ollama (Windows) | `localhost:11434` |
| Cerbere (GGUF proxy) | Local tunnel | `localhost:4545` |
| SD/Video proxy | Local tunnel | `localhost:3000` |

## Common Commands

```powershell
# Bootstrap workspace
pwsh -File .\bootstrap.ps1 setup
pwsh -File .\bootstrap.ps1 local start -NoPause

# Build
npm run build:backend      # from a11/ root (no-op, no build needed)
npm run build:frontend     # from a11/ root (runs vite build)
npm run build:all          # both

# Test
npm run test:backend       # node --test ./test/*.node.test.cjs
npm run test:backend:e2e   # e2e artifact flow

# Frontend dev server (run manually)
npm run dev                # from a11/frontend/apps/web

# Backend dev server (run manually)
node server.cjs            # from a11/backend/apps/server

# QFlush lib
npm run build              # tsc
npm test                   # vitest run

# Deploy prod
pwsh -File .\deploy-a11-prod.ps1 -Message "fix(a11): description"
```

## Environment

- Backend env: `.env.local` (dev) or Railway env vars (prod)
- Frontend env: `.env` with `VITE_` prefix
- Key backend vars: `OPENAI_API_KEY`, `LLM_ROUTER_URL`, `DATABASE_URL`, `R2_*`, `NEZ_TOKENS`, `CORS_ORIGINS`, `PUBLIC_API_URL`
- Key frontend vars: `VITE_A11_API_BASE_URL`, `VITE_A11_ONLINE_API_BASE_URL`
