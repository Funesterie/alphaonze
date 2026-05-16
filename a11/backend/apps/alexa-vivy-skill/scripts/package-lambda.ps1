$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$dist = Join-Path $root "dist"
$zip = Join-Path $dist "alexa-vivy-skill-lambda.zip"
$staging = Join-Path $dist "lambda-package"

if (!(Test-Path (Join-Path $root "node_modules"))) {
  throw "node_modules missing. Run npm install first."
}

if (Test-Path $staging) {
  Remove-Item -LiteralPath $staging -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $staging | Out-Null

Copy-Item -Path (Join-Path $root "src") -Destination $staging -Recurse
Copy-Item -Path (Join-Path $root "models") -Destination $staging -Recurse
Copy-Item -Path (Join-Path $root "node_modules") -Destination $staging -Recurse
Copy-Item -Path (Join-Path $root "package.json") -Destination $staging
Copy-Item -Path (Join-Path $root "README.md") -Destination $staging

if (Test-Path $zip) {
  Remove-Item -LiteralPath $zip -Force
}

Compress-Archive -Path (Join-Path $staging "*") -DestinationPath $zip -Force
Write-Host "Created $zip"
