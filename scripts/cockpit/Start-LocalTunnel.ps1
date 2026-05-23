param(
  [string]$TunnelName = "nossen-cockpit-local",
  [string]$Hostname = "cockpit.funesterie.me",
  [int]$Port = 8089,
  [switch]$SkipDnsRoute,
  [switch]$NoBrowser,
  [switch]$ForegroundServer,
  [switch]$SelfTest
)

$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'
$root = $PSScriptRoot
if (-not $root) { $root = Split-Path -Parent $MyInvocation.MyCommand.Path }
$serverScript = Join-Path $root "local-server.ps1"
$logDir = Join-Path $root "logs"
if (-not (Test-Path -LiteralPath $logDir)) {
  New-Item -ItemType Directory -Path $logDir -Force | Out-Null
}

function Test-CommandExists {
  param([string]$Name)
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Test-ListeningPort {
  param([int]$LocalPort)
  return [bool](Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort $LocalPort -State Listen -ErrorAction SilentlyContinue)
}

function Ensure-CloudflaredTunnel {
  param([string]$Name)
  $list = cloudflared tunnel list 2>$null | Out-String
  if ($LASTEXITCODE -ne 0) { throw "cloudflared tunnel list failed" }
  if ($list -match "(?m)\s$([regex]::Escape($Name))\s") {
    return
  }
  Write-Host "Creating Cloudflare tunnel '$Name'..." -ForegroundColor DarkGreen
  cloudflared tunnel create $Name 2>$null | Out-Host
  if ($LASTEXITCODE -ne 0) { throw "cloudflared tunnel create failed" }
}

function Ensure-DnsRoute {
  param([string]$Name, [string]$DnsHost)
  if ($SkipDnsRoute) { return }
  Write-Host "Routing $DnsHost to tunnel '$Name'..." -ForegroundColor DarkGreen
  cloudflared tunnel route dns --overwrite-dns $Name $DnsHost 2>$null | Out-Host
  if ($LASTEXITCODE -ne 0) { throw "cloudflared tunnel route dns failed" }
}

function Ensure-CloudflaredProcess {
  param([string]$Name, [int]$LocalPort)
  $pattern = "cloudflared.*tunnel.*run.*$([regex]::Escape($Name))"
  $existing = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match '^cloudflared(\.exe)?$' -and $_.CommandLine -match $pattern }
  if ($existing) { return }

  Start-Process -FilePath "cloudflared" -ArgumentList @(
    "tunnel",
    "--no-autoupdate",
    "--url",
    "http://127.0.0.1:$LocalPort",
    "run",
    $Name
  ) -WindowStyle Hidden
}

function Stop-ExistingLocalServers {
  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object {
      $_.ProcessId -ne $PID -and
      $_.Name -match '^powershell(\.exe)?$|^pwsh(\.exe)?$' -and
      $_.CommandLine -match 'local-server\.ps1'
    } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}

if ($SelfTest) {
  if (-not (Test-Path -LiteralPath $serverScript)) { throw "local-server.ps1 missing" }
  if (-not (Test-CommandExists "cloudflared")) { throw "cloudflared not found" }
  Write-Output (@{ ok = $true; host = $Hostname; tunnel = $TunnelName; port = $Port } | ConvertTo-Json -Compress)
  exit 0
}

if (-not (Test-CommandExists "cloudflared")) {
  throw "cloudflared is not available in PATH"
}
if (-not (Test-Path -LiteralPath $serverScript)) {
  throw "local-server.ps1 missing"
}

Ensure-CloudflaredTunnel -Name $TunnelName
Ensure-DnsRoute -Name $TunnelName -DnsHost $Hostname
Ensure-CloudflaredProcess -Name $TunnelName -LocalPort $Port
Stop-ExistingLocalServers

Write-Host ""
Write-Host "NOSSEN cockpit tunnel starting" -ForegroundColor Green
Write-Host "Public: https://$Hostname/mcp" -ForegroundColor DarkGreen
Write-Host "Local:  http://127.0.0.1:$Port/mcp" -ForegroundColor DarkGreen
Write-Host "Session gate is generated inside the local server and is not printed." -ForegroundColor DarkGray
Write-Host ""

$serverArgs = @(
  "-NoProfile",
  "-ExecutionPolicy",
  "Bypass",
  "-File",
  $serverScript,
  "-Port",
  [string]$Port,
  "-TunnelHostname",
  $Hostname
)
if ($NoBrowser) { $serverArgs += "-NoBrowser" }

if ($ForegroundServer) {
  & powershell @serverArgs
  exit $LASTEXITCODE
}

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$stdout = Join-Path $logDir "local-server-$stamp.out.log"
$stderr = Join-Path $logDir "local-server-$stamp.err.log"
Start-Process -FilePath "powershell" -ArgumentList $serverArgs -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr | Out-Null

for ($i = 0; $i -lt 30; $i++) {
  if (Test-ListeningPort -LocalPort $Port) { break }
  Start-Sleep -Milliseconds 300
}

Write-Host "Cockpit local started in background." -ForegroundColor Green
Write-Host "Logs: $stdout" -ForegroundColor DarkGray
