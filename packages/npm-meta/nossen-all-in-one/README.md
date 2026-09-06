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
- ZEN 0.1.3 with bounded parsing, authenticated verification and large-file streaming.
- ScentGate 2.1.0 with its original ephemeral capsules plus closed, signed job notifications.
- The public `a11-coder` package.

The 0.1.13 snapshot was checked against the npm registry on 2026-08-05. Its internal NOSSEN versions are exact, including ZEN 0.1.3, Logic Reduce 2.0.3, ScentGate 2.1.0, Morphing 2.1.0 and the coordinated Dragon, Freeland Bros and QFlush patch train.

## Package Manifest

```js
const nossen = require('@nossen/all-in-one');

console.log(nossen.packageCount);
console.log(nossen.packages);
```

## Public And Private Split

Use this package for public installs, demos, CI smoke tests and external users.

Operator machines that can access private packages should install `@funeste/all-in-one-nossen` instead. The private package depends on this public package and adds the private `@funeste/*` adapters.

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

1. Publish the new public module under `@nossen`.
2. Add it to `dependencies` in this package.
3. Add it to `packages` in `index.cjs`.
4. Bump the patch version and publish with `npm publish --access public`.

Keep versions exact so one install reproduces the same NOSSEN train everywhere.
