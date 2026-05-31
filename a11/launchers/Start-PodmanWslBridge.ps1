param(
  [string]$Distro = "podman-a11-wsl",
  [int]$Port = 50460,
  [switch]$Quiet
)

$ErrorActionPreference = "Stop"

function Write-Step([string]$Message) {
  if (-not $Quiet) {
    Write-Host "[Podman WSL] $Message" -ForegroundColor Cyan
  }
}

if (-not (Get-Command podman -ErrorAction SilentlyContinue)) {
  throw "podman introuvable dans le PATH"
}
if (-not (Get-Command wsl -ErrorAction SilentlyContinue)) {
  throw "wsl introuvable dans le PATH"
}

$wslNames = @(& wsl -l -q) | ForEach-Object {
  ($_ -replace "`0", "").Trim()
} | Where-Object { $_ }
if ($wslNames -notcontains $Distro) {
  throw "Distribution WSL introuvable: $Distro"
}

$a11Root = Split-Path -Parent $PSScriptRoot
$dnsRepairScript = Join-Path $a11Root "ops\funesterie-docker\repair-wsl-dns.ps1"
if (Test-Path -LiteralPath $dnsRepairScript) {
  Write-Step "Verification DNS de $Distro"
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $dnsRepairScript -Distro $Distro -Json *> $null
  if ($LASTEXITCODE -ne 0) {
    throw "Verification DNS Podman WSL echouee pour $Distro"
  }
}

Write-Step "Preparation runtime Podman rootless"
try {
  $uid = (& wsl -d $Distro -- sh -lc "id -u").Trim()
  $gid = (& wsl -d $Distro -- sh -lc "id -g").Trim()
  if ($uid -match '^\d+$' -and $gid -match '^\d+$') {
    $runtimeRootCommand = "set -eu; install -d -m 700 -o $uid -g $gid /run/user/$uid; install -d -m 700 -o $uid -g $gid /run/user/$uid/containers; install -d -m 700 -o $uid -g $gid /run/user/$uid/containers/networks"
    & wsl -d $Distro -u root -- bash -lc $runtimeRootCommand
  }
} catch {
  Write-Step "Preparation runtime root: $($_.Exception.Message)"
}
$runtimeCommand = 'runtime_dir="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"; mkdir -p "$runtime_dir/containers/networks" 2>/dev/null || true'
& wsl -d $Distro -- bash -lc $runtimeCommand

Write-Step "Activation du service Podman dans $Distro sur localhost:$Port"
$wslCommand = "if ! ss -ltn 2>/dev/null | grep -q ':$Port '; then nohup podman system service --time=0 tcp:0.0.0.0:$Port >/tmp/a11-podman-service.log 2>&1 & fi; sleep 1; podman info >/dev/null"
& wsl -d $Distro -- bash -lc $wslCommand
if ($LASTEXITCODE -ne 0) {
  throw "Impossible de demarrer le service Podman dans $Distro"
}

$pingUrl = "http://localhost:$Port/v5.8.2/libpod/_ping"
$ready = $false
for ($i = 0; $i -lt 10; $i += 1) {
  try {
    $response = Invoke-WebRequest -Uri $pingUrl -UseBasicParsing -TimeoutSec 2
    if ([int]$response.StatusCode -eq 200) {
      $ready = $true
      break
    }
  } catch {}
  Start-Sleep -Milliseconds 500
}
if (-not $ready) {
  throw "Service Podman non joignable sur $pingUrl"
}

$connectionName = "a11-wsl-localhost"
try {
  & podman system connection remove $connectionName -f *> $null
} catch {}

& podman system connection add --default $connectionName "tcp://localhost:$Port" *> $null
if ($LASTEXITCODE -ne 0) {
  throw "Impossible de declarer la connexion Podman $connectionName"
}

$version = (& podman info --format "{{.Version.Version}}" 2>$null).Trim()
if ($LASTEXITCODE -ne 0 -or -not $version) {
  throw "Podman ne repond pas apres configuration de $connectionName"
}

Write-Step "Podman pret via $connectionName (version $version)"
