[CmdletBinding()]
param(
  [string]$RepoConfigPath = ".npmrc.google",
  [string]$CredentialConfigPath = $(if ($env:FUNESTERIE_GAR_NPMRC) { $env:FUNESTERIE_GAR_NPMRC } else { "D:\FunesterieSecrets\google\artifact-registry.npmrc" })
)

$ErrorActionPreference = "Stop"

function Resolve-RepoRoot {
  $root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
  return $root.Path
}

$repoRoot = Resolve-RepoRoot
if (-not [System.IO.Path]::IsPathRooted($RepoConfigPath)) {
  $RepoConfigPath = Join-Path $repoRoot $RepoConfigPath
}

$credentialDir = Split-Path -Parent $CredentialConfigPath
if ($credentialDir -and -not (Test-Path -LiteralPath $credentialDir)) {
  New-Item -ItemType Directory -Path $credentialDir -Force | Out-Null
}

if (-not (Test-Path -LiteralPath $RepoConfigPath)) {
  & (Join-Path $PSScriptRoot "Write-GoogleArtifactNpmrc.ps1") -OutputPath $RepoConfigPath
}

Write-Host "Refreshing Google Artifact Registry npm credentials."
Write-Host "Repo config: $RepoConfigPath"
Write-Host "Credential config: $CredentialConfigPath"

& npx --yes google-artifactregistry-auth `
  --repo-config $RepoConfigPath `
  --credential-config $CredentialConfigPath

if ($LASTEXITCODE -ne 0) {
  throw "google-artifactregistry-auth failed with exit code $LASTEXITCODE."
}

Write-Host "Google Artifact Registry npm credentials refreshed. Keep $CredentialConfigPath outside Git."
