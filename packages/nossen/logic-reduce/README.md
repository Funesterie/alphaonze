# @nossen/logic-reduce

Deterministic direct-path reducer for plans, runbooks, and agent handoffs.

It takes a noisy path, removes known dead ends, and keeps safety checks such as
preflight, auth review, tests, audits, backups, and rollback notes.

## Install

```powershell
npm install @nossen/logic-reduce
```

## Use

```js
const { logicReduce, formatReducedPlan } = require('@nossen/logic-reduce');

const result = logicReduce('scan repo + retry broken deploy + patch exact file + run targeted test', {
  objective: 'Fix the failing route'
});

console.log(formatReducedPlan(result));
```

## CLI

```powershell
nossen-logic-reduce --objective "Fix route" --steps "scan repo + retry timeout deploy + patch exact file + run targeted test"
nossen-logic-reduce --json --steps "A + timeout retry + verify auth + C"
```

## Safety

This package does not read secrets, environment variables, or local files. It is
a pure reducer over provided text/step data.

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

