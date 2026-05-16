# Funesterie MCP Roster

Status: active
Last update: 2026-05-16
Canonical machine file: `docs/ops/mcp-roster.json`

This is the secret-free control map for agents connected to Funesterie through MCP. It answers four questions before any big operation:

- who is connected;
- which endpoint they use;
- which tools they may touch;
- which tools stay locked.

## Current Endpoints

| Surface | Endpoint | Auth | Status | Use |
| --- | --- | --- | --- | --- |
| Gemini public | `https://mcp.funesterie.me/gemini/mcp` | none | connected | public read-only Gemini CLI lane |
| ChatGPT public | `https://mcp.funesterie.me/chatgpt/mcp` | none | available | public-safe connector lane |
| Grok public | `https://mcp.funesterie.me/grok/mcp` | none | available | public-safe challenge/review lane |
| Full private MCP | `https://mcp.funesterie.me/mcp` | bearer or OAuth | connected | bounded private agent lane |
| Kiro local A11 | `node .../a11-mcp-server.cjs` | local process | configured | local A11 route map and diagnostics |
| A11 backend | `https://a11.funesterie.pro` | app auth | healthy | product/backend surface |

Health checked on 2026-05-16:

- `https://mcp.funesterie.me/health` returned OK.
- `https://a11.funesterie.pro/health` returned OK.
- Gemini CLI sees `funesterie` and `funesterie_full` connected.
- Kiro config sees `a11` local and `a11mcp-shared`.

## Agent Roster

| Agent | Status | Role | MCP Access | BB Role |
| --- | --- | --- | --- | --- |
| `chatgpt` | available | orchestration, priority, arbitration, synthesis | public-safe, OAuth private when configured | operator and route owner |
| `chopper` | planned | repair, diagnostics, patches, tests, queues, configs | private safe via job board | fix owner |
| `qflush` | active | perception/action, vision, bounded input/runtime hooks | private status/input tools | local eyes and hands |
| `a11` | healthy | memory, graph, identity, routing, semantic context | local/private | memory owner |
| `kaen44` | available | client/demo copilot, accessibility, documents | private/app surfaces | client surface owner |
| `vivy` | available | audio/music/media identity | A11/Qflush status surfaces | audio/video lane |
| `codex` | active | implementation, review, local ops | private full + local workspace | worker and verifier |
| `kiro` | connected | codebase navigation and spec execution | local A11 + shared full MCP | route-map checker |
| `gemini-cli-pro` | connected | long-context reasoning and second pass analysis | public Gemini + private full | analysis engine |
| `claude` | candidate | deep review, docs, coherence | public-safe or OAuth private | review lane |
| `copilot-cli` | quota-gated | PR, CI, targeted code suggestions | GitHub CLI + MCP when quota permits | CI repair assistant |
| `grok` | candidate | media analysis, contradiction and fast alternate hypotheses | public Grok, future Cloudflare proxy | sanity-check lane |
| `cloudflare` | active | tunnels, routes, R2, future proxy | ops surface | edge lane |
| `render` | active | backend hosting and logs | ops surface | deploy lane |
| `jfrog` | available | private package/module registry | ops surface | package lane |

Canonical dispatch:

```txt
ChatGPT -> Chopper/Qflush/A11/Kaen44/Vivy/Codex/Kiro
```

Use `agent_role_route` before dispatching fuzzy work. Qflush physical input remains opt-in and bounded.

## Tool Policy

Public read-only tools:

- `search`
- `fetch`
- `a11_status`
- `kaen44_status`
- `qflush_status`
- `generated_bucket_status`
- `generated_bucket_public_url`

Private safe tools:

- presence and heartbeat;
- agent role routing;
- discussions;
- job status and schema;
- Neo4j read-only status/query;
- A11, Kaen44, Qflush, Janus, Vivy status;
- Qflush source profile, selected-window capture, and audio source selection;
- generated bucket list/head;
- search/fetch.

Operations-gated tools:

- job enqueue/lease/start/complete/fail;
- append-only memory write;
- safe graph write;
- generated artifact publish.

Blocked by default:

- free shell;
- raw filesystem read outside allowlist;
- secret reads;
- `docker.sock`;
- root;
- worker start/stop/restart from external agents;
- direct Neo4j write query;
- production deploy;
- billing/payment mutation.

## Gemini Full MCP

Gemini is configured with two MCP profiles:

```txt
funesterie       -> https://mcp.funesterie.me/gemini/mcp
funesterie_full  -> https://mcp.funesterie.me/mcp
```

`funesterie_full` uses the environment variable name `GEMINI_CLI_FUNESTERIE_MCP` in `C:/Users/Djeff/.gemini/settings.json`. The value must stay in the local environment or secret store, never in docs or chat.

Verified test:

```txt
OK_GEMINI_FULL_MCP: qflush_status responded successfully.
```

## Next Additions

Recommended order:

1. Claude with public-safe or OAuth private access for review only.
2. Grok through a Cloudflare proxy with `X-Agent-Id`, not a visible bearer. Keep it as a media analyst and challenger, not a runtime operator.
3. Copilot CLI once quota is available, restricted to CI/jobs/discussions.
4. Render/Cloudflare/JFrog as ops surfaces, not autonomous agents.

Grok lane policy:

- `docs/ops/GROK_MEDIA_ANALYST_LANE_2026-05-15.md`

## Operation BB Gate

Operation BB can start when these are green or explicitly waived:

- MCP public and private endpoints healthy.
- Gemini/Kiro/Codex connected and listed in the roster.
- Current git worktree reviewed, with unrelated changes preserved.
- CI failures listed with owner and reproduction command.
- A11 backend 502/video/frame-generate issues reproduced.
- Worker status known and no duplicate worker loops running.
- Secrets scan planned before screenshots, sharing, or deploy.
- Render and Cloudflare rollback paths known.
- Neo4j local/Aura read status checked.
- Demo UI checked mobile and desktop.

No BB task should start with “fix everything”. Each task gets:

```txt
id:
owner:
scope:
risk:
repro:
done condition:
rollback:
```
