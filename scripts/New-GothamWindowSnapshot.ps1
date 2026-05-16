param(
  [string]$OutPath = "D:\agent-bus\gotham-window-snapshot-light.json",
  [string]$BusDir = "D:\agent-bus",
  [string]$BridgeDir = "C:\Users\Djeff\OneDrive\Kaen44 Retro\Arcade Controller",
  [int]$Tail = 25
)

$ErrorActionPreference = "Stop"

function Read-JsonFile {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) { return $null }
  try {
    return (Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json)
  } catch {
    return [pscustomobject]@{
      error = "json_parse_failed"
      path = $Path
      message = $_.Exception.Message
    }
  }
}

function Read-TailLines {
  param([string]$Path, [int]$Count = 25)
  if (-not (Test-Path -LiteralPath $Path)) { return @() }
  @(Get-Content -LiteralPath $Path -Tail $Count -ErrorAction SilentlyContinue | ForEach-Object { [string]$_ })
}

function Copy-LatestCapture {
  param(
    [string]$Pattern,
    [string]$Destination
  )
  if (-not (Test-Path -LiteralPath $BridgeDir)) { return $null }
  $captures = Join-Path $BridgeDir "captures"
  if (-not (Test-Path -LiteralPath $captures)) { return $null }
  $latest = Get-ChildItem -LiteralPath $captures -Filter $Pattern -File -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
  if (-not $latest) { return $null }
  Copy-Item -LiteralPath $latest.FullName -Destination $Destination -Force
  [pscustomobject]@{
    source = $latest.FullName
    copy = $Destination
    lastWriteTime = $latest.LastWriteTime.ToString("o")
    length = $latest.Length
  }
}

function Get-OpenWindowsLight {
  $interesting = @(
    "RomStation",
    "Dolphin",
    "Funesterie Desktop",
    "Kiro",
    "Codex",
    "chrome",
    "brave",
    "claude",
    "Neo4j"
  )

  Get-Process |
    Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle } |
    Where-Object {
      $p = $_
      $interesting | Where-Object {
        $p.ProcessName -like "*$_*" -or $p.MainWindowTitle -like "*$_*"
      }
    } |
    Sort-Object ProcessName, Id |
    ForEach-Object {
      [pscustomobject]@{
        id = $_.Id
        processName = $_.ProcessName
        title = $_.MainWindowTitle
        handle = ("0x{0:X}" -f $_.MainWindowHandle.ToInt64())
        mainModule = try { $_.MainModule.FileName } catch { $null }
      }
    }
}

$romState = Read-JsonFile (Join-Path $BridgeDir "latest-state.json")
$brState = Read-JsonFile (Join-Path $BridgeDir "br-latest-state.json")

$captures = [pscustomobject]@{
  romstation = Copy-LatestCapture -Pattern "romstation-*.png" -Destination (Join-Path $BusDir "gotham-romstation-current.png")
  bloodyRoar = Copy-LatestCapture -Pattern "br-*.png" -Destination (Join-Path $BusDir "gotham-bloody-current.png")
}

$logs = [pscustomobject]@{
  romstationState = Read-TailLines (Join-Path $BridgeDir "romstation-state-watch.stdout.log") $Tail
  brState = Read-TailLines (Join-Path $BridgeDir "br-state-watch.stdout.log") $Tail
  mouse = Read-TailLines (Join-Path $BridgeDir "qflush-mouse-watch.stdout.log") $Tail
  keyboard = Read-TailLines (Join-Path $BridgeDir "qflush-keyboard-watch.stdout.log") $Tail
  gamepad = Read-TailLines (Join-Path $BridgeDir "br-watch.stdout.log") $Tail
}

$snapshot = [pscustomobject]@{
  schema = "funesterie.gotham_bat.window_snapshot.light.v1"
  role = "bat:gotham-light"
  generatedAt = (Get-Date).ToString("o")
  windows = @(Get-OpenWindowsLight)
  states = [pscustomobject]@{
    romstation = $romState
    bloodyRoar = $brState
  }
  captures = $captures
  commandBuses = [pscustomobject]@{
    mouse = Join-Path $BusDir "mouse-commands.jsonl"
    keyboard = Join-Path $BusDir "keyboard-commands.jsonl"
    gamepad = Join-Path $BusDir "gamepad-commands.jsonl"
    bloodyRoar = Join-Path $BusDir "br-commands.jsonl"
  }
  logs = $logs
}

$outDir = Split-Path -Parent $OutPath
if ($outDir -and -not (Test-Path -LiteralPath $outDir)) {
  New-Item -ItemType Directory -Path $outDir -Force | Out-Null
}

$snapshot | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $OutPath -Encoding UTF8
$snapshot
