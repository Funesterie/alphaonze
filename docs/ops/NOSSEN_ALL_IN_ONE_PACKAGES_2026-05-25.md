# NOSSEN All-In-One Packages - current through 2026-06-22

## Coordinated release - 2026-06-22

The registry and operator install now use one reproducible train:

- `@nossen/zen@0.1.2` and `@funeste/zen@0.1.2` preserve format V1 while adding bounded parsing, safe inspect/verify APIs and atomic large-file streaming.
- `@nossen/morphing@2.1.0` is consumed directly; `@funeste/morphing-nossen@2.1.0` is aligned with it.
- exact-pin patches were published for Dragon Upstream `2.0.2`, Dragon `2.0.2`, Freeland Bros `2.0.4`, QFlush `2.0.2` and QFlush Runner `2.0.2`.
- 35 stale private adapters were published at the exact public versions recorded in `packages/funeste/adapters/adapter-train.json`; Katana `2.0.0` was already aligned and was not republished.
- the public snapshot is `@nossen/all-in-one@0.1.6`; it has 37 exact dependencies (36 `@nossen/*` modules plus `a11-coder`), for 38 visible packages when the meta-package itself is counted.
- the private snapshot is `@funeste/all-in-one-nossen@0.1.5`; it has 39 exact dependencies and exposes 38 private packages in its index.

Registry metadata, tarball file lists, anonymous public installs, authenticated private installs and full dependency trees were verified after publication. The strict inventory reported zero outdated entries, zero floating internal ranges and zero errors against the release plan.

## Goal

Provide one public install point and one private operator install point.

- Public users install `@nossen/all-in-one`.
- Funesterie operator machines install `@funeste/all-in-one-nossen`.
- The private package depends on the public package, so the private install includes both trains.

## Public Package

```bash
npm install @nossen/all-in-one
```

Package source:

```text
packages/npm-meta/nossen-all-in-one
```

Policy:

- public npm package
- exact dependencies
- no secrets
- includes public `@nossen/*` packages and `a11-coder`

Published:

- `@nossen/all-in-one@0.1.6`
- access: public
- anonymous install smoke: OK

## Private Package

```bash
npm install @funeste/all-in-one-nossen
```

Package source:

```text
packages/npm-meta/funeste-all-in-one-nossen
```

Policy:

- restricted npm package
- requires an authenticated npm token with private `@funeste` read access
- exact dependencies
- depends on `@nossen/all-in-one`
- includes private `@funeste/*` packages

Published:

- `@funeste/all-in-one-nossen@0.1.5`
- access: private/restricted
- authenticated install smoke: OK
- anonymous access smoke: denied as expected

## Local PC Rule

After validation, this PC should keep only the private all-in-one package as the top-level NOSSEN install:

```text
D:\agent-bus\nossen-all-in-one
```

That local project should list only:

```json
{
  "dependencies": {
    "@funeste/all-in-one-nossen": "0.1.5"
  }
}
```

The public and private module train arrives transitively through the meta-package.

Validated local path:

```text
D:\agent-bus\nossen-all-in-one
```

The local `package.json` declares only `@funeste/all-in-one-nossen@0.1.5` as a dependency and has no overrides. Npm may hoist transitive packages inside `node_modules`, but the local top-level contract remains the private meta-package. The pre-upgrade manifests are backed up under `D:\agent-bus\nossen-all-in-one\backups\20260622-210156`.

## Smoke Results

Checks completed on 2026-06-22:

- Focused Node and ZEN suites: 35 tests passed, zero failures.
- `npm pack --dry-run --ignore-scripts --json` for 45 release packages: OK; no environment, log, temporary or fixture archive leaked.
- Registry-derived files in the five public rebases remained immutable; only `package.json` was intentionally patched.
- Exact dependency resolution for all public/private dependencies: OK.
- Public anonymous install of `@nossen/all-in-one@0.1.6`: OK.
- Private authenticated install of `@funeste/all-in-one-nossen@0.1.5`: OK.
- Local PC graph in `D:\agent-bus\nossen-all-in-one`: one top-level dependency, no overrides, no invalid or missing nodes, zero audit vulnerabilities.
- Runtime smoke: private index loaded, Morphing `2.1.0` imported, and an encrypted ZEN fixture encoded, authenticated, decoded and removed successfully.

Known note: the mistaken legacy alias was removed. Use only `@nossen/qflush`.

## Future Modules

When a future module is added:

1. Publish public modules under `@nossen`.
2. Publish private modules under `@funeste`.
3. Add public modules to `packages/npm-meta/nossen-all-in-one/package.json` and `index.cjs`.
4. Add private modules to `packages/npm-meta/funeste-all-in-one-nossen/package.json` and `index.cjs`.
5. Bump the patch version of the changed meta-package.
6. Publish public with `npm publish --access public`.
7. Publish private with `npm publish --access restricted`.
8. Reinstall locally in `D:\agent-bus\nossen-all-in-one`.

Inventory helper:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File D:\projets\funesterie\scripts\npm\Get-NossenAllInOneInventory.ps1
```

JSON output:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File D:\projets\funesterie\scripts\npm\Get-NossenAllInOneInventory.ps1 -Json
```

Strict registry/release-plan gate:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File D:\projets\funesterie\scripts\npm\Get-NossenAllInOneInventory.ps1 -Registry -Strict -Json -Plan packages\npm-release-train\2026-06-22.json
```
