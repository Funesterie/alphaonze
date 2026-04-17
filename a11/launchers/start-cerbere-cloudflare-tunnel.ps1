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

function Get-TunnelHealthSnapshot {
  param(
    [string]$PublicBackendUrl,
    [string]$PublicRouterUrl,
    [string]$LocalBackendUrl,
    [string]$LocalRouterUrl
  )

  $backendPublicHealthy = Test-HttpHealth -Url $PublicBackendUrl
  $backendLocalHealthy = Test-HttpHealth -Url $LocalBackendUrl
  $routerPublicHealthy = Test-HttpHealth -Url $PublicRouterUrl
  $routerLocalHealthy = Test-HttpHealth -Url $LocalRouterUrl

  return [pscustomobject]@{
    BackendPublicHealthy = $backendPublicHealthy
    BackendLocalHealthy = $backendLocalHealthy
    RouterPublicHealthy = $routerPublicHealthy
    RouterLocalHealthy = $routerLocalHealthy
    TunnelReady = $backendPublicHealthy -and $backendLocalHealthy
  }
}

$cloudflared = Get-CommandPath 'cloudflared'
$tunnelName = 'funesterie-cerbere-local'
$configPath = Join-Path $PSScriptRoot 'config\cloudflared-cerbere.yml'
$runtimeRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\runtime'))
$runtimeDir = Join-Path $runtimeRoot 'launcher'
$logDir = Join-Path $runtimeDir 'logs'
$stdoutPath = Join-Path $logDir 'cerbere-cloudflared.out.log'
$stderrPath = Join-Path $logDir 'cerbere-cloudflared.err.log'
$publicBackendHealthUrl = 'https://sd.funesterie.me/health'
$publicRouterHealthUrl = 'https://cerbere.funesterie.me/health'
$localBackendHealthUrl = 'http://127.0.0.1:3000/health'
$localRouterHealthUrl = 'http://127.0.0.1:4545/health'

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
  $snapshot = Get-TunnelHealthSnapshot `
    -PublicBackendUrl $publicBackendHealthUrl `
    -PublicRouterUrl $publicRouterHealthUrl `
    -LocalBackendUrl $localBackendHealthUrl `
    -LocalRouterUrl $localRouterHealthUrl

  if ($snapshot.TunnelReady -and $snapshot.RouterLocalHealthy) {
    Write-Host "[Tunnel Cerbere] deja actif et sain (public + local OK, PID(s): $($matching.ProcessId -join ', '))." -ForegroundColor Yellow
    exit 0
  }

  if ($RestartExisting) {
    Write-Host "[Tunnel Cerbere] redemarrage force demande (PID(s): $($matching.ProcessId -join ', '))." -ForegroundColor Yellow
  } else {
    Write-Host "[Tunnel Cerbere] process detecte mais tunnel non sain, redemarrage automatique (PID(s): $($matching.ProcessId -join ', '))." -ForegroundColor Yellow
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

for ($attempt = 0; $attempt -lt 20; $attempt++) {
  Start-Sleep -Seconds 2
  $snapshot = Get-TunnelHealthSnapshot `
    -PublicBackendUrl $publicBackendHealthUrl `
    -PublicRouterUrl $publicRouterHealthUrl `
    -LocalBackendUrl $localBackendHealthUrl `
    -LocalRouterUrl $localRouterHealthUrl

  if ($snapshot.TunnelReady) {
    Write-Host "[Tunnel Cerbere] Healthcheck OK (backend public/local OK, router public=$($snapshot.RouterPublicHealthy) local=$($snapshot.RouterLocalHealthy))."
    exit 0
  }
}

if (Test-Path $stderrPath) {
  $stderrTail = (Get-Content $stderrPath -Tail 40 -ErrorAction SilentlyContinue) -join "`n"
  if ($stderrTail -match 'Invalid tunnel secret') {
    throw '[Tunnel Cerbere] Echec Cloudflare: tunnel secret invalide.'
  }
}

Write-Host "[Tunnel Cerbere] Demarre mais le backend tunnel n'est pas encore verifie sur sd.funesterie.me." -ForegroundColor Yellow
