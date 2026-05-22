# @nossen/qflush

QFlush is a portable command-line orchestrator for local automation, runtime
modules, compose files, routing lanes, workflow packets, and supervised service
processes.

It is designed for operators who need one small CLI that can inspect, prepare,
start, stop, and clean a modular workspace without wiring every service by hand.

## Install

```powershell
npm install -g @nossen/qflush
qflush --help
```

For project-local use:

```powershell
npm install @nossen/qflush
npx qflush --help
```

## What It Does

- Detects runtime modules and starts selected services.
- Generates missing environment and config files.
- Supervises background processes and stores logs under `.qflush/logs`.
- Reads `qflush.yml` or `qflush.fcl` compose definitions.
- Keeps legacy compose file names working for existing projects.
- Routes lanes with fallback scoring and circuit-breaker state.
- Applies workflow packets from JSON or PNG carriers.
- Exposes small automation helpers for modular runtime flows.

## CLI

| Command | Purpose |
| --- | --- |
| `qflush start` | Launch detected or selected modules. |
| `qflush kill` | Stop supervised processes. |
| `qflush purge` | Clear caches, logs, sessions, and supervisor state. |
| `qflush inspect` | Show active services and ports. |
| `qflush config` | Generate missing configuration files. |
| `qflush compose up` | Start modules from `qflush.yml` or `qflush.fcl`. |
| `qflush compose down` | Stop composed services and clear supervisor state. |
| `qflush compose logs <name>` | Tail a supervised module log. |
| `qflush doctor` | Run local health checks. |
| `qflush tool-run` | Execute a guarded tool command through QFlush. |

## Examples

```powershell
qflush start
qflush start --service rome --path D:/rome
qflush start --service nezlephant --service freeland --fresh
qflush compose up --background
qflush compose logs rome
qflush purge --fresh
qflush doctor
```

## Programmatic Use

```ts
import { buildPipeline, executePipeline } from "@nossen/qflush";

const { pipeline, options } = buildPipeline(["start", "--service", "rome"]);
await executePipeline(pipeline, options);
```

## Runtime Dependencies

QFlush can work with companion modules from the public package set:

- `@nossen/bat`
- `@nossen/envaptex`
- `@nossen/freeland`
- `@nossen/nezlephant`
- `@nossen/rome`

Installations should resolve from npmjs by default, or from a configured
internal registry when a private mirror is required.

## Quality Gates

Run these checks before publishing or tagging a release:

```powershell
npm install
npm run build
npm test
npm pack --dry-run
```

The published package exposes the `qflush` binary from `dist/cli.js`; keep the
compiled `dist` output current before release.

## Publishing

```powershell
npm version patch
npm run build
npm test
npm publish --access public
```

For JFrog, generate `.npmrc.jfrog` with `scripts/jfrog/Write-JFrogNpmrc.ps1`
and publish through the repository manifest.

## License

See the repository license files for commercial and non-commercial terms.

## Support NOSSEN

NOSSEN packages stay public and usable under their license. If this package helps your workflow, choose any support amount that fits your situation. Contributions support Funesterie infrastructure, releases, and maintenance:

- Email: funeste38@gmail.com
- Wero: `+33 7 83 46 37 61` (choose your amount)
- PayPal: https://paypal.me/funeste38 (choose your amount)
- Stripe/card support: https://buy.stripe.com/7sYfZhfKW2DSffZgWU7Re01
- Contact, invoice, sponsorship or custom support: https://funesterie.me/contact/

Support is voluntary; there is no fixed package price.
