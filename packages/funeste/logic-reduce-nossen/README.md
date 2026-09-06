# @funeste/logic-reduce-nossen

Private NOSSEN presets for `@nossen/logic-reduce`.

This package is for the Funesterie operator stack. It keeps project-specific
rules, agent vocabulary, and release guardrails out of the public package while
using the same deterministic reducer.

## Scope

- read the session preflight before infra, MCP, auth, deploy, npm, and prod claims
- keep secrets out of code, docs, tickets, and chat output
- patch exact files
- run targeted tests
- keep PR checks green before merge
- separate public `@nossen/*` modules from private org-scope adapters

## CLI

```powershell
nossen-logic-reduce-private --objective "Prepare publish" --steps "preflight + retry failed token + patch exact package + run tests + publish"
```

No token, key, password, recovery code, or webhook secret belongs in this
package.

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

