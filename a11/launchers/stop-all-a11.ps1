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

# Lire A11_RUNTIME_ROOT depuis le config, sinon fallback relatif
$configPath = Join-Path $launcherRoot 'config\a11-local.env'
$resolvedRuntimeRoot = $null
if (Test-Path -LiteralPath $configPath) {
  $configLine = Get-Content -LiteralPath $configPath | Where-Object { $_ -match '^A11_RUNTIME_ROOT\s*=' } | Select-Object -Last 1
  if ($configLine) {
    $rawValue = ($configLine -split '=', 2)[1].Trim()
    if ([System.IO.Path]::IsPathRooted($rawValue)) {
      $resolvedRuntimeRoot = $rawValue
    } else {
      $resolvedRuntimeRoot = [System.IO.Path]::GetFullPath((Join-Path $launcherRoot $rawValue))
    }
  }
}
if (-not $resolvedRuntimeRoot) { $resolvedRuntimeRoot = Join-Path $workspaceRoot 'a11\runtime' }
$runtimeRoot = Join-Path $resolvedRuntimeRoot 'launcher'
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

# SIG # Begin signature block
# MIIFpwYJKoZIhvcNAQcCoIIFmDCCBZQCAQExDzANBglghkgBZQMEAgEFADB5Bgor
# BgEEAYI3AgEEoGswaTA0BgorBgEEAYI3AgEeMCYCAwEAAAQQH8w7YFlLCE63JNLG
# KX7zUQIBAAIBAAIBAAIBAAIBADAxMA0GCWCGSAFlAwQCAQUABCCifz1Fcnlme0TT
# 5U+TQTkVyP/s45taDizjep4Qd1VatqCCAxYwggMSMIIB+qADAgECAhAWh8uBU0rs
# rEDlqExfyH1hMA0GCSqGSIb3DQEBCwUAMCExHzAdBgNVBAMMFkExMS1GdW5lc3Rl
# cmllLVNjcmlwdHMwHhcNMjYwNDI2MTI1MDU5WhcNMzEwNDI2MTMwMDU5WjAhMR8w
# HQYDVQQDDBZBMTEtRnVuZXN0ZXJpZS1TY3JpcHRzMIIBIjANBgkqhkiG9w0BAQEF
# AAOCAQ8AMIIBCgKCAQEA6RbjQDNKRaPU3C25PQYgV9o3Ne3oIX0SWxC3caNFhtDt
# Y6p+kdxoxPNNvyUteNC25XYUbDDJyIsLSoZA6ItHMavQ8OCZZGx2bMqY2Ab8Q4jr
# OxV8GIpgDoDGqVx/bNECfoh4AFmRqgY+00p1CoQ7r9QVTn6X9OBKRA0iXVZxEMT7
# OumcskpwwwNJhiPsRCY51UxwXKG8z7e3P1Tm3OVXkkyQNQN8cc9TURarToaxgahN
# zHz0N81zamFRcwzdxIz2xyx2SQoK/arcLhA27j1ndIegbzqYWvrTZ9HgSiMI34tM
# HxlzctmzCgeTGtDmOzN66NSmAFTkfv8E+U09fGxsyQIDAQABo0YwRDAOBgNVHQ8B
# Af8EBAMCB4AwEwYDVR0lBAwwCgYIKwYBBQUHAwMwHQYDVR0OBBYEFBPlLwoseJYs
# +l+hlUcKSY0P+y/xMA0GCSqGSIb3DQEBCwUAA4IBAQAjCc2teI13CeAoNLTlKPkB
# ROz/icO7JxlvnUQ+jmP2nmmTVfRfZvpp09tIHrHYpEH1kAIzb3Yy2knZUHisiOIo
# YqN0VtdvdDQtz/8hauhnqODPYOu2LQsc6t7vKGciu4yLP9agY9sBQJGvv2FJ25gU
# wEur8Jm3PW6/eHIO4dnv7zLdstOQqKL+Pu8aeoWpb0AE2oTX72sVx8/74DzkEbgM
# FY9mKjO832S4QWwsqvhMo1I8C97l3Dz6cyfjb9HJQgFHgtJ2zEp1zVBOstkDDxnH
# m3Xc2CJuNEwD4yScri97KFELD9K3+ZSahAs5teGCPV5vI5o7GPHeHI5gsbrQdnVW
# MYIB5zCCAeMCAQEwNTAhMR8wHQYDVQQDDBZBMTEtRnVuZXN0ZXJpZS1TY3JpcHRz
# AhAWh8uBU0rsrEDlqExfyH1hMA0GCWCGSAFlAwQCAQUAoIGEMBgGCisGAQQBgjcC
# AQwxCjAIoAKAAKECgAAwGQYJKoZIhvcNAQkDMQwGCisGAQQBgjcCAQQwHAYKKwYB
# BAGCNwIBCzEOMAwGCisGAQQBgjcCARUwLwYJKoZIhvcNAQkEMSIEIGzSoLI9e+OM
# Aah0TYst3KAiQlZ5enH9JA1eP3rfo9QdMA0GCSqGSIb3DQEBAQUABIIBADD1arBq
# RHAxbsYwoMVqEHm5/vsuZPVAm8MdW1rzBrq0911IpbQHtQOPMrYXeBcpDzBGjvbM
# 3sDn5wgxHNzsnayArp+j87KCrwzK6fIahYkiqL/F81aKMTS5RsmDGU4obTecpJqJ
# jU3fcbfniimSqAzDzb/4hohrQwUjoO1guFsy+d/U2NO8VnadWkQJE24rqrggt1CU
# 2RICjdFr6NbD3UkQWmHBXFY61YWEHBbu2KgBR6auGEc1rSDlwmhWtUhLUafVJ96S
# 9k5dcV/3WddbqF53Kkao8Q6J6gv5FnPDAzhU1TVzrVgoctuIPeWM2IsHgQKZABEb
# VN/CTU8+KiM52ag=
# SIG # End signature block
