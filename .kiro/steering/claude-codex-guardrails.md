# Claude/Kiro Guardrails

These rules are operational guardrails for Claude when working in this repository.

## Current workspace

- Treat `D:\projets\funesterie-google-artifact-registry` as the active A11 rebuild/deploy workspace unless the user explicitly says to work in `D:\projets\funesterie`.
- Treat `D:\projets\funesterie` as historical/runtime/backfill space. It may contain old branches, logs, backups, and active local runtime data.
- Do not run broad dependency updates, `npm audit fix`, `npm update`, mass rewrites, or git cleanup in either workspace without asking Codex or the user first.

## NPM scope

- `@funeste38` is the old npm scope and must not be used for new installs, junctions, package names, docs, or imports.
- The live public scope is `@nossen`.
- Do not try to deprecate `@funeste38/*` packages unless the npm account/token with permission for that scope is confirmed. Without access, document migration to `@nossen/*` instead.

## Local global junctions

Expected global local package links:

- `@nossen/qflush` -> `D:\projets\funesterie\runtime\modules\qflush`
- `@nossen/freeland` -> `D:\projets\funesterie\runtime\modules\freeland`
- `@nossen/nezlephant` -> `D:\projets\funesterie\runtime\modules\nezlephant`
- `@nossen/spyder` -> `D:\projets\funesterie\runtime\modules\spyder\packages\spyder`

Do not point `@nossen/spyder` at `runtime\modules\spyder` root. That root is a private legacy qflush mirror and its package name is intentionally not `@nossen/spyder`.

## Safety

- Do not print secrets, OAuth credentials, npm tokens, Red Hat tokens, Railway variables, Google/Entra secrets, or raw `.env` values.
- Before deleting, moving, or recursively replacing files, verify the resolved path and explain the scope.
- On Windows junctions, remove the junction itself only after checking it is a reparse point. Do not recursively delete a target directory by accident.
