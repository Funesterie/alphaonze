param(
  [string]$CommandFile = "D:\agent-bus\desktop-commands.jsonl",
  [string]$ControlScript = "D:\projets\funesterie\scripts\Desktop-Control.ps1",
  [string]$LogFile = "D:\agent-bus\desktop-control.log",
  [int]$PollMs = 250,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

function Write-DesktopLog {
  param([string]$Message)
  $line = "{0} {1}" -f (Get-Date -Format "HH:mm:ss.fff"), $Message
  Write-Host $line
  $dir = Split-Path -Parent $LogFile
  if ($dir) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  Add-Content -LiteralPath $LogFile -Value $line -Encoding UTF8
}

function Convert-ParamsToArgs {
  param($Params)

  $args = @()
  if (-not $Params) { return $args }

  foreach ($prop in $Params.PSObject.Properties) {
    $name = "-" + $prop.Name
    $value = $prop.Value
    if ($value -is [bool]) {
      if ($value) { $args += $name }
      continue
    }
    if ($null -eq $value) { continue }
    $args += $name
    $args += [string]$value
  }

  return $args
}

function Get-SafeParamSummary {
  param($Action, $Params)

  $summary = @()
  foreach ($prop in $Params.PSObject.Properties) {
    if ($prop.Name -in @("text", "Text", "inputJson", "InputJson")) {
      $length = if ($null -eq $prop.Value) { 0 } else { ([string]$prop.Value).Length }
      $summary += "{0}=<len:{1}>" -f $prop.Name, $length
    } else {
      $summary += "{0}={1}" -f $prop.Name, $prop.Value
    }
  }
  return ("action={0} {1}" -f $Action, ($summary -join " ")).Trim()
}

function Invoke-DesktopBusCommand {
  param($Command)

  if ($Command.schema -and $Command.schema -ne "funesterie.desktop_command.v1") {
    return
  }

  $id = [string]$Command.id
  $action = [string]$Command.action
  if (-not $action) { throw "Desktop command missing action." }

  $params = $Command.params
  if (-not $params) { $params = [pscustomobject]@{} }

  Write-DesktopLog ("[{0}] {1} dryRun={2}" -f $id, (Get-SafeParamSummary $action $params), $DryRun)

  $args = @($action) + (Convert-ParamsToArgs $params)
  if ($DryRun) { $args += "-DryRun" }
  $args += "-Json"

  $output = & powershell -NoProfile -ExecutionPolicy Bypass -File $ControlScript @args
  foreach ($line in $output) {
    if ($line) { Write-DesktopLog ("[{0}] OUT {1}" -f $id, $line) }
  }

  $waitMs = 0
  if ($Command.PSObject.Properties.Name -contains "waitMs") {
    $waitMs = [Math]::Max(0, [Math]::Min(10000, [int]$Command.waitMs))
  }
  if ($waitMs -gt 0) { Start-Sleep -Milliseconds $waitMs }
}

if (-not (Test-Path -LiteralPath $ControlScript)) {
  throw "Control script not found: $ControlScript"
}

$commandDir = Split-Path -Parent $CommandFile
if ($commandDir) { New-Item -ItemType Directory -Force -Path $commandDir | Out-Null }
if (-not (Test-Path -LiteralPath $CommandFile)) {
  New-Item -ItemType File -Force -Path $CommandFile | Out-Null
}

Write-DesktopLog "Watching $CommandFile with $ControlScript DryRun=$DryRun"

$seenIds = [System.Collections.Generic.HashSet[string]]::new()
$lastSize = (Get-Item -LiteralPath $CommandFile).Length

while ($true) {
  Start-Sleep -Milliseconds $PollMs

  if (-not (Test-Path -LiteralPath $CommandFile)) { continue }
  $currentSize = (Get-Item -LiteralPath $CommandFile).Length
  if ($currentSize -le $lastSize) { continue }

  $stream = [System.IO.File]::Open($CommandFile, "Open", "Read", "ReadWrite")
  try {
    $stream.Seek($lastSize, "Begin") | Out-Null
    $reader = New-Object System.IO.StreamReader $stream
    $newText = $reader.ReadToEnd()
    $reader.Close()
  } finally {
    $stream.Close()
  }

  $lastSize = $currentSize

  foreach ($line in ($newText -split "`n")) {
    $line = $line.Trim()
    if (-not $line) { continue }

    try {
      $cmd = $line | ConvertFrom-Json
      $id = [string]$cmd.id
      if ($id -and $seenIds.Contains($id)) {
        Write-DesktopLog "[$id] duplicate skip"
        continue
      }
      if ($id) { $seenIds.Add($id) | Out-Null }
      Invoke-DesktopBusCommand $cmd
    } catch {
      Write-DesktopLog ("ERR {0} | {1}" -f $_.Exception.Message, $line)
    }
  }
}
