[CmdletBinding()]
param(
  [string]$ProjectId = $(if ($env:GOOGLE_CLOUD_PROJECT) { $env:GOOGLE_CLOUD_PROJECT } else { "alphaonze" }),
  [string]$Location = $(if ($env:GAR_LOCATION) { $env:GAR_LOCATION } else { "europe-west4" }),
  [string]$Repository = $(if ($env:GAR_NPM_REPOSITORY) { $env:GAR_NPM_REPOSITORY } else { "funesterie-npm" }),
  [string[]]$Scopes = @("@funesterie", "@nossen"),
  [string]$OutputPath = ".npmrc.google"
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

$registry = "https://$Location-npm.pkg.dev/$ProjectId/$Repository/"
$content = New-Object System.Collections.Generic.List[string]

foreach ($scope in $Scopes) {
  if (-not [string]::IsNullOrWhiteSpace($scope)) {
    $content.Add("${scope}:registry=$registry")
  }
}
$content.Add("//$Location-npm.pkg.dev/$ProjectId/$Repository/:always-auth=true")

$outputDir = Split-Path -Parent $OutputPath
if ($outputDir -and -not (Test-Path -LiteralPath $outputDir)) {
  New-Item -ItemType Directory -Path $outputDir | Out-Null
}

Set-Content -LiteralPath $OutputPath -Value $content -Encoding utf8
Write-Host "Wrote $OutputPath for Artifact Registry npm repository $ProjectId/$Repository in $Location."
Write-Host "No token was written. Run scripts/google/Refresh-GoogleArtifactNpmAuth.ps1 before publishing or installing."
