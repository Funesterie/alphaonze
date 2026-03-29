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
$configPath = Join-Path $HOME '.cloudflared\config.yml'
$tunnelName = 'funesterie-tunnel-named'
$runtimeDir = Join-Path $PSScriptRoot 'runtime'
$logDir = Join-Path $runtimeDir 'logs'
$stdoutPath = Join-Path $logDir 'cloudflared-managed.out.log'
$stderrPath = Join-Path $logDir 'cloudflared-managed.err.log'

if (-not $cloudflared) {
  throw 'cloudflared.exe introuvable dans le PATH.'
}

if (-not (Test-Path $configPath)) {
  throw "Config Cloudflare introuvable: $configPath"
}

New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$existing = Get-Process -Name cloudflared -ErrorAction SilentlyContinue
if ($existing) {
  if (-not $RestartExisting) {
    Write-Host "[Tunnel] cloudflared tourne deja (PID(s): $($existing.Id -join ', '))." -ForegroundColor Yellow
    Write-Host "[Tunnel] Relance avec -RestartExisting pour basculer sur la config locale." -ForegroundColor Yellow
    exit 0
  }

  foreach ($proc in $existing) {
    try {
      Stop-Process -Id $proc.Id -Force -ErrorAction Stop
      Write-Host "[Tunnel] cloudflared arrete (PID $($proc.Id))."
    } catch {
      Write-Host "[Tunnel] Impossible d'arreter PID $($proc.Id): $($_.Exception.Message)" -ForegroundColor Red
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

Write-Host "[Tunnel] Demarre avec la config locale: $configPath"
Write-Host "[Tunnel] PID: $($process.Id)"
Write-Host "[Tunnel] Logs stdout: $stdoutPath"
Write-Host "[Tunnel] Logs stderr: $stderrPath"
