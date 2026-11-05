# A11 MCP private GitHub repository relay (experimental)

An **asynchronous mailbox**, not an HTTP tunnel. A11 and another agent can exchange
MCP JSON-RPC envelopes through a *separate, temporary private repository*.
Useful if the two agents cannot maintain a direct connection. Both still need a
running process to poll and process messages.

This package is deliberately separate from `packages/mcp-bridge-tunnel` and
`packages/nossen/zen-gate`. It does not touch Cloudflare, Neo4j, the existing A11
MCP endpoint, or existing repositories.

## Workflow

1. An authorized server creates `a11-mcp-relay-<random>` as **private**.
2. A session marker binds the repository owner, stable GitHub ID and expiry.
3. Requests are saved as distinct AES-256-GCM encrypted JSON files. Authenticated
   metadata binds the session ID, direction, and message ID to the ciphertext.
4. A receiving agent polls, decrypts, and processes allowlisted MCP methods/tools.
   The recipient returns separately encrypted responses.
5. After verified processing, the recipient writes an encrypted acknowledgment.
6. Cleanup checks private visibility, repo identity, marker, acknowledgment and
   a minimum age of 10 minutes. It is a **dry run by default**. Actual deletion
   requires an explicit server opt-in, exact `DELETE owner/repo` confirmation,
   and proof that this process created the repo.

**Never delete arbitrary repositories.** After a process restart, cleanup is
blocked by design. A production version needs a durable, authenticated ownership
registry plus retention/recovery and audit policies.

## Server-side API (Node >=20)

```js
const { GitHubAdapter, PrivateRepoRelay } = require('./src/index.cjs');
const github = new GitHubAdapter({
  token: process.env.GITHUB_RELAY_TOKEN,
  owner: 'Funesterie',
  ownerType: 'org'
});
const relay = new PrivateRepoRelay({
  github,
  sharedKey: process.env.RELAY_SHARED_KEY_B64,
  allowedTools: ['lotus__search'],
  allowDelete: false
});
const session = await relay.createSession();
await relay.sendMcpRequest(session, 'tools/call', {
  name: 'lotus__search', arguments: { q: 'Lotus' }
});
const received = await relay.listMessages(session, 'request');
// A trusted agent must validate/execute an allowed tool before replying.
// await relay.sendMcpResponse(session, rpcId, { result: { ... } });
// await relay.acknowledge(session, [received[0].messageId]);
// await relay.cleanup(session); // dry-run only; never deletes by default
```

Generate a fresh random 32-byte shared key. Provide it only through a secure
secret manager to authorized servers. Never paste it into a page, public repo,
or chat. Give the GitHub token the minimum necessary permissions. Grant
repository deletion only to a separately gated identity when specifically needed.

## Security boundaries

- Source may live in the **public** `Funesterie/alphaonze`; messages belong
  in **private** ephemeral repos and must be encrypted. Visibility is rechecked.
- GitHub stores historical versions. Deleting a GitHub repository does **not**
  guarantee complete or immediate erasure. Do not send highly sensitive data.
- Parties who gain both GitHub access and the shared key can decrypt messages.
  Before production, implement per-agent key management, replay/idempotency
  protection, persistent receipts and authorization, structured audit logs,
  retries with backoff, reconciliation, and recovery after process restarts.
- No live GitHub repository was created or deleted during offline tests.
- This version does not implement an MCP server endpoint, OAuth, polling daemon,
  automatic background job, durable delivery queue, Cloudflare integration,
  or production authentication. It is **not** an operational remote MCP tunnel.
- Prefer one private repo per bounded session rather than one per message to
  reduce API limits and resource churn.

Run offline tests with `npm test` from this package directory.
