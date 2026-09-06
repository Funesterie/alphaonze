# fix-ue-remotecontrol-deps.ps1  (v2 - corrected stderr handling)
# Fixes Unreal "Failed To Install dependencies" (RemoteControlWebInterface WebApp npm install).
# OPTIONAL: only if you re-enable the RemoteControlWebInterface plugin.
# Run AS ADMINISTRATOR: powershell -ExecutionPolicy Bypass -File D:\projets\funesterie\scripts\fix-ue-remotecontrol-deps.ps1

$webapp = 'C:\Program Files\Epic Games\UE_5.8\Engine\Plugins\VirtualProduction\RemoteControlWebInterface\WebApp'
$node   = Join-Path $webapp 'Node-v16.17.0\node.exe'
$npmCli = Join-Path $webapp 'Node-v16.17.0\node_modules\npm\bin\npm-cli.js'

if (-not (Test-Path $webapp)) { Write-Host "WebApp not found: $webapp" -ForegroundColor Red; exit 1 }
if (-not (Test-Path $node))   { Write-Host "Bundled node not found: $node" -ForegroundColor Red; exit 1 }
if (-not (Test-Path $npmCli)) { Write-Host "npm-cli.js not found: $npmCli" -ForegroundColor Red; exit 1 }

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)
if (-not $admin) { Write-Host "WARNING: not Admin - npm install will likely fail to write node_modules under Program Files." -ForegroundColor Yellow }

# 1) Clear read-only on package files (Epic's FixNpmInstall.bat does this)
Write-Host "1) clearing read-only on package files..." -ForegroundColor Cyan
foreach ($f in 'package.json','package-lock.json','Server\package.json','Server\package-lock.json','Client\package.json','Client\package-lock.json') {
  $p = Join-Path $webapp $f
  if (Test-Path $p) { (Get-Item $p -Force).IsReadOnly = $false; "   $f -> ReadOnly=$false" }
}

# 2) npm install with bundled Node v16. Do NOT let npm's stderr warnings stop the script.
Write-Host "2) running npm install with bundled Node v16 (this also installs Client/Server)..." -ForegroundColor Cyan
$ErrorActionPreference = 'Continue'   # <-- key fix: npm writes WARN/progress to stderr
Push-Location $webapp
try {
  $log = & $node $npmCli install --no-audit --no-fund 2>&1
  $code = $LASTEXITCODE
} finally { Pop-Location }
$log | ForEach-Object { "   $_" }
Write-Host ""
Write-Host ("npm exit code: {0}" -f $code) -ForegroundColor $(if($code -eq 0){'Green'}else{'Yellow'})
# Did Client/Server get their node_modules?
$okC = Test-Path (Join-Path $webapp 'Client\node_modules')
$okS = Test-Path (Join-Path $webapp 'Server\node_modules')
Write-Host ("Client\node_modules: {0}    Server\node_modules: {1}" -f $okC, $okS) -ForegroundColor $(if($okC -and $okS){'Green'}else{'Yellow'})
if ($okC -and $okS) { Write-Host "DONE. Restart the Unreal editor -> 'Failed To Install dependencies' should be gone." -ForegroundColor Green }
else { Write-Host "node_modules still missing. Re-run as Admin; if it still fails, keep the plugin disabled (Option 1)." -ForegroundColor Yellow }