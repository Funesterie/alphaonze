# Blue USB / Janus / QFlush map - 2026-05-13

Purpose: give Kiro, Codex, and A11 a shared map of the local input stack without
exposing secrets or attempting to capture private Bluetooth payloads.

## Current evidence

- The Sony controller is present over USB as `VID_054C&PID_09CC`.
- Its physical path is `USBROOT(0)#USB(7)` / `Port_#0007.Hub_#0001`.
- Windows binds it through Microsoft `usb.inf`, `input.inf`, and `wdma_usb.inf`.
- The Realtek Bluetooth USB adapter `VID_0BDA&PID_A728` is not currently present.
- No connected Bluetooth class device is currently enumerated by Windows.
- `Nefarius Virtual Gamepad Emulation Bus` is present and healthy.
- `GameInputSvc`, `XboxGipSvc`, and `hidserv` are running.

## Iceberg layers

1. Physical USB
   - The controller is on the root hub port 7.
   - The Bluetooth dongle must first reappear as USB `VID_0BDA&PID_A728`.
   - If it appears as `VID_0000&PID_0002`, Windows failed the USB descriptor request.

2. Windows PnP and drivers
   - Sony USB controller path: USB composite -> HID game controller + USB audio endpoints.
   - Bluetooth path, when healthy: USB Realtek adapter -> Bluetooth class -> Microsoft BTH enumerators.
   - If the USB Realtek device is absent, the Bluetooth stack above it cannot recover by software alone.

3. Local game input
   - Human input: RomStation/Dolphin sees `Wireless Controller` directly.
   - Agent input: ViGEm creates virtual Xbox controllers for bounded automation.

4. Agent bus
   - Default live bus: `D:\agent-bus`
   - Legacy/backup bus: `C:\Users\Djeff\OneDrive\a11_memory\agent-bus`
   - Generic QFlush gamepad file: `gamepad-commands.jsonl`
   - Bloody Roar legacy file: `br-commands.jsonl`
   - Keyboard fallback file: `keyboard-commands.jsonl`
   - Mouse fallback file: `mouse-commands.jsonl`

5. Watchers and bridge
   - `Watch-BrCommands.ps1` consumes `br-commands.jsonl` through ViGEm.
   - `Watch-QflushKeyboardCommands.ps1` consumes keyboard fallback commands.
   - `Watch-QflushMouseCommands.ps1` consumes mouse fallback commands.
   - `Watch-BrState.ps1` and `Watch-RomStationState.ps1` produce visual/window state.

6. MCP / Kiro
   - Local MCP `a11` points to `D:\projets\funesterie\a11\backend\apps\server\tools\mcp\a11-mcp-server.cjs`.
   - Shared MCP `a11mcp-shared` exposes `qflush_gamepad_status`, `qflush_gamepad_play`, and `qflush_gamepad_pilot`.
   - Kiro is configured to auto-approve those shared QFlush tools.

7. Janus
   - Janus is a vision/analysis layer, not the physical controller driver.
   - It helps interpret frames, images, video plans, and visual state.
   - The game-control path is Janus/agent decision -> QFlush command -> agent-bus -> watcher -> ViGEm/input.

## Blue USB watcher

Run once:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File D:\projets\funesterie\a11mcp\scripts\Watch-BlueUsbPnP.ps1 -Once
```

Run continuously while unplugging/replugging the dongle:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File D:\projets\funesterie\a11mcp\scripts\Watch-BlueUsbPnP.ps1
```

Output:

```txt
D:\agent-bus\blue-usb-events.jsonl
```

Interpretation:

- `VID_0BDA&PID_A728` present with `ProblemCode=0`: USB and Realtek driver are alive.
- `VID_0BDA&PID_A728` present with non-zero `ProblemCode`: reinstall/update Realtek Bluetooth driver.
- `VID_0000&PID_0002`: USB descriptor failure, usually port, power, hub, or dongle hardware.
- No Realtek entry at all: Windows does not see the dongle electrically.

## Safe operating rule

Do not capture Bluetooth payloads or pairing secrets. For this system, the useful
diagnostic boundary is PnP/USB presence, driver binding, and QFlush command flow.
