# NOSSEN All-In-One Packages - 2026-05-25

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

- `@nossen/all-in-one@0.1.0`
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

- `@funeste/all-in-one-nossen@0.1.0`
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
    "@funeste/all-in-one-nossen": "0.1.0"
  }
}
```

The public and private module train arrives transitively through the meta-package.

Validated local path:

```text
D:\agent-bus\nossen-all-in-one
```

The local `package.json` declares only `@funeste/all-in-one-nossen@0.1.0` as a dependency. Npm may hoist transitive packages inside `node_modules`, but the local top-level contract remains the private meta-package.

## Smoke Results

Checks completed on 2026-05-25:

- `npm pack --dry-run --ignore-scripts --json` for both meta-packages: OK.
- Exact dependency resolution for all public/private dependencies: OK.
- Public anonymous install of `@nossen/all-in-one@0.1.0`: OK.
- Private anonymous `npm view @funeste/all-in-one-nossen@0.1.0`: denied.
- Private authenticated install of `@funeste/all-in-one-nossen@0.1.0`: OK.
- Local PC install in `D:\agent-bus\nossen-all-in-one`: OK.

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
