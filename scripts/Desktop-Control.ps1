param(
  [Parameter(Position = 0)]
  [Alias("Command")]
  [ValidateSet(
    "help",
    "list-windows",
    "foreground",
    "focus",
    "screenshot",
    "cursor",
    "move",
    "click",
    "double-click",
    "right-click",
    "middle-click",
    "mouse-down",
    "mouse-up",
    "drag",
    "scroll",
    "hscroll",
    "key",
    "hotkey",
    "alt-tab",
    "type",
    "paste",
    "clipboard-get",
    "clipboard-set",
    "open-url",
    "wait",
    "run-json"
  )]
  [string]$Action = "help",

  [string]$TitleLike,
  [string]$ProcessName,
  [int]$Id,

  [int]$X = [int]::MinValue,
  [int]$Y = [int]::MinValue,
  [int]$ToX = [int]::MinValue,
  [int]$ToY = [int]::MinValue,
  [double]$Rx = [double]::NaN,
  [double]$Ry = [double]::NaN,
  [switch]$Relative,

  [ValidateSet("left", "right", "middle", "x1", "x2")]
  [string]$Button = "left",
  [int]$Count = 1,
  [int]$DelayMs = 80,
  [int]$HoldMs = 45,
  [int]$DurationMs = 350,
  [int]$Steps = 24,
  [int]$Delta = 120,
  [int]$Ms = 500,

  [string]$Keys,
  [string]$Text,
  [string]$Url,
  [string]$Path,
  [string]$InputJson,
  [string]$InputPath,

  [switch]$NoRestoreClipboard,
  [switch]$Reverse,
  [switch]$Json,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName Microsoft.VisualBasic

if (-not ("DesktopControlNative" -as [type])) {
  Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public struct DesktopControlPoint {
  public int X;
  public int Y;
}

public struct DesktopControlRect {
  public int Left;
  public int Top;
  public int Right;
  public int Bottom;
}

public static class DesktopControlNative {
  [DllImport("user32.dll")]
  public static extern bool SetCursorPos(int X, int Y);

  [DllImport("user32.dll")]
  public static extern bool GetCursorPos(out DesktopControlPoint point);

  [DllImport("user32.dll")]
  public static extern void mouse_event(uint dwFlags, uint dx, uint dy, int dwData, UIntPtr dwExtraInfo);

  [DllImport("user32.dll")]
  public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);

  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();

  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

  [DllImport("user32.dll")]
  public static extern bool IsIconic(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern bool GetWindowRect(IntPtr hWnd, out DesktopControlRect rect);
}
"@
}

$SW_RESTORE = 9
$KEYEVENTF_KEYUP = 0x0002
$MOUSEEVENTF_LEFTDOWN = 0x0002
$MOUSEEVENTF_LEFTUP = 0x0004
$MOUSEEVENTF_RIGHTDOWN = 0x0008
$MOUSEEVENTF_RIGHTUP = 0x0010
$MOUSEEVENTF_MIDDLEDOWN = 0x0020
$MOUSEEVENTF_MIDDLEUP = 0x0040
$MOUSEEVENTF_XDOWN = 0x0080
$MOUSEEVENTF_XUP = 0x0100
$MOUSEEVENTF_WHEEL = 0x0800
$MOUSEEVENTF_HWHEEL = 0x1000
$XBUTTON1 = 0x0001
$XBUTTON2 = 0x0002

$KeyMap = @{
  "backspace" = 0x08; "back" = 0x08
  "tab" = 0x09
  "enter" = 0x0D; "return" = 0x0D
  "shift" = 0x10
  "ctrl" = 0x11; "control" = 0x11
  "alt" = 0x12; "menu" = 0x12
  "pause" = 0x13
  "capslock" = 0x14
  "esc" = 0x1B; "escape" = 0x1B
  "space" = 0x20
  "pageup" = 0x21; "pgup" = 0x21
  "pagedown" = 0x22; "pgdn" = 0x22
  "end" = 0x23
  "home" = 0x24
  "left" = 0x25
  "up" = 0x26
  "right" = 0x27
  "down" = 0x28
  "printscreen" = 0x2C; "prtsc" = 0x2C
  "insert" = 0x2D; "ins" = 0x2D
  "delete" = 0x2E; "del" = 0x2E
  "lwin" = 0x5B; "win" = 0x5B
  "rwin" = 0x5C
  "apps" = 0x5D; "contextmenu" = 0x5D
  "sleep" = 0x5F
  "numlock" = 0x90
  "scrolllock" = 0x91
  "browserback" = 0xA6
  "browserforward" = 0xA7
  "browserrefresh" = 0xA8
  "browserstop" = 0xA9
  "browsersearch" = 0xAA
  "browserfavorites" = 0xAB
  "browserhome" = 0xAC
  "volumemute" = 0xAD
  "volumedown" = 0xAE
  "volumeup" = 0xAF
  "medianext" = 0xB0
  "mediaprev" = 0xB1
  "mediastop" = 0xB2
  "mediaplaypause" = 0xB3
  "launchmail" = 0xB4
  "semicolon" = 0xBA
  "equals" = 0xBB
  "comma" = 0xBC
  "minus" = 0xBD
  "period" = 0xBE
  "slash" = 0xBF
  "backtick" = 0xC0
  "leftbracket" = 0xDB
  "backslash" = 0xDC
  "rightbracket" = 0xDD
  "quote" = 0xDE
}

foreach ($c in [char[]]"ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
  $KeyMap[[string]$c] = [byte][int][char]$c
  $KeyMap[([string]$c).ToLowerInvariant()] = [byte][int][char]$c
}
for ($i = 0; $i -le 9; $i++) {
  $KeyMap[[string]$i] = [byte](0x30 + $i)
  $KeyMap["numpad$i"] = [byte](0x60 + $i)
}
for ($i = 1; $i -le 24; $i++) {
  $KeyMap["f$i"] = [byte](0x6F + $i)
}
$KeyMap["numpadmultiply"] = 0x6A
$KeyMap["numpadadd"] = 0x6B
$KeyMap["numpadsubtract"] = 0x6D
$KeyMap["numpaddecimal"] = 0x6E
$KeyMap["numpaddivide"] = 0x6F

function Write-Result {
  param([object]$Value)
  if ($Json) {
    $Value | ConvertTo-Json -Depth 8
  } else {
    $Value
  }
}

function Show-Help {
  @"
Desktop-Control.ps1

Window:
  list-windows [-Json]
  foreground [-Json]
  focus -TitleLike "Brave" | -ProcessName brave | -Id 11116

Mouse:
  cursor [-Json]
  move -X 100 -Y 200
  click [-X 100 -Y 200] [-Button left|right|middle|x1|x2] [-Count 2]
  double-click -X 100 -Y 200
  right-click -X 100 -Y 200
  mouse-down -Button left
  mouse-up -Button left
  drag -X 100 -Y 200 -ToX 500 -ToY 220 [-DurationMs 400]
  scroll -Delta -720 [-X 900 -Y 500]
  hscroll -Delta 240

Keyboard:
  key -Keys ENTER [-Count 1]
  hotkey -Keys "CTRL+L"
  alt-tab [-Count 1] [-Reverse]
  type -Text "unicode text pasted through clipboard"
  paste -Text "same as type"
  open-url -Url "https://example.com"

Clipboard and screen:
  clipboard-get
  clipboard-set -Text "hello"
  screenshot [-Path C:\Temp\shot.png] [-TitleLike "Brave"]
  wait -Ms 500

Relative window coordinates:
  click -TitleLike "Brave" -Relative -Rx 0.5 -Ry 0.5

Batch JSON:
  run-json -InputJson '[{"action":"focus","titleLike":"Brave"},{"action":"hotkey","keys":"CTRL+L"}]'
  run-json -InputPath D:\agent-bus\desktop-commands.jsonl

Safety:
  Add -DryRun to resolve and print actions without executing them.
"@
}

function Get-OpenWindows {
  Get-Process |
    Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle } |
    Sort-Object ProcessName, Id |
    ForEach-Object {
      [pscustomobject]@{
        id = $_.Id
        processName = $_.ProcessName
        title = $_.MainWindowTitle
        handle = ("0x{0:X}" -f $_.MainWindowHandle.ToInt64())
      }
    }
}

function Get-ForegroundWindowInfo {
  $handle = [DesktopControlNative]::GetForegroundWindow()
  $proc = Get-Process | Where-Object { $_.MainWindowHandle -eq $handle } | Select-Object -First 1
  if (-not $proc) {
    return [pscustomobject]@{ handle = ("0x{0:X}" -f $handle.ToInt64()); processName = $null; id = $null; title = $null }
  }
  [pscustomobject]@{
    id = $proc.Id
    processName = $proc.ProcessName
    title = $proc.MainWindowTitle
    handle = ("0x{0:X}" -f $proc.MainWindowHandle.ToInt64())
  }
}

function Resolve-Window {
  if ($Id -gt 0) {
    $proc = Get-Process -Id $Id -ErrorAction Stop
    if ($proc.MainWindowHandle -eq 0) { throw "Process $Id has no main window." }
    return $proc
  }

  $windows = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle }

  if ($ProcessName) {
    $windows = $windows | Where-Object { $_.ProcessName -like $ProcessName -or $_.ProcessName -like "$ProcessName*" }
  }
  if ($TitleLike) {
    $needle = "*$TitleLike*"
    $windows = $windows | Where-Object { $_.MainWindowTitle -like $needle }
  }

  $match = $windows | Sort-Object @{ Expression = { $_.MainWindowTitle.Length } }, ProcessName | Select-Object -First 1
  if (-not $match) {
    throw "No window matched TitleLike='$TitleLike' ProcessName='$ProcessName' Id='$Id'."
  }
  return $match
}

function Get-WindowRectInfo {
  param([Diagnostics.Process]$Process)
  $rect = New-Object DesktopControlRect
  if (-not [DesktopControlNative]::GetWindowRect($Process.MainWindowHandle, [ref]$rect)) {
    throw "GetWindowRect failed for process $($Process.Id)."
  }
  [pscustomobject]@{
    left = $rect.Left
    top = $rect.Top
    right = $rect.Right
    bottom = $rect.Bottom
    width = [Math]::Max(0, $rect.Right - $rect.Left)
    height = [Math]::Max(0, $rect.Bottom - $rect.Top)
  }
}

function Focus-Window {
  param([Diagnostics.Process]$Process)
  if ($DryRun) {
    return [pscustomobject]@{ action = "focus"; dryRun = $true; id = $Process.Id; processName = $Process.ProcessName; title = $Process.MainWindowTitle }
  }
  if ([DesktopControlNative]::IsIconic($Process.MainWindowHandle)) {
    [DesktopControlNative]::ShowWindow($Process.MainWindowHandle, $SW_RESTORE) | Out-Null
    Start-Sleep -Milliseconds 80
  }
  try {
    [Microsoft.VisualBasic.Interaction]::AppActivate($Process.Id) | Out-Null
  } catch {}
  [DesktopControlNative]::SetForegroundWindow($Process.MainWindowHandle) | Out-Null
  Start-Sleep -Milliseconds 120
  [pscustomobject]@{ action = "focus"; id = $Process.Id; processName = $Process.ProcessName; title = $Process.MainWindowTitle }
}

function Get-CursorInfo {
  $point = New-Object DesktopControlPoint
  [DesktopControlNative]::GetCursorPos([ref]$point) | Out-Null
  [pscustomobject]@{ x = $point.X; y = $point.Y }
}

function Resolve-Point {
  $hasX = $X -ne [int]::MinValue
  $hasY = $Y -ne [int]::MinValue

  if ($Relative) {
    $proc = Resolve-Window
    $rect = Get-WindowRectInfo $proc
    $rxValue = if ([double]::IsNaN($Rx)) { 0.5 } else { [Math]::Max(0.0, [Math]::Min(1.0, [double]$Rx)) }
    $ryValue = if ([double]::IsNaN($Ry)) { 0.5 } else { [Math]::Max(0.0, [Math]::Min(1.0, [double]$Ry)) }
    return [pscustomobject]@{
      x = [int]($rect.left + ($rect.width * $rxValue))
      y = [int]($rect.top + ($rect.height * $ryValue))
      mode = "window-relative"
      window = $proc.MainWindowTitle
    }
  }

  if ($hasX -and $hasY) {
    return [pscustomobject]@{ x = $X; y = $Y; mode = "absolute-screen"; window = $null }
  }

  $cursor = Get-CursorInfo
  [pscustomobject]@{ x = $cursor.x; y = $cursor.y; mode = "current-cursor"; window = $null }
}

