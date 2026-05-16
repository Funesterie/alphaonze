# Codex G - D Drive Cleanup Dry-Run Result - 2026-05-16

Status: dry-run only. No file was moved, deleted, or launched from G:\.

## Generated reports

- Audit JSON: `D:\projets\funesterie\docs\ops_tmp\d-drive-audit-20260516-115934\d-drive-audit.json`
- Audit Markdown: `D:\projets\funesterie\docs\ops_tmp\d-drive-audit-20260516-115934\d-drive-audit.md`
- Quarantine plan: `D:\projets\funesterie\docs\ops_tmp\cleanup-plan-20260516-120338\quarantine-plan.json`
- Backup manifest: `D:\projets\funesterie\docs\ops_tmp\backup-manifest-20260516-120535\backup-manifest.json`

## Runtime health before cleanup

- Local A11 `http://127.0.0.1:3000/api/health`: down
- Local K44 `http://127.0.0.1:3001/api/health`: down
- Local MCP `http://127.0.0.1:8787/health`: ok
- Local MCP `http://127.0.0.1:8788/health`: ok
- Local MCP `http://127.0.0.1:8789/health`: ok
- Public A11 / K44 / MCP health checks were ok in the previous probe.

## Safe quarantine candidates

These are the only automatic quarantine candidates from the dry-run plan:

| Path | Size | Risk | Note |
| --- | ---: | --- | --- |
| `D:\tmp\Documents\loas11.iso` | 4.58 GB | medium | Large ISO under tmp |
| `D:\projets\funesterie\.codex-tmp` | 2.43 GB | medium | Codex temporary snapshots |
| `D:\codex-merge-work\alphaonze` | 0.94 GB | medium | External work clone |

Estimated space recovered if approved: about 7.95 GB.

The stale browser download candidates no longer exist, so they recover 0 GB.

## Manual review only

Do not move these until runtime repair and backup are complete:

| Path | Size | Risk | Note |
| --- | ---: | --- | --- |
| `D:\projets\funesterie\runtime\Corpus\Virtual Hard Disks\Lecteur USB\projets` | 96.33 GB | high | Huge mirrored project tree |
| `D:\projets\Win11_25H2_Lab_2.25` | 27.32 GB | medium | Large lab kit |
| `D:\projets\Flowframes` | 4.46 GB | medium | Large app/tooling |

## Duplicate pressure

Audit found 12 possible large duplicate groups. The biggest pressure is from the VHD/corpus mirror:

- `Win11_25H2_Lab_2.25.zip`: 2 copies, 54.64 GB total
- `Microsoft365DeviceLabKit.zpaq`: 2 copies, 54.64 GB total
- Janus Pro model shards duplicated between active tree and mirror: about 27.64 GB total across 7B/1B shards
- `codebook_1go.bin`: 4 copies, 4 GB total

These are not safe automatic moves because some copies are inside the corpus/VHD mirror.

## Backup dry-run

Backup manifest is ready but not executable yet because local A11 and K44 health checks are down.

Backup excludes:

- `node_modules`
- build outputs
- `.codex-tmp`
- `docs\ops_tmp`
- `runtime\Corpus\Virtual Hard Disks`

VHD mirror is excluded by default.

## Next safe command, only after Djeff validates

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File D:\projets\funesterie\scripts\cleanup\Prepare-DDriveQuarantinePlan.ps1 -Execute -ConfirmToken MOVE_TO_CLEANUP_REVIEW
```

This would move only the approved candidates into `D:\_cleanup_review\20260516-120338`.
