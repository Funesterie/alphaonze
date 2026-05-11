[CmdletBinding()]
param(
  [string]$Registry = $env:JFROG_NPM_REGISTRY,
  [string]$Scope = $(if ($env:JFROG_NPM_SCOPE) { $env:JFROG_NPM_SCOPE } else { "@funeste38" }),
  [string]$OutputPath = (Join-Path (Get-Location) ".npmrc.jfrog"),
  [switch]$Force
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($Registry)) {
  throw "JFROG_NPM_REGISTRY is required, for example https://<tenant>.jfrog.io/artifactory/api/npm/funesterie-npm/"
}

if ($Scope -notmatch "^@") {
  $Scope = "@$Scope"
}

$Registry = $Registry.Trim()
if (-not $Registry.EndsWith("/")) {
  $Registry = "$Registry/"
}

$uri = [Uri]$Registry
if ($uri.Scheme -notin @("http", "https")) {
  throw "Registry must be an http(s) URL."
}

if ((Test-Path -LiteralPath $OutputPath) -and -not $Force) {
  throw "$OutputPath already exists. Use -Force to overwrite."
}

$authTarget = ($uri.Host + $uri.AbsolutePath).TrimEnd("/")
$lines = @(
  "registry=https://registry.npmjs.org/",
  "$($Scope):registry=$Registry",
  "//$authTarget/:_authToken=`${JFROG_NPM_AUTH_TOKEN}"
)

Set-Content -LiteralPath $OutputPath -Value ($lines -join [Environment]::NewLine) -Encoding UTF8
Write-Host "Wrote npm config to $OutputPath"
Write-Host "Token value is not written; npm will read JFROG_NPM_AUTH_TOKEN from the environment."