function Move-Cursor {
  param([int]$TargetX, [int]$TargetY)
  if (-not $DryRun) {
    [DesktopControlNative]::SetCursorPos($TargetX, $TargetY) | Out-Null
  }
}

function Get-MouseFlags {
  param([string]$MouseButton)
  switch ($MouseButton) {
    "left" { return @{ down = $MOUSEEVENTF_LEFTDOWN; up = $MOUSEEVENTF_LEFTUP; data = 0 } }
    "right" { return @{ down = $MOUSEEVENTF_RIGHTDOWN; up = $MOUSEEVENTF_RIGHTUP; data = 0 } }
    "middle" { return @{ down = $MOUSEEVENTF_MIDDLEDOWN; up = $MOUSEEVENTF_MIDDLEUP; data = 0 } }
    "x1" { return @{ down = $MOUSEEVENTF_XDOWN; up = $MOUSEEVENTF_XUP; data = $XBUTTON1 } }
    "x2" { return @{ down = $MOUSEEVENTF_XDOWN; up = $MOUSEEVENTF_XUP; data = $XBUTTON2 } }
  }
}

function Send-MouseDown {
  param([string]$MouseButton)
  $flags = Get-MouseFlags $MouseButton
  if (-not $DryRun) {
    [DesktopControlNative]::mouse_event([uint32]$flags.down, 0, 0, [int]$flags.data, [UIntPtr]::Zero)
  }
}

function Send-MouseUp {
  param([string]$MouseButton)
  $flags = Get-MouseFlags $MouseButton
  if (-not $DryRun) {
    [DesktopControlNative]::mouse_event([uint32]$flags.up, 0, 0, [int]$flags.data, [UIntPtr]::Zero)
  }
}

function Invoke-MouseClick {
  param([string]$MouseButton, [int]$ClickCount)
  $clicks = [Math]::Max(1, [Math]::Min(10, $ClickCount))
  for ($i = 0; $i -lt $clicks; $i++) {
    Send-MouseDown $MouseButton
    if (-not $DryRun) { Start-Sleep -Milliseconds ([Math]::Max(10, $HoldMs)) }
    Send-MouseUp $MouseButton
    if (-not $DryRun -and $i -lt ($clicks - 1)) { Start-Sleep -Milliseconds ([Math]::Max(20, $DelayMs)) }
  }
}

function Get-KeyCode {
  param([string]$Token)
  $key = $Token.Trim().ToLowerInvariant()
  if (-not $KeyMap.ContainsKey($key)) {
    throw "Unsupported key '$Token'. Use letters, digits, F1-F24, arrows, enter, esc, tab, ctrl, alt, shift, win, delete, etc."
  }
  return [byte]$KeyMap[$key]
}

function Split-Hotkey {
  param([string]$Chord)
  @($Chord -split "[+]" | ForEach-Object { $_.Trim() } | Where-Object { $_ })
}

function Send-KeyDown {
  param([string]$KeyName)
  $vk = Get-KeyCode $KeyName
  if (-not $DryRun) {
    [DesktopControlNative]::keybd_event($vk, 0, 0, [UIntPtr]::Zero)
  }
}

function Send-KeyUp {
  param([string]$KeyName)
  $vk = Get-KeyCode $KeyName
  if (-not $DryRun) {
    [DesktopControlNative]::keybd_event($vk, 0, $KEYEVENTF_KEYUP, [UIntPtr]::Zero)
  }
}

function Invoke-Hotkey {
  param([string]$Chord)
  $tokens = Split-Hotkey $Chord
  if ($tokens.Count -eq 0) { throw "No keys supplied." }
  foreach ($token in $tokens) { Send-KeyDown $token }
  if (-not $DryRun) { Start-Sleep -Milliseconds ([Math]::Max(10, $HoldMs)) }
  [array]::Reverse($tokens)
  foreach ($token in $tokens) { Send-KeyUp $token }
}

