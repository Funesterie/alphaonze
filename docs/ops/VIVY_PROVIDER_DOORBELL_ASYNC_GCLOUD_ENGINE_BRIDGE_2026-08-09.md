# Vivy provider doorbell + async jobs + engine bridge

Date: 2026-08-09

## Goal

Remove dead waiting from Vivy's LLM/song path and keep long work outside the browser/proxy request lifetime.

## 1. Provider doorbell

Before a costly LLM request, ring every candidate provider concurrently with a bounded cheap probe.

Rules:

- default probe window: 1.2 s;
- never use a real generation as a probe;
- definite credential/quota/refusal can remove a provider for the current round;
- timeout, 5xx or unsupported metadata route is `unknown` and remains eligible;
- emit an optional HORN event with a secret-free report;
- BLOOP is not used here: BLOOP remains the Neo4j integrity/memory sonar;
- ScentGate remains a signed terminal signal for completed/failed/cancelled jobs.

Packages:

- public core: `@nossen/provider-doorbell`;
- private Vivy adapter: `@funeste/provider-doorbell-vivy`.

## 2. Long work becomes a ticket

Do not try to extend a browser/Cloudflare request until a song, render or large LLM task finishes.

Target contract:

```text
POST /api/vivy/.../jobs
  -> validate request
  -> provider doorbell
  -> reserve idempotency key + jobId
  -> enqueue/launch work
  -> HTTP 202 { jobId, statusUrl }

worker/job
  -> LLM / lyrics / media generation
  -> persist result
  -> optional ScentGate terminal signal
  -> HORN internal event

client
  -> poll statusUrl or subscribe through an existing authenticated channel
  -> receive final asset/result link
```

The 202 response is the receipt. The result URL is the plate arriving later.

## 3. GCloud lane

Recommended private orchestration lane for work that benefits from GCloud:

- Cloud Run Jobs: bounded long-running workers;
- Workflows: orchestration and callback waiting;
- Eventarc: event routing toward Workflows/Cloud Run targets;
- Cloud Tasks: reliable HTTP delivery, retries and rate control for dispatch/callback endpoints.

No cloud spend is enabled merely by committing this design. Deployment must use the existing `alphaonze` project policy, IAM service identities and secret stores.

Suggested event names:

- `vivy.job.accepted`
- `vivy.job.started`
- `vivy.job.completed`
- `vivy.job.failed`
- `vivy.asset.ready`

The external/public contract should expose only job identifiers, state and allowed result URLs. Provider credentials and internal topology never enter event payloads.

## 4. Unity / Unreal from Finland

Do not expose editor MCP ports publicly.

Use the existing agent-bus/reverse-SSH topology:

```text
Finland orchestrator / Vivy
  -> engine-commands.jsonl
  -> existing SSH/hot-tunnel lane
  -> workstation agent-bus
  -> local engine adapter
       -> Unity MCP/API
       -> Unreal MCP/API
  -> engine-results.jsonl
  -> tunnel back to Finland
```

Public generic contract: `@nossen/mcp-engine-bridge`.
Private Funesterie adapter: `@funeste/mcp-engine-bridge-nossen`.

Supported intents are fixed (`status`, `apply`, `open`, `save`, `play`, `stop`, `build`). They are not shell strings. The workstation adapter must map each intent to an allowlisted editor action and validate project/resource boundaries before applying changes.

## 5. Deployment order

1. Run package tests and `npm pack --dry-run` for the two public cores.
2. Publish `@nossen/provider-doorbell@0.1.0` and `@nossen/mcp-engine-bridge@0.1.0` publicly.
3. Publish the two `@funeste/*` adapters as restricted packages.
4. Publish `@nossen/all-in-one@0.1.14`, then `@funeste/all-in-one-nossen@0.1.9`.
5. Mirror the public train to Google Artifact Registry using the existing publication script.
6. Fresh-install both all-in-one packages in clean directories.
7. Wire Vivy's LLM bundle chain behind an environment flag, observe doorbell decisions, then enable by default only after logs prove there are no false negatives.
8. Add `engine-commands.jsonl` pull and `engine-results.jsonl` push to the existing hot tunnel, then install local Unity/Unreal adapters.
9. Only after local engine status/read calls pass, allow `apply` on an explicit project allowlist.

## 6. Rollback

- Doorbell can be disabled without removing the existing fallback chain.
- Unknown providers remain eligible by design.
- Engine bridge can be stopped by stopping the local adapter; the editor itself remains unexposed.
- GCloud async lane can fall back to the existing local job queue while preserving the same `{jobId,statusUrl}` contract.
