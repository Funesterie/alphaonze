# @funeste/zen

Private Funesterie route preset for `@nossen/zen`.

This package does not replace the public `.zen` format. It wraps it with the
default Funesterie/NOSSEN routes that operator machines expect: MCP, A11,
Neo4j, Qflush, Kaen44, Vivy, and the NOSSEN Docker runtime lane.

## Install

```powershell
npm install @funeste/zen
```

You need npm access to the private `@funeste` scope.

## CLI

```powershell
funeste-zen encode --in .\corpus.json --out .\corpus.zen --key-env FUNESTE_ZEN_KEY
funeste-zen inspect --in .\corpus.zen --json
funeste-zen verify --in .\corpus.zen --key-env FUNESTE_ZEN_KEY --json
funeste-zen decode --in .\corpus.zen --out .\corpus.out.json --key-env FUNESTE_ZEN_KEY
```

The key is never written into the `.zen` file. `FUNESTE_ZEN_KEY` is preferred,
and `ZEN_KEY` is accepted for compatibility. `--key-env` names a variable only;
its value is never printed. Positive limits are available through
`--max-container-bytes`, `--max-header-bytes`, `--max-payload-bytes`, and
`--max-raw-bytes`.

## API

```js
const {
  encodeFunesteZenContainer,
  decodeFunesteZenContainer
} = require('@funeste/zen');

const archive = encodeFunesteZenContainer({ kind: 'private-corpus-shard' }, {
  key: process.env.FUNESTE_ZEN_KEY,
  manifest: {
    source: { id: 'operator-note' }
  }
});

const decoded = decodeFunesteZenContainer(archive, {
  key: process.env.FUNESTE_ZEN_KEY
});

console.log(decoded.container.manifest.routes);
```

The synchronous container APIs above are intended for bounded structured
payloads. `encodeFunesteZenFileAsync()` and `decodeFunesteZenFileAsync()` forward
the public streaming file implementation for large byte-preserving files, with
the same limits and atomic destination replacement. `verifyFunesteZenFileAsync()`
authenticates and checksums without exposing content or private routes.

## Defaults

`buildFunesteZenManifest()` injects these private routes unless you add more:

- shared Funesterie MCP
- A11 memory semantics
- shared Neo4j and Aura-local Neo4j
- NOSSEN Docker runtime lane
- Qflush perception/action
- Kaen44 client semantics
- Vivy media semantics

Plaintext output is refused by default. Use `--allow-plaintext` only for local
dev fixtures that never leave the machine.

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