function Invoke-KeyPress {
  param([string]$KeyName, [int]$PressCount)
  $presses = [Math]::Max(1, [Math]::Min(100, $PressCount))
  for ($i = 0; $i -lt $presses; $i++) {
    Invoke-Hotkey $KeyName
    if (-not $DryRun -and $i -lt ($presses - 1)) { Start-Sleep -Milliseconds ([Math]::Max(10, $DelayMs)) }
  }
}

function Invoke-AltTab {
  param([int]$SwitchCount, [switch]$Backwards)
  $presses = [Math]::Max(1, [Math]::Min(20, $SwitchCount))
  Send-KeyDown "alt"
  if ($Backwards) { Send-KeyDown "shift" }
  for ($i = 0; $i -lt $presses; $i++) {
    Send-KeyDown "tab"
    if (-not $DryRun) { Start-Sleep -Milliseconds ([Math]::Max(20, $HoldMs)) }
    Send-KeyUp "tab"
    if (-not $DryRun -and $i -lt ($presses - 1)) { Start-Sleep -Milliseconds ([Math]::Max(30, $DelayMs)) }
  }
  if ($Backwards) { Send-KeyUp "shift" }
  Send-KeyUp "alt"
}

function Invoke-PasteText {
  param([string]$Value)
  $oldText = $null
  $hadText = $false
  try {
    $hadText = [System.Windows.Forms.Clipboard]::ContainsText()
    if ($hadText) { $oldText = [System.Windows.Forms.Clipboard]::GetText() }
  } catch {}

  if (-not $DryRun) {
    [System.Windows.Forms.Clipboard]::SetText($Value)
    Start-Sleep -Milliseconds 80
    Invoke-Hotkey "ctrl+v"
    Start-Sleep -Milliseconds 120
    if (-not $NoRestoreClipboard -and $hadText) {
      [System.Windows.Forms.Clipboard]::SetText($oldText)
    }
  }
}

function Invoke-Screenshot {
  $targetPath = $Path
  if (-not $targetPath) {
    $targetPath = Join-Path $env:TEMP ("desktop-control-{0}.png" -f (Get-Date -Format "yyyyMMdd-HHmmss-fff"))
  }

  $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
  if ($TitleLike -or $ProcessName -or $Id -gt 0) {
    $proc = Resolve-Window
    $rect = Get-WindowRectInfo $proc
    $bounds = New-Object System.Drawing.Rectangle($rect.left, $rect.top, $rect.width, $rect.height)
  }

  if ($bounds.Width -le 0 -or $bounds.Height -le 0) {
    throw "Screenshot bounds are empty."
  }

  if (-not $DryRun) {
    $bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
      $graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
      $dir = Split-Path -Parent $targetPath
      if ($dir) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
      $bitmap.Save($targetPath, [System.Drawing.Imaging.ImageFormat]::Png)
    } finally {
      $graphics.Dispose()
      $bitmap.Dispose()
    }
  }

  [pscustomobject]@{ action = "screenshot"; path = $targetPath; width = $bounds.Width; height = $bounds.Height; dryRun = [bool]$DryRun }
}

