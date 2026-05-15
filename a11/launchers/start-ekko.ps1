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

# --- Résoudre le chemin complet de python
# NOTE : Start-Process NE cherche pas dans PATH comme le shell.
# On résout le chemin source via Get-Command pour éviter ce piège.
$pythonCmd = Get-Command python -ErrorAction SilentlyContinue
if (-not $pythonCmd) {
  $pythonCmd = Get-Command python3 -ErrorAction SilentlyContinue
}
if (-not $pythonCmd) {
  Write-Host "[Ekko] Python introuvable dans le PATH — abandon."
  exit 1
}
$pythonExe = $pythonCmd.Source

Write-Host "[Ekko] Python    : $pythonExe"
Write-Host "[Ekko] Config    : $ConfigFile"
Write-Host "[Ekko] Logs      : $LogOut"
Write-Host "[Ekko] Demarrage en arriere-plan..."

# IMPORTANT : ne pas utiliser -WindowStyle Hidden avec -RedirectStandard* en meme temps.
# C'est un bug PowerShell 5.1/Windows : Start-Process retourne null silencieusement.
# La sortie est de toute facon redirigee vers des fichiers, pas de fenetre apparaitra.
$proc = $null
try {
  $proc = Start-Process `
    -FilePath      $pythonExe `
    -ArgumentList  "main.py", "--config", $ConfigFile `
    -WorkingDirectory $EkkoRoot `
    -RedirectStandardOutput $LogOut `
    -RedirectStandardError  $LogErr `
    -PassThru
} catch {
  Write-Host "[Ekko] Erreur Start-Process : $_"
  Write-Host "[Ekko] Lance manuellement : cd $EkkoRoot && python main.py --config $ConfigFile"
  exit 1
}

if (-not $proc) {
  Write-Host "[Ekko] Start-Process a retourne null — Python inaccessible."
  Write-Host "[Ekko] Lance manuellement : cd $EkkoRoot && python main.py --config $ConfigFile"
  exit 1
}

# Attendre 1 s pour detecter un crash immediat
Start-Sleep -Milliseconds 1200
if ($proc.HasExited) {
  Write-Host "[Ekko] Le processus s'est arrete immediatement (exit code $($proc.ExitCode))."
  if (Test-Path $LogErr) {
    Write-Host "[Ekko] --- stderr ---"
    Get-Content $LogErr -ErrorAction SilentlyContinue | Select-Object -First 40 | ForEach-Object { Write-Host $_ }
    Write-Host "[Ekko] ---"
  }
  exit 1
}

Write-Host "[Ekko] OK — PID $($proc.Id) sur http://127.0.0.1:5012"
$proc.Id | Out-File $PidFile -Encoding utf8 -NoNewline
