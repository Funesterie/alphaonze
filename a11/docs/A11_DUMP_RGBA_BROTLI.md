# A11 Dump RGBA Brotli

Format d'archive visuelle interne pour A11. Transforme une information structurée en PNG RGBA lossless, réversible et vérifiable.

## Pipeline

```
information A11 → JSON canonique → Brotli → bytes → PNG RGBA lossless
                → manifest .dump.json → décodage exact possible
```

## Pourquoi RGBA + Brotli ?

- **RGBA** : 4 bytes/pixel, plus dense que RGB (3 bytes/pixel), décodage trivial
- **Brotli** : compression excellente sur JSON, texte, logs, prompts (~5-10x sur données répétitives)
- **PNG lossless** : aucune perte, décodage pixel-perfect garanti
- **Pas de stéganographie** : archive explicite, lisible par A11

## Format binaire v1

```
magic         8 bytes   "A11DMP1\0"
version       1 byte    1
codec         1 byte    1 = brotli
pixelMode     1 byte    4 = RGBA
flags         1 byte    0
headerLength  4 bytes   LE uint32 — longueur du jsonHeader UTF-8
rawLength     8 bytes   LE BigUInt64 — longueur du contenu brut
payloadLength 8 bytes   LE BigUInt64 — longueur du payload Brotli
createdAtMs   8 bytes   LE BigUInt64 — timestamp ms
sha256Raw     32 bytes  SHA-256 du contenu brut
sha256Payload 32 bytes  SHA-256 du payload Brotli
reserved      32 bytes  zéros
jsonHeader    variable  UTF-8 JSON (headerLength bytes)
payload       variable  Brotli bytes (payloadLength bytes)
```

Header fixe total : **136 bytes**

## JSON Header

```json
{
  "type": "a11.dump.rgba.brotli",
  "version": 1,
  "source": "chat|vision|rag|graph|session|file|api",
  "conversationId": "...",
  "userId": "...",
  "tags": ["a11", "memory"],
  "contentType": "application/json",
  "compression": "brotli",
  "createdBy": "a11",
  "createdAt": "2026-04-27T...",
  "rawLength": 12345,
  "payloadLength": 2345
}
```

## Manifest sidecar

Chaque PNG génère un fichier `<nom>.dump.png.dump.json` :

```json
{
  "format": "a11.dump.rgba.brotli",
  "version": 1,
  "pngPath": "a11dump_xxx.dump.png",
  "width": 128,
  "height": 128,
  "totalPixels": 16384,
  "totalBytes": 65536,
  "rawLength": 12345,
  "payloadLength": 2345,
  "sha256Raw": "abc123...",
  "sha256Payload": "def456...",
  "source": "chat",
  "tags": ["a11", "memory"],
  "createdAt": "2026-04-27T..."
}
```

## API

### Encoder

```http
POST /api/dump/rgba-brotli
Content-Type: application/json

{
  "data": { "message": "...", "userId": "Djeff" },
  "source": "chat",
  "tags": ["a11", "session"],
  "conversationId": "conv_xyz"
}
```

### Décoder

```http
POST /api/dump/rgba-brotli/decode
Content-Type: multipart/form-data

png: <fichier.dump.png>
```

### Vérifier

```http
GET /api/dump/rgba-brotli/verify/a11dump_xxx.dump.png
```

### Lister

```http
GET /api/dump/rgba-brotli/list
```

## Usage Node.js

```javascript
const { encodeDumpToRgbaPng, decodeDumpFromRgbaPng, verifyDump } = require('./src/dump/a11-dump-rgba-brotli.cjs');

// Encoder
const result = await encodeDumpToRgbaPng(
  { userId: 'Djeff', memory: [...] },
  'runtime/dumps/session.dump.png',
  { source: 'session', tags: ['a11', 'memory'] }
);

// Décoder
const { content, verified } = await decodeDumpFromRgbaPng('session.dump.png', { verify: true });
const data = JSON.parse(content);

// Vérifier
const { ok, error } = await verifyDump('session.dump.png');
```

## Tests

```bash
node --test ./test/a11-dump-rgba-brotli.node.test.cjs
```

Tests couverts :

- Magic, version, SHA-256
- Round-trip JSON, UTF-8 français, gros JSON (100 entrées)
- Manifest sidecar
- Détection de corruption
- Ratio de compression Brotli

## Roadmap

- **V1** (actuel) : JSON → Brotli → RGBA PNG
- **V2** (futur) : JSON → Brotli → Codebook 64B → RGBA PNG (si gain prouvé)
- **V3** (futur) : Intégration avec le Corpus RGB legacy pour migration

## Sécurité

- Ne lit jamais `.env`, secrets, tokens
- Ne stocke pas de credentials par défaut
- Archive explicite, pas de stéganographie cachée
- SHA-256 double (contenu brut + payload compressé) pour détection de corruption
