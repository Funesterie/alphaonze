param(
  [switch]$NoPause
)

$ErrorActionPreference = 'Stop'

function Write-Info {
  param([string]$Message)
  Write-Host "[A11 STOP] $Message"
}

function Write-WarnLine {
  param([string]$Message)
  Write-Host "[A11 STOP] $Message" -ForegroundColor Yellow
}

function Get-ListeningProcessId {
  param([int]$Port)

  if (-not $Port) { return $null }
  try {
    $connection = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction Stop | Select-Object -First 1
    if ($connection) {
      return [int]$connection.OwningProcess
    }
  } catch {
    return $null
  }

  return $null
}

function Stop-ProcessTreeBestEffort {
  param([int]$ProcessId)

  if (-not $ProcessId -or $ProcessId -le 0) { return }
  if ($ProcessId -eq $PID) { return }

  try {
    & taskkill /PID $ProcessId /T /F | Out-Null
    Write-Info "Processus arrete (PID $ProcessId)."
  } catch {
    Write-WarnLine "Echec taskkill PID ${ProcessId}: $($_.Exception.Message)"
    try {
      Stop-Process -Id $ProcessId -Force -ErrorAction Stop
      Write-Info "Processus force via Stop-Process (PID $ProcessId)."
    } catch {
      Write-WarnLine "Impossible d'arreter PID ${ProcessId}: $($_.Exception.Message)"
    }
  }
}

function Read-JsonFileBestEffort {
  param([string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) { return $null }
  try {
    return (Get-Content -LiteralPath $Path -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop)
  } catch {
    Write-WarnLine "Lecture JSON impossible: $Path"
    return $null
  }
}

function Invoke-LauncherStopWithTimeout {
  param(
    [string]$LauncherPath,
    [int]$TimeoutSec = 8
  )

  if (-not (Test-Path -LiteralPath $LauncherPath)) {
    Write-WarnLine "Launcher introuvable pour stop standard: $LauncherPath"
    return
  }

  $stopProcess = $null
  try {
    $stopProcess = Start-Process -FilePath 'pwsh' `
      -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $LauncherPath, 'stop', '-NoPause') `
      -WorkingDirectory (Split-Path -Parent $LauncherPath) `
      -WindowStyle Hidden `
      -PassThru
  } catch {
    Write-WarnLine "Impossible de lancer le stop standard du launcher: $($_.Exception.Message)"
    return
  }

  if (-not $stopProcess) { return }

  try {
    if (-not (Wait-Process -Id $stopProcess.Id -Timeout $TimeoutSec -ErrorAction SilentlyContinue)) {
      Write-WarnLine "Le stop standard du launcher depasse ${TimeoutSec}s, bascule vers le fallback."
      Stop-ProcessTreeBestEffort -ProcessId $stopProcess.Id
    }
  } catch {
    Write-WarnLine "Attente du stop standard impossible: $($_.Exception.Message)"
    Stop-ProcessTreeBestEffort -ProcessId $stopProcess.Id
  }
}

function Get-KnownA11ProcessIds {
  param([string]$WorkspaceRoot)

  $patterns = @(
    [System.IO.Path]::GetFullPath((Join-Path $WorkspaceRoot 'a11\backend\apps\server\server.cjs')).ToLowerInvariant(),
    [System.IO.Path]::GetFullPath((Join-Path $WorkspaceRoot 'a11\backend\apps\server\llm-router-runner.cjs')).ToLowerInvariant(),
    [System.IO.Path]::GetFullPath((Join-Path $WorkspaceRoot 'a11\backend\apps\tts\siwis.py')).ToLowerInvariant(),
    [System.IO.Path]::GetFullPath((Join-Path $WorkspaceRoot 'a11\frontend\apps\web')).ToLowerInvariant(),
    [System.IO.Path]::GetFullPath((Join-Path $WorkspaceRoot 'a11\a11qflushrailway')).ToLowerInvariant()
  )

  $results = New-Object System.Collections.Generic.HashSet[int]
  $processes = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue
  foreach ($processInfo in @($processes)) {
    if (-not $processInfo) { continue }
    $candidatePid = [int]$processInfo.ProcessId
    if ($candidatePid -le 0 -or $candidatePid -eq $PID) { continue }
    $commandLine = [string]$processInfo.CommandLine
    if ([string]::IsNullOrWhiteSpace($commandLine)) { continue }
    $commandLineLower = $commandLine.ToLowerInvariant()

    foreach ($pattern in $patterns) {
      if ($commandLineLower.Contains($pattern)) {
        [void]$results.Add($candidatePid)
        break
      }
    }
  }

  return @($results | Sort-Object)
}

function Stop-CerbereTunnel {
  $matching = @(
    Get-CimInstance Win32_Process -Filter "Name = 'cloudflared.exe'" -ErrorAction SilentlyContinue |
      Where-Object {
        ($_.CommandLine -like "*funesterie-cerbere-local*")
      }
  )

  foreach ($proc in $matching) {
    try {
      Stop-Process -Id $proc.ProcessId -Force -ErrorAction Stop
      Write-Host "[A11 STOP] Tunnel Cerbere arrete (PID $($proc.ProcessId))."
    } catch {
      Write-Host "[A11 STOP] Echec arret tunnel PID $($proc.ProcessId): $($_.Exception.Message)" -ForegroundColor Yellow
    }
  }
}

$launcherRoot = Split-Path -Parent $PSCommandPath
$localLauncher = Join-Path $launcherRoot 'a11-local.ps1'
$workspaceRoot = [System.IO.Path]::GetFullPath((Join-Path $launcherRoot '..\..'))
$runtimeRoot = Join-Path $workspaceRoot 'a11\runtime\launcher'
$stateFile = Join-Path $runtimeRoot 'a11-local.state.json'
$snapshotFile = Join-Path $runtimeRoot 'a11-local.snapshot.json'
$progressFile = Join-Path $runtimeRoot 'a11-local.progress.json'
$operationFile = Join-Path $runtimeRoot 'a11-local.operation.json'

Invoke-LauncherStopWithTimeout -LauncherPath $localLauncher -TimeoutSec 8

Start-Sleep -Seconds 1

$candidatePids = New-Object System.Collections.Generic.HashSet[int]
$state = Read-JsonFileBestEffort -Path $stateFile
if ($state -and $state.services) {
  foreach ($entry in $state.services.PSObject.Properties) {
    $service = $entry.Value
    if ($service.pid) {
      [void]$candidatePids.Add([int]$service.pid)
    }
  }
}

foreach ($port in 3000, 4545, 5002, 5173, 43421) {
  $listeningPid = Get-ListeningProcessId -Port $port
  if ($listeningPid) {
    [void]$candidatePids.Add([int]$listeningPid)
  }
}

foreach ($knownPid in @(Get-KnownA11ProcessIds -WorkspaceRoot $workspaceRoot)) {
  [void]$candidatePids.Add([int]$knownPid)
}

foreach ($targetPid in @($candidatePids | Sort-Object -Unique)) {
  Stop-ProcessTreeBestEffort -ProcessId $targetPid
}

Stop-CerbereTunnel

foreach ($path in @($operationFile, $progressFile, $snapshotFile, $stateFile)) {
  if (-not (Test-Path -LiteralPath $path)) { continue }
  try {
    Remove-Item -LiteralPath $path -Force -ErrorAction Stop
  } catch {
    Write-WarnLine "Nettoyage impossible: $path"
  }
}

exit $LASTEXITCODE
