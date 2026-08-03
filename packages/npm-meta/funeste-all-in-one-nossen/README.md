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

## Package Manifest

```js
const funeste = require('@funeste/all-in-one-nossen');

console.log(funeste.publicMetaPackage);
console.log(funeste.privatePackageCount);
console.log(funeste.privatePackages);
```

## Current snapshot

Repo source `0.1.6` tracks the private operator train from `@funeste/all-in-one-nossen` 0.1.5, updates the public bridge to `@nossen/all-in-one` 0.1.7, and keeps `@funeste/zen` / `@nossen/zen` on 0.1.2.

## Local Operator Rule

On a trusted Funesterie PC, keep this package as the only top-level NOSSEN dependency. The individual public and private packages should arrive through this meta-package so the machine stays easy to update.

## Support / Soutien

NOSSEN packages stay public and usable under their license. If this package helps
your workflow, support is voluntary and can be any amount:

- PayPal: https://paypal.me/funeste38
- QR Wero: https://funesterie.me/assets/wero-jeffrey-cellauro-qr.png
- Contact, invoice, sponsorship or custom support: https://funesterie.me/contact/

Recurring plans (trimestriel, resiliable a tout moment):

- Standard 8.99 EUR — Qonto: https://pay.qonto.com/payment-links/019fb9c8-9299-7a60-8130-cc40268dfd2b?resource_id=019fb9c8-929b-7269-9db7-19eed62119e0
- Premium 29.99 EUR — Stripe: https://buy.stripe.com/00w7sL6am3HW1p98qo7Re05 · PayPal: https://www.paypal.com/ncp/payment/YXRY5G9QMKRNY
- Fondateur 29.99 EUR — Stripe: https://buy.stripe.com/dRmeVdeGSemA3xh7mk7Re03 · PayPal: https://www.paypal.com/ncp/payment/DJ7HKGB8PLYJ4

## Adding Future Modules

1. Publish public modules under `@nossen`.
2. Publish internal modules under `@funeste`.
3. Add public modules to `@nossen/all-in-one`.
4. Add private modules here.
5. Bump the patch version and publish with `npm publish --access restricted`.

Keep exact versions. This package is an operator snapshot, not a floating dependency bundle.
