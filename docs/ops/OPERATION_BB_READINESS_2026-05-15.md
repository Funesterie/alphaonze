# Operation BB Readiness

Status: prepared, not launched
Name: BB, Body Building
Goal: repair Funesterie to a stable, demo-ready, production-safe state without mixing scopes or leaking secrets.

## Mission Shape

Operation BB is not one giant task. It is a coordinated repair sprint with bounded lanes:

| Lane | Owner | Goal | Done Condition |
| --- | --- | --- | --- |
| MCP fleet | Codex + Kiro + Gemini | keep agents connected and scoped | roster green, no unsafe tools exposed |
| CI and GitHub | Codex + Copilot | make checks pass | failing jobs reproduced or fixed |
| A11 backend | Codex + A11 | remove 502s and broken generation paths | health, video upload, frame generation tested |
| Qflush/Janus/Vivy | A11 + Gemini + Vivy | stabilize analysis hooks | status tools green, no runaway analysis loop |
| Neo4j corpus | A11 + Kiro | align local/Aura reads and corpus map | read-only checks pass, no direct secret import |
| UI demo | Codex + Kaen44 | A11, Kaen44, Vivy, home page polished | mobile/desktop screenshots clean |
| Deploy/edge | Codex + Cloudflare + Render | routes, tunnels, rollback | public URLs reachable, rollback known |
| Packages | Codex + JFrog | modules clean and publishable | package config validated, no token in repo |

## Go / No-Go

Do not launch BB until these checks are known:

- `git status --short` reviewed.
- All active PR/check failures listed.
- `https://mcp.funesterie.me/health` healthy.
- `https://a11.funesterie.me/health` healthy.
- Gemini `funesterie_full` connected.
- Kiro local `a11` and shared `a11mcp-shared` configured.
- Worker supervisor status known.
- Render route for backend known.
- Cloudflare route for MCP known.
- Secrets scan planned before any public capture/share.

## Phase 0 - Freeze And Inventory

Commands:

```powershell
git status --short
gh pr status
gh run list --limit 20
gemini mcp list
```

Outputs to collect:

- dirty files grouped by owner;
- failing CI jobs;
- public health status;
- active workers;
- current deployments.

## Phase 1 - CI And Backend Repro

Focus:

- failing GitHub checks;
- A11 502 routes;
- video upload/send failures;
- `frame generate 0 error`;
- Qflush/Janus auto-analysis status.

Rule:

Fix only one failure class per branch/commit. Avoid drive-by refactors.

## Phase 2 - Runtime And Workers

Focus:

- worker supervisor status;
- identity archivist queue;
- task dispatcher;
- duplicate loops;
- dead-letter or stale leases.

Allowed:

- `a11_worker_status`
- `a11_agent_jobs_status`
- read-only queue checks
- dispatch dry-run

Blocked unless scoped:

- worker start/stop/restart from external LLMs;
- broad queue purge;
- deleting job history.

## Phase 3 - Corpus And Neo4j

Focus:

- local vs Aura node/relation counts;
- identity tags generated;
- source card enrichment;
- read-only graph exploration;
- import plan for accepted Cypher only.

No secrets in Corpus. Ever.

## Phase 4 - Demo Surfaces

Routes:

- home page full connected;
- A11 simple/warm interface;
- Kaen44 client/demo interface;
- Vivy musical identity;
- cockpit if needed.

Checks:

- mobile screenshot;
- desktop screenshot;
- no internal jargon on public front;
- no visible Neo4j/MCP/QFlush/ports/diagnostic words on public pages unless in cockpit.

## Phase 5 - Deploy And Rollback

Before deploy:

- CI green or failure accepted;
- `.env` and secrets excluded;
- Render env verified by presence only;
- Cloudflare route verified;
- rollback target identified.

After deploy:

- public health;
- login/OAuth route smoke;
- video/frame generation smoke;
- MCP health;
- one screenshot.

## BB Task Template

```txt
id:
lane:
owner:
scope:
risk:
repro:
files:
commands:
done condition:
rollback:
status:
```

## Launch Phrase

Human says:

```txt
Operation BB GO
```

Codex responds with:

```txt
BB acknowledged.
Phase 0 freeze/inventory starting.
No secrets will be printed.
```
