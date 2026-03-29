param(
  [switch]$RestartExisting
)

$ErrorActionPreference = 'Stop'

function Get-CommandPath {
  param([string]$Name)

  try {
    return (Get-Command $Name -ErrorAction Stop).Source
  } catch {
    return $null
  }
}

$cloudflared = Get-CommandPath 'cloudflared'
$tunnelName = 'funesterie-cerbere-local'
$configPath = Join-Path $PSScriptRoot 'config\cloudflared-cerbere.yml'
$runtimeDir = Join-Path $PSScriptRoot 'runtime'
$logDir = Join-Path $runtimeDir 'logs'
$stdoutPath = Join-Path $logDir 'cerbere-cloudflared.out.log'
$stderrPath = Join-Path $logDir 'cerbere-cloudflared.err.log'

if (-not $cloudflared) {
  throw 'cloudflared.exe introuvable dans le PATH.'
}

if (-not (Test-Path $configPath)) {
  throw "Config Cloudflare Cerbere introuvable: $configPath"
}

New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$matching = @(
  Get-CimInstance Win32_Process -Filter "Name = 'cloudflared.exe'" -ErrorAction SilentlyContinue |
    Where-Object {
      ($_.CommandLine -like "*$tunnelName*") -or
      ($_.CommandLine -like "*cloudflared-cerbere.yml*")
    }
)

if ($matching.Count -gt 0) {
  if (-not $RestartExisting) {
    Write-Host "[Tunnel Cerbere] deja actif (PID(s): $($matching.ProcessId -join ', '))." -ForegroundColor Yellow
    exit 0
  }

  foreach ($proc in $matching) {
    try {
      Stop-Process -Id $proc.ProcessId -Force -ErrorAction Stop
      Write-Host "[Tunnel Cerbere] cloudflared arrete (PID $($proc.ProcessId))."
    } catch {
      Write-Host "[Tunnel Cerbere] Impossible d'arreter PID $($proc.ProcessId): $($_.Exception.Message)" -ForegroundColor Red
      throw
    }
  }

  Start-Sleep -Seconds 1
}

$argumentList = @(
  'tunnel',
  '--config',
  $configPath,
  'run',
  $tunnelName
)

$process = Start-Process `
  -FilePath $cloudflared `
  -ArgumentList $argumentList `
  -WorkingDirectory (Split-Path -Parent $configPath) `
  -RedirectStandardOutput $stdoutPath `
  -RedirectStandardError $stderrPath `
  -WindowStyle Hidden `
  -PassThru

Write-Host "[Tunnel Cerbere] Demarre avec la config: $configPath"
Write-Host "[Tunnel Cerbere] PID: $($process.Id)"
Write-Host "[Tunnel Cerbere] Logs stdout: $stdoutPath"
Write-Host "[Tunnel Cerbere] Logs stderr: $stderrPath"
