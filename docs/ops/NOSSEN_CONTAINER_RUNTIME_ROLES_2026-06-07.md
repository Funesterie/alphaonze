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

## Operator Commands

```powershell
npm run nossen:docker:status
npm run nossen:docker:profile
npm run nossen:docker:atelier:on
npm run nossen:docker:atelier:off
```

Direct script:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/nossen/Nossen-DockerRuntime.ps1 status
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
- Kiro workspace MCP config now points to canonical `https://mcp.funesterie.me/mcp`; `/kiro/mcp` is legacy.

## Rule For Agents

MCP exposes the read-only tool `container_runtime_status` for this map. Agents must call it, or read this document, before claiming Docker/Podman is unavailable or choosing where a container task belongs.

When a user says "Docker NOSSEN", first run the status command and name the exact lane:

- Runtime Docker Desktop
- Atelier Podman
- Docker Hub registry
- Prod Hetzner Docker

Do not stop or delete anything unless the user asks for that lane or the status clearly shows it is nonessential and the user confirms.