function Invoke-DesktopAction {
  param([string]$Name)

  switch ($Name) {
    "help" { Show-Help; return }
    "list-windows" { Write-Result (Get-OpenWindows); return }
    "foreground" { Write-Result (Get-ForegroundWindowInfo); return }
    "focus" { Write-Result (Focus-Window (Resolve-Window)); return }
    "screenshot" { Write-Result (Invoke-Screenshot); return }
    "cursor" { Write-Result (Get-CursorInfo); return }

    "move" {
      $point = Resolve-Point
      Move-Cursor $point.x $point.y
      Write-Result ([pscustomobject]@{ action = "move"; x = $point.x; y = $point.y; mode = $point.mode; dryRun = [bool]$DryRun })
      return
    }

    "click" {
      $point = Resolve-Point
      Move-Cursor $point.x $point.y
      Invoke-MouseClick $Button $Count
      Write-Result ([pscustomobject]@{ action = "click"; button = $Button; count = $Count; x = $point.x; y = $point.y; mode = $point.mode; dryRun = [bool]$DryRun })
      return
    }

    "double-click" {
      $point = Resolve-Point
      Move-Cursor $point.x $point.y
      Invoke-MouseClick $Button 2
      Write-Result ([pscustomobject]@{ action = "double-click"; button = $Button; x = $point.x; y = $point.y; mode = $point.mode; dryRun = [bool]$DryRun })
      return
    }

    "right-click" {
      $point = Resolve-Point
      Move-Cursor $point.x $point.y
      Invoke-MouseClick "right" 1
      Write-Result ([pscustomobject]@{ action = "right-click"; x = $point.x; y = $point.y; mode = $point.mode; dryRun = [bool]$DryRun })
      return
    }

    "middle-click" {
      $point = Resolve-Point
      Move-Cursor $point.x $point.y
      Invoke-MouseClick "middle" 1
      Write-Result ([pscustomobject]@{ action = "middle-click"; x = $point.x; y = $point.y; mode = $point.mode; dryRun = [bool]$DryRun })
      return
    }

    "mouse-down" {
      $point = Resolve-Point
      Move-Cursor $point.x $point.y
      Send-MouseDown $Button
      Write-Result ([pscustomobject]@{ action = "mouse-down"; button = $Button; x = $point.x; y = $point.y; dryRun = [bool]$DryRun })
      return
    }

    "mouse-up" {
      $point = Resolve-Point
      Move-Cursor $point.x $point.y
      Send-MouseUp $Button
      Write-Result ([pscustomobject]@{ action = "mouse-up"; button = $Button; x = $point.x; y = $point.y; dryRun = [bool]$DryRun })
      return
    }

    "drag" {
      if ($ToX -eq [int]::MinValue -or $ToY -eq [int]::MinValue) { throw "drag requires -ToX and -ToY." }
      $point = Resolve-Point
      $safeSteps = [Math]::Max(1, [Math]::Min(240, $Steps))
      Move-Cursor $point.x $point.y
      Send-MouseDown $Button
      for ($i = 1; $i -le $safeSteps; $i++) {
        $t = $i / $safeSteps
        $nx = [int]($point.x + (($ToX - $point.x) * $t))
        $ny = [int]($point.y + (($ToY - $point.y) * $t))
        Move-Cursor $nx $ny
        if (-not $DryRun) { Start-Sleep -Milliseconds ([Math]::Max(1, [int]($DurationMs / $safeSteps))) }
      }
      Send-MouseUp $Button
      Write-Result ([pscustomobject]@{ action = "drag"; button = $Button; fromX = $point.x; fromY = $point.y; toX = $ToX; toY = $ToY; steps = $safeSteps; dryRun = [bool]$DryRun })
      return
    }

    "scroll" {
      $point = Resolve-Point
      Move-Cursor $point.x $point.y
      if (-not $DryRun) { [DesktopControlNative]::mouse_event($MOUSEEVENTF_WHEEL, 0, 0, $Delta, [UIntPtr]::Zero) }
      Write-Result ([pscustomobject]@{ action = "scroll"; delta = $Delta; x = $point.x; y = $point.y; dryRun = [bool]$DryRun })
      return
    }

    "hscroll" {
      $point = Resolve-Point
      Move-Cursor $point.x $point.y
      if (-not $DryRun) { [DesktopControlNative]::mouse_event($MOUSEEVENTF_HWHEEL, 0, 0, $Delta, [UIntPtr]::Zero) }
      Write-Result ([pscustomobject]@{ action = "hscroll"; delta = $Delta; x = $point.x; y = $point.y; dryRun = [bool]$DryRun })
      return
    }

    "key" {
      if (-not $Keys) { throw "key requires -Keys." }
      Invoke-KeyPress $Keys $Count
      Write-Result ([pscustomobject]@{ action = "key"; keys = $Keys; count = $Count; dryRun = [bool]$DryRun })
      return
    }

    "hotkey" {
      if (-not $Keys) { throw "hotkey requires -Keys, for example -Keys 'CTRL+L'." }
      Invoke-Hotkey $Keys
      Write-Result ([pscustomobject]@{ action = "hotkey"; keys = $Keys; dryRun = [bool]$DryRun })
      return
    }

    "alt-tab" {
      Invoke-AltTab $Count $Reverse
      Write-Result ([pscustomobject]@{ action = "alt-tab"; count = $Count; reverse = [bool]$Reverse; dryRun = [bool]$DryRun })
      return
    }

    "type" {
      if ($null -eq $Text) { throw "type requires -Text." }
      Invoke-PasteText $Text
      Write-Result ([pscustomobject]@{ action = "type"; length = $Text.Length; dryRun = [bool]$DryRun })
      return
    }

    "paste" {
      if ($null -eq $Text) { throw "paste requires -Text." }
      Invoke-PasteText $Text
      Write-Result ([pscustomobject]@{ action = "paste"; length = $Text.Length; dryRun = [bool]$DryRun })
      return
    }

    "clipboard-get" {
      $value = if ([System.Windows.Forms.Clipboard]::ContainsText()) { [System.Windows.Forms.Clipboard]::GetText() } else { "" }
      Write-Result ([pscustomobject]@{ action = "clipboard-get"; text = $value; hasText = ($value.Length -gt 0) })
      return
    }

    "clipboard-set" {
      if ($null -eq $Text) { throw "clipboard-set requires -Text." }
      if (-not $DryRun) { [System.Windows.Forms.Clipboard]::SetText($Text) }
      Write-Result ([pscustomobject]@{ action = "clipboard-set"; length = $Text.Length; dryRun = [bool]$DryRun })
      return
    }

    "open-url" {
      if (-not $Url) { throw "open-url requires -Url." }
      Invoke-Hotkey "ctrl+l"
      Invoke-PasteText $Url
      Invoke-KeyPress "enter" 1
      Write-Result ([pscustomobject]@{ action = "open-url"; url = $Url; dryRun = [bool]$DryRun })
      return
    }

    "wait" {
      if (-not $DryRun) { Start-Sleep -Milliseconds ([Math]::Max(0, $Ms)) }
      Write-Result ([pscustomobject]@{ action = "wait"; ms = $Ms; dryRun = [bool]$DryRun })
      return
    }

    "run-json" {
      Invoke-RunJson
      return
    }
  }
}

