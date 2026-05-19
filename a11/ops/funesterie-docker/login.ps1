param(
  [string]$Username = 'funesterie',
  [string]$TokenFile = 'C:\Users\Djeff\Desktop\docker.txt',
  [switch]$SkipDockerCli,
  [switch]$SkipPodman
)

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\Funesterie.Container.ps1"

$token = $env:DOCKERHUB_TOKEN
if ([string]::IsNullOrWhiteSpace($token) -and (Test-Path -LiteralPath $TokenFile)) {
  $token = (Get-Content -LiteralPath $TokenFile -Raw).Trim()
}
if ([string]::IsNullOrWhiteSpace($token)) {
  throw 'Docker Hub token missing. Set DOCKERHUB_TOKEN or provide -TokenFile.'
}

Add-FunesterieDockerPath
$results = [ordered]@{
  username = $Username
  dockerCli = $false
  podman = $false
  secretPrinted = $false
}

if (-not $SkipDockerCli -and (Test-Path -LiteralPath $script:FunesterieDockerExe)) {
  $out = $token | & $script:FunesterieDockerExe login --username $Username --password-stdin 2>&1 | Out-String
  $results.dockerCli = ($out -match 'Login Succeeded')
}

if (-not $SkipPodman -and (Get-Command podman -ErrorAction SilentlyContinue)) {
  $out = $token | podman login docker.io --username $Username --password-stdin 2>&1 | Out-String
  $results.podman = ($out -match 'Login Succeeded|Authenticating with existing credentials|Existing credentials are valid')
}

[pscustomobject]$results | Format-List
