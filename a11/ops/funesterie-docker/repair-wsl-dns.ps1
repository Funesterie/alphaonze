param(
  [string]$Distro = 'podman-a11-wsl',
  [string]$Nameserver = '',
  [switch]$DryRun,
  [switch]$Json
)

$ErrorActionPreference = 'Stop'

function Write-Result {
  param([object]$Value)

  if ($Json) {
    $Value | ConvertTo-Json -Depth 8
  } else {
    $Value
  }
}

function Get-CleanWslLines {
  param([string[]]$Lines)

  @($Lines | ForEach-Object { ($_ -replace "`0", '').Trim() } | Where-Object { $_ })
}

function Resolve-FunesterieWslNameserver {
  param([Parameter(Mandatory = $true)][string]$DistroName)

  if (-not [string]::IsNullOrWhiteSpace($Nameserver)) {
    return $Nameserver.Trim()
  }

  $route = Get-CleanWslLines @(& wsl.exe -d $DistroName -- sh -lc 'ip route 2>/dev/null || true' 2>$null) | Select-Object -First 1
  if ($route -match '^default\s+via\s+(\d{1,3}(?:\.\d{1,3}){3})\b') {
    return $Matches[1]
  }

  $resolv = Get-CleanWslLines @(& wsl.exe -d $DistroName -- sh -lc 'cat /etc/resolv.conf 2>/dev/null || true' 2>$null)
  $currentNameserverLine = $resolv | Where-Object { $_ -match '^nameserver\s+' } | Select-Object -First 1
  if ($currentNameserverLine -match '^nameserver\s+(\d{1,3}(?:\.\d{1,3}){3})\b') {
    return $Matches[1]
  }

  throw 'Could not auto-detect a WSL nameserver. Pass -Nameserver explicitly.'
}

$wsl = Get-Command wsl.exe -ErrorAction SilentlyContinue
if (-not $wsl) {
  throw 'wsl.exe not found.'
}

$distroList = Get-CleanWslLines @(& wsl.exe --list --quiet)
if (-not ($distroList -contains $Distro)) {
  throw "WSL distro '$Distro' not found."
}

$resolvedNameserver = Resolve-FunesterieWslNameserver -DistroName $Distro
if ($resolvedNameserver -notmatch '^\d{1,3}(\.\d{1,3}){3}$') {
  throw 'Nameserver must be an IPv4 address.'
}

$before = (& wsl.exe -d $Distro -- sh -lc "cat /etc/resolv.conf 2>/dev/null || true") -join "`n"

if ($DryRun) {
  Write-Result ([pscustomobject]@{
    distro = $Distro
    nameserver = $resolvedNameserver
    dryRun = $true
    before = $before
    secretPrinted = $false
  })
  exit 0
}

$backupPathExpected = "/etc/resolv.conf.bak-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
$shell = "set -eu; cp /etc/resolv.conf '$backupPathExpected'; printf 'nameserver $resolvedNameserver\noptions timeout:2 attempts:2\n' > /etc/resolv.conf; printf '%s\n' '$backupPathExpected'"
$backupPath = (& wsl.exe -d $Distro -u root -- sh -lc $shell) -join "`n"
$after = (& wsl.exe -d $Distro -- sh -lc "cat /etc/resolv.conf 2>/dev/null || true") -join "`n"
$registryDnsOk = $false
try {
  & wsl.exe -d $Distro -- sh -lc "getent hosts registry.redhat.io >/dev/null && getent hosts registry-1.docker.io >/dev/null" | Out-Null
  $registryDnsOk = $LASTEXITCODE -eq 0
} catch {
  $registryDnsOk = $false
}

Write-Result ([pscustomobject]@{
  distro = $Distro
  nameserver = $resolvedNameserver
  backup = $backupPath.Trim()
  registryDnsOk = $registryDnsOk
  before = $before
  after = $after
  secretPrinted = $false
})
