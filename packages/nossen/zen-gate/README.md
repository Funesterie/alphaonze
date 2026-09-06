# @nossen/zen-gate

**ZEN Gate / Stargate** — the chunked, deduplicated transfer portal for **PC ↔ EX44 ↔ agents**.
Built on the existing Funesterie briques instead of inventing a sixth compressor.

## What it is

A transfer layer that sends only the bytes that changed:

```
file → chunks → SHA-256(chunk) → receiver already has it? → yes: 0 bytes / no: Brotli → send → reconstruct → SHA-256(final)
```

It reuses the same primitives as the rest of the ecosystem:

| brique | reused from |
|---|---|
| Brotli | `node:zlib` (same as `@nossen/zen`, A11 dump rgba-brotli) |
| SHA-256 | `node:crypto` (same as `@nossen/zen`, A11) |
| `.zen` container (encrypted manifest/bundle) | `@nossen/zen` (planned wrap, V1.1) |
| HTTP zstd/gzip | Caddy — **untouched** (ZEN Gate is a separate transfer lane) |

## V1 status — DONE, tested

`node test/roundtrip.cjs`:
```
1) first sync : sent=4/4 chunks  wire=1025KiB
2) same file  : sent=0 chunks     wire=1436B   (full dedup)
3) 1-chunk mod: sent=1/4 chunks   wire=257KiB  (only the changed chunk)
4) have/need  : have=4 need=0
ZEN Gate V1 round-trip: OK (dedup: same=0B, 1-chunk mod=1 chunk, final SHA-256 verified)
```

## API (V1)

```js
const { ChunkStore, InMemoryTransport, syncBuffer, buildManifest, haveNeed } = require('@nossen/zen-gate');
const store = new ChunkStore('./chunk-store');          // content-addressed: sha256 -> bytes
const tp = new InMemoryTransport();                     // pluggable transport (SSH/HTTP/socket plug the same shape)
const res = await syncBuffer(buf, {}, store, tp, { name: 'repo.bundle', chunkSize: 256*1024 });
// res = { ok, sha256, sent, total, have, need, bytes, rounds }
```

Modules: `hash` · `chunker` · `store` · `manifest` · `negotiate` (HAVE/NEED) · `pack` · `reconstruct` · `transport`.

## Roadmap

- **V1** ✅ fixed-size chunks, HAVE/NEED, Brotli per chunk, content-addressed store, final SHA-256.
- **V1.1** wrap the manifest/bundle in a `@nossen/zen` encrypted container (reuse `encodeZenContainer`/`decodeZenContainer`).
- **V2** content-defined chunking (rolling-hash boundaries) so insertions shift only the touched chunks.
- **V3** delta between versions (rsync-style rolling checksum).
- **V4** shared dictionaries + auto codec selection (PASS / BROTLI / ZSTD / DELTA).
- **Transport** — the one open piece: wire `transport.cjs` to the real **PC ↔ EX44** link (SSH? HTTP? socket?). `InMemoryTransport` is the reference shape.

## DRIVE transport (preferred for PC ↔ EX44) ✅ tested

A **shared content-addressed chunk store** on a path both sides see (e.g. OneDrive mounted on PC + EX44).
No SSH / no open port needed — OneDrive is the relay, and it only syncs the **NEW** compressed chunks.

```
PC:    zen-gate drive-push <file> --store <shared> --name repo.bundle
        -> writes only NEW chunks (sha256.z, Brotli) + manifest to the shared store
        -> OneDrive uploads only those new chunks
EX44:  zen-gate drive-pull --store <shared> --name repo.bundle --out <file>
        -> reads chunks from the shared store, reconstructs, verifies final SHA-256
```

`node test/drive-roundtrip.cjs`:
```
1) PC push    : new=4/4 chunks  written=1024KiB
2) EX44 pull  : reconstructed sha OK
3) PC re-push : new=0 chunks  written=0B   (full dedup, OneDrive idle)
4) PC push mod: new=1/4 chunks  written=256KiB
5) EX44 pull  : modified sha OK
6) CLI push/pull: OK
```
Unchanged file = 0 bytes to the drive. 1-chunk change = 1 chunk to the drive.

## Transports summary
| transport | use | tested |
|---|---|---|
| InMemory | lib / unit | ✅ |
| Subprocess | local have/apply CLI (= the SSH protocol) | ✅ |
| Ssh | PC → EX44 over `ssh` (needs port 22) | ready (22 blocked from mobile) |
| HTTP | PC → `serve` on EX44 (needs port + deploy) | ✅ local |
| Drive | shared store on OneDrive (both sides mount) — **no direct connection** | ✅ |

---

Part of [`@nossen/all-in-one`](https://www.npmjs.com/package/@nossen/all-in-one) — the whole NOSSEN / Funesterie AI toolkit in one import.
