param(
  [switch]$NoPause,
  [switch]$KeepOllama
)

$ErrorActionPreference = 'Stop'

function Write-Info {
  param([string]$Message)
  Write-Host "[FUNESTERIE STOP] $Message"
}

function Write-WarnLine {
  param([string]$Message)
  Write-Host "[FUNESTERIE STOP] $Message" -ForegroundColor Yellow
}

function Stop-ProcessTreeBestEffort {
  param([int]$ProcessId)

  if (-not $ProcessId -or $ProcessId -le 0 -or $ProcessId -eq $PID) { return }
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

function Get-ListeningProcessId {
  param([int]$Port)

  if (-not $Port) { return $null }
  try {
    $connection = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction Stop | Select-Object -First 1
    if ($connection) { return [int]$connection.OwningProcess }
  } catch {
    return $null
  }
  return $null
}

function Get-MatchingProcessIds {
  param([scriptblock]$Predicate)

  $ids = New-Object System.Collections.Generic.HashSet[int]
  $processes = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue
  foreach ($processInfo in @($processes)) {
    if (-not $processInfo) { continue }
    $candidatePid = [int]$processInfo.ProcessId
    if ($candidatePid -le 0 -or $candidatePid -eq $PID) { continue }
    if (& $Predicate $processInfo) {
      [void]$ids.Add($candidatePid)
    }
  }
  return @($ids | Sort-Object)
}

function Stop-MatchingProcesses {
  param(
    [string]$Label,
    [scriptblock]$Predicate
  )

  $ids = @(Get-MatchingProcessIds -Predicate $Predicate)
  if (-not $ids.Length) {
    Write-Info "${Label}: rien a arreter."
    return
  }

  Write-Info "${Label}: arret de $($ids.Length) processus."
  foreach ($targetPid in $ids) {
    Stop-ProcessTreeBestEffort -ProcessId $targetPid
  }
}

function Stop-PortOwnerIfNameMatches {
  param(
    [string]$Label,
    [int]$Port,
    [string[]]$ExpectedNames
  )

  $ownerPid = Get-ListeningProcessId -Port $Port
  if (-not $ownerPid) {
    Write-Info "${Label}: port $Port libre."
    return
  }

  $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $ownerPid" -ErrorAction SilentlyContinue
  $name = ([string]$processInfo.Name).ToLowerInvariant()
  $expected = @($ExpectedNames | ForEach-Object { ([string]$_).ToLowerInvariant() })
  if ($expected -notcontains $name) {
    Write-WarnLine "${Label}: port $Port occupe par $name (PID $ownerPid), laisse intact."
    return
  }

  Write-Info "${Label}: arret du port $Port (PID $ownerPid)."
  Stop-ProcessTreeBestEffort -ProcessId $ownerPid
}

function Get-PowerShellExe {
  $pwsh = Get-Command 'pwsh' -ErrorAction SilentlyContinue
  if ($pwsh -and $pwsh.Source) { return $pwsh.Source }
  return 'powershell'
}

function Invoke-ChildPowerShellScript {
  param(
    [string]$Path,
    [string[]]$Arguments = @()
  )

  if (-not (Test-Path -LiteralPath $Path)) {
    Write-WarnLine "Script introuvable: $Path"
    return
  }

  $psExe = Get-PowerShellExe
  & $psExe -NoProfile -ExecutionPolicy Bypass -File $Path @Arguments
  if ($LASTEXITCODE -ne 0) {
    Write-WarnLine "Script termine avec code ${LASTEXITCODE}: $Path"
  }
}

function Complete {
  if (-not $NoPause) {
    Write-Host ''
    [void](Read-Host 'Appuie sur Entree pour fermer')
  }
}

$launcherRoot = Split-Path -Parent $PSCommandPath
$workspaceRoot = [System.IO.Path]::GetFullPath((Join-Path $launcherRoot '..\..'))
$alphaDir = [System.IO.Path]::GetFullPath((Join-Path $workspaceRoot 'alphaonze-afk'))
$stopA11 = Join-Path $launcherRoot 'stop-all-a11.ps1'

try {
  if (Test-Path -LiteralPath $stopA11) {
    Write-Info 'Arret A11.'
    Invoke-ChildPowerShellScript -Path $stopA11 -Arguments @('-NoPause')
  } else {
    Write-WarnLine "Stop A11 introuvable: $stopA11"
  }

  $alphaNeedle = $alphaDir.ToLowerInvariant()
  Stop-MatchingProcesses -Label 'AlphaOnze AFK' -Predicate {
    param($proc)
    $commandLine = ([string]$proc.CommandLine).ToLowerInvariant()
    return ($commandLine.Contains($alphaNeedle) -and $commandLine.Contains('server.cjs'))
  }
  Stop-PortOwnerIfNameMatches -Label 'AlphaOnze AFK' -Port 8088 -ExpectedNames @('node.exe')

  Stop-MatchingProcesses -Label 'Caddy AlphaOnze' -Predicate {
    param($proc)
    $commandLine = ([string]$proc.CommandLine).ToLowerInvariant()
    $name = ([string]$proc.Name).ToLowerInvariant()
    return ($name -eq 'caddy.exe' -and $commandLine.Contains($alphaNeedle) -and $commandLine.Contains('caddyfile'))
  }
  Stop-PortOwnerIfNameMatches -Label 'Caddy AlphaOnze' -Port 443 -ExpectedNames @('caddy.exe')
  Stop-PortOwnerIfNameMatches -Label 'Caddy AlphaOnze' -Port 80 -ExpectedNames @('caddy.exe')

  if (-not $KeepOllama) {
    Stop-MatchingProcesses -Label 'Ollama' -Predicate {
      param($proc)
      $name = ([string]$proc.Name).ToLowerInvariant()
      $path = ([string]$proc.ExecutablePath).ToLowerInvariant()
      return ($name -eq 'ollama.exe' -or $name -eq 'ollama app.exe' -or $path.Contains('\ollama\'))
    }
  } else {
    Write-Info 'Ollama conserve.'
  }

  Write-Info 'Termine.'
} finally {
  Complete
}
