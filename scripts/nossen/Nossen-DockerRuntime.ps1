# Nossen-DockerRuntime.ps1 - role-based local container runtime control.
# Usage:
#   pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/nossen/Nossen-DockerRuntime.ps1 status
#   pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/nossen/Nossen-DockerRuntime.ps1 start-atelier
#   pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/nossen/Nossen-DockerRuntime.ps1 stop-atelier

param(
  [ValidateSet("status", "start-atelier", "stop-atelier", "profile")]
  [string]$Action = "status",
  [string]$PodmanDistro = "podman-a11-wsl",
  [string]$PodmanNetworkDistro = "podman-net-usermode",
  [string]$PodmanDockerContext = "podman-a11"
)

$ErrorActionPreference = "Stop"
$RepoRoot = Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..")
$RepairPodmanScript = Join-Path $RepoRoot "scripts\nossen\Repair-PodmanA11Wsl.ps1"

function Write-Section([string]$Title) {
  Write-Host ""
  Write-Host "== $Title ==" -ForegroundColor Cyan
}

function Test-CommandExists([string]$Name) {
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Get-WslState([string]$Name) {
  if (-not (Test-CommandExists "wsl.exe")) { return "unavailable" }
  $raw = (& wsl.exe -l -v 2>$null | Out-String)
  $plain = $raw -replace "`0", ""
  foreach ($line in $plain -split "`r?`n") {
    if ($line -match [regex]::Escape($Name)) {
      if ($line -match "\bRunning\b") { return "Running" }
      if ($line -match "\bStopped\b") { return "Stopped" }
      return "present"
    }
  }
  return "missing"
}

function Invoke-Optional([scriptblock]$Script, [string]$Fallback = "") {
  try {
    & $Script
  } catch {
    if ($Fallback) { Write-Host $Fallback -ForegroundColor Yellow }
    Write-Host "warning: $($_.Exception.Message)" -ForegroundColor Yellow
  }
}

function Show-Profile {
  Write-Section "NOSSEN container roles"
  Write-Host "runtime   : Docker Desktop / desktop-linux - MCP, Neo4j local, A11/NOSSEN live tools."
  Write-Host "atelier   : Podman WSL / podman-a11 - build, tests, rescue, old images, isolated experiments."
  Write-Host "registry  : Docker Hub funeste38/pool - image storage/publication, not a running engine."
  Write-Host "rule      : keep runtime on; start atelier only for build/rescue/test sessions; never delete without explicit human request."
}

function Show-Status {
  Show-Profile

  Write-Section "WSL engines"
  Write-Host ("docker-desktop       : {0}" -f (Get-WslState "docker-desktop"))
  Write-Host ("{0,-20}: {1}" -f $PodmanDistro, (Get-WslState $PodmanDistro))
  Write-Host ("{0,-20}: {1}" -f $PodmanNetworkDistro, (Get-WslState $PodmanNetworkDistro))

  Write-Section "Docker contexts"
  Invoke-Optional { docker context ls | Out-Host } "docker context unavailable"

  Write-Section "Runtime containers (desktop-linux)"
  Invoke-Optional {
    docker --context desktop-linux ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" | Out-Host
  } "desktop-linux unavailable"

  Write-Section "Atelier containers (podman-a11)"
  $atelierState = Get-WslState $PodmanDistro
  if ($atelierState -ne "Running") {
    Write-Host "atelier sleeping (${PodmanDistro}: $atelierState). Use npm run nossen:docker:atelier:on when needed."
  } else {
    Invoke-Optional {
      docker --context $PodmanDockerContext ps -a --format "table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}" | Out-Host
    } "podman-a11 unavailable"
  }
}

switch ($Action) {
  "profile" {
    Show-Profile
  }
  "status" {
    Show-Status
  }
  "start-atelier" {
    Write-Section "Starting atelier runtime"
    if (-not (Test-Path -LiteralPath $RepairPodmanScript)) {
      throw "Podman repair/start helper missing: $RepairPodmanScript"
    }
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $RepairPodmanScript
    Show-Status
  }
  "stop-atelier" {
    Write-Section "Stopping atelier runtime"
    Invoke-Optional { wsl.exe --terminate $PodmanDistro | Out-Host } "podman distro already stopped"
    Invoke-Optional { wsl.exe --terminate $PodmanNetworkDistro | Out-Host } "podman network distro already stopped"
    Show-Status
  }
}
