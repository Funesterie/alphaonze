# NOSSEN release alignment - 2026-05-18

This file is the GitHub-side source of record for the NOSSEN package reset
performed on 2026-05-18. The runtime package working copies live under
`runtime/modules`, which is intentionally ignored by this repository; this
manifest keeps GitHub aligned with the npmjs and JFrog publications.

## Registries

- npmjs scope: `@nossen`
- JFrog build name: `funesterie-dependency-sweep`
- JFrog build numbers: `20260518-5`, `20260518-6`, `20260518-7`, `20260518-8`

## Published package train

| Package | npmjs/JFrog version | GitHub tag |
| --- | ---: | --- |
| `@nossen/allmight` | `1.0.0` | `@nossen/allmight@1.0.0` |
| `@nossen/bat` | `1.0.0` | `@nossen/bat@1.0.0` |
| `@nossen/bat-system` | `1.0.0` | `@nossen/bat-system@1.0.0` |
| `@nossen/beam` | `1.0.0` | `@nossen/beam@1.0.0` |
| `@nossen/envapt-superimg` | `1.0.0` | `@nossen/envapt-superimg@1.0.0` |
| `@nossen/envaptex` | `1.0.0` | `@nossen/envaptex@1.0.0` |
| `@nossen/freeland` | `1.0.0` | `@nossen/freeland@1.0.0` |
| `@nossen/morphing` | `1.0.0` | `@nossen/morphing@1.0.0` |
| `@nossen/nezlephant` | `1.0.0` | `@nossen/nezlephant@1.0.0` |
| `@nossen/rome` | `1.0.0` | `@nossen/rome@1.0.0` |
| `@nossen/scentgate` | `1.0.0` | `@nossen/scentgate@1.0.0` |
| `@nossen/scream` | `1.0.0` | `@nossen/scream@1.0.0` |
| `@nossen/spyder` | `1.0.0` | `@nossen/spyder@1.0.0` |
| `@nossen/katana` | `1.0.0` | `@nossen/katana@1.0.0` |
| `@nossen/freeland-bros` | `1.0.0` | `@nossen/freeland-bros@1.0.0` |
| `@nossen/qflush-runner` | `1.0.0` | `@nossen/qflush-runner@1.0.0` |
| `@nossen/dragon-contracts` | `1.0.0` | `@nossen/dragon-contracts@1.0.0` |
| `@nossen/dragon-upstream` | `1.0.0` | `@nossen/dragon-upstream@1.0.0` |
| `@nossen/dragon` | `1.0.0` | `@nossen/dragon@1.0.0` |
| `@nossen/qflush` | `1.0.1` | `@nossen/qflush@1.0.1` |
| `@nossen/qflash` | `1.0.1` | `@nossen/qflash@1.0.1` |

## Patch notes

- `@nossen/qflush@1.0.0` remains public but is deprecated on npmjs because it
  referenced legacy `@funeste38/*` runtime dependencies.
- `@nossen/qflash@1.0.0` remains public but is deprecated on npmjs because its
  installer still referenced the legacy package name.
- New consumers should use `@nossen/qflush@^1.0.1` and
  `@nossen/qflash@^1.0.1`.

## Validation summary

- Base module install/build/test passes completed before publication.
- `@nossen/envaptex`: 16 test files, 283 tests passing.
- `@nossen/qflush`: 24 test files, 39 tests passing.
- `@nossen/qflash`: SmartChain smoke tests passing.
- Fresh install check: `@nossen/qflush-runner@1.0.0` resolves
  `@nossen/qflush@1.0.1`.
- Fresh install check: `@nossen/qflash@1.0.1` has no legacy installer reference.
