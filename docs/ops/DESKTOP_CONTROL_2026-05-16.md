# Desktop control command set - 2026-05-16

Purpose: give Codex/A11 a reusable Windows desktop control layer for bounded UI work.

Primary script:

```powershell
D:\projets\funesterie\scripts\Desktop-Control.ps1
```

Watcher script for hooks/agents:

```powershell
D:\projets\funesterie\scripts\Watch-DesktopCommands.ps1
```

Watcher management:

```powershell
D:\projets\funesterie\scripts\Start-DesktopCommandsWatcher.ps1
D:\projets\funesterie\scripts\Get-DesktopCommandsWatcherStatus.ps1
D:\projets\funesterie\scripts\Stop-DesktopCommandsWatcher.ps1
```

## Direct commands

Window:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File D:\projets\funesterie\scripts\Desktop-Control.ps1 list-windows -Json
powershell -NoProfile -ExecutionPolicy Bypass -File D:\projets\funesterie\scripts\Desktop-Control.ps1 foreground -Json
powershell -NoProfile -ExecutionPolicy Bypass -File D:\projets\funesterie\scripts\Desktop-Control.ps1 focus -TitleLike "Brave"
```

Mouse:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File D:\projets\funesterie\scripts\Desktop-Control.ps1 cursor -Json
powershell -NoProfile -ExecutionPolicy Bypass -File D:\projets\funesterie\scripts\Desktop-Control.ps1 move -X 100 -Y 200
powershell -NoProfile -ExecutionPolicy Bypass -File D:\projets\funesterie\scripts\Desktop-Control.ps1 click -X 100 -Y 200
powershell -NoProfile -ExecutionPolicy Bypass -File D:\projets\funesterie\scripts\Desktop-Control.ps1 double-click -X 100 -Y 200
powershell -NoProfile -ExecutionPolicy Bypass -File D:\projets\funesterie\scripts\Desktop-Control.ps1 right-click -X 100 -Y 200
powershell -NoProfile -ExecutionPolicy Bypass -File D:\projets\funesterie\scripts\Desktop-Control.ps1 scroll -Delta -720 -X 900 -Y 500
powershell -NoProfile -ExecutionPolicy Bypass -File D:\projets\funesterie\scripts\Desktop-Control.ps1 drag -X 100 -Y 200 -ToX 500 -ToY 220
```

Keyboard:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File D:\projets\funesterie\scripts\Desktop-Control.ps1 key -Keys ENTER
powershell -NoProfile -ExecutionPolicy Bypass -File D:\projets\funesterie\scripts\Desktop-Control.ps1 hotkey -Keys "CTRL+L"
powershell -NoProfile -ExecutionPolicy Bypass -File D:\projets\funesterie\scripts\Desktop-Control.ps1 alt-tab -Count 1
powershell -NoProfile -ExecutionPolicy Bypass -File D:\projets\funesterie\scripts\Desktop-Control.ps1 type -Text "hello"
powershell -NoProfile -ExecutionPolicy Bypass -File D:\projets\funesterie\scripts\Desktop-Control.ps1 open-url -Url "https://example.com"
```

Screen and clipboard:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File D:\projets\funesterie\scripts\Desktop-Control.ps1 screenshot -Path C:\Temp\shot.png
powershell -NoProfile -ExecutionPolicy Bypass -File D:\projets\funesterie\scripts\Desktop-Control.ps1 clipboard-get
powershell -NoProfile -ExecutionPolicy Bypass -File D:\projets\funesterie\scripts\Desktop-Control.ps1 clipboard-set -Text "hello"
```

Relative window coordinates:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File D:\projets\funesterie\scripts\Desktop-Control.ps1 click -TitleLike "Brave" -Relative -Rx 0.5 -Ry 0.5
```

Dry run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File D:\projets\funesterie\scripts\Desktop-Control.ps1 click -TitleLike "Brave" -Relative -Rx 0.5 -Ry 0.5 -DryRun -Json
```

## Bus mode

Start watcher:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File D:\projets\funesterie\scripts\Start-DesktopCommandsWatcher.ps1
```

Check watcher:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File D:\projets\funesterie\scripts\Get-DesktopCommandsWatcherStatus.ps1
```

Stop watcher:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File D:\projets\funesterie\scripts\Stop-DesktopCommandsWatcher.ps1
```

Default command file:

```txt
D:\agent-bus\desktop-commands.jsonl
```

Command schema:

```json
{"schema":"funesterie.desktop_command.v1","id":"demo-1","action":"focus","params":{"titleLike":"Brave"}}
{"schema":"funesterie.desktop_command.v1","id":"demo-2","action":"hotkey","params":{"keys":"CTRL+L"}}
{"schema":"funesterie.desktop_command.v1","id":"demo-3","action":"type","params":{"text":"https://example.com"}}
{"schema":"funesterie.desktop_command.v1","id":"demo-4","action":"key","params":{"keys":"ENTER"}}
```

Safety rule: do not put passwords, bearer tokens, cookies, or raw `.env` values into desktop command logs. Text command logs record only text length, but the command file itself can still contain the raw text.
