# NOSSEN release alignment - 2026-05-23

This file is the GitHub-side source of record for the NOSSEN 2.0 stable package
train published on 2026-05-23. The runtime package working copies live under
`runtime/modules`, which is intentionally ignored by this repository; this
manifest keeps GitHub aligned with the npmjs and Google Artifact Registry
publications.

## Registries

- npmjs scope: `@nossen`
- npmjs tag: `latest`
- Google Artifact Registry: `europe-west4-npm.pkg.dev/alphaonze/funesterie-npm`
- Google tags: `latest`, `stable`

## Published package train

| Package | Published version | Canonical tag name |
| --- | ---: | --- |
| `@nossen/allmight` | `2.0.0` | `@nossen/allmight@2.0.0` |
| `@nossen/bat` | `2.0.0` | `@nossen/bat@2.0.0` |
| `@nossen/bat-system` | `2.0.0` | `@nossen/bat-system@2.0.0` |
| `@nossen/beam` | `2.0.0` | `@nossen/beam@2.0.0` |
| `@nossen/envapt-superimg` | `2.0.0` | `@nossen/envapt-superimg@2.0.0` |
| `@nossen/envaptex` | `2.0.0` | `@nossen/envaptex@2.0.0` |
| `@nossen/freeland` | `2.0.0` | `@nossen/freeland@2.0.0` |
| `@nossen/freeland-bros` | `2.0.0` | `@nossen/freeland-bros@2.0.0` |
| `@nossen/katana` | `2.0.0` | `@nossen/katana@2.0.0` |
| `@nossen/morphing` | `2.0.0` | `@nossen/morphing@2.0.0` |
| `@nossen/nezlephant` | `2.0.0` | `@nossen/nezlephant@2.0.0` |
| `@nossen/qflush` | `2.0.0` | `@nossen/qflush@2.0.0` |
| `@nossen/qflush-runner` | `2.0.0` | `@nossen/qflush-runner@2.0.0` |
| `@nossen/logic-reduce` | `2.0.0` | `@nossen/logic-reduce@2.0.0` |
| `@nossen/rome` | `2.0.0` | `@nossen/rome@2.0.0` |
| `@nossen/scentgate` | `2.0.0` | `@nossen/scentgate@2.0.0` |
| `@nossen/scream` | `2.0.0` | `@nossen/scream@2.0.0` |
| `@nossen/spyder` | `2.0.0` | `@nossen/spyder@2.0.0` |
| `@nossen/dragon-contracts` | `2.0.0` | `@nossen/dragon-contracts@2.0.0` |
| `@nossen/dragon-upstream` | `2.0.0` | `@nossen/dragon-upstream@2.0.0` |
| `@nossen/dragon` | `2.0.0` | `@nossen/dragon@2.0.0` |

## Patch notes

- The public train is now `2.0.0` across all packages.
- New consumers should use `@nossen/*@^2.0.0`.
- Legacy `1.0.x` packages remain immutable on npmjs but are not the current
  supported train.
- The first restricted private adapter is
  `@funesterieindustry/logic-reduce-nossen@2.0.0`; it depends on the public
  `@nossen/logic-reduce@2.0.0` core.
- `@funeste` remains the preferred private org scope, but restricted package
  publication there is blocked until org private-package billing is enabled.

## Validation summary

- Package-local build/test/pack passes completed before publication.
- `@nossen/qflush`: 25 test files, 41 tests passing.
- Dragon workspace: build, typecheck and audit pass with `0` vulnerabilities.
- npmjs: `latest = 2.0.0` for all 21 packages.
- npmjs fresh install: all 21 packages install together with audit `0`.
- Google Artifact Registry: `latest = 2.0.0` and `stable = 2.0.0` for all 21
  packages.
- Google Artifact Registry fresh install: all 21 packages install together with
  audit `0`.
- Private npmjs: `@funesterieindustry/logic-reduce-nossen@2.0.0` is restricted,
  tagged `latest`, and fresh-installs with `@nossen/logic-reduce@2.0.0` with
  audit `0`.
