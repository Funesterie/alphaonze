# NOSSEN Container Runtime Roles - 2026-06-07

Status: local operator source of truth for Djeff's PC.

## Decision

Use several container environments, but give each one a clear job.

| Role | Engine / Place | State policy | Purpose |
| --- | --- | --- | --- |
| Runtime | Docker Desktop, context `desktop-linux` | Keep on during NOSSEN work | MCP bridge, local Neo4j, A11/NOSSEN live tools, quick checks |
| Atelier | Podman WSL, context `podman-a11` | Start only for build/rescue/test sessions | isolated image builds, old containers, recovery, experiments |
| Registry | Docker Hub `funeste38/pool` | Not a running engine | publish/store images and package artifacts |
| Prod | Hetzner Docker/Caddy | Manage separately via deploy/hotfix scripts | public Funesterie/A11/K44/Vivy services |

## Current Local Policy

- Do not delete old Podman containers just because they are stopped.
- Do not run Docker Desktop and Podman all day unless a build/rescue/test task needs both.
- Keep Docker Desktop as the active NOSSEN runtime because it currently exposes the useful MCP/Neo4j containers.
- Keep Podman as a paid/available workshop lane, not as a duplicate always-on runtime.
- Keep WSL default on `docker-desktop` on Djeff's PC. If the default distro falls back to `podman-a11-wsl`, bare `wsl` calls can hit the workshop lane by mistake.
- Keep Docker CLI default context on `desktop-linux`.
- Pull the watched floating image tracks daily: `cloudflare/cloudflared:latest`, `caddy:2-alpine`, and `neo4j:latest`.

## Operator Commands

```powershell
npm run nossen:docker:status
npm run nossen:docker:profile
npm run nossen:docker:atelier:on
npm run nossen:docker:atelier:off
npm run nossen:docker:update:check
npm run nossen:docker:update
npm run nossen:docker:update:recreate
npm run nossen:docker:update:task
```

Direct script:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/nossen/Nossen-DockerRuntime.ps1 status
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/nossen/Update-FunesterieDockerImages.ps1 -Pull -SetDockerContext -EnsureWslDefault
```

## Verified Snapshot

On 2026-06-07:

- `docker-desktop`: running.
- `podman-a11-wsl`: stopped after operator cleanup.
- `podman-net-usermode`: stopped after operator cleanup.
- Docker Desktop active containers included `a11-mcp`, `a11-mcp-aura`, `a11-mcp-cloudflared`, `a11-neo4j-local`, and Docker Desktop extension services.
- Podman contained old stopped A11 containers and is suitable as the atelier/rescue lane.
- Local runtime MCP `http://127.0.0.1:8787/mcp` listed 101 tools, including `container_runtime_status`.
- Local Aura MCP `http://127.0.0.1:8788/mcp` listed 101 tools, including `container_runtime_status`.
- Public MCP `https://mcp.funesterie.me/mcp` was redeployed on Hetzner and listed 101 tools, including `container_runtime_status`.
- Shared and Aura Neo4j MCP status checks succeeded against database `aa4680d2`.

On 2026-06-09:

- WSL default was changed from `podman-a11-wsl` to `docker-desktop`.
- Docker context was confirmed as `desktop-linux`.
- Local floating images were pulled: `cloudflare/cloudflared:latest`, `caddy:2-alpine`, `neo4j:latest`.
- Local `a11-mcp-cloudflared` was recreated from the updated Cloudflared image.
- Docker Desktop Neo4j extension was recreated from the updated `neo4j:latest` image and reported Neo4j 2026.05.0 in logs.
- Prod Caddy on Hetzner was pulled and recreated from updated `caddy:2-alpine`; public smoke checks returned HTTP 200.
- Windows scheduled task `Funesterie Docker Image Daily Update` runs the pull/context/WSL guard daily at 09:15 and recreates local Cloudflared/Neo4j containers only when their watched image changed.
- Kiro workspace MCP config now points to canonical `https://mcp.funesterie.me/mcp`; `/kiro/mcp` is legacy.

## Rule For Agents

MCP exposes the read-only tool `container_runtime_status` for this map. Agents must call it, or read this document, before claiming Docker/Podman is unavailable or choosing where a container task belongs.

When a user says "Docker NOSSEN", first run the status command and name the exact lane:

- Runtime Docker Desktop
- Atelier Podman
- Docker Hub registry
- Prod Hetzner Docker

Do not stop or delete anything unless the user asks for that lane or the status clearly shows it is nonessential and the user confirms.
