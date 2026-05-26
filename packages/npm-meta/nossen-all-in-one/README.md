# @nossen/all-in-one

Public all-in-one installer for the NOSSEN package train.

This package is a small meta-package: it contains no runtime secret and no hidden service. Installing it pulls every public `@nossen/*` module plus the public `a11-coder` helper with exact versions.

## Install

```bash
npm install @nossen/all-in-one
```

## What It Installs

- Public NOSSEN runtime vocabulary and orchestration modules.
- MCP helper packages for agent bus, job queue, worker supervision, memory graph, cloud assets, media bridge and tool manifests.
- Public Rome, QFlush, Dragon, BAT, Beam, Freeland, Morphing, Scentgate, Scream, Spyder and related adapters.
- The public `a11-coder` package.

## Package Manifest

```js
const nossen = require('@nossen/all-in-one');

console.log(nossen.packageCount);
console.log(nossen.packages);
```

## Public And Private Split

Use this package for public installs, demos, CI smoke tests and external users.

Operator machines that can access private packages should install `@funeste/all-in-one-nossen` instead. The private package depends on this public package and adds the private `@funeste/*` adapters.

## Adding Future Modules

1. Publish the new public module under `@nossen`.
2. Add it to `dependencies` in this package.
3. Add it to `packages` in `index.cjs`.
4. Bump the patch version and publish with `npm publish --access public`.

Keep versions exact so one install reproduces the same NOSSEN train everywhere.
