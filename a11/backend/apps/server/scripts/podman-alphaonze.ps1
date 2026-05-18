param(
  [string]$DockerUser = "nossen",
  [string]$Image = "docker.io/nossen/alphaonze:latest",
  [switch]$Build,
  [switch]$Push,
  [switch]$Up
)

$ErrorActionPreference = "Stop"
$env:CONTAINERS_MACHINE_PROVIDER = "wsl"

$root = Split-Path -Parent $PSScriptRoot
$tokenFile = Join-Path $env:USERPROFILE "Desktop\codex.txt"

function Get-CodexSecret {
  param([string]$Name)
  if (!(Test-Path -LiteralPath $tokenFile)) {
    throw "Token file not found: $tokenFile"
  }
  $line = Get-Content -LiteralPath $tokenFile -Raw -Encoding UTF8 |
    Select-String -Pattern "(?im)^$([regex]::Escape($Name))\s*[:=]\s*(.+)$" |
    Select-Object -First 1
  if (!$line) {
    throw "Secret '$Name' not found in Desktop codex file"
  }
  return $line.Matches[0].Groups[1].Value.Trim()
}

function Assert-PodmanReady {
  $list = & cmd.exe /c "podman machine list 2>&1"
  if ($LASTEXITCODE -ne 0) {
    throw "Podman is not ready. Try: `$env:CONTAINERS_MACHINE_PROVIDER='wsl'; podman machine init a11-wsl --user-mode-networking --volume D:\projets\funesterie\a11:/workspace/a11 --volume D:\projets\funesterie\runtime:/workspace/runtime"
  }
  $machineLines = @($list | Where-Object { [string]::IsNullOrWhiteSpace([string]$_) -eq $false })
  if ($machineLines.Count -le 1) {
    throw "No Podman machine exists yet. WSL is not initialized on this Windows session, so init currently fails before the build can start."
  }
  $running = & cmd.exe /c "podman info --format ""{{.Version.Version}}"" 2>&1"
  if ($LASTEXITCODE -ne 0 -or !$running) {
    throw "No running Podman machine. Start it with: `$env:CONTAINERS_MACHINE_PROVIDER='wsl'; podman machine start a11-wsl"
  }
}

Push-Location $root
try {
  Assert-PodmanReady

  $dockerToken = Get-CodexSecret -Name "docker"
  $dockerToken | & podman login docker.io -u $DockerUser --password-stdin | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "Docker login failed for '$DockerUser'"
  }

  if ($Build) {
    & podman build -t $Image .
    if ($LASTEXITCODE -ne 0) { throw "podman build failed" }
  }

  if ($Push) {
    & podman push $Image
    if ($LASTEXITCODE -ne 0) { throw "podman push failed" }
  }

  if ($Up) {
    & podman compose -f docker-compose.yml -f docker-compose.alphaonze.local.yml up -d --build
    if ($LASTEXITCODE -ne 0) { throw "podman compose up failed" }
  }

  "alphaonze podman command completed"
}
finally {
  Pop-Location
}
