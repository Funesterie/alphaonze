# Funeste38 Package Matrix

Updated: 2026-04-02

## Packages

| Package | npm | Canonical repo | Default branch | Current CI state | Notes |
| --- | --- | --- | --- | --- | --- |
| `@funeste38/qflush` | `4.0.16` | `Funesterie/a11qflushrailway` | `main` | Green | Latest GitHub run on `main` is green. |
| `@funeste38/spyder` | `1.0.6` | `Funesterie/spyder` | `main` | Green | `CI`, `with supervisor`, `no supervisor`, and `safe embedded services` are all green on latest `main`. |
| `@funeste38/bat` | `1.0.3` | `jEFFLEZ/bat` | `main` | Green | Latest `CI / Publish` is green; old publish failures remain only in history. |
| `@funeste38/allmight` | `1.0.0` | `jEFFLEZ/allmight` | `main` | Green | Baseline CI now verifies install, tests, build and `npm pack --dry-run`. |
| `@funeste38/envaptex` | `1.0.5` | `jEFFLEZ/envapt-multi` | `feature/nezlephant-pr` | Green | Default branch was switched to the live branch on 2026-04-02, workflows now follow it, and the latest `tests`, `commitlint`, `codecov`, and `publish-n-release` runs are green. |
| `@funeste38/rome` | `1.5.5` | `Funesterie/rome` | `main` | Green | Baseline CI now verifies install, build and `npm pack --dry-run`. |
| `@funeste38/morphing` | `0.1.5` | `jEFFLEZ/morphing` | `main` | Green | Baseline CI now verifies install, tests, build and `npm pack --dry-run`. |
| `@funeste38/freeland` | `0.2.2` | `jEFFLEZ/freeland` | `main` | Green | Baseline CI verifies install, tests, build and `npm pack --dry-run`; default branch was normalized from `master` to `main` on 2026-04-02. |
| `@funeste38/nezlephant` | `1.0.4` | `jEFFLEZ/nezlephant` | `main` | Green | Nested package source was realigned with npm `1.0.4`, got a lockfile, and now has baseline CI. |
| `@funeste38/scream` | `0.1.0` | `Funesterie/scream` | `main` | Green | Package, README, tests and CI were added on 2026-04-02. npm publish returned success, but registry visibility had not propagated yet from this machine at the last check. |

## Service Repos

| Repo | Role | Default branch | Current CI state | Notes |
| --- | --- | --- | --- | --- |
| `Funesterie/a11qflushrailway` | Canonical `qflush` service repo | `main` | Green | Latest CI on `main` is green. |
| `Funesterie/a11backendrailway` | A11 backend service | `main` | Manual only | Self-hosted workflow was switched to `workflow_dispatch` to avoid false red runs. |
| `Funesterie/qflush` | Legacy/hybrid repo | `main` | Green on repair branch | Latest `repair-spyder-release` runs are green; not the canonical package repo. |

## Branch Normalization Notes

- `jEFFLEZ/envapt-multi`: normalized on 2026-04-02 by making `feature/nezlephant-pr` the default branch and aligning workflows with it.
## Recommended Next Pass

1. Normalize `envapt-multi` by deciding whether `feature/nezlephant-pr` should become the long-term default branch or be merged back into `main`.
2. Re-check npm registry propagation for `@funeste38/scream` from a clean network path, since publish succeeded but `npm view` still returned `404` on this machine during the first minutes after publish.
