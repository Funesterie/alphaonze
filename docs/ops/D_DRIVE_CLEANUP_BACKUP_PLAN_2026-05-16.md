# D Drive Cleanup And Backup Plan - 2026-05-16

Status: audit/read-only. Do not delete or move runtime data while repair agents
or orchestrator workers are active.

## Current Finding

The storage pressure is concentrated under `D:\projets`.

Known large areas from the read-only audit:

- `D:\projets`: about 268 GB
- `D:\projets\funesterie`: about 200 GB
- `D:\projets\funesterie\runtime`: about 167 GB
- `D:\projets\funesterie\runtime\Corpus`: about 164 GB
- `D:\projets\funesterie\runtime\Corpus\Virtual Hard Disks`: about 163 GB

The risky duplicate is the mirror:

```txt
D:\projets\funesterie\runtime\Corpus\Virtual Hard Disks\Lecteur USB\projets
```

This appears to contain a copied `D:\projets` tree, including another
`funesterie` tree. That mirror explains why scans and patch operations can
become slow or confused.

## Important Warning

`a11/docs/RUNTIME_CLEANUP.md` and `a11/docs/DUPLICATE_ANALYSIS.md` are outdated
for the current disk state. They describe `D:\projets\funesterie\runtime` as a
small old runtime, but it now contains the large Corpus/VHD mirror.

Do not run old cleanup scripts until they are rewritten.

## Safe Policy

1. No direct delete.
2. No move from active runtime while repair agents are running.
3. First produce manifests and size reports.
4. Quarantine only small, obvious candidates first.
5. Backup only after A11/K44/Vivy/MCP/Neo4j health checks are green.
6. Keep one private backup manifest with file sizes and hashes for important
   artifacts.

## Cleanup Order

### Phase 1 - No-risk cleanup candidates

These can be moved to `D:\_cleanup_review` after confirmation:

- incomplete browser downloads such as `*.crdownload`
- temporary ISO under `D:\tmp\Documents` if no longer mounted/used
- stale `D:\projets\funesterie\.codex-tmp`
- stale clone work dirs outside the main repo, after checking `git status`

### Phase 2 - Worktree and clone review

Review these before moving:

- `D:\codex-merge-work`
- `D:\codex-pr-eval`
- `D:\projets\funesterie-codex-*`
- `D:\projets\funesterie-ci-*`
- `D:\projets\funesterie-worktrees`

Dirty trees must not be removed. Create a patch/branch/backup first.

### Phase 3 - VHD mirror decision

The big win is the mirror under:

```txt
D:\projets\funesterie\runtime\Corpus\Virtual Hard Disks\Lecteur USB\projets
```

Before touching it:

1. Confirm whether it is a real backup, a generated mirror, or a mounted VHD dump.
2. Confirm the real active runtime paths.
3. Create a manifest of top files and duplicate hashes.
4. Make a backup of unique user/corpus assets.
5. Only then quarantine or replace the mirror with a documented pointer.

## Backup Strategy

Target state before the big backup:

- repo health known
- runtime paths known
- Neo4j local/Aura export status known
- MCP worker status known
- semantic/corpus files synced
- dangerous old cleanup docs marked deprecated

Backup should include:

- `D:\projets\funesterie` excluding generated caches and the VHD mirror unless
  explicitly requested
- `D:\agent-bus`
- key docs/tasks/runtime manifests
- Neo4j export/dump if available
- MCP configs without exposing secrets in public docs

Backup should exclude by default:

- `node_modules`
- `.pnpm-store`
- `.npm-cache`
- `.git\objects` if a clean remote exists and no local-only work remains
- build outputs: `dist`, `build`, `.next`, `.turbo`
- the VHD mirror until it has been reviewed

## New Tools

Read-only audit:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File D:\projets\funesterie\scripts\cleanup\Audit-DDriveStructure.ps1
```

Dry-run quarantine plan:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File D:\projets\funesterie\scripts\cleanup\Prepare-DDriveQuarantinePlan.ps1
```

Backup manifest dry-run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File D:\projets\funesterie\scripts\backup\New-FunesterieBackupManifest.ps1
```

None of these scripts delete files.
