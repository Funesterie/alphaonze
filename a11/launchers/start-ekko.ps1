Set-StrictMode -Version Latest
$ErrorActionPreference = "Continue"

$EkkoRoot   = "D:\projets\funesterie\a11\backend\apps\ekko"
$EnvFile    = "D:\projets\funesterie\a11\backend\apps\server\.env.local"
$ConfigFile = Join-Path $EkkoRoot "ekko.config.prod.json"
$LogDir     = "D:\projets\funesterie\a11\logs\ekko"
$PidFile    = Join-Path $LogDir "ekko.pid"
$Stamp      = Get-Date -Format "yyyyMMdd-HHmmss"
$LogOut     = Join-Path $LogDir "ekko-$Stamp.out.log"
$LogErr     = Join-Path $LogDir "ekko-$Stamp.err.log"

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

# --- Charger les vars d'env depuis .env.local (EKKO_TOKEN notamment)
if (Test-Path $EnvFile) {
  Get-Content $EnvFile | ForEach-Object {
    if ($_ -match '^\s*([A-Z0-9_]+)\s*=\s*(.+)\s*$' -and $_ -notmatch '^\s*#') {
      $name  = $Matches[1]
      $value = $Matches[2].Trim('"').Trim("'")
      [System.Environment]::SetEnvironmentVariable($name, $value, "Process")
    }
  }
}

# --- Resoudre le chemin complet de python
# Start-Process ne cherche pas dans PATH comme le shell.
# On resout le chemin source via Get-Command.
$pythonCmd = Get-Command python -ErrorAction SilentlyContinue
if (-not $pythonCmd) {
  $pythonCmd = Get-Command python3 -ErrorAction SilentlyContinue
}
if (-not $pythonCmd) {
  Write-Host "[Ekko] Python introuvable dans le PATH - abandon."
  exit 1
}
$pythonExe = $pythonCmd.Source

Write-Host "[Ekko] Python : $pythonExe"
Write-Host "[Ekko] Config : $ConfigFile"
Write-Host "[Ekko] Logs   : $LogOut"
Write-Host "[Ekko] Lancement..."

# NOTE: ne pas combiner -WindowStyle Hidden avec -PassThru + -RedirectStandard*
# (bug PS 5.1 - retourne null). Sans -PassThru, on lit le PID via Get-CimInstance.
Start-Process `
  -FilePath      $pythonExe `
  -ArgumentList  @("main.py", "--config", $ConfigFile) `
  -WorkingDirectory $EkkoRoot `
  -RedirectStandardOutput $LogOut `
  -RedirectStandardError  $LogErr `
  -WindowStyle Hidden

Start-Sleep -Milliseconds 1500

# Trouver le PID du processus via la ligne de commande
$ekkoProc = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -and $_.CommandLine -match "ekko\.config" } |
  Select-Object -First 1

if ($ekkoProc) {
  Write-Host "[Ekko] OK - PID $($ekkoProc.ProcessId) sur http://127.0.0.1:5012"
  $ekkoProc.ProcessId | Out-File $PidFile -Encoding utf8 -NoNewline
} else {
  Write-Host "[Ekko] Processus non detecte apres 1.5s - voir logs: $LogErr"
  if (Test-Path $LogErr) {
    Get-Content $LogErr -ErrorAction SilentlyContinue | Select-Object -First 30 | ForEach-Object { Write-Host "  $_" }
  }
}
