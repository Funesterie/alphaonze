# Google Cloud Run staging - 2026-05-26

Secret-safe operational note for the Funesterie/NOSSEN Google Cloud staging lane.

## Project

- Project: `alphaonze`
- Region: `europe-west4`
- Runtime target: Cloud Run
- Artifact target: Artifact Registry

## Artifact Registry

Existing repositories:

- `funesterie-docker` (`DOCKER`)
- `funesterie-npm` (`NPM`)
- `funesterie-generic` (`GENERIC`)

Container scanning was enabled via `containerscanning.googleapis.com`.

Current staging image:

- `europe-west4-docker.pkg.dev/alphaonze/funesterie-docker/a11-backend:staging-current`
- Digest used for first staging deploy: `sha256:86524201d786d68382e0fd51f8395f2057ad8ca16881624268a5de89c48b518a`
- Trace tag: `staging-20260526-0430`

## Cloud Run

Service:

- Name: `a11-backend-staging`
- URL: `https://a11-backend-staging-uh6lkneqpa-ez.a.run.app`
- Access: private, authenticated invocations only
- Min instances: `0`
- Max instances: `1`
- Runtime service account: `funesterie-run-staging@alphaonze.iam.gserviceaccount.com`
- Latest verified revision: `a11-backend-staging-00004-zxp`

Smoke result:

- Authenticated `GET /health`: `200`, body `{"status":"ok"}`
- Unauthenticated `GET /health`: blocked with `403`

## Commands

Deploy or update staging:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/google/Deploy-CloudRunStaging.ps1
```

Smoke test staging:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/google/Test-CloudRunStaging.ps1
```

## Boundaries

- This does not change `funesterie.me`.
- This does not replace Hetzner production.
- No production secrets were copied to Google Cloud during this first staging pass.
- Keep staging private until OAuth, Drive access, secrets, and domain mapping are intentionally wired.
