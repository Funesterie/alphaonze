Set-StrictMode -Version Latest
$ErrorActionPreference = "Continue"

$EkkoRoot   = "D:\projets\funesterie\a11\backend\apps\ekko"
$EnvFile    = "D:\projets\funesterie\a11\backend\apps\server\.env.local"
$ConfigFile = Join-Path $EkkoRoot "ekko.config.prod.json"
$LogDir     = "D:\projets\funesterie\a11\logs\ekko"
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

# --- Vérifier que Python est dispo
$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) {
  Write-Host "[Ekko] Python introuvable — abandon."
  exit 1
}

Write-Host "[Ekko] Démarrage en arrière-plan..."
Write-Host "[Ekko] Config  : $ConfigFile"
Write-Host "[Ekko] Logs    : $LogOut"

$proc = Start-Process `
  -FilePath "python" `
  -ArgumentList "main.py", "--config", $ConfigFile `
  -WorkingDirectory $EkkoRoot `
  -RedirectStandardOutput $LogOut `
  -RedirectStandardError  $LogErr `
  -WindowStyle Hidden `
  -PassThru

if ($proc) {
  Write-Host "[Ekko] PID $($proc.Id) — serveur sur http://127.0.0.1:5012"
  # Sauvegarder le PID pour stop-ekko.ps1
  $proc.Id | Out-File (Join-Path $LogDir "ekko.pid") -Encoding utf8
} else {
  Write-Host "[Ekko] Échec du démarrage."
  exit 1
}
