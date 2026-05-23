# NOSSEN Package Matrix

Updated: 2026-05-23

This matrix is the public package map for the NOSSEN reset. It tracks the
canonical npm scope, the source path used for packaging, and the release status
that npmjs and Google Artifact Registry should stay aligned to.

## Packages

| Package | Version | Source path | Status |
| --- | ---: | --- | --- |
| `@nossen/allmight` | `2.0.0` | `runtime/modules/allmight` | npmjs `latest`; Google `latest`, `stable` |
| `@nossen/bat` | `2.0.0` | `runtime/modules/bat/packages/bat` | npmjs `latest`; Google `latest`, `stable` |
| `@nossen/bat-system` | `2.0.0` | `runtime/modules/bat/packages/bat-system` | npmjs `latest`; Google `latest`, `stable` |
| `@nossen/beam` | `2.0.0` | `runtime/modules/beam` | npmjs `latest`; Google `latest`, `stable` |
| `@nossen/envapt-superimg` | `2.0.0` | `runtime/modules/envaptex/envapt-superimg` | npmjs `latest`; Google `latest`, `stable` |
| `@nossen/envaptex` | `2.0.0` | `runtime/modules/envaptex` | npmjs `latest`; Google `latest`, `stable` |
| `@nossen/freeland` | `2.0.0` | `runtime/modules/freeland` | npmjs `latest`; Google `latest`, `stable` |
| `@nossen/freeland-bros` | `2.0.0` | `runtime/modules/freeland-bros` | npmjs `latest`; Google `latest`, `stable` |
| `@nossen/katana` | `2.0.0` | `runtime/modules/katana` | npmjs `latest`; Google `latest`, `stable` |
| `@nossen/morphing` | `2.0.0` | `runtime/modules/morphing` | npmjs `latest`; Google `latest`, `stable` |
| `@nossen/nezlephant` | `2.0.0` | `runtime/modules/nezlephant/nezlephant/nezlephant` | npmjs `latest`; Google `latest`, `stable` |
| `@nossen/qflush` | `2.0.0` | `a11/backend/libs` | npmjs `latest`; Google `latest`, `stable` |
| `@nossen/qflush-runner` | `2.0.0` | `runtime/modules/qflush/runner-package` | npmjs `latest`; Google `latest`, `stable` |
| `@nossen/rome` | `2.0.0` | `runtime/modules/rome` | npmjs `latest`; Google `latest`, `stable` |
| `@nossen/scentgate` | `2.0.0` | `runtime/modules/scentgate` | npmjs `latest`; Google `latest`, `stable` |
| `@nossen/scream` | `2.0.0` | `runtime/modules/scream` | npmjs `latest`; Google `latest`, `stable` |
| `@nossen/spyder` | `2.0.0` | `runtime/modules/spyder/packages/spyder` | npmjs `latest`; Google `latest`, `stable` |
| `@nossen/dragon-contracts` | `2.0.0` | `a11/dragon/packages/contracts` | npmjs `latest`; Google `latest`, `stable` |
| `@nossen/dragon-upstream` | `2.0.0` | `a11/dragon/packages/upstream` | npmjs `latest`; Google `latest`, `stable` |
| `@nossen/dragon` | `2.0.0` | `a11/dragon/apps/dragon-daemon` | npmjs `latest`; Google `latest`, `stable` |

## Release Rules

- New public packages use the `@nossen` scope only.
- Private Funesterie operator packages use `@funeste/*` first, with
  `@funesterieindustry/*` only as an npm-permission fallback.
- Dual packages are split into a public reusable core plus a private
  Funesterie adapter. Do not publish one package name as both public and
  private.
- Package names and CLI examples should use `qflush`; the early misspelling is
  retired.
- npmjs versions are immutable, so README-only fixes require a patch release if
  the npm package page must change.
- GitHub tags should use the form `@nossen/<package>@<version>`.

## Private And Dual Lanes

The package liaison map tracks the next private and dual extraction waves:

```powershell
npm run nossen:packages
```

Source of truth:

- `scripts/nossen/nossen-package-liaisons.manifest.json`
- `docs/packages/NOSSEN_PUBLIC_PRIVATE_PACKAGE_POLICY.md`

## Validation Baseline

- Run package-local build and test scripts before publishing.
- Run `npm pack --dry-run` from each package source path.
- Publish to npmjs first, then mirror the same train to Google Artifact
  Registry.
- After publish, verify `latest` on npmjs, `latest` and `stable` on Google, then
  run a fresh install check from each registry.
- Update `docs/ops/NOSSEN_RELEASE_ALIGNMENT_2026-05-18.md` after every package
  train change.
