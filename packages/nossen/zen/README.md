# @nossen/zen

Zero-Exposed NEZ archive encoder/decoder for `.zen` corpus containers.

ZEN is the Funesterie “NEZ inverse”: a searchable name for an opaque corpus
container. It keeps the public header poor, encrypts the internal manifest, and
binds payloads to a spatial imaginary map, fragment routes, RGBA/Qflush bridges,
and Neo4j graph hints. It is not a renamed zip file.

## Install

```powershell
npm install @nossen/zen
```

## API

```js
const { encodeZenContainer, decodeZenContainer } = require('@nossen/zen');

const archive = encodeZenContainer({ kind: 'corpus.shard', items: ['a', 'b'] }, {
  key: process.env.ZEN_KEY,
  manifest: {
    intent: 'corpus-container',
    axes: ['R', '+i', '-i'],
    zone: { model: 'Z_m(n)', m: 3 },
    graphHints: [['ZEN', 'USES', 'Spatial Imaginary Map']]
  }
});

const decoded = decodeZenContainer(archive, {
  key: process.env.ZEN_KEY
});

console.log(decoded.container.manifest);
```

## CLI

```powershell
$env:ZEN_KEY = 'local secret passphrase'
nossen-zen encode --in .\shard.json --out .\shard.zen --key-env ZEN_KEY
nossen-zen inspect --in .\shard.zen
nossen-zen decode --in .\shard.zen --out .\shard.out.json --key-env ZEN_KEY
```

For test fixtures only:

```powershell
nossen-zen encode --in .\sample.txt --out .\sample.zen --allow-plaintext
```

## Format V1

The file starts with the binary magic `NOSSENZ1`, followed by a public JSON
header length and a minimal public JSON header.

The header exposes only technical compatibility data:

- format/version/mode
- codec
- cipher and KDF metadata
- salt, IV, authentication tag
- payload checksums

It does not expose file names, file count, internal order, routes, corpus index,
or payload structure.

The encrypted payload can contain:

- the ZEN canon;
- an internal manifest;
- imaginary axes and zone metadata;
- fragment descriptors;
- graph hints for Neo4j;
- the actual shard payload.

## Canon

ZEN is a reverse zip: it does not only compress files; it hides the order in
which they exist. Prime numbers are treated as the real projection of a broader
spatial imaginary map. A `.zen` container can route fragments through imaginary
coordinates, a `pi` ring/zone, and a reconstruction order that only appears
after decode.

## Safety

Keys are never written into the `.zen` file. Encrypted containers use
AES-256-GCM with a key derived by scrypt, and payloads are verified after decode.
Plaintext mode is rejected by default and exists only for deterministic dev
fixtures.

## Support NOSSEN

NOSSEN packages stay public and usable under their license. If this package helps
your workflow, support is voluntary and can be any amount:

- PayPal: https://paypal.me/funeste38
- QR Wero: https://funesterie.me/assets/wero-jeffrey-cellauro-qr.png
- Contact, invoice, sponsorship or custom support: https://funesterie.me/contact/
