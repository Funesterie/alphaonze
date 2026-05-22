# NOSSEN Context Pack - 2026-05-22

This pack records the verified local state for NOSSEN / Funesterie after the Neo4j local/cloud repair was merged.

No raw secrets, tokens, passwords, API keys, private keys, or credential blobs are included here.

## Sources Read

- Preflight: `npm --prefix D:\projets\funesterie\a11mcp run session:preflight -- --print`
  - Generated: `2026-05-22T16:30:27.245Z`
- MCP inbox and memory tools:
  - shared inbox check
  - local A11/Kiro inbox check
  - semantic memory schema
  - temporal graph status
- Neo4j schema:
  - `neo4j-cli query :schema --credential default --format toon`
- Project checks:
  - `memory:status`
  - `ensure:runtime-modules`
  - `chopper:status`
  - `mixer:status`
  - `sync:runtime-hooks-neo4j:dry-run`
  - `sync:ecosystem-scope-neo4j:dry-run`
  - `sync:ecosystem-corpus-neo4j:dry-run`
  - `worker:archivist:dry-run`
  - `nossen:chatgpt-index --target both`

## Verified State

- Current worktree: `D:\projets\funesterie-worktrees\nossen-pack-identity-review-20260522`
- Current branch: `codex/nossen-pack-identity-review-20260522`
- Base: `origin/master` at `7aaa15b2 fix(nossen): repair Neo4j local/cloud memory sync`
- PR #87 is already merged into master.

## MCP

- Preflight sees the canonical ops thread `ops-update-20260522-mcp-neo4j-railway` as open/working.
- Shared MCP inbox check at `2026-05-22T16:30:40Z` returned:
  - active agents: `1`
  - jobs: `7`
  - queued: `6`
  - done: `1`
  - failed: `0`
- Local A11/Kiro inbox check reached the shared MCP endpoint and returned the same thread set.
- Semantic memory governance is configured and append-only by contract.
- Temporal Neo4j status is configured for `Event`, `Decision`, `Run`, and `Module` wiring.

## Neo4j

- Aura memory graph:
  - uri shape: `neo4j+s://...databases.neo4j.io`
  - database: `aa4680d2`
  - status: OK
  - nodes: `3171`
  - relationships: `17368`
- Local memory graph:
  - uri: `bolt://127.0.0.1:17687`
  - database: `neo4j`
  - status: OK
  - nodes: `3413`
  - relationships: `17750`
- The Neo4j schema is readable through `neo4j-cli`.
- The schema includes NOSSEN/Funesterie labels and constraints such as `Nossen*`, `Funesterie*`, `ChatGPTConversation`, `NossenConversation`, `MemoryNote`, and agent/runtime labels.

## ChatGPT Corpus Index

- Input: sorted local metadata index `cellaurojeffrey-chatgpt-sorted`.
- Records: `568`.
- Local graph:
  - existing: `568`
  - missing: `0`
  - written in this check: `0`
- Aura graph:
  - existing: `568`
  - missing: `0`
  - written in this check: `0`
- This check was metadata/index based. It does not require writing raw conversation text into this doc.

## Runtime Modules

Initial clean-worktree bootstrap exposed one real bug: `rome` was missing because `ensure-runtime-modules.cjs` only checked local `SERVER_ROOT/node_modules`, while this worktree intentionally reused dependencies via `NODE_PATH`.

Patch applied in this branch:

- `ensure-runtime-modules.cjs` now resolves packages from:
  - local `SERVER_ROOT/node_modules`
  - paths listed in `NODE_PATH`
  - Node package resolution fallback
- A regression test covers `@nossen/rome` resolution from `NODE_PATH`.

Verified after patch:

- `ensure:runtime-modules`: OK
- minimum modules: OK
- modules installed: `20/20`
- `rome`: installed from `npm:@nossen/rome`
- `chopper:status`: OK
- doctor score: `94`
- doctor status: `guarded`
- required missing: `0`
- only warning: `qflush` is a controlled runner and should not be imported at top level.
- `mixer:status`: OK
- primary recipe: `operation-bb`
- primary rumble: `Monster Point`
- top score: `86`

## Ecosystem Dry Runs

Runtime hooks dry-run:

- modules: `11`
- links: `49`
- source paths present: `26`
- watched files present: `1`

Ecosystem scope dry-run:

- repos: `27`
- private repos: `25`
- public repos: `2`
- curated repo profiles: `15`
- repos needing curation: `7`
- local modules: `12`
- local modules present: `10`
- packages: `15`
- contracts: `9`
- contracts present: `5`
- semantic tools: `10`
- access profiles: `4`
- identity profiles: `56`
- identity hashtags: `213`
- links: `3760`

Ecosystem corpus dry-run:

- source cards: `71`
- repo cards: `27`
- repo briefs: `27`
- domains: `9`
- restricted cards: `2`
- private metadata cards: `67`
- public summary cards: `2`
- identity profiles: `45`
- identity hashtags: `138`
- links: `5515`

Identity archivist dry-run:

- proposals: `114`
- accepted: `114`
- needs review: `0`
- functional tags: `149`
- narrative tags: `68`
- visual tags: `15`
- identity tags: `232`
- source card patches: `71`
- Neo4j relations proposed: `1742`

## What Is Still Uncertain

- Runtime artifacts under `a11/runtime` are generated and ignored. They are valid for this local worktree after bootstrap, but they are not a tracked source of truth.
- This continuation performed dry-runs for graph syncs and archivist review. It did not perform new Neo4j write operations.
- The shared MCP ops thread still has pending roll-call participants beyond Codex/ChatGPT.

## Next Direct Path

1. Merge the runtime bootstrap fix and this context pack.
2. After merge, rerun `ensure:runtime-modules`, `chopper:status`, `mixer:status`, and `memory:status` from a fresh worktree to confirm clean-worktree reproducibility.
3. If the user wants corpus promotion, run the write-capable graph/corpus commands only in a bounded maintenance window:
   - `sync:runtime-hooks-neo4j`
   - `sync:ecosystem-corpus-neo4j`
   - `worker:archivist --write-corpus`
4. Post a no-secrets MCP ops update with the final merge/verification status.
