param(
  [string]$CommandFile = "D:\agent-bus\desktop-commands.jsonl",
  [string]$LogFile = "D:\agent-bus\desktop-control.log",
  [string]$PidFile = "D:\agent-bus\desktop-control.pid"
)

$ErrorActionPreference = "Stop"

$watchers = @(Get-CimInstance Win32_Process |
  Where-Object {
    $_.Name -match "powershell" -and
    $_.CommandLine -like "*Watch-DesktopCommands.ps1*" -and
    $_.CommandLine -like "*$CommandFile*"
  } |
  ForEach-Object {
    [pscustomobject]@{
      pid = $_.ProcessId
      commandLine = $_.CommandLine
    }
  })

$tail = @()
if (Test-Path -LiteralPath $LogFile) {
  $tail = @(Get-Content -LiteralPath $LogFile -Tail 8 | ForEach-Object { [string]$_ })
}

[pscustomobject]@{
  ok = $true
  running = ($watchers.Count -gt 0)
  watchers = $watchers
  commandFile = $CommandFile
  commandFileExists = (Test-Path -LiteralPath $CommandFile)
  commandFileLength = if (Test-Path -LiteralPath $CommandFile) { (Get-Item -LiteralPath $CommandFile).Length } else { 0 }
  logFile = $LogFile
  pidFile = $PidFile
  pidFileValue = if (Test-Path -LiteralPath $PidFile) { (Get-Content -Raw -LiteralPath $PidFile).Trim() } else { "" }
  logTail = $tail
} | ConvertTo-Json -Depth 6
