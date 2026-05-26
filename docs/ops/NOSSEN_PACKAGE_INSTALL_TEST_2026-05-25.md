# NOSSEN Package Install Test - 2026-05-25

## Purpose

This note records the full npm scope audit and install smoke for the Funesterie
and NOSSEN package split:

- `@nossen/*` is public and installable without an npm token.
- `@funeste/*` is private and requires authenticated npm access.
- `a11-coder` is a legacy unscoped public package owned from the `funeste`
  organization package list.

No token, client secret, webhook, private key or `.env` value is included here.

## Registry Setup

Both scopes use npmjs:

```ini
@nossen:registry=https://registry.npmjs.org/
@funeste:registry=https://registry.npmjs.org/
```

The auth token belongs only in the local user npm config or a secret store. It
must not be committed, pasted into docs, or printed in logs.

## Scope Inventory

`npm access list packages` returned:

- `funeste`: 38 package entries.
- `@funeste/*`: 37 scoped private packages.
- `a11-coder`: 1 unscoped public package owned from the same org list.
- `@nossen/*`: 36 scoped public packages.
- Total unique packages audited: 74.

Access calibration result:

- `@funeste/*`: `private`, anonymous `npm view` denied.
- `@nossen/*`: `public`, anonymous `npm view` allowed.
- `a11-coder`: `public`, anonymous `npm view` allowed.
- Mismatches: 0.

## Public Install Smoke

Anonymous install was tested in a temporary empty project with a temporary npmrc
that only contained the public npmjs registry.

Command shape:

```powershell
npm install --ignore-scripts --userconfig <public-only-npmrc> <all-public-packages>
```

Public set:

- 36 `@nossen/*` packages.
- 1 legacy public package: `a11-coder`.

Result:

- Requested: 37.
- Installed: 37.
- `npm ls --depth=0 --json`: OK.
- Temporary install directory removed.

## Private Install Smoke

Authenticated install was tested in a separate temporary empty project using the
local user npm configuration.

Command shape:

```powershell
npm install --ignore-scripts <all-private-funeste-packages>
```

Private set:

- 37 `@funeste/*` packages.

Result:

- Requested: 37.
- Installed: 37.
- `npm ls --depth=0 --json`: OK.
- Anonymous access denied for all 37 private packages.
- Temporary install directory removed.

## Documentation Calibration

Full README quality check after fixes:

- Every audited package has a description.
- Every audited package has install instructions in README.
- No audited README contains the old stale `1.0.0` package table pattern.
- No audited README fell below the minimum smoke threshold used for this pass.

Packages republished during this pass:

- `@nossen/dragon@2.0.1`: public, README install/runtime surface fixed.
- `@nossen/dragon-contracts@2.0.1`: public, README install/types usage fixed.
- `@nossen/dragon-upstream@2.0.1`: public, README install/API usage fixed.
- `@funeste/logic-reduce-nossen@2.0.1`: private, README install/private-scope
  guidance fixed.

All-in-one packages published during this pass:

- `@nossen/all-in-one@0.1.0`: public meta-package for all public modules.
- `@funeste/all-in-one-nossen@0.1.0`: private meta-package for operator machines; depends on `@nossen/all-in-one`.

All-in-one smoke:

- `npm pack --dry-run --ignore-scripts --json`: OK for both packages.
- Anonymous install of `@nossen/all-in-one@0.1.0`: OK.
- Anonymous access to `@funeste/all-in-one-nossen@0.1.0`: denied as expected.
- Authenticated install of `@funeste/all-in-one-nossen@0.1.0`: OK.
- Local operator install kept at `D:\agent-bus\nossen-all-in-one` with only `@funeste/all-in-one-nossen` declared as a top-level dependency.

## Public Matrix

