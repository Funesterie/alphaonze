[CmdletBinding()]
param(
  [string]$Owner = $(if ($env:GITHUB_REPOSITORY_OWNER) { $env:GITHUB_REPOSITORY_OWNER } else { "Funesterie" }),
  [string]$Scope = "@funesterie",
  [string]$Registry = "https://npm.pkg.github.com",
  [string]$OutputPath = ".npmrc.github",
  [string]$TokenEnv = "NODE_AUTH_TOKEN"
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

$registryUri = [Uri]$Registry
$registryPath = $registryUri.AbsolutePath.TrimEnd("/")
$authTarget = $registryUri.Host
if ($registryPath) {
  $authTarget = "$authTarget$registryPath"
}

$outputDir = Split-Path -Parent $OutputPath
if ($outputDir -and -not (Test-Path -LiteralPath $outputDir)) {
  New-Item -ItemType Directory -Path $outputDir | Out-Null
}

$content = @(
  "${Scope}:registry=$Registry",
  "//$authTarget/:_authToken=`${$TokenEnv}"
)

Set-Content -LiteralPath $OutputPath -Value $content -Encoding utf8
Write-Host "Wrote $OutputPath for owner $Owner and scope $Scope."
Write-Host "No token was written; npm will read `${$TokenEnv} at publish/install time."
