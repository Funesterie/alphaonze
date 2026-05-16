# A11 / Kaen44 split

## Decision

A11 and Kaen44 now have separate Node entrypoints:

- `backend/apps/server/server-a11.cjs`
- `backend/apps/server/server-kaen44.cjs`

They still load the shared Express server, but each entrypoint sets its own product defaults before startup.

## Commands

From `backend/apps/server`:

```powershell
npm run dev:a11
npm run dev:kaen44
npm run start:a11
npm run start:kaen44
```

## Runtime roles

A11:

- private/admin brain
- production domain: `https://a11.funesterie.pro`
- default port: `3000`
- heavier tools, memories, connectors, generation and operations

Kaen44:

- client-facing assistant surface
- public website / landing: `https://funesterie.me`
- application domain: `https://k44.funesterie.me`
- legacy alias: `https://kaen44.funesterie.me`
- default port: `3001`
- lighter defaults, dev routes disabled, legacy automation disabled
- A11 remains the remote brain for heavy work

## Profile examples

- `backend/apps/server/profiles/a11.env.example`
- `backend/apps/server/profiles/kaen44.env.example`

Real `.env` files must stay outside public packages and must never be committed with secrets.

## Future repo split

Recommended target:

- `alphaonze-a11`: backend core, A11 operations, generation, memory, storage, admin tooling.
- `kaen44`: client app, Windows package, client-facing UI, public docs, lightweight API profile.

The safe split should be done with `git filter-repo` or a clean fresh repository, after checking:

- no `.env`, token, SSH key, OAuth client secret, payment secret, or storage password is copied
- package names and deployment scripts point to the right domain
- Kaen44 only keeps client-safe docs and tools
- A11 keeps admin-only modules and private operations

## Suggested deployment shape

```txt
a11.funesterie.pro      -> server-a11.cjs     -> port 3000
funesterie.me           -> server-kaen44.cjs  -> port 3001
k44.funesterie.me       -> server-kaen44.cjs  -> port 3001
kaen44.funesterie.me    -> server-kaen44.cjs  -> port 3001 (legacy alias)
```

Use Caddy/Nginx to reverse-proxy each domain to its own local port.

Prepared Caddy snippet:

```txt
deploy/caddy/kaen44.funesterie.me.Caddyfile
```

## Docker shape

An override compose file exists:

```powershell
docker compose -f docker-compose.yml -f docker-compose.split.yml up -d --build
```

Expected containers:

- `a11-backend` on port `3000`
- `kaen44-backend` on port `3001`

Each service has its own runtime/log volumes. Keep `.env.a11` and `.env.kaen44` private.
The current compose override does not auto-load those files, so it can run with the existing deployment env. For stricter separation, copy the examples to real env files and add them in the server deployment only.
