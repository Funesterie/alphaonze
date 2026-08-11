# publish-nossen-packages.ps1 - publish @nossen/cf, @nossen/hetzner, @nossen/zen-gate to the JFrog @nossen registry.
# Run from anywhere:  powershell -ExecutionPolicy Bypass -File D:\projets\funesterie\scripts\publish-nossen-packages.ps1
. "$PSScriptRoot\jfrog\jfrog.env.ps1"   # sets $env:JFROG_NPM_AUTH_TOKEN
$reg = "https://trialhnuk69.jfrog.io/artifactory/api/npm/funesterie-npm/"
$authLine = "//trialhnuk69.jfrog.io/artifactory/api/npm/funesterie-npm/:_authToken=`${JFROG_NPM_AUTH_TOKEN}"
foreach ($p in @("cf","hetzner","zen-gate")) {
  $dir = "D:\projets\funesterie\packages\nossen\$p"
  if (-not (Test-Path "$dir\package.json")) { Write-Host "skip $p (no package.json)"; continue }
  $npmrc = "$dir\.npmrc"
  "@nossen:registry=$reg`r`n$authLine`r`n" | Set-Content -Path $npmrc -Encoding utf8
  Write-Host "=== npm publish @nossen/$p ===" -ForegroundColor Cyan
  Push-Location $dir
  try { npm publish --registry $reg --access public } catch { Write-Host "  err: $_" }
  Pop-Location
  Remove-Item $npmrc -Force -EA SilentlyContinue
}
Write-Host "done. (if a version already exists, bump the version in that package.json and re-run)"
