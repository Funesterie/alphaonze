param(
  [switch]$NoOpen,
  [switch]$NoPause
)

$ErrorActionPreference = 'Stop'

function Write-Info {
  param([string]$Message)
  Write-Host "[FUNESTERIE START] $Message"
}

function Write-WarnLine {
  param([string]$Message)
  Write-Host "[FUNESTERIE START] $Message" -ForegroundColor Yellow
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

function Wait-Port {
  param(
    [int]$Port,
    [int]$TimeoutSec = 20
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  do {
    $listeningPid = Get-ListeningProcessId -Port $Port
    if ($listeningPid) { return $listeningPid }
    Start-Sleep -Milliseconds 500
  } while ((Get-Date) -lt $deadline)

  return $null
}

function Resolve-CommandPath {
  param(
    [string[]]$Candidates,
    [string]$CommandName
  )

  foreach ($candidate in @($Candidates)) {
    if ($candidate -and (Test-Path -LiteralPath $candidate)) {
      return [System.IO.Path]::GetFullPath($candidate)
    }
  }

  $command = Get-Command $CommandName -ErrorAction SilentlyContinue
  if ($command -and $command.Source) {
    return $command.Source
  }

  return ''
}

function Start-LoggedProcess {
  param(
    [string]$Label,
    [string]$FilePath,
    [string[]]$ArgumentList,
    [string]$WorkingDirectory,
    [string]$LogRoot
  )

  if (-not $FilePath) {
    throw "$Label introuvable."
  }

  if (-not (Test-Path -LiteralPath $LogRoot)) {
    New-Item -ItemType Directory -Force -Path $LogRoot | Out-Null
  }

  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $safeLabel = ($Label -replace '[^A-Za-z0-9_-]+', '-').Trim('-')
  $stdout = Join-Path $LogRoot "$safeLabel-$stamp.out.log"
  $stderr = Join-Path $LogRoot "$safeLabel-$stamp.err.log"

  $process = Start-Process -FilePath $FilePath `
    -ArgumentList $ArgumentList `
    -WorkingDirectory $WorkingDirectory `
    -RedirectStandardOutput $stdout `
    -RedirectStandardError $stderr `
    -WindowStyle Hidden `
    -PassThru

  Write-Info "$Label lance (PID $($process.Id)). Logs: $stdout"
  return $process
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

function Start-OllamaIfNeeded {
  param([string]$LogRoot)

  $existing = Get-ListeningProcessId -Port 11434
  if ($existing) {
    Write-Info "Ollama deja actif sur 11434 (PID $existing)."
    return
  }

  $ollama = Resolve-CommandPath -CommandName 'ollama.exe' -Candidates @(
    (Join-Path $env:LOCALAPPDATA 'Programs\Ollama\ollama.exe'),
    (Join-Path $env:LOCALAPPDATA 'Ollama\ollama.exe')
  )
  if (-not $ollama) {
    Write-WarnLine 'Ollama introuvable, A11 pourra demarrer mais le LLM local risque de ne pas repondre.'
    return
  }

  Start-LoggedProcess -Label 'ollama' -FilePath $ollama -ArgumentList @('serve') -WorkingDirectory (Split-Path -Parent $ollama) -LogRoot $LogRoot | Out-Null
  $ollamaPid = Wait-Port -Port 11434 -TimeoutSec 25
  if ($ollamaPid) {
    Write-Info "Ollama pret sur 11434 (PID $ollamaPid)."
  } else {
    Write-WarnLine 'Ollama lance, mais le port 11434 ne repond pas encore.'
  }
}

function Start-AlphaOnZeIfNeeded {
  param(
    [string]$AlphaDir,
    [string]$LogRoot
  )

  $existing = Get-ListeningProcessId -Port 8088
  if ($existing) {
    Write-Info "AlphaOnze deja actif sur 8088 (PID $existing)."
    return
  }

  $node = Resolve-CommandPath -CommandName 'node.exe' -Candidates @(
    'C:\Program Files\nodejs\node.exe'
  )
  if (-not $node) {
    Write-WarnLine 'Node.js introuvable, AlphaOnze AFK ne peut pas demarrer.'
    return
  }

  $previousPort = $env:ALPHAONZE_PORT
  $previousHost = $env:ALPHAONZE_HOST
  try {
    $alphaHost = if ([string]::IsNullOrWhiteSpace($env:A11_ALPHAONZE_HOST)) {
      if ([string]::IsNullOrWhiteSpace($env:ALPHAONZE_HOST)) { '127.0.0.1' } else { $env:ALPHAONZE_HOST }
    } else {
      $env:A11_ALPHAONZE_HOST
    }
    $env:ALPHAONZE_PORT = '8088'
    $env:ALPHAONZE_HOST = $alphaHost
    Start-LoggedProcess -Label 'alphaonze-afk' -FilePath $node -ArgumentList @('server.cjs') -WorkingDirectory $AlphaDir -LogRoot $LogRoot | Out-Null
  } finally {
    $env:ALPHAONZE_PORT = $previousPort
    $env:ALPHAONZE_HOST = $previousHost
  }

  $alphaPid = Wait-Port -Port 8088 -TimeoutSec 20
  if ($alphaPid) {
    Write-Info "AlphaOnze pret sur 8088 (PID $alphaPid)."
  } else {
    Write-WarnLine 'AlphaOnze lance, mais le port 8088 ne repond pas encore.'
  }
}

function Start-CaddyIfNeeded {
  param(
    [string]$AlphaDir,
    [string]$LogRoot
  )

  $existing443 = Get-ListeningProcessId -Port 443
  if ($existing443) {
    Write-Info "HTTPS deja actif sur 443 (PID $existing443)."
    return
  }

  $caddy = Resolve-CommandPath -CommandName 'caddy.exe' -Candidates @(
    (Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages\CaddyServer.Caddy_Microsoft.Winget.Source_8wekyb3d8bbwe\caddy.exe')
  )
  if (-not $caddy) {
    Write-WarnLine 'Caddy introuvable, alphaonze.funesterie.pro ne peut pas demarrer en HTTPS local.'
    return
  }

  Start-LoggedProcess -Label 'alphaonze-caddy' -FilePath $caddy -ArgumentList @('run', '--config', 'Caddyfile', '--adapter', 'caddyfile') -WorkingDirectory $AlphaDir -LogRoot $LogRoot | Out-Null
  $pid443 = Wait-Port -Port 443 -TimeoutSec 25
  $pid80 = Wait-Port -Port 80 -TimeoutSec 5
  if ($pid443) {
    Write-Info "Caddy pret sur 443 (PID $pid443)."
  } else {
    Write-WarnLine 'Caddy lance, mais le port 443 ne repond pas encore.'
  }
  if ($pid80) {
    Write-Info "Caddy ecoute aussi sur 80 (PID $pid80)."
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

# Lire A11_RUNTIME_ROOT depuis le config, sinon fallback relatif
$configPath = Join-Path $launcherRoot 'config\a11-local.env'
$logRootBase = $null
if (Test-Path -LiteralPath $configPath) {
  $configLine = Get-Content -LiteralPath $configPath | Where-Object { $_ -match '^A11_RUNTIME_ROOT\s*=' } | Select-Object -Last 1
  if ($configLine) {
    $rawValue = ($configLine -split '=', 2)[1].Trim()
    if ([System.IO.Path]::IsPathRooted($rawValue)) {
      $logRootBase = $rawValue
    } else {
      $logRootBase = [System.IO.Path]::GetFullPath((Join-Path $launcherRoot $rawValue))
    }
  }
}
if (-not $logRootBase) { $logRootBase = Join-Path $workspaceRoot 'a11\runtime' }
$logRoot = Join-Path $logRootBase 'launcher\funesterie-all'
$stopAll = Join-Path $launcherRoot 'funesterie-stop-all.ps1'
$a11Launcher = Join-Path $launcherRoot 'a11-local.ps1'

try {
  Write-Info 'Relance complete en cours.'
  if (Test-Path -LiteralPath $stopAll) {
    Invoke-ChildPowerShellScript -Path $stopAll -Arguments @('-NoPause')
  }

  Start-OllamaIfNeeded -LogRoot $logRoot

  if (Test-Path -LiteralPath $a11Launcher) {
    Write-Info 'Demarrage A11.'
    $a11Args = @('restart', '-NoPause', '-SkipUiBuild')
    if ($NoOpen) { $a11Args += '-NoOpen' }
    Invoke-ChildPowerShellScript -Path $a11Launcher -Arguments $a11Args
  } else {
    Write-WarnLine "Launcher A11 introuvable: $a11Launcher"
  }

  if (Test-Path -LiteralPath $alphaDir) {
    Start-CaddyIfNeeded -AlphaDir $alphaDir -LogRoot $logRoot
  } else {
    Write-WarnLine "Dossier AlphaOnze introuvable: $alphaDir"
  }

  if (Test-Path -LiteralPath $a11Launcher) {
    Write-Info 'Statut A11:'
    Invoke-ChildPowerShellScript -Path $a11Launcher -Arguments @('status', '-NoPause')
  }

  Write-Info 'Termine.'
  Write-Info 'A11 local: http://127.0.0.1:3000'
  Write-Info 'A11 public: https://alphaonze.funesterie.pro/'
} finally {
  Complete
}
