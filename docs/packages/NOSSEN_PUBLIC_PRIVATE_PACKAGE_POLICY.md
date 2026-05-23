# NOSSEN Public / Private Package Policy

Updated: 2026-05-23

This policy keeps the NOSSEN package line useful for everyone while giving the
Funesterie operator stack private packages for funesterie.me, MCP, agents,
payments, graph memory, and local startup.

## Lanes

- Public packages use `@nossen/*`.
- Private packages use `@funeste/*` first, with `@funesterieindustry/*` as a
  fallback only if npm permissions require it.
- Dual packages have a public reusable core and a private Funesterie adapter.

Do not publish the same package name as both public and private. Use twin names:

```text
@nossen/source-index          public reusable indexer
@funeste/nossen-source-index  private Funesterie corpus adapter
```

## Public Package Rules

Public packages must stay generic:

- no private A11/Funesterie topology in npm metadata
- no personal machine paths
- no deployment hostnames unless they are public product URLs
- no secrets, tokens, webhook signing secrets, recovery codes, or private keys
- support links may point to `https://funesterie.me/contact/`
- donations must stay voluntary, with no fixed price required to use packages

## Private Package Rules

Private packages can bind public modules to the operator stack:

- `funesterie.me` profiles
- MCP tool handlers and agent rosters
- Neo4j/Aura graph adapters
- Google Drive / local corpus configuration
- Docker/Desktop startup checks
- Stripe, PayPal, and Wero support metadata

Private packages still must not contain raw credentials. They may read secrets
from environment variables, local secret stores, or provider dashboards at
runtime.

## Current Map

The machine-readable map lives in:

```text
scripts/nossen/nossen-package-liaisons.manifest.json
```

Validate it with:

```powershell
npm run nossen:packages
npm run nossen:packages:json
```

The first validated wave has:

- 20 published public packages in `@nossen/*`
- 1 source-ready public package seed: `@nossen/logic-reduce`
- 19 private or dual candidates for the next extraction waves
- one support/donation helper planned as a dual package

## Next Extraction Order

1. `@funeste/qflush-funesterie`
   Private operator defaults for the already public `@nossen/qflush`.
2. `@nossen/logic-reduce` + `@funeste/logic-reduce-nossen`
   Public deterministic reducer, private NOSSEN prompt/profile adapter. The
   public source seed lives in `packages/nossen/logic-reduce`.
3. `@nossen/source-index` + `@funeste/nossen-source-index`
   Public local indexer, private corpus/Drive bindings.
4. `@funeste/mcp-tools`
   Private MCP tool package consumed by the A11 server.
5. `@funeste/payments-support`
   Provider-neutral support metadata for funesterie.me; no secrets.

Each wave should patch the exact package source, run its targeted tests, run
`npm pack --dry-run`, install in a fresh temp folder, then publish only when the
train is coherent.
