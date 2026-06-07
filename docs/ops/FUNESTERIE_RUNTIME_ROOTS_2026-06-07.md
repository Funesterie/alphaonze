# Funesterie Runtime Roots - 2026-06-07

Secret-safe note for local and container agents.

## Canonical Roots

- `D:\projets\funesterie\a11\runtime`: canonical A11 runtime for session state, vision memory, vector memory, knowledge graph exports and generated operational files.
- `D:\projets\funesterie\runtime\Corpus`: broad local corpus and imported archives. Read-only by default for agents.
- `D:\projets\funesterie\a11\backend\apps\server\runtime`: backend-local generated assets and service runtime files.
- `D:\agent-bus`: coordination bus, workers, discussions and local agent state.

## MCP Workspace

Docker/Podman MCP containers mount the full repo as:

```text
D:/projets/funesterie:/workspace:ro
```

This gives agents read-only access to the Funesterie codebase and docs through safe MCP search/fetch tools. Secret-looking paths such as `.env`, tokens, private keys and credentials remain blocked by the MCP filesystem guard.

## Policy

- Prefer `a11/runtime` for A11 memory, Janus/Vision Memory and session state.
- Prefer `runtime/Corpus` for broad corpus/reference material.
- Do not commit private media dumps or generated runtime bulk.
- Do not expose raw secrets in prompts, MCP discussions, logs or docs.
