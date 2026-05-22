param(
  [switch]$Json,
  [switch]$PreferDocker
)

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\Funesterie.Container.ps1"

$engine = Get-FunesterieContainerEngine -PreferDocker:$PreferDocker
$podmanLogin = $null
try { $podmanLogin = (podman login --get-login docker.io 2>$null) } catch {}

$railwayCliReady = [bool](Get-Command railway -ErrorAction SilentlyContinue)
$railwayAuthenticated = $false
$railwayLinked = $false
if ($railwayCliReady) {
  try {
    $railwayWhoami = (railway whoami 2>&1 | Out-String).Trim()
    $railwayAuthenticated = ($LASTEXITCODE -eq 0) -and ($railwayWhoami -match 'Logged in as')
  } catch {}

  try {
    $railwayStatus = (railway status 2>&1 | Out-String).Trim()
    $railwayLinked = ($LASTEXITCODE -eq 0) -and ($railwayStatus -match 'Project:') -and -not ($railwayStatus -match 'Service:\s+None')
  } catch {}
}

$dockerConfig = Join-Path $env:USERPROFILE '.docker\config.json'
$dockerAuthKeys = @()
if (Test-Path -LiteralPath $dockerConfig) {
  try {
    $cfg = Get-Content -LiteralPath $dockerConfig -Raw | ConvertFrom-Json
    if ($cfg.auths) { $dockerAuthKeys = @($cfg.auths.PSObject.Properties.Name) }
  } catch {}
}

$status = [ordered]@{
  engine = $engine.Name
  engineReady = $engine.DaemonReady
  engineCommand = $engine.Command
  engineVersion = $engine.Version
  dockerCredentialStoreHasDockerIo = ($dockerAuthKeys -contains 'https://index.docker.io/v1/')
  podmanDockerIoLoggedIn = -not [string]::IsNullOrWhiteSpace($podmanLogin)
  railwayCliReady = $railwayCliReady
  railwayAuthenticated = $railwayAuthenticated
  railwayLinkedService = $railwayLinked
  secretPrinted = $false
}

if ($Json) {
  $status | ConvertTo-Json -Depth 5
  exit 0
}

[pscustomobject]$status | Format-List
