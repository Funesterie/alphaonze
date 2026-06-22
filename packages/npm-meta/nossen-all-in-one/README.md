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
- ZEN 0.1.2 with bounded parsing, authenticated verification and large-file streaming.
- The public `a11-coder` package.

The 0.1.6 snapshot was audited against the npm registry on 2026-06-22. Its
internal NOSSEN versions are exact, including Morphing 2.1.0 and the coordinated
Dragon, Freeland Bros and QFlush patch train.

## Package Manifest

```js
const nossen = require('@nossen/all-in-one');

console.log(nossen.packageCount);
console.log(nossen.packages);
```

## Public And Private Split

Use this package for public installs, demos, CI smoke tests and external users.

Operator machines that can access private packages should install `@funeste/all-in-one-nossen` instead. The private package depends on this public package and adds the private `@funeste/*` adapters.

## Support NOSSEN

NOSSEN packages stay public and usable under their license. If this package helps your workflow, support is voluntary and can be any amount:

- PayPal: https://paypal.me/funeste38
- QR Wero: https://funesterie.me/assets/wero-jeffrey-cellauro-qr.png
- Contact, invoice, sponsorship or custom support: https://funesterie.me/contact/

## Adding Future Modules

1. Publish the new public module under `@nossen`.
2. Add it to `dependencies` in this package.
3. Add it to `packages` in `index.cjs`.
4. Bump the patch version and publish with `npm publish --access public`.

Keep versions exact so one install reproduces the same NOSSEN train everywhere.