function Invoke-RunJson {
  $raw = $InputJson
  if ($InputPath) {
    if (-not (Test-Path -LiteralPath $InputPath)) { throw "InputPath not found: $InputPath" }
    $raw = Get-Content -Raw -LiteralPath $InputPath
  }
  if (-not $raw) { throw "run-json requires -InputJson or -InputPath." }

  $items = @()
  $trimmed = $raw.Trim()
  if ($trimmed.StartsWith("[")) {
    $converted = $trimmed | ConvertFrom-Json
    foreach ($entry in $converted) { $items += $entry }
  } else {
    foreach ($line in ($raw -split "`n")) {
      $line = $line.Trim()
      if ($line) { $items += ($line | ConvertFrom-Json) }
    }
  }

  $results = @()
  foreach ($item in $items) {
    $script = $PSCommandPath
    $args = @()
    $act = ""
    if ($item.PSObject.Properties.Name -contains "action") {
      $act = [string]$item.action
    }
    if (-not $act -and $item.PSObject.Properties.Name -contains "command") {
      $act = [string]$item.command
    }
    if (-not $act) { throw "JSON item missing action." }
    $args += $act
    foreach ($prop in $item.PSObject.Properties) {
      if ($prop.Name -in @("action", "command")) { continue }
      $name = "-" + $prop.Name
      $value = $prop.Value
      if ($value -is [bool]) {
        if ($value) { $args += $name }
      } else {
        $args += $name
        $args += [string]$value
      }
    }
    if ($DryRun) { $args += "-DryRun" }
    if ($Json) { $args += "-Json" }
    $output = & powershell -NoProfile -ExecutionPolicy Bypass -File $script @args
    $results += [pscustomobject]@{ action = $act; output = ($output -join "`n") }
  }
  Write-Result $results
}

Invoke-DesktopAction $Action
