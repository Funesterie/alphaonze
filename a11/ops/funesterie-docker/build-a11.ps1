param(
  [string]$Repository = 'funesterie/a11-backend',
  [string]$Tag = (Get-Date -Format 'yyyyMMdd-HHmmss'),
  [switch]$Latest,
  [switch]$Push,
  [switch]$NoCache,
  [switch]$PreferDocker,
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\Funesterie.Container.ps1"

$serverRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..\backend\apps\server')
$engine = Get-FunesterieContainerEngine -PreferDocker:$PreferDocker
if (-not $engine.DaemonReady) {
  throw 'No ready container daemon found. Podman should be started, or Docker Desktop daemon must be fixed.'
}

$localImage = 'a11-backend:local'
$remoteTag = "${Repository}:${Tag}"
$buildArgs = @('build', '-t', $localImage, '-t', $remoteTag)
if ($Latest) { $buildArgs += @('-t', "${Repository}:latest") }
if ($NoCache) { $buildArgs += '--no-cache' }
if ($env:JFROG_NPM_AUTH_TOKEN) {
  $buildArgs += @('--build-arg', 'JFROG_NPM_AUTH_TOKEN')
}
$buildArgs += '.'

Invoke-FunesterieContainer -Engine $engine -Arguments $buildArgs -WorkingDirectory $serverRoot -DryRun:$DryRun

if ($Push) {
  Invoke-FunesterieContainer -Engine $engine -Arguments @('push', $remoteTag) -WorkingDirectory $serverRoot -DryRun:$DryRun
  if ($Latest) {
    Invoke-FunesterieContainer -Engine $engine -Arguments @('push', "${Repository}:latest") -WorkingDirectory $serverRoot -DryRun:$DryRun
  }
}

[pscustomobject]@{
  engine = $engine.Name
  image = $remoteTag
  latest = [bool]$Latest
  pushed = [bool]$Push
  dryRun = [bool]$DryRun
} | Format-List
