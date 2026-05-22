# PR100 Reboot Autostart

This is the operator checklist for a Windows reboot rescue on the NOSSEN /
Funesterie desktop.

## Goal

After Windows logon, the local stack should restart without manual terminal
work, then agents can verify the system before gameplay or production work.

## Windows Task

Task Scheduler entry:

- Task path: `\Funesterie\`
- Task name: `Funesterie Auto Start`
- Trigger: current user logon
- Delay: `PT45S`
- Action: `powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "D:\projets\funesterie\a11\launchers\funesterie-autostart.ps1"`

Install or refresh it with:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File D:\projets\funesterie\a11\launchers\install-funesterie-autostart.ps1
```

Verify it with:

```powershell
Get-ScheduledTask -TaskName "Funesterie Auto Start" -TaskPath "\Funesterie\" |
  Select-Object TaskPath, TaskName, State, @{ Name = "Delay"; Expression = { $_.Triggers[0].Delay } }
```

## Autostart Scope

`funesterie-autostart.ps1` is the single boot entrypoint. It handles:

- source update helper when present;
- Podman / local Neo4j bridge checks;
- A11 MCP local service and tunnel;
- A11 local backend;
- Kaen44 local backend;
- local frontend;
- Ekko when available;
- Codex/Neo4j and memory sync checks;
- RomStation / QFlush bridge;
- public health checks for `mcp.funesterie.me`, `a11.funesterie.me`, and `k44.funesterie.me`.

Logs are written under:

```text
D:\projets\funesterie\a11\logs\autostart
```

## Team Call

No secrets belong in discussions, logs, screenshots, commits, or PR comments.

Post-reboot roles:

- Codex: inspect preflight, task state, logs, GitHub PR state, and blockers.
- Kiro: reload MCP clients and confirm `tools/list` / RomStation tools.
- A11: verify MCP local/public, Neo4j/Aura, and memory sync health.
- Kaen44: verify UI/API route health.
- Vivy: verify audio/media readiness.
- QFlush / Janus: verify RomStation/Bloody Roar state and bridge readiness.
- Chopper: triage queued repair/system-health work.

## Gameplay Guardrail

For Bloody Roar, keep the bridge in observation until the user confirms the
session is back. Use short bounded intents only after the state file is fresh:

```text
D:\agent-bus\romstation\latest-state.json
```
