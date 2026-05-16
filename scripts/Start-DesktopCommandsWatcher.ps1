param(
  [string]$CommandFile = "D:\agent-bus\desktop-commands.jsonl",
  [string]$ControlScript = "D:\projets\funesterie\scripts\Desktop-Control.ps1",
  [string]$WatcherScript = "D:\projets\funesterie\scripts\Watch-DesktopCommands.ps1",
  [string]$LogFile = "D:\agent-bus\desktop-control.log",
  [string]$PidFile = "D:\agent-bus\desktop-control.pid",
  [int]$PollMs = 250,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

function Get-DesktopWatcherProcess {
  Get-CimInstance Win32_Process |
    Where-Object {
      $_.Name -match "powershell" -and
      $_.CommandLine -like "*Watch-DesktopCommands.ps1*" -and
      $_.CommandLine -like "*$CommandFile*"
    }
}

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $CommandFile) | Out-Null
New-Item -ItemType File -Force -Path $CommandFile | Out-Null
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $LogFile) | Out-Null

$existing = Get-DesktopWatcherProcess | Select-Object -First 1
if ($existing) {
  Set-Content -LiteralPath $PidFile -Value ([string]$existing.ProcessId) -Encoding ASCII
  [pscustomobject]@{
    ok = $true
    alreadyRunning = $true
    pid = $existing.ProcessId
    commandFile = $CommandFile
    logFile = $LogFile
  } | ConvertTo-Json -Depth 4
  exit 0
}

$args = @(
  "-NoProfile",
  "-ExecutionPolicy", "Bypass",
  "-File", $WatcherScript,
  "-CommandFile", $CommandFile,
  "-ControlScript", $ControlScript,
  "-LogFile", $LogFile,
  "-PollMs", [string]$PollMs
)
if ($DryRun) { $args += "-DryRun" }

$proc = Start-Process -FilePath "powershell" -ArgumentList $args -PassThru -WindowStyle Hidden
Start-Sleep -Milliseconds 500
Set-Content -LiteralPath $PidFile -Value ([string]$proc.Id) -Encoding ASCII

[pscustomobject]@{
  ok = $true
  alreadyRunning = $false
  pid = $proc.Id
  commandFile = $CommandFile
  logFile = $LogFile
  pidFile = $PidFile
  dryRun = [bool]$DryRun
} | ConvertTo-Json -Depth 4
