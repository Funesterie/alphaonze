# Repair-PodmanA11Wsl.ps1 - revive the local A11 Podman WSL bridge after reboot/shutdown.
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\nossen\Repair-PodmanA11Wsl.ps1

param(
  [string]$Distro = "podman-a11-wsl",
  [string]$ConnectionName = "a11-wsl-localhost",
  [string]$RuntimeUser = "user",
  [string]$RuntimeUid = "1000",
  [switch]$RemoveStaleInfraPod
)

$ErrorActionPreference = "Continue"

function Write-Step($Message) {
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Invoke-Checked($Command, [string]$Label) {
  Write-Host "  $Label"
  & powershell -NoProfile -Command $Command
  if ($LASTEXITCODE -ne 0) {
    Write-Host "  warning: command exited with $LASTEXITCODE" -ForegroundColor Yellow
  }
}

Write-Host ""
Write-Host "=== PODMAN A11 WSL REPAIR $(Get-Date -Format 'yyyy-MM-dd HH:mm') ===" -ForegroundColor Cyan

Write-Step "Starting WSL distro $Distro"
wsl -d $Distro -- uname -a | Out-Host

Write-Step "Recreating rootless runtime dir"
wsl -d $Distro -u root -- bash -lc "install -d -m 700 -o $RuntimeUser -g $RuntimeUser /run/user/$RuntimeUid && ls -ld /run/user/$RuntimeUid" | Out-Host

Write-Step "Checking Podman directly inside WSL"
wsl -d $Distro -u $RuntimeUser -- bash -lc "export XDG_RUNTIME_DIR=/run/user/$RuntimeUid; podman version --format '{{.Client.Version}}'; podman ps -a --format '{{.ID}} {{.Names}} {{.Status}}' | head -20" | Out-Host

if ($RemoveStaleInfraPod) {
  Write-Step "Removing known stale test pod if present"
  wsl -d $Distro -u $RuntimeUser -- bash -lc "export XDG_RUNTIME_DIR=/run/user/$RuntimeUid; podman pod inspect my-first-pod >/dev/null 2>&1 && podman pod rm my-first-pod || true" | Out-Host
}

Write-Step "Ensuring Windows Podman default connection"
$connections = podman system connection list 2>$null
$connectionPattern = "^\s*$([regex]::Escape($ConnectionName))\s"
$connectionExists = $false
foreach ($line in $connections) {
  if ($line -match $connectionPattern) {
    $connectionExists = $true
    break
  }
}
if (-not $connectionExists) {
  podman system connection add $ConnectionName tcp://localhost:50460 | Out-Host
}
podman system connection default $ConnectionName | Out-Host

Write-Step "Windows Podman smoke test"
podman ps -a --format "{{.ID}} {{.Names}} {{.Status}}" | Out-Host
podman system df | Out-Host

Write-Host ""
Write-Host "Done. If this fails after a hard reboot, start Podman Desktop once, then rerun this script." -ForegroundColor Green
