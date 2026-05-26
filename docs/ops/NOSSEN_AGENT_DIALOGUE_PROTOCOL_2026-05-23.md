# NOSSEN Agent Dialogue Protocol

Date: 2026-05-23
Status: active coordination rule for NOSSEN / Funesterie agents.

## Goal

The operator must not be the relay between agents.

When Codex, Kiro, Claude, A11, Kaen44, Vivy, Gemini, or another approved agent needs another agent, it must start and hold the dialogue directly through the available coordination rail: MCP discussion, local agent bus, approved Discord bridge, GitHub PR thread, or the active tool lane.

This is a dialogue protocol, not a notice-board protocol.

## Rule

An agent may not do this:

```text
Tell Jeffrey to ask Claude/Kiro/A11 what to do.
Drop one status line and disappear.
Leave a human to reconcile contradictory advice from several agents.
```

An agent must do this instead:

```text
Open or join the relevant agent thread.
State the exact question, file, route, PR, probe, or command result.
Stay in the thread until the other side answers or the task is handed off.
Answer follow-up questions.
Close with one of: resolved, blocked with reason, or handed off with owner and next check.
```

## Completion Criteria

A dialogue is complete only when one of these is true:

- The issue is fixed and verified.
- The issue is rejected with evidence.
- The issue is blocked by a concrete missing dependency.
- Another named agent accepts the next action in the same thread.
- The operator explicitly stops the work.

If none of those are true, the agent is still holding the thread.

## Required Thread Shape

Every inter-agent request should include:

- topic and goal;
- current source of truth;
- exact file, PR, endpoint, route, or job id;
- what was already verified;
- what is uncertain;
- requested next action;
- deadline or urgency if it matters.

Avoid vague requests such as "check this", "ask Claude", or "someone fix prod".

## Handoff Format

Use this compact format when another agent takes over:

```text
Handoff:
- owner: <agent>
- scope: <exact scope>
- source: <doc/file/thread/PR>
- verified: <checks already run>
- next: <first next action>
- stop condition: <when to stop or return>
```

## Guardrails

- No raw tokens, passwords, API keys, private keys, recovery codes, or credential blobs in any agent dialogue.
- Before statements about infra, MCP, auth, GitHub, deploy, or prod, read the preflight and cite the current source of truth.
- Do not touch unrelated local changes.
- Use clean worktrees for serious patches.
- Prefer objective -> exact file -> minimal patch -> targeted test -> PR.
- Do not call a task done until it is verified.

## Current Coordination Rails

- MCP shared discussions for durable agent-to-agent state.
- Local `D:\agent-bus` for machine-local events and watcher-controlled actions.
- GitHub PR threads for code review and CI evidence.
- Discord bridge only when it is already configured and appropriate for live discussion.

The human can still decide priorities. The agents must carry their own conversations.
