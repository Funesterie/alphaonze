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
$env:FUNESTE_ZEN_KEY = 'local passphrase'
funeste-zen encode --in .\corpus.json --out .\corpus.zen --key-env FUNESTE_ZEN_KEY
funeste-zen inspect --in .\corpus.zen
funeste-zen decode --in .\corpus.zen --out .\corpus.out.json --key-env FUNESTE_ZEN_KEY
```

The key is never written into the `.zen` file. `FUNESTE_ZEN_KEY` is preferred,
and `ZEN_KEY` is accepted for compatibility.

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

## Support NOSSEN

NOSSEN packages stay public and usable under their license. If this package
helps your workflow, support is voluntary and can be any amount:

- PayPal: https://paypal.me/funeste38
- QR Wero: https://funesterie.me/assets/wero-jeffrey-cellauro-qr.png
- Contact, invoice, sponsorship or custom support: https://funesterie.me/contact/
