param(
  [string]$GamesRoot = "C:\Users\Djeff\Desktop\jeux",
  [string]$RemoteUrls = "https://a11.funesterie.me,https://k44.funesterie.me",
  [string]$TokenFile = "D:\projets\funesterie\secrets\match-arena-worker-token.txt",
  [string]$StatusPath = "D:\agent-bus\match-arena\local-match-arena-worker-status.json",
  [string]$ExportRoot = "D:\agent-bus\match-arena\sessions",
  [string]$StreamUrl = "",
  [string]$StreamCandidates = "",
  [switch]$RestartWorker,
  [switch]$Visible
)

$ErrorActionPreference = "Stop"

$workerScript = Join-Path $PSScriptRoot "local-match-arena-worker.cjs"
$logDir = "D:\agent-bus\match-arena\logs"
$workerStdout = Join-Path $logDir "local-match-arena-worker.stdout.log"
$workerStderr = Join-Path $logDir "local-match-arena-worker.stderr.log"

function New-WorkerTokenIfMissing {
  if (Test-Path -LiteralPath $TokenFile) {
    $existing = (Get-Content -LiteralPath $TokenFile -Raw).Trim()
    if ($existing) { return }
  }
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $TokenFile) | Out-Null
  $bytes = [byte[]]::new(32)
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $rng.GetBytes($bytes)
  } finally {
    if ($rng) { $rng.Dispose() }
  }
  $token = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
  Set-Content -LiteralPath $TokenFile -Value $token -Encoding ASCII
}

function Get-MatchArenaWorkerProcesses {
  $scriptName = "local-match-arena-worker.cjs"
  Get-CimInstance Win32_Process |
    Where-Object {
      $_.ProcessId -ne $PID -and
      $_.CommandLine -and
      $_.CommandLine -like "*$scriptName*"
    }
}

function Stop-MatchArenaWorkerProcesses {
  $existing = @(Get-MatchArenaWorkerProcesses)
  foreach ($process in $existing) {
    try {
      Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop
    } catch {
      Write-Warning "Impossible d'arreter le worker Match Arena PID $($process.ProcessId): $($_.Exception.Message)"
    }
  }
}

if (-not (Test-Path -LiteralPath $workerScript)) {
  throw "Worker Match Arena introuvable: $workerScript"
}
if (-not (Test-Path -LiteralPath $GamesRoot)) {
  throw "Dossier jeux introuvable: $GamesRoot"
}

New-Item -ItemType Directory -Force -Path $logDir | Out-Null
New-WorkerTokenIfMissing

$existingWorkers = @(Get-MatchArenaWorkerProcesses)
if ($existingWorkers.Count -gt 0 -and -not $RestartWorker) {
  Write-Host "Match Arena worker already running ($($existingWorkers.Count) process). Use -RestartWorker to reload it."
  Write-Host "  games: $GamesRoot"
  Write-Host "  status: $StatusPath"
  Write-Host "  logs: $logDir"
  return
}
if ($RestartWorker) {
  Stop-MatchArenaWorkerProcesses
}

$node = (Get-Command node -ErrorAction Stop).Source
$workerId = "$env:COMPUTERNAME-match-arena"
$workerEnv = @"
`$env:A11_MATCH_ARENA_REMOTE_URLS='$RemoteUrls'
`$env:A11_MATCH_ARENA_WORKER_TOKEN_FILE='$TokenFile'
`$env:A11_MATCH_ARENA_GAMES_ROOT='$GamesRoot'
`$env:A11_MATCH_ARENA_STATUS_PATH='$StatusPath'
`$env:A11_MATCH_ARENA_EXPORT_ROOT='$ExportRoot'
`$env:A11_MATCH_ARENA_WORKER_ID='$workerId'
`$env:A11_MATCH_ARENA_STREAM_URL='$StreamUrl'
`$env:A11_MATCH_ARENA_STREAM_CANDIDATES='$StreamCandidates'
Set-Location -LiteralPath 'D:\projets\funesterie'
& '$node' '$workerScript' 1>> '$workerStdout' 2>> '$workerStderr'
"@

$windowStyle = if ($Visible) { "Normal" } else { "Hidden" }
Start-Process -FilePath "powershell.exe" -WindowStyle $windowStyle -ArgumentList @(
  "-NoProfile",
  "-ExecutionPolicy",
  "Bypass",
  "-Command",
  $workerEnv
) | Out-Null

Write-Host "Match Arena worker started."
Write-Host "  games: $GamesRoot"
Write-Host "  status: $StatusPath"
Write-Host "  logs: $logDir"
