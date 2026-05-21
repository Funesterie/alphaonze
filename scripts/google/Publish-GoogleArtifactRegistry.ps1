[CmdletBinding()]
param(
  [switch]$DryRun,
  [switch]$Publish,
  [switch]$NoBuild,
  [string]$PackageId,
  [string]$ManifestPath = $(Join-Path $PSScriptRoot "google-artifact-registry.manifest.json"),
  [string]$RepoNpmrcPath = ".npmrc.google",
  [string]$CredentialNpmrcPath = $(if ($env:FUNESTERIE_GAR_NPMRC) { $env:FUNESTERIE_GAR_NPMRC } else { "D:\FunesterieSecrets\google\artifact-registry.npmrc" })
)

$ErrorActionPreference = "Stop"

function Resolve-RepoRoot {
  $root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
  return $root.Path
}

function Read-JsonFile([string]$Path) {
  return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
}

$repoRoot = Resolve-RepoRoot
if (-not [System.IO.Path]::IsPathRooted($ManifestPath)) {
  $ManifestPath = Join-Path $repoRoot $ManifestPath
}
if (-not [System.IO.Path]::IsPathRooted($RepoNpmrcPath)) {
  $RepoNpmrcPath = Join-Path $repoRoot $RepoNpmrcPath
}

$manifest = Read-JsonFile $ManifestPath
$registry = [string]$manifest.registry
if ([string]::IsNullOrWhiteSpace($registry)) {
  throw "Manifest is missing registry: $ManifestPath"
}

& (Join-Path $PSScriptRoot "Write-GoogleArtifactNpmrc.ps1") `
  -ProjectId ([string]$manifest.projectId) `
  -Location ([string]$manifest.location) `
  -Repository ([string]$manifest.npmRepository) `
  -OutputPath $RepoNpmrcPath

if ($Publish) {
  & (Join-Path $PSScriptRoot "Refresh-GoogleArtifactNpmAuth.ps1") `
    -RepoConfigPath $RepoNpmrcPath `
    -CredentialConfigPath $CredentialNpmrcPath
}

$publishArgs = @(
  "-File", (Join-Path $repoRoot "scripts\github\Publish-GitHubPackages.ps1"),
  "-ManifestPath", $ManifestPath,
  "-Registry", $registry,
  "-NpmrcPath", $CredentialNpmrcPath,
  "-UseExternalNpmAuth",
  "-SummaryTitle", "Google Artifact Registry summary"
)

if ($DryRun -or -not $Publish) {
  $publishArgs += "-DryRun"
}
if ($Publish) {
  $publishArgs += "-Publish"
}
if ($NoBuild) {
  $publishArgs += "-NoBuild"
}
if ($PackageId) {
  $publishArgs += @("-PackageId", $PackageId)
}

& pwsh -NoProfile -ExecutionPolicy Bypass @publishArgs
if ($LASTEXITCODE -ne 0) {
  throw "Artifact Registry publish flow failed with exit code $LASTEXITCODE."
}
