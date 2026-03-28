param(
  [switch]$Relaunch
)

$ErrorActionPreference = "Stop"

$installedExe = "C:\Users\cella\AppData\Local\A11 Local\a11_local_desktop.exe"
$launcherConfig = "C:\Users\cella\AppData\Local\pro.funesterie.a11.desktop\a11-local\launcher\config\a11-local.env"
$launcherScript = "C:\Users\cella\AppData\Local\pro.funesterie.a11.desktop\a11-local\launcher\a11-local.ps1"

Write-Host "[A11 RESET] Arret du shell desktop..."
Get-Process a11_local_desktop -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Milliseconds 500

if (Test-Path $launcherScript) {
  Write-Host "[A11 RESET] Arret best effort de la stack..."
  try {
    powershell -NoProfile -ExecutionPolicy Bypass -File $launcherScript stop -ConfigPath $launcherConfig -NoPause | Out-Host
  } catch {
    Write-Warn "[A11 RESET] Stop launcher: $($_.Exception.Message)"
  }
}

if (-not (Test-Path $launcherConfig)) {
  throw "Config launcher introuvable: $launcherConfig"
}

Write-Host "[A11 RESET] Retour au mode local..."
$updated = (Get-Content $launcherConfig) `
  -replace '^A11_CHAT_PROVIDER_MODE=.*$', 'A11_CHAT_PROVIDER_MODE=local' `
  -replace '^A11_REMOTE_PROVIDER_ID=.*$', 'A11_REMOTE_PROVIDER_ID=' `
  -replace '^OPENAI_BASE_URL=.*$', 'OPENAI_BASE_URL=' `
  -replace '^OPENAI_API_KEY=.*$', 'OPENAI_API_KEY=' `
  -replace '^OPENAI_MODEL=.*$', 'OPENAI_MODEL=' `
  -replace '^A11_ENABLE_LLM=.*$', 'A11_ENABLE_LLM=1' `
  -replace '^A11_ENABLE_QFLUSH=.*$', 'A11_ENABLE_QFLUSH=1' `
  -replace '^A11_INSTALLER_LITE=.*$', 'A11_INSTALLER_LITE=1'
$updated | Set-Content -Path $launcherConfig -Encoding UTF8

Write-Host "[A11 RESET] Configuration nettoyee."

if ($Relaunch) {
  if (-not (Test-Path $installedExe)) {
    throw "Executable introuvable: $installedExe"
  }
  Write-Host "[A11 RESET] Relance de A11..."
  Start-Process -FilePath $installedExe | Out-Null
}

Write-Host "[A11 RESET] Termine."
