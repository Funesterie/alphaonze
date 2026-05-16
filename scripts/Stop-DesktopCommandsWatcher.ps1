param(
  [string]$CommandFile = "D:\agent-bus\desktop-commands.jsonl",
  [string]$PidFile = "D:\agent-bus\desktop-control.pid"
)

$ErrorActionPreference = "Stop"

$targets = @()

if (Test-Path -LiteralPath $PidFile) {
  $pidText = (Get-Content -Raw -LiteralPath $PidFile).Trim()
  if ($pidText -match "^\d+$") {
    $proc = Get-Process -Id ([int]$pidText) -ErrorAction SilentlyContinue
    if ($proc) { $targets += $proc }
  }
}

$watchers = Get-CimInstance Win32_Process |
  Where-Object {
    $_.Name -match "powershell" -and
    $_.CommandLine -like "*Watch-DesktopCommands.ps1*" -and
    $_.CommandLine -like "*$CommandFile*"
  }

foreach ($watcher in $watchers) {
  $proc = Get-Process -Id $watcher.ProcessId -ErrorAction SilentlyContinue
  if ($proc) { $targets += $proc }
}

$targets = $targets | Sort-Object Id -Unique
$stopped = @()
foreach ($proc in $targets) {
  Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
  $stopped += $proc.Id
}

Remove-Item -LiteralPath $PidFile -ErrorAction SilentlyContinue

[pscustomobject]@{
  ok = $true
  stopped = $stopped
  commandFile = $CommandFile
} | ConvertTo-Json -Depth 4
