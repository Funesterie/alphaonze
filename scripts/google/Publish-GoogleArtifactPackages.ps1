[CmdletBinding()]
param(
  [switch]$DryRun,
  [switch]$Publish,
  [switch]$NoBuild,
  [string]$PackageId,
  [string]$ProjectId = $(if ($env:GOOGLE_CLOUD_PROJECT) { $env:GOOGLE_CLOUD_PROJECT } else { "alphaonze" }),
  [string]$Location = $(if ($env:GOOGLE_CLOUD_LOCATION) { $env:GOOGLE_CLOUD_LOCATION } else { "europe-west4" }),
  [string]$Repository = "funesterie-npm",
  [string]$Scope = "@funesterie",
  [string]$ManifestPath = "scripts/github/github-packages.manifest.json",
  [string]$NpmrcPath = ".npmrc.google",
  [string]$TokenEnv = "GOOGLE_ARTIFACT_ACCESS_TOKEN"
)

$ErrorActionPreference = "Stop"

function Resolve-RepoRoot {
  $root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
  return $root.Path
}

if ($Publish -and $DryRun) {
  throw "Use either -DryRun or -Publish, not both."
}
if (-not $Publish) {
  $DryRun = $true
}

$repoRoot = Resolve-RepoRoot
$registry = "https://${Location}-npm.pkg.dev/${ProjectId}/${Repository}/"

if (-not [System.IO.Path]::IsPathRooted($NpmrcPath)) {
  $NpmrcPath = Join-Path $repoRoot $NpmrcPath
}

& (Join-Path $PSScriptRoot "Write-GoogleArtifactNpmrc.ps1") `
  -ProjectId $ProjectId `
  -Location $Location `
  -Repository $Repository `
  -Scope $Scope `
  -OutputPath $NpmrcPath `
  -TokenEnv $TokenEnv

$previousToken = [Environment]::GetEnvironmentVariable($TokenEnv, "Process")
try {
  if ($Publish) {
    $accessToken = (& gcloud auth print-access-token --project $ProjectId 2>$null)
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($accessToken)) {
      throw "Could not obtain a Google access token. Run gcloud auth login and retry."
    }
    [Environment]::SetEnvironmentVariable($TokenEnv, ([string]$accessToken).Trim(), "Process")
  }

  $publisher = Join-Path $repoRoot "scripts\github\Publish-GitHubPackages.ps1"
  $commonArgs = @{
    ManifestPath = $ManifestPath
    NpmrcPath = $NpmrcPath
    Registry = $registry
    TokenEnv = $TokenEnv
  }
  if ($PackageId) {
    $commonArgs.PackageId = $PackageId
  }

  if ($Publish) {
    & $publisher -Publish -NoBuild:$NoBuild @commonArgs
  } else {
    & $publisher -DryRun -NoBuild:$NoBuild @commonArgs
  }
  if ($LASTEXITCODE -ne 0) {
    throw "Package mirror publish failed."
  }
} finally {
  [Environment]::SetEnvironmentVariable($TokenEnv, $previousToken, "Process")
}
