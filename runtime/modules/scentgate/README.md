# @nossen/scentgate

Ephemeral research capsule for structured notes, signals, and short-lived investigation context.

## Overview

- Captures investigation context without turning notes into permanent state.
- Keeps signals, observations, and capsule metadata structured.
- Useful for short research passes and agent handoffs.

## Install

```powershell
npm install @nossen/scentgate
```

## CLI

`scentgate` is exposed by this package.

```powershell
npx scentgate --help
```

## Signed job signals

Version 2.1 adds a small, closed notification contract for long-running jobs:
`job.completed`, `job.failed`, and `job.cancelled`. Signals are HMAC-SHA256
signed, expire quickly, bind an issuer/audience/job id, and support an external
nonce set for replay protection.

This API deliberately does not rename existing systems: BLOOP remains the
Neo4j memory sonar and EKKO remains the audio capture service. A signal may only
carry an optional `bloopReportId` that points to an existing BLOOP report.

## Package Details

| Field | Value |
| --- | --- |
| Package | `@nossen/scentgate` |
| Version | `2.1.0` |
| Type | CLI and library |
| Registry scope | `@nossen` |

## Quality Gates

| Task | Command |
| --- | --- |
| test | `npm run test` |

## Publishing

This package is part of the NOSSEN package train. Before publishing, run the quality gates, inspect `npm pack --dry-run`, then publish the immutable version to npmjs and mirror the same version to the Funesterie JFrog npm registry.

## Support NOSSEN

NOSSEN packages stay public and usable under their license. If this package helps your workflow, support Funesterie infrastructure, releases, and maintenance through:

- Wero: `+33 7 83 46 37 61`
- PayPal: https://paypal.me/funeste38
- Stripe/card checkout: https://funesterie.me/subscription
- Custom support or invoice: https://funesterie.me/contact/

Support is voluntary, but it keeps the registry, compute, and maintenance work alive.

## License

See the package license and repository license files for terms.
