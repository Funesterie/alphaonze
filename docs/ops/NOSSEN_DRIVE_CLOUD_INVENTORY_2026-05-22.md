# NOSSEN Drive and cloud inventory - 2026-05-22

Status: local inventory and documentation patch only. No Drive corpus was bulk-indexed, no file content was copied, and no Neo4j write was performed in this pass.

## Verification sources

- Preflight checked first with `npm --prefix D:\projets\funesterie\a11mcp run session:preflight -- --print`.
- Neo4j schema checked with `neo4j-cli query :schema --format toon` before Cypher reads.
- Local scans covered `D:\projets\funesterie`, `D:\projets\funesterie\a11mcp`, `D:\agent-bus`, `C:\Users\Djeff\.codex\memories`, the visible OneDrive roots, and the current NOSSEN worktree.

## Real state

- Google OAuth is documented as split by purpose: A11/K44 login uses identity-only scopes, while Vivy media is the separate lane for Drive and YouTube scopes.
- Google Cloud is documented as a later cutover path, after OAuth and payment stability. Current docs mention Artifact Registry, package mirrors, and future stable workload migration, not a completed App Engine or Cloud Run production cutover.
- Microsoft/OneDrive exists as local context and storage roots. The canonical agent-bus guidance says scripts should prefer `A11_AGENT_BUS_DIR` / `AGENT_BUS_DIR`, then avoid drifting back into old OneDrive or Google Drive paths.
- Google Drive is referenced as a local mount at `G:\Mon Drive`; it is not part of the enabled NOSSEN source-index example by default.
- Neo4j Aura contains cloud/auth/Drive references, but only as thin metadata today: the aggregate read found matching nodes mostly under `FunesterieEcosystemNode`, plus smaller matches in conversations, agents, endpoint, capability, and job metadata.
- The current NOSSEN source index example previously enabled only the workspace root and kept the Seagate and OneDrive Corpus roots disabled.

## Module state

- Runtime verification after PR #88 showed Chopper can see 20 modules and has no required module missing.
- The backend currently depends on these installed `@nossen` packages: `allmight`, `bat`, `beam`, `envaptex`, `freeland`, `freeland-bros`, `morphing`, `nezlephant`, `qflush`, `rome`, `scream`, and `spyder`.
- The release alignment doc lists the broader published train, including Dragon packages, Katana, Scentgate, runner packages, and deprecated/updated Qflush notes.
- This patch wires that published train into `sync:ecosystem-scope-neo4j`, so every listed `@nossen` package becomes a first-class package entry even when its source package is outside the monorepo checkout.
- The OneDrive Funesterie backup tree contains a broader module mirror, but that mirror is still a disabled source root until an explicit metadata-only index is reviewed.

## Patch decision

`scripts/nossen/nossen-sources.example.json` now declares the known local/cloud roots as disabled private roots:

- main Funesterie workspace;
- Seagate backup root;
- OneDrive Corpus;
- OneDrive A11 memory;
- OneDrive Funesterie A11 memory;
- OneDrive Funesterie modules backup;
- OneDrive Funesterie Gemini handoff;
- Google Drive `Mon Drive`;
- canonical `D:\agent-bus`.

The default remains conservative: only the workspace is enabled. Broad cloud-drive roots are present for review, but must be enabled deliberately.

## Still uncertain

- The local scan has not authenticated into online Google Drive, Microsoft Graph, SharePoint, Google Cloud, or App Engine APIs. It only used local mounts, local docs, local MCP context, and Neo4j metadata.
- Sensitive-looking credential filenames exist in the scanned local surfaces by filename category. Their contents were not opened or copied.

## Next direct path

1. Add a reviewed metadata-only indexing profile for selected cloud roots, still with secret filters and `--max-entries`.
2. Run `npm run nossen:index -- --config scripts\nossen\nossen-sources.example.json --root <reviewed-root> --max-entries <n>` without Neo4j sync.
3. Review `runtime/nossen/source-index/nossen-source-index.json` for accidental sensitive filenames.
4. Only after review, sync safe metadata to local and Aura with `--sync --target both`.
5. Sync the reviewed ecosystem scope to local and Aura after verifying the new package train dry-run.

## Validation

- `node --test ./test/ecosystem-scope.node.test.cjs` passes.
- `npm run nossen:index:dry` passes with 1 enabled root, 200 entries, 11 skipped secret-like entries, and 0 errors.
- `npm run sync:ecosystem-scope-neo4j:dry-run` passes with 31 packages and 4480 links.
- `npm run sync:ecosystem-corpus-neo4j:dry-run` passes with 87 source cards and 6997 links.
- `npm run ensure:runtime-modules` passes with the runtime `NODE_PATH`; the minimum module gate is OK.
- `npm run chopper:status` passes with 20 installed modules, 0 required missing, and doctor status `guarded`.
