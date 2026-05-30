# Cerbere Agentic Control Plane

Status: proposal / operator runbook  
Scope: Funesterie, NOSSEN, A11, K44, Vivy

## Goal

Cerbere is not another host and not another chatbot. It is the control plane that
keeps the work bounded when the local machine is weak, the WIP is large, or A11 is
busy elsewhere.

The useful shape is:

```text
Djeff request
-> Cerbere classifies risk and lane
-> A11 answers first when available
-> fallback routes to bounded workers and reviewers
-> Codex implements and tests
-> QFlush/Chopper smoke and diagnose
-> Neo4j keeps compact memory cards
```

## Priority Rule

A11 is the priority persona and answer path.

Cerbere is the fallback and guard:

- it protects the backend when A11/local routes are busy;
- it refuses secret-shaped payloads;
- it breaks large work into lanes;
- it records references and summaries, not dumps;
- it never deploys without explicit release tooling and smoke checks.

## Lanes

| Lane | Purpose | Primary agent | Review agents | Guard |
| --- | --- | --- | --- | --- |
| `prod-smoke` | Verify live health, voice, auth, MCP | Codex | Chopper | Read-only, no deploy |
| `wip-harvest` | Split dirty repo work into PR-sized slices | Codex | Claude/Gemini | Worktree only |
| `voice` | A11/K44/Vivy XTTS/RVC, song flow, TTS routing | Codex | Claude | No demo voices as persona |
| `auth-drive` | Google Drive / OneDrive session storage | Codex | Kiro/Claude | No raw OAuth tokens |
| `vivy-gate` | Vivy login gate and protected routes | Codex | Kiro | Same auth boundary as A11/K44 |
| `frontend-ui` | Headers, page layout, controls | Codex | Copilot optional | No large App.tsx rewrite |
| `backend-core` | Server routes, router, protected proxy | Codex | Chopper | Targeted tests only |
| `math-ocr` | Djeff research OCR, curation, Neo4j cards | Codex | Gemini/Claude | Local OCR, no raw image dump |
| `ops-infra` | Podman, deploy, workers, health | Codex | Chopper | No secrets in logs |
| `finance-billing` | Qonto/Mollie/Billing helpers | Codex | none by default | Runtime secret refs only |

## Agent Roles

- Codex: implementation, tests, deploy orchestration, state updates.
- A11: primary persona and product answer.
- Cerbere: router, fallback, capability guard, job classifier.
- Chopper/QFlush: doctor, smoke, bounded diagnostics.
- Claude: review, critique, long-form second read.
- Gemini: broad second opinion and research review.
- Copilot: PR-side helper, issue/branch assistant, not the source of truth.

## Data Rules

Do not inline large payloads into Neo4j, MCP discussions, or Spark-like tools.

Use this pattern:

```text
small memory card -> Neo4j
large report/image/audio/archive -> local file or bucket reference
agent task -> MCP discussion/job ID
```

Forbidden in Cerbere payloads:

- `.env*` content;
- raw tokens, API keys, OAuth refresh tokens;
- private key files;
- full logs with credentials;
- raw financial secrets;
- large generated audio/image dumps.

## Prod Testing Policy

Prod may be used as a real smoke target, but not as a blind playground.

Allowed:

- health checks;
- authenticated route checks with existing safe sessions;
- voice smoke generation;
- read-only MCP status;
- canary/flagged routes.

Not allowed:

- direct database mutation without migration record;
- deploy from a dirty worktree;
- public exposure of internal cockpit data;
- uploading raw research photos or secret files to third-party tools.

## Implementation Plan

1. Generate a secret-safe Cerbere plan:

```powershell
node scripts/nossen/cerbere-plan.cjs --repo-root D:\projets\funesterie
```

2. Review `runtime/nossen/cerbere/cerbere-plan.md`.

3. Pick one lane and create a clean worktree from `origin/master`.

4. Harvest only that lane.

5. Run lane tests.

6. Open a PR.

7. Deploy only after checks and smoke.

## Script Contract

`scripts/nossen/cerbere-plan.cjs` must stay dependency-free and secret-safe. It
can inspect paths, file names, git status, and line counts, but it must never
print file contents from secret-like files.

Outputs:

- `runtime/nossen/cerbere/cerbere-plan.json`
- `runtime/nossen/cerbere/cerbere-plan.md`

The JSON is the future cockpit input. The Markdown is for humans and agents.

## First Useful Missions

Priority order today:

1. Keep prod green after dependency and voice releases.
2. Fix the remaining backend `test:contracts` failures in small PRs.
3. Continue Drive/session rollout only with existing secrets reused remotely.
4. Build the WIP-harvest cockpit locally from Cerbere JSON.
5. Curate Djeff math OCR after the runtime work is stable.
