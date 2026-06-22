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
- Private graph, MCP, worker, runtime bridge and ZEN route packages.

The 0.1.5 snapshot is aligned with the registry-audited public 0.1.6 train:
Morphing is 2.1.0, ZEN is 0.1.2, and every generated private adapter pins its
public counterpart exactly.

## Package Manifest

```js
const funeste = require('@funeste/all-in-one-nossen');

console.log(funeste.publicMetaPackage);
console.log(funeste.privatePackageCount);
console.log(funeste.privatePackages);
```

## Local Operator Rule

On a trusted Funesterie PC, keep this package as the only top-level NOSSEN dependency. The individual public and private packages should arrive through this meta-package so the machine stays easy to update.

## Support NOSSEN

NOSSEN packages stay public and usable under their license. If this package helps your workflow, support is voluntary and can be any amount:

- PayPal: https://paypal.me/funeste38
- QR Wero: https://funesterie.me/assets/wero-jeffrey-cellauro-qr.png
- Contact, invoice, sponsorship or custom support: https://funesterie.me/contact/

## Adding Future Modules

1. Publish public modules under `@nossen`.
2. Publish internal modules under `@funeste`.
3. Add public modules to `@nossen/all-in-one`.
4. Add private modules here.
5. Bump the patch version and publish with `npm publish --access restricted`.

Keep exact versions. This package is an operator snapshot, not a floating dependency bundle.
