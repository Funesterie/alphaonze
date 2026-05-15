# Qflush virtual input bridge

Qflush can queue bounded gamepad, keyboard, and mouse commands for local demo
bridges. This is meant for demo/game automation, not general keyboard capture or
unscoped desktop control.

## Endpoints

Local-only by default:

- `GET /api/qflush/gamepad/status`
- `GET /api/qflush/gamepad/commands?limit=50`
- `POST /api/qflush/gamepad/command`
- `POST /api/qflush/gamepad/pilot`
- `GET /api/qflush/gamepad/keyboard/commands?limit=50`
- `POST /api/qflush/gamepad/keyboard/command`
- `POST /api/qflush/gamepad/keyboard/pilot`
- `GET /api/qflush/mouse/commands?limit=50`
- `POST /api/qflush/mouse/command`
- `POST /api/qflush/mouse/click`

Set `QFLUSH_GAMEPAD_ALLOW_REMOTE=1` only if the route is protected by a trusted
local tunnel or auth layer.

## MCP tools

The shared MCP exposes the same bus for agents:

- `qflush_gamepad_status`
- `qflush_gamepad_play`
- `qflush_gamepad_pilot`
- `qflush_mouse_click`

The older `br_play` and `br_pilot` tools remain available for Bloody Roar, but
new agents should prefer the `qflush_gamepad_*` names when they mean the generic
virtual controller bus.

## Command payload

```json
{
  "from": "codex",
  "target": "bloody-roar-extreme",
  "player": 1,
  "buttons": "right a",
  "holdMs": 65,
  "waitMs": 160,
  "note": "demo poke"
}
```

Canonical names to use in agent prompts:

```txt
Gamepad target: bloody-roar-extreme
Keyboard layouts:
- bloody-roar-keyboard-azerty
- bloody-roar-keyboard-wasd
- bloody-roar-keyboard-numpad
Mouse coordinate mode:
- window-normalized
- window-pixels
Mouse actions:
- click
- double_click
- move
Mouse buttons:
- left
- right
- middle
```

Allowed buttons:

```txt
up down left right a b x y z l r start select
```

Qflush writes:

- `gamepad-commands.jsonl` with schema `funesterie.gamepad_command.v1`
- `br-commands.jsonl` with schema `funesterie.br_play.v1` when the target is
  `bloody-roar-extreme`, so the current Bloody Roar ViGEm watcher works without
  another bridge.

Default bus:

```txt
C:\Users\Djeff\OneDrive\a11_memory\agent-bus
```

Override with `QFLUSH_GAMEPAD_BUS_DIR`.

## Pilot intents

```json
{
  "from": "a11",
  "target": "bloody-roar-extreme",
  "player": 1,
  "intent": "demo_fight",
  "loops": 1
}
```

Intents:

```txt
auto wake advance_menu demo_fight beast_combo safe_idle reset_soft
```

## Bridge

For Bloody Roar, start or restart:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File D:\projets\funesterie\a11mcp\scripts\Start-BloodyRoarDemoBridge.ps1
```

The bridge creates Xbox 360 virtual controllers through ViGEm and consumes the
append-only command file.

## Keyboard fallback

If the virtual gamepad is not picked up by the emulator, Qflush can emit bounded
keyboard commands instead:

```json
{
  "from": "a11",
  "target": "bloody-roar-extreme",
  "layout": "bloody-roar-keyboard-azerty",
  "player": 1,
  "buttons": "right a",
  "holdMs": 55
}
```

Layouts:

```txt
bloody-roar-keyboard-azerty  arrows + A/Z/E/R/S/D/F/Enter
bloody-roar-keyboard-wasd    WASD + J/K/U/I/O/Q/E/Enter
bloody-roar-keyboard-numpad  numpad movement/actions + Enter
```

Keyboard commands are written to:

```txt
C:\Users\Djeff\OneDrive\a11_memory\agent-bus\keyboard-commands.jsonl
```

The keyboard watcher is started by `Start-BloodyRoarDemoBridge.ps1` unless
`-NoKeyboardFallback` is passed. It only sends allowlisted keys and only after
focusing a window matching `Bloody Roar Extreme`.

Old aliases still work for compatibility:

```txt
br-azerty -> bloody-roar-keyboard-azerty
br-wasd   -> bloody-roar-keyboard-wasd
br-numpad -> bloody-roar-keyboard-numpad
```

## Mouse fallback

Qflush can also queue bounded mouse actions. Prefer window-relative coordinates
so agents do not click random desktop locations:

```json
{
  "from": "a11",
  "target": "bloody-roar-extreme",
  "targetWindow": "Bloody Roar Extreme|RomStation",
  "action": "click",
  "button": "left",
  "coordinateMode": "window-normalized",
  "x": 0.5,
  "y": 0.5,
  "holdMs": 35
}
```

Mouse commands are written to:

```txt
C:\Users\Djeff\OneDrive\a11_memory\agent-bus\mouse-commands.jsonl
```

The mouse watcher is started by `Start-BloodyRoarDemoBridge.ps1` unless
`-NoMouseFallback` is passed. It supports `click`, `double_click`, and `move`.
Absolute screen coordinates are refused unless `QFLUSH_MOUSE_ALLOW_ABSOLUTE=1`
is explicitly set.
