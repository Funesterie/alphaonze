# Funeste ZEN Package Audit - 2026-06-07

## Result

- Created and published private package `@funeste/zen@0.1.1`.
- Published `@funeste/all-in-one-nossen@0.1.4` with `@funeste/zen@0.1.1`.
- Updated local operator install at `D:\agent-bus\nossen-all-in-one` to `@funeste/all-in-one-nossen@0.1.4`.
- Verified all private `@funeste/*` dependencies declared by the private all-in-one package are accessible and aligned with npm latest.

## ZEN Routing

`@funeste/zen` wraps the public `@nossen/zen@0.1.1` format with Funesterie private defaults:

- shared Funesterie MCP route
- A11 memory/semantics route
- shared Neo4j route
- Aura-local Neo4j route
- NOSSEN Docker runtime lane
- Qflush perception/action route
- Kaen44 client semantics route
- Vivy media semantics route

The package keeps the same safety model as `@nossen/zen`: encrypted containers by default, Brotli compression, AES-256-GCM, scrypt key derivation, public header without corpus contents, and no key stored in `.zen` files.

## Commands Verified

```text
npm run funeste:zen:test
npm run funeste:zen:pack
npm run nossen:zen:test
npm run funeste:logic-reduce:test
npm run nossen:all-in-one:inventory:json
npm pack --dry-run
npm publish --access restricted
npm install @funeste/all-in-one-nossen@0.1.4 --save-exact
npm ls @funeste/zen @funeste/all-in-one-nossen --depth=1
```

## Registry Audit

- `@funeste/zen@0.1.1`: private, latest tag `0.1.1`, depends on `@nossen/zen@0.1.1`.
- `@funeste/all-in-one-nossen@0.1.4`: private, latest tag `0.1.4`, depends on `@funeste/zen@0.1.1`.
- Private train check: 38 `@funeste/*` packages checked, 38 accessible, 38 aligned with declared versions, 0 mismatches.

## Local Smoke

The installed `funeste-zen` binary in `D:\agent-bus\nossen-all-in-one` was used to:

1. encode a local test file into `.zen`;
2. inspect the public header;
3. decode the payload back to the original text.

The generated header reported `encrypted_multiload`, `brotli`, and `aes-256-gcm`.

## Notes

- npm initially returned `404` for `@funeste/zen` immediately after publish while the access API already showed the package. After propagation, `npm view @funeste/zen` and local install worked normally.
- No secrets or tokens were printed or stored in docs.
