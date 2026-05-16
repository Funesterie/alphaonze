# Grok Media Analyst Lane

Status: proposed active lane
Date: 2026-05-15
Scope: Grok as an external analysis and brainstorming agent for Funesterie.

## Position

Grok is useful as a media analyst, challenger, and fast alternate-hypothesis engine.

Grok is not a system captain, runtime operator, secret holder, production deployer, or Neo4j owner.

## Approved Role

Grok may help with:

- audio/video analysis briefs;
- image, poster, UI, and branding critique;
- fast brainstorms;
- contradiction and red-team-style review;
- public-safe corpus reading;
- comparison against Gemini/ChatGPT/A11 analysis;
- summarizing media quality, narrative coherence, and demo impact.

## Access Model

Preferred access:

```txt
public_grok -> https://mcp.funesterie.me/grok/mcp
```

Future stronger access:

```txt
Cloudflare Worker proxy
  checks X-Agent-Id: grok
  injects bearer server-side
  forwards only allowlisted tools
```

Grok should never receive a raw bearer token in chat, UI, prompt, screenshot, config paste, or public document.

## Allowed Tools

Public-safe only by default:

- `search`
- `fetch`
- `a11_status`
- `kaen44_status`
- `qflush_status`
- `generated_bucket_status`
- `generated_bucket_public_url`

Optional private-safe tools later, only via proxy/OAuth and explicit allowlist:

- `discussion_list`
- `discussion_read`
- `discussion_post`
- `agent_heartbeat`
- `a11_agent_jobs_status`
- `neo4j_read_query` with read-only guard

## Blocked Tools

Always blocked by default:

- free shell;
- direct filesystem access;
- secret reads;
- raw `.env` reads;
- `a11_worker_start`;
- `a11_worker_stop`;
- `a11_worker_restart`;
- direct `neo4j_write_query`;
- production deploy;
- billing/payment operations;
- root/admin host operations;
- unrestricted Qflush input injection.

## Media Workflow

Recommended workflow:

```txt
1. A11/Codex prepares a public-safe media artifact or URL.
2. Grok reviews the artifact with a bounded prompt.
3. Grok returns:
   - observations;
   - risks;
   - suggested edits;
   - confidence;
   - what it cannot verify.
4. Codex/Gemini compare against local context.
5. A11 stores only the useful summary, not raw private data.
```

## Output Contract

Ask Grok for this format:

```txt
GROK_MEDIA_REVIEW
artifact:
goal:
what works:
risks:
missing context:
suggested changes:
confidence:
safe next action:
```

## Governance Rule

Grok can advise. A11, Codex, and the human operator decide.

If Grok proposes taking more control, translate that proposal into a bounded capability request first:

```txt
requested capability:
business value:
risk:
allowed tools:
blocked tools:
audit path:
rollback:
```

No capability is granted from enthusiasm alone.
