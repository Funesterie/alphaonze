# publish-nossen-npm.ps1 - publish @nossen/cf, @nossen/hetzner, @nossen/zen-gate to public npm (registry.npmjs.org).
$tok = (Get-Content -LiteralPath "C:\Users\cella\OneDrive\Bureau\claude api npm.txt" -Raw).Trim()
$env:NPM_TOKEN = $tok
$reg = "https://registry.npmjs.org/"
foreach ($p in @("all-in-one")) {
  $dir = "D:\projets\funesterie\packages\nossen\$p"
  if (-not (Test-Path "$dir\package.json")) { continue }
  $npmrc = "$dir\.npmrc"
  "registry=$reg`r`n//registry.npmjs.org/:_authToken=`${NPM_TOKEN}`r`n" | Set-Content -Path $npmrc -Encoding utf8
  Write-Host "=== npm publish @nossen/$p -> public npm ===" -ForegroundColor Cyan
  Push-Location $dir
  try { npm publish --registry $reg --access public 2>&1 | Select-Object -Last 8 } catch { Write-Host "  err: $_" }
  Pop-Location
  Remove-Item $npmrc -Force -EA SilentlyContinue
}
Write-Host "done."
