param(
  [string]$ServerId = "funesterie",
  [string]$Url = "https://trialhnuk69.jfrog.io/",
  [string]$JfPath = "jf",
  [string]$AccessToken = $env:JFROG_ACCESS_TOKEN,
  [string]$User = $env:JFROG_USER,
  [string]$Password = $env:JFROG_PASSWORD,
  [switch]$Overwrite
)

$ErrorActionPreference = "Stop"

function Resolve-JfPath {
  param([string]$Candidate)

  if ($Candidate -and (Get-Command $Candidate -ErrorAction SilentlyContinue)) {
    return (Get-Command $Candidate).Source
  }

  $fallback = Join-Path $env:USERPROFILE "bin\jf.exe"
  if (Test-Path -LiteralPath $fallback) {
    return $fallback
  }

  throw "JFrog CLI not found. Install jf.exe or pass -JfPath."
}

$jf = Resolve-JfPath $JfPath
$args = @(
  "c", "add", $ServerId,
  "--url", $Url,
  "--interactive=false"
)

if ($Overwrite) {
  $args += "--overwrite=true"
}

if ($AccessToken) {
  Write-Host "Configuring JFrog CLI server '$ServerId' with access token from environment."
  $AccessToken | & $jf @args --access-token-stdin
} elseif ($User -and $Password) {
  Write-Host "Configuring JFrog CLI server '$ServerId' with username/password from environment."
  $args += @("--user", $User)
  $Password | & $jf @args --password-stdin
} else {
  throw @"
Missing credentials.

Set one of:
  `$env:JFROG_ACCESS_TOKEN = '<identity-or-access-token>'

or:
  `$env:JFROG_USER = '<username>'
  `$env:JFROG_PASSWORD = '<password-or-api-key>'

Then run:
  .\scripts\jfrog\Configure-JFrogCli.ps1 -Overwrite

Do not use frog.txt here: it contains Artifactory/Xray license blocks, not a login password.
"@
}

& $jf rt ping --server-id $ServerId
if ($LASTEXITCODE -ne 0) {
  throw "JFrog CLI ping failed for server '$ServerId'. The token may still work with direct Artifactory REST, but the CLI config is not usable."
}

Write-Host "Verifying authenticated Artifactory API access..."
& $jf rt curl "/api/system/version" --server-id $ServerId | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw "JFrog CLI authenticated API check failed for server '$ServerId'."
}
Write-Host "Authenticated Artifactory API access OK."
