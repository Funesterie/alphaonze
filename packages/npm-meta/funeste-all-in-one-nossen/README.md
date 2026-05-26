# @funeste/all-in-one-nossen

Private all-in-one installer for Funesterie operator machines.

This package depends on the public `@nossen/all-in-one` package and adds every private `@funeste/*` NOSSEN adapter. It is meant for authenticated local machines and internal automation only.

## Install

```bash
npm install @funeste/all-in-one-nossen
```

You need an npm token that can read the private `@funeste` scope. Do not paste tokens in docs, issues, logs or chat.

## What It Installs

- `@nossen/all-in-one`, which brings the public NOSSEN train.
- Private `@funeste/*-nossen` operator adapters.
- Private graph, MCP, worker and runtime bridge packages.

## Package Manifest

```js
const funeste = require('@funeste/all-in-one-nossen');

console.log(funeste.publicMetaPackage);
console.log(funeste.privatePackageCount);
console.log(funeste.privatePackages);
```

## Local Operator Rule

On a trusted Funesterie PC, keep this package as the only top-level NOSSEN dependency. The individual public and private packages should arrive through this meta-package so the machine stays easy to update.

## Adding Future Modules

1. Publish public modules under `@nossen`.
2. Publish internal modules under `@funeste`.
3. Add public modules to `@nossen/all-in-one`.
4. Add private modules here.
5. Bump the patch version and publish with `npm publish --access restricted`.

Keep exact versions. This package is an operator snapshot, not a floating dependency bundle.
