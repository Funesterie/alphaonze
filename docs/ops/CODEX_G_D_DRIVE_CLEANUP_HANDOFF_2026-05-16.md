# Handoff To Codex On G - D Drive Cleanup

Audience: Codex instance currently operating from / around `G:`.

Goal: take over the D drive cleanup/backup operation without running anything
from `G:` and without deleting data.

## Situation

The disk pressure is on `D:\`, especially under `D:\projets`.

Known read-only findings:

- `D:\` used: about 296 GB
- `D:\projets`: about 268 GB
- `D:\projets\funesterie`: about 200 GB
- `D:\projets\funesterie\runtime`: about 167 GB
- `D:\projets\funesterie\runtime\Corpus`: about 164 GB
- `D:\projets\funesterie\runtime\Corpus\Virtual Hard Disks`: about 163 GB

The main suspected mirror is:

```txt
D:\projets\funesterie\runtime\Corpus\Virtual Hard Disks\Lecteur USB\projets
```

It appears to contain copied chunks of `D:\projets`, including another
`funesterie` tree, Windows lab artifacts, Flowframes, Janus models and git
objects.

## Hard Rules

1. Do not delete anything directly.
2. Do not move the VHD mirror yet.
3. Do not run old cleanup scripts.
4. Do not touch active runtime paths while repair/orchestrator workers are
   running.
5. Use quarantine moves only after explicit confirmation.
6. Keep all reports in `D:\projets\funesterie\docs\ops_tmp` or `docs\ops`.
7. No secrets in reports, MCP notes or chat.

## Deprecated Danger

This file is now marked deprecated:

```txt
D:\projets\funesterie\a11\docs\RUNTIME_CLEANUP.md
```

Reason: it describes `D:\projets\funesterie\runtime` as a small old runtime,
but the current tree contains large Corpus/VHD data. Do not run the old
`cleanup-old-runtime.ps1` flow.

## Current Safe Scripts

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

All are dry-run by default. They do not delete files.

## Existing Reports

Latest generated reports:

```txt
D:\projets\funesterie\docs\ops_tmp\d-drive-audit-current\d-drive-audit.md
D:\projets\funesterie\docs\ops_tmp\d-drive-audit-current\d-drive-audit.json
D:\projets\funesterie\docs\ops_tmp\cleanup-plan-20260516-112937\quarantine-plan.json
D:\projets\funesterie\docs\ops_tmp\backup-manifest-20260516-112937\backup-manifest.json
```

Main plan:

```txt
D:\projets\funesterie\docs\ops\D_DRIVE_CLEANUP_BACKUP_PLAN_2026-05-16.md
```

## Safe Quarantine Candidates

Dry-run found these candidates:

- `D:\tmp\Documents\loas11.iso` - about 4.58 GB
- `D:\projets\funesterie\.codex-tmp` - about 2.43 GB
- `D:\codex-merge-work\alphaonze` - about 0.94 GB

Total first-pass gain: about 7.95 GB.

Only move these after confirmation, using:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File D:\projets\funesterie\scripts\cleanup\Prepare-DDriveQuarantinePlan.ps1 -Execute -ConfirmToken MOVE_TO_CLEANUP_REVIEW
```

This moves to `D:\_cleanup_review\<timestamp>`, not deletion.

## Manual Review Only

Do not move yet:

- `D:\projets\funesterie\runtime\Corpus\Virtual Hard Disks\Lecteur USB\projets`
- `D:\projets\Win11_25H2_Lab_2.25`
- `D:\projets\Flowframes`

Those need a separate review after runtime repair and backup planning.

## Duplicate Highlights

Large duplicates seen in the audit:

- `Microsoft365DeviceLabKit.zpaq`: 2 copies, about 54.64 GB total
- `Win11_25H2_Lab_2.25.zip`: 2 copies, about 54.64 GB total
- Windows 25H2 ISO: 2 copies, about 13.23 GB total
- Janus Pro 7B shard 1: 2 copies, about 18.60 GB total
- Janus Pro 7B shard 2: 2 copies, about 9.04 GB total
- Janus Pro 1B model: 2 copies, about 7.78 GB total
- `codebook_1go.bin`: 4 copies, about 4 GB total
- Flowframes Torch CUDA files duplicated in the VHD mirror

## Backup Readiness

The backup manifest dry-run currently says:

- MCP `8787` OK
- MCP `8788` OK
- A11 `3000` down
- K44 `3001` down

Do not perform the large backup until A11/K44 health is green or intentionally
declared out of scope.

## Recommended Next Steps For Codex On G

1. Read this handoff and the main cleanup plan.
2. Check MCP heartbeat/inbox.
3. Check whether repair/orchestrator workers are still running.
4. Re-run the three scripts in dry-run only.
5. If results match, ask Djeff for confirmation for first-pass quarantine.
6. Move only the safe candidates to `D:\_cleanup_review`.
7. Recheck A11/K44/MCP health.
8. Prepare backup target and manifest.
9. Leave VHD mirror untouched until a dedicated review.
