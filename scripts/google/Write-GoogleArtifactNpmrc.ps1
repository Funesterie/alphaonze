[CmdletBinding()]
param(
  [string]$ProjectId = $(if ($env:GOOGLE_CLOUD_PROJECT) { $env:GOOGLE_CLOUD_PROJECT } else { "alphaonze" }),
  [string]$Location = $(if ($env:GOOGLE_CLOUD_LOCATION) { $env:GOOGLE_CLOUD_LOCATION } else { "europe-west4" }),
  [string]$Repository = "funesterie-npm",
  [string]$Scope = "@funesterie",
  [string]$OutputPath = ".npmrc.google",
  [string]$TokenEnv = "GOOGLE_ARTIFACT_ACCESS_TOKEN"
)

$ErrorActionPreference = "Stop"

function Resolve-RepoRoot {
  $root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
  return $root.Path
}

$repoRoot = Resolve-RepoRoot
if (-not [System.IO.Path]::IsPathRooted($OutputPath)) {
  $OutputPath = Join-Path $repoRoot $OutputPath
}

$registry = "https://${Location}-npm.pkg.dev/${ProjectId}/${Repository}/"
$registryUri = [Uri]$registry
$authTarget = "$($registryUri.Host)$($registryUri.AbsolutePath.TrimEnd('/'))"

$outputDir = Split-Path -Parent $OutputPath
if ($outputDir -and -not (Test-Path -LiteralPath $outputDir)) {
  New-Item -ItemType Directory -Path $outputDir | Out-Null
}

$content = @(
  "# Local Google Artifact Registry npm config.",
  "# This file is ignored by Git. It expects an access token in `${$TokenEnv}.",
  "${Scope}:registry=$registry",
  "//$authTarget/:_authToken=`${$TokenEnv}"
)

Set-Content -LiteralPath $OutputPath -Value $content -Encoding utf8
Write-Host "Wrote $OutputPath for $Scope -> $registry."
Write-Host "No access token was written; npm reads `${$TokenEnv} at publish/install time."
