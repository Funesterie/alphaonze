# NOSSEN Package Matrix

Updated: 2026-05-18

This matrix is the public package map for the NOSSEN reset. It tracks the
canonical npm scope, the source path used for packaging, and the release status
that GitHub, npmjs, and JFrog should stay aligned to.

## Packages

| Package | Version | Source path | Status |
| --- | ---: | --- | --- |
| `@nossen/allmight` | `1.0.0` | `runtime/modules/allmight` | Published to npmjs and JFrog |
| `@nossen/bat` | `1.0.0` | `runtime/modules/bat/packages/bat` | Published to npmjs and JFrog |
| `@nossen/bat-system` | `1.0.0` | `runtime/modules/bat/packages/bat-system` | Published to npmjs and JFrog |
| `@nossen/beam` | `1.0.0` | `runtime/modules/beam` | Published to npmjs and JFrog |
| `@nossen/envapt-superimg` | `1.0.0` | `runtime/modules/envaptex/envapt-superimg` | Published to npmjs and JFrog |
| `@nossen/envaptex` | `1.0.0` | `runtime/modules/envaptex` | Published to npmjs and JFrog |
| `@nossen/freeland` | `1.0.0` | `runtime/modules/freeland` | Published to npmjs and JFrog |
| `@nossen/freeland-bros` | `1.0.0` | `runtime/modules/freeland-bros` | Published to npmjs and JFrog |
| `@nossen/katana` | `1.0.0` | `runtime/modules/katana` | Published to npmjs and JFrog |
| `@nossen/morphing` | `1.0.0` | `runtime/modules/morphing` | Published to npmjs and JFrog |
| `@nossen/nezlephant` | `1.0.0` | `runtime/modules/nezlephant/nezlephant/nezlephant` | Published to npmjs and JFrog |
| `@nossen/qflush` | `1.0.1` | `a11/backend/libs` | Published to npmjs and JFrog |
| `@nossen/qflush-runner` | `1.0.0` | `runtime/modules/qflush/runner-package` | Published to npmjs and JFrog |
| `@nossen/rome` | `1.0.0` | `runtime/modules/rome` | Published to npmjs and JFrog |
| `@nossen/scentgate` | `1.0.0` | `runtime/modules/scentgate` | Published to npmjs and JFrog |
| `@nossen/scream` | `1.0.0` | `runtime/modules/scream` | Published to npmjs and JFrog |
| `@nossen/spyder` | `1.0.0` | `runtime/modules/spyder/packages/spyder` | Published to npmjs and JFrog |

## Release Rules

- New public packages use the `@nossen` scope only.
- Package names and CLI examples should use `qflush`; the early misspelling is
  retired.
- Every published package README should include the `Support NOSSEN` block:
  Wero `+33 7 83 46 37 61`, PayPal `https://paypal.me/funeste38`, Stripe/card
  checkout `https://funesterie.me/subscription`, and custom support
  `https://funesterie.me/contact/`.
- Every published package manifest should keep `funding.url` on
  `https://paypal.me/funeste38` for npm/JFrog compatibility, with the full
  `donations` object for Wero, PayPal, Stripe, and contact links.
- npmjs versions are immutable, so README-only fixes require a patch release if
  the npm package page must change.
- GitHub tags should use the form `@nossen/<package>@<version>`.

## Validation Baseline

- Run package-local build and test scripts before publishing.
- Run `npm pack --dry-run` from each package source path.
- Publish to npmjs first, then mirror the same tarball version to JFrog.
- Update `docs/ops/NOSSEN_RELEASE_ALIGNMENT_2026-05-18.md` after every package
  train change.
