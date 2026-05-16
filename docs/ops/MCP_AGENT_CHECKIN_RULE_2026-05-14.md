# MCP agent check-in rule - 2026-05-14

Goal: every agent that arrives on the MCP should behave like a teammate entering a room:
announce presence, check messages, read active jobs, and answer briefly when useful.

## Rule

On MCP startup or reconnect, agents should call:

1. `agent_heartbeat`
2. `agent_inbox_check` if they need a manual refresh
3. `discussion_read` on any thread that needs real work
4. `discussion_post` or `discussion_set_status` only with non-secret status

`agent_heartbeat` now checks the inbox automatically by default.

## Anti-spam guard

- The check-in never replies to archived or done threads.
- It does not answer its own last message.
- It does not answer another check-in message.
- It keeps per-agent/per-thread receipts.
- It uses a two-hour default cooldown before another automatic check-in.

## Message shape

Automatic replies use this short form:

```text
Check-in MCP: <agent> a lu ce fil en arrivant. Etat actuel: <status>. Aucune action sensible lancee automatiquement.
```

No secrets, passwords, private keys, provider tokens, payment data, or raw credentials belong in discussion messages.