| Package | Version | Access |
| --- | --- | --- |
| `@nossen/allmight` | `2.0.1` | public |
| `@nossen/bat` | `2.0.1` | public |
| `@nossen/bat-system` | `2.0.1` | public |
| `@nossen/beam` | `2.0.1` | public |
| `@nossen/dragon` | `2.0.1` | public |
| `@nossen/dragon-contracts` | `2.0.1` | public |
| `@nossen/dragon-upstream` | `2.0.1` | public |
| `@nossen/envapt-superimg` | `2.0.0` | public |
| `@nossen/envaptex` | `2.0.1` | public |
| `@nossen/freeland` | `2.0.1` | public |
| `@nossen/freeland-bros` | `2.0.1` | public |
| `@nossen/katana` | `2.0.0` | public |
| `@nossen/logic-reduce` | `2.0.0` | public |
| `@nossen/mcp-agent-bus` | `0.1.1` | public |
| `@nossen/mcp-chopper-mixer` | `0.1.1` | public |
| `@nossen/mcp-cloud-assets` | `0.1.1` | public |
| `@nossen/mcp-job-queue` | `0.1.1` | public |
| `@nossen/mcp-media-bridge` | `0.1.1` | public |
| `@nossen/mcp-memory-graph` | `0.1.1` | public |
| `@nossen/mcp-public-endpoints` | `0.1.1` | public |
| `@nossen/mcp-qflush-control` | `0.1.1` | public |
| `@nossen/mcp-retro-session` | `0.1.1` | public |
| `@nossen/mcp-security-preflight` | `0.1.1` | public |
| `@nossen/mcp-tool-manifest` | `0.1.1` | public |
| `@nossen/mcp-toolkit` | `0.1.1` | public |
| `@nossen/mcp-web-drafts` | `0.1.1` | public |
| `@nossen/mcp-worker-supervisor` | `0.1.1` | public |
| `@nossen/morphing` | `2.0.1` | public |
| `@nossen/nezlephant` | `2.0.1` | public |
| `@nossen/qflush` | `2.0.1` | public |
| `@nossen/qflush-runner` | `2.0.1` | public |
| `@nossen/rome` | `2.0.1` | public |
| `@nossen/scentgate` | `2.0.0` | public |
| `@nossen/scream` | `2.0.1` | public |
| `@nossen/spyder` | `2.0.1` | public |
| `a11-coder` | `1.0.1` | public legacy unscoped |

## Private Matrix

| Package | Version | Access |
| --- | --- | --- |
| `@funeste/allmight-nossen` | `2.0.0` | private |
| `@funeste/bat-nossen` | `2.0.0` | private |
| `@funeste/bat-system-nossen` | `2.0.0` | private |
| `@funeste/beam-nossen` | `2.0.0` | private |
| `@funeste/dragon-contracts-nossen` | `2.0.0` | private |
| `@funeste/dragon-nossen` | `2.0.0` | private |
| `@funeste/dragon-upstream-nossen` | `2.0.0` | private |
| `@funeste/envapt-superimg-nossen` | `2.0.0` | private |
| `@funeste/envaptex-nossen` | `2.0.0` | private |
| `@funeste/freeland-bros-nossen` | `2.0.0` | private |
| `@funeste/freeland-nossen` | `2.0.0` | private |
| `@funeste/graph-router-nossen` | `2.0.0` | private |
| `@funeste/katana-nossen` | `2.0.0` | private |
| `@funeste/logic-reduce-nossen` | `2.0.1` | private |
| `@funeste/mcp-agent-bus-nossen` | `0.1.1` | private |
| `@funeste/mcp-chopper-mixer-nossen` | `0.1.1` | private |
| `@funeste/mcp-cloud-assets-nossen` | `0.1.1` | private |
| `@funeste/mcp-job-queue-nossen` | `0.1.1` | private |
| `@funeste/mcp-media-bridge-nossen` | `0.1.1` | private |
| `@funeste/mcp-memory-graph-nossen` | `0.1.1` | private |
| `@funeste/mcp-public-endpoints-nossen` | `0.1.1` | private |
| `@funeste/mcp-qflush-control-nossen` | `0.1.1` | private |
| `@funeste/mcp-retro-session-nossen` | `0.1.1` | private |
| `@funeste/mcp-security-preflight-nossen` | `0.1.1` | private |
| `@funeste/mcp-tool-manifest-nossen` | `0.1.1` | private |
| `@funeste/mcp-toolkit-nossen` | `0.1.1` | private |
| `@funeste/mcp-web-drafts-nossen` | `0.1.1` | private |
| `@funeste/mcp-worker-supervisor-nossen` | `0.1.1` | private |
| `@funeste/morphing-nossen` | `2.0.0` | private |
| `@funeste/nezlephant-nossen` | `2.0.0` | private |
| `@funeste/qflush-nossen` | `2.0.0` | private |
| `@funeste/qflush-runner-nossen` | `2.0.0` | private |
| `@funeste/rome-nossen` | `2.0.0` | private |
| `@funeste/scentgate-nossen` | `2.0.0` | private |
| `@funeste/scream-nossen` | `2.0.0` | private |
| `@funeste/spyder-graph-nossen` | `2.0.0` | private |
| `@funeste/spyder-nossen` | `2.0.1` | private |

## Test Hygiene

- Installs ran in disposable temporary directories.
- Install scripts were disabled with `--ignore-scripts`.
- Temporary directories and temporary npmrc files were removed after the smoke.
- No secret material was printed.

## Operator Rule

For public demos, docs, tweets, examples and third-party installs, use
`@nossen/*` or the public legacy `a11-coder` package.

For internal Funesterie/NOSSEN operator workflows, presets and private glue, use
`@funeste/*` and require authenticated npm access.
