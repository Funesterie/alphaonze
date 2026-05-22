# RubixCube vault - 2026-05-22

Goal: give Funesterie/NOSSEN one operator-controlled place for token bundles without putting raw tokens in chat, docs, Neo4j, logs, screenshots, or MCP messages.

## Storage model

- Default local vault root: `D:\agent-bus\rubixgate\vault`.
- The vault root is outside the git repository.
- Each bundle is encrypted with AES-256-GCM.
- The key is derived from an operator passphrase with scrypt.
- The encrypted container is split into PNG shards, one shard per RubixCube face.
- The manifest stores only metadata, shard hashes, and encrypted-container hash.
- Recovery requires all shards, the manifest, and the passphrase.

This is not just steganography. The PNG files are carriers for encrypted random-looking shares. The security comes from authenticated encryption plus the passphrase, not from pretending the images are harmless.

## Commands

Create a local JSON bundle file yourself, then run:

```powershell
$env:RUBIXCUBE_VAULT_PASSPHRASE = "<operator passphrase from secure channel>"
npm run rubixcube:vault -- create --name funesterie-core --input D:\agent-bus\rubixgate\incoming\token-bundle.json --confirm STORE_SECRET_BUNDLE
```

Inspect without revealing secrets:

```powershell
npm run rubixcube:vault -- status --manifest D:\agent-bus\rubixgate\vault\funesterie-core\funesterie-core.manifest.json
```

## MCP rail

The A11 MCP server exposes two RubixCube tools:

- `a11_rubixcube_vault_status`: checks manifest, PNG shards, and hashes. It does not read the passphrase.
- `a11_rubixcube_vault_consume`: decrypts the bundle in memory only after `confirm: CONSUME_SECRET_BUNDLE`; it returns a redacted inventory, never token values.

`a11_rubixcube_vault_consume` is intentionally not a read-only auto-approval tool. Agents can verify that a named item exists and then use a future whitelisted consumer path, but they must not dump recovered values into MCP replies, logs, Neo4j, screenshots, or docs.

Recover to a local file only when needed:

```powershell
$env:RUBIXCUBE_VAULT_PASSPHRASE = "<operator passphrase from secure channel>"
npm run rubixcube:vault -- recover --manifest D:\agent-bus\rubixgate\vault\funesterie-core\funesterie-core.manifest.json --out D:\agent-bus\rubixgate\recovered\token-bundle.json --confirm WRITE_SECRET_OUTPUT
```

## Rules

- Do not commit manifests or PNG shards.
- Do not index the vault with NOSSEN source indexing.
- Do not paste bundle JSON into chat.
- Do not store the passphrase next to the vault.
- Do not upload shards to public R2 or public docs.
- If a bundle is recovered, use it for the intended check and delete the recovered plaintext promptly.

## Where Google Drive fits

Google Drive or OneDrive can be a backup/mirror only after the local vault is created and verified. The live bus remains `D:\agent-bus`; the vault can be copied by the operator into a private Drive folder, but agents should consume it through RubixGate/MCP status tools and never by dumping token values.
