param(
  [string]$Distro = "podman-a11-wsl",
  [string]$Nameserver = "172.17.224.1",
  [switch]$DryRun,
  [switch]$Json
)

$ErrorActionPreference = "Stop"

function Write-Result {
  param([object]$Value)

  if ($Json) {
    $Value | ConvertTo-Json -Depth 8
  } else {
    $Value
  }
}

if ($Nameserver -notmatch '^\d{1,3}(\.\d{1,3}){3}$') {
  throw "Nameserver must be an IPv4 address."
}

$wsl = Get-Command wsl.exe -ErrorAction SilentlyContinue
if (-not $wsl) {
  throw "wsl.exe not found."
}

$distroList = & wsl.exe --list --quiet
if (-not ($distroList -contains $Distro)) {
  throw "WSL distro '$Distro' not found."
}

$before = (& wsl.exe -d $Distro -- sh -lc "cat /etc/resolv.conf 2>/dev/null || true") -join "`n"

if ($DryRun) {
  Write-Result ([pscustomobject]@{
    distro = $Distro
    nameserver = $Nameserver
    dryRun = $true
    before = $before
    secretPrinted = $false
  })
  exit 0
}

$shell = @"
set -eu
backup="/etc/resolv.conf.bak-`$(date +%Y%m%d-%H%M%S)"
cp /etc/resolv.conf "`$backup"
printf 'nameserver $Nameserver\noptions timeout:2 attempts:2\n' > /etc/resolv.conf
printf '%s\n' "`$backup"
"@

$backupPath = (& wsl.exe -d $Distro -u root -- sh -lc $shell) -join "`n"
$after = (& wsl.exe -d $Distro -- sh -lc "cat /etc/resolv.conf 2>/dev/null || true") -join "`n"
$registryDnsOk = $false
try {
  $hosts = (& wsl.exe -d $Distro -- sh -lc "getent hosts registry.redhat.io >/dev/null && getent hosts registry-1.docker.io >/dev/null")
  $registryDnsOk = $LASTEXITCODE -eq 0
} catch {
  $registryDnsOk = $false
}

Write-Result ([pscustomobject]@{
  distro = $Distro
  nameserver = $Nameserver
  backup = $backupPath.Trim()
  registryDnsOk = $registryDnsOk
  before = $before
  after = $after
  secretPrinted = $false
})
