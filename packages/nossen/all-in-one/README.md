# @nossen/all-in-one

**One import for the whole NOSSEN / Funesterie AI toolkit.** So you don't get lost.

```js
const N = require('@nossen/all-in-one');
N.cf.listZones();            // Cloudflare
N.hetzner.robotListServers(); // Hetzner Robot (EX44)
N.zenGate.syncFile(...);     // chunked dedup sync
N.zen.encodeZenContainer(...); // encrypted .zen container
N.logicReduce.reducePlan(...);
```

## Install

```bash
npm install @nossen/all-in-one
```

Pulls every public NOSSEN module. `npm install @nossen/all-in-one@0.1.14` for this version.

## New in 0.1.14
- [`@nossen/cf`](https://www.npmjs.com/package/@nossen/cf) — Cloudflare API client (zones/DNS/tunnels/Access/R2).
- [`@nossen/hetzner`](https://www.npmjs.com/package/@nossen/hetzner) — Hetzner Robot API client (EX44 over 443, no SSH).
- [`@nossen/zen-gate`](https://www.npmjs.com/package/@nossen/zen-gate) — ZEN Gate / Stargate: chunked dedup transfer (PC↔EX44↔agents).

## How it fits together

```
        PC (Jeff)                         EX44 (Hetzner, Kaen44)
   ┌───────────────┐                ┌──────────────────────────┐
   │ NOSSEN tools  │   ZEN Gate      │ a11mcp (the Funesterie  │
   │ @nossen/*     │ ◄──── sync ────►│   AIs) @ mcp.funesterie │
   │ cf / hetzner  │  (chunk dedup)  │ Caddy (web)              │
   └───────┬───────┘                 └──────────┬───────────────┘
           └──────── Cloudflare tunnel (kaen44-hetzner, 443) ────┘
```

- **@nossen/zen** = encrypted `.zen` corpus container (AES-256-GCM + Brotli + manifest).
- **@nossen/zen-gate** = the transfer portal (dedup; only new chunks move).
- **@nossen/cf** = pilot Cloudflare from any AI.
- **@nossen/hetzner** = pilot EX44 (dedicated) over 443, no SSH.
- **@nossen/scentgate** = rights/access control gate.
- **@nossen/knowledge-modules** + **@nossen/logic-reduce** = the canon + the plan reducer.
- **@nossen/mcp-\*** = the MCP tooling surface for the agents.

## All 40 packages

| package | version | what it does |
|---|---|---|
| [`@nossen/allmight`](https://www.npmjs.com/package/@nossen/allmight) | 2.0.1 | Audit-first duplicate detector and canonicalization helper for large JavaScript and TypeScript repositories. |
| [`@nossen/bat`](https://www.npmjs.com/package/@nossen/bat) | 2.0.2 | Adaptive request-control primitives: ears for sensing, wings for routing, fangs for guarded execution. |
| [`@nossen/bat-system`](https://www.npmjs.com/package/@nossen/bat-system) | 2.0.2 | Compatibility layer for older BAT system workflows. Prefer @nossen/bat for new code. |
| [`@nossen/beam`](https://www.npmjs.com/package/@nossen/beam) | 2.0.1 | Pipeline orchestration primitives for routing work through Funesterie and A11 systems. |
| [`@nossen/cf`](https://www.npmjs.com/package/@nossen/cf) | 0.1.0 | Tiny Cloudflare API client for the Funesterie AIs (zones/DNS/tunnels/Access/R2) - one CLOUDFLARE_API_TOKEN, no browser. |
| [`@nossen/dragon`](https://www.npmjs.com/package/@nossen/dragon) | 2.0.2 | Dragon control-plane daemon for the Funesterie ecosystem. |
| [`@nossen/dragon-contracts`](https://www.npmjs.com/package/@nossen/dragon-contracts) | 2.0.1 | Shared Dragon contracts for the Funesterie control plane. |
| [`@nossen/dragon-upstream`](https://www.npmjs.com/package/@nossen/dragon-upstream) | 2.0.2 | Dragon upstream probing, daemon policy and integration workflows. |
| [`@nossen/envapt-superimg`](https://www.npmjs.com/package/@nossen/envapt-superimg) | 2.0.2 | Image-oriented ENVAPT helpers for OC8-style payload verification and transport experiments. |
| [`@nossen/envaptex`](https://www.npmjs.com/package/@nossen/envaptex) | 2.0.1 | Environment adapter toolkit for typed runtime configuration, profile loading and integration checks. |
| [`@nossen/freeland`](https://www.npmjs.com/package/@nossen/freeland) | 2.0.2 | Neutral normalization layer for values crossing Funesterie, A11 and runtime module boundaries. |
| [`@nossen/freeland-bros`](https://www.npmjs.com/package/@nossen/freeland-bros) | 2.0.4 | Runtime diagnostics and RGBA/cube projection layer on top of Freeland and Morphing. |
| [`@nossen/hetzner`](https://www.npmjs.com/package/@nossen/hetzner) | 0.1.0 | Hetzner Robot API client for the Funesterie AIs - manage EX44 (dedicated) over 443: server info, reboot, rescue, reverse DNS. No SSH. |
| [`@nossen/katana`](https://www.npmjs.com/package/@nossen/katana) | 2.0.0 | Focused CLI and library helpers for repository cuts, checks and small automation tasks. |
| [`@nossen/knowledge-modules`](https://www.npmjs.com/package/@nossen/knowledge-modules) | 0.2.3 | Public NOSSEN knowledge modules: persona canon, temporal gravity constants, pulsar colour palette. |
| [`@nossen/logic-reduce`](https://www.npmjs.com/package/@nossen/logic-reduce) | 2.0.3 | Deterministic direct-path reducer for plans, runbooks, and agent handoffs. |
| [`@nossen/mcp-agent-bus`](https://www.npmjs.com/package/@nossen/mcp-agent-bus) | 0.1.2 | Request builders for agent presence, inbox, discussions and bounded handoffs. |
| [`@nossen/mcp-chopper-mixer`](https://www.npmjs.com/package/@nossen/mcp-chopper-mixer) | 0.1.2 | Read-only planning contracts for runtime hooks, doctor/chopper diagnostics and mixer routing. |
| [`@nossen/mcp-cloud-assets`](https://www.npmjs.com/package/@nossen/mcp-cloud-assets) | 0.1.2 | Read-only search/fetch contracts plus generated asset bucket request builders for trusted MCP profiles. |
| [`@nossen/mcp-job-queue`](https://www.npmjs.com/package/@nossen/mcp-job-queue) | 0.1.2 | Safe declarative job queue builders for MCP workers: enqueue, lease, heartbeat, complete and recover. |
| [`@nossen/mcp-media-bridge`](https://www.npmjs.com/package/@nossen/mcp-media-bridge) | 0.1.2 | Request builders for window capture, source selection, vision/audio analysis and combined media summaries. |
| [`@nossen/mcp-memory-graph`](https://www.npmjs.com/package/@nossen/mcp-memory-graph) | 0.1.2 | Secret-safe memory and graph request builders for Neo4j-style MCP profiles. |
| [`@nossen/mcp-public-endpoints`](https://www.npmjs.com/package/@nossen/mcp-public-endpoints) | 0.1.2 | Endpoint profile helpers for public read-only MCP clients such as ChatGPT, Gemini, Claude and Grok. |
| [`@nossen/mcp-qflush-control`](https://www.npmjs.com/package/@nossen/mcp-qflush-control) | 0.1.2 | Bounded gamepad, keyboard and mouse command contracts for Qflush-compatible controller bridges. |
| [`@nossen/mcp-retro-session`](https://www.npmjs.com/package/@nossen/mcp-retro-session) | 0.1.2 | Retro session contracts for SNES/KI/RomStation state and bounded controller plans. |
| [`@nossen/mcp-security-preflight`](https://www.npmjs.com/package/@nossen/mcp-security-preflight) | 0.1.2 | Secret redaction, token-presence summaries and preflight-safe helpers for MCP clients. |
| [`@nossen/mcp-tool-manifest`](https://www.npmjs.com/package/@nossen/mcp-tool-manifest) | 0.1.2 | A grouped manifest for NOSSEN-compatible MCP tools and safe public profiles. |
| [`@nossen/mcp-toolkit`](https://www.npmjs.com/package/@nossen/mcp-toolkit) | 0.1.2 | Small dependency-free helpers for JSON-RPC MCP calls, endpoint normalization and tool call payloads. |
| [`@nossen/mcp-web-drafts`](https://www.npmjs.com/package/@nossen/mcp-web-drafts) | 0.1.2 | Append-only website draft contracts for MCP agents that should never deploy directly to production. |
| [`@nossen/mcp-worker-supervisor`](https://www.npmjs.com/package/@nossen/mcp-worker-supervisor) | 0.1.2 | Contracts for bounded worker status, start/stop/restart, task dispatch and task result polling. |
| [`@nossen/morphing`](https://www.npmjs.com/package/@nossen/morphing) | 2.1.0 | Compact 4-byte value shapes and RGBA/cube helpers for low-friction transport. |
| [`@nossen/nezlephant`](https://www.npmjs.com/package/@nossen/nezlephant) | 2.0.2 | OC8 image payload helper for encoding, decoding and inspecting small binary/image carriers. |
| [`@nossen/qflush`](https://www.npmjs.com/package/@nossen/qflush) | 2.0.4 | QFlush - portable command-line orchestrator for local modules, workflows, and supervised services. |
| [`@nossen/qflush-runner`](https://www.npmjs.com/package/@nossen/qflush-runner) | 2.0.2 | Small runner package for invoking QFlush in lightweight automation contexts. |
| [`@nossen/rome`](https://www.npmjs.com/package/@nossen/rome) | 2.0.3 | Runtime orchestration and command vocabulary used by QFlush, A11 and local automation flows. |
| [`@nossen/scentgate`](https://www.npmjs.com/package/@nossen/scentgate) | 2.2.0 | Ephemeral research capsule for structured notes, signals and short-lived investigation context. |
| [`@nossen/scream`](https://www.npmjs.com/package/@nossen/scream) | 2.0.2 | Small semantic prototype for SCREAM, WAZAA and MASK primitives. |
| [`@nossen/spyder`](https://www.npmjs.com/package/@nossen/spyder) | 2.0.2 | Lightweight local assistant and scanner primitives for NOSSEN/Funesterie developer tooling. |
| [`@nossen/zen`](https://www.npmjs.com/package/@nossen/zen) | 0.1.3 | Zero-Exposed NEZ archive encoder/decoder for .zen corpus containers. |
| [`@nossen/zen-gate`](https://www.npmjs.com/package/@nossen/zen-gate) | 0.1.0 | ZEN Gate / Stargate - chunked dedup transfer (HAVE/NEED) for PC<->EX44, built on @nossen/zen + Brotli + SHA-256. |

## License

MIT. NOSSEN packages stay public and usable.
