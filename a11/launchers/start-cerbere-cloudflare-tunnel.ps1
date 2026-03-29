param(
  [switch]$RestartExisting
)

$ErrorActionPreference = 'Stop'

function Test-HttpHealth {
  param(
    [string]$Url,
    [int]$TimeoutSec = 5
  )

  if ([string]::IsNullOrWhiteSpace($Url)) {
    return $false
  }

  try {
    $response = Invoke-WebRequest -Uri $Url -Method Get -UseBasicParsing -TimeoutSec $TimeoutSec
    return ($response.StatusCode -ge 200 -and $response.StatusCode -lt 400)
  } catch {
    return $false
  }
}

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
$publicHealthUrl = 'https://cerbere.funesterie.me/health'
$localHealthUrl = 'http://127.0.0.1:4545/health'

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
  $publicHealthy = Test-HttpHealth -Url $publicHealthUrl
  $localHealthy = Test-HttpHealth -Url $localHealthUrl

  if ($publicHealthy -and $localHealthy) {
    Write-Host "[Tunnel Cerbere] deja actif et sain (public + local OK, PID(s): $($matching.ProcessId -join ', '))." -ForegroundColor Yellow
    exit 0
  }

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

Start-Sleep -Seconds 2

$publicHealthy = Test-HttpHealth -Url $publicHealthUrl
$localHealthy = Test-HttpHealth -Url $localHealthUrl

if ($publicHealthy -or $localHealthy) {
  Write-Host "[Tunnel Cerbere] Healthcheck initial OK (local=$localHealthy public=$publicHealthy)."
  exit 0
}

if (Test-Path $stderrPath) {
  $stderrTail = (Get-Content $stderrPath -Tail 40 -ErrorAction SilentlyContinue) -join "`n"
  if ($stderrTail -match 'Invalid tunnel secret') {
    throw '[Tunnel Cerbere] Echec Cloudflare: tunnel secret invalide.'
  }
}

Write-Host "[Tunnel Cerbere] Demarre mais endpoints pas encore verifies (local=$localHealthy public=$publicHealthy)." -ForegroundColor Yellow
