#!/usr/bin/env pwsh
<#
.SYNOPSIS
    CERBÈRE WATCHDOG — Lance A11 avec protection automatique contre les crashes.
    "L'eau qui ranime Luffy contre Crocodile"

.DESCRIPTION
    Lance le backend A11 via le watchdog Node.js qui :
    - Relance automatiquement server.cjs si il crash
    - Sauvegarde la mémoire A11 toutes les 5 minutes
    - Vérifie la santé du serveur toutes les 30 secondes
    - Limite les relances (max 10, max 5 crashes/minute)

.PARAMETER NoPause
    Ne pas attendre une touche à la fin

.PARAMETER ShowWindow
    Afficher la fenêtre du processus

.PARAMETER Port
    Port du backend (défaut: 3000)

.EXAMPLE
    .\cerbere-watchdog.ps1
    .\cerbere-watchdog.ps1 -NoPause
    .\cerbere-watchdog.ps1 -Port 3001
#>

param(
    [switch]$NoPause,
    [switch]$ShowWindow,
    [int]$Port = 3000
)

$ErrorActionPreference = 'Stop'

# ─── Chemins ──────────────────────────────────────────────────────────────────

$ScriptDir = Split-Path -Parent $PSCommandPath
$RepoRoot = Split-Path -Parent $ScriptDir
$ServerDir = Join-Path $RepoRoot 'a11\backend\apps\server'
$WatchdogScript = Join-Path $ServerDir 'cerbere-watchdog.cjs'
$RuntimeDir = Join-Path $RepoRoot 'a11\runtime'
$LogsDir = Join-Path $RuntimeDir 'logs'
$WatchdogLog = Join-Path $LogsDir 'cerbere-watchdog.log'

# ─── Couleurs ─────────────────────────────────────────────────────────────────

function Write-Cerbere {
    param([string]$Message, [string]$Color = 'Cyan')
    Write-Host "[CERBÈRE] $Message" -ForegroundColor $Color
}

function Write-Revive {
    param([string]$Message)
    Write-Host "[💧 REVIVE] $Message" -ForegroundColor Magenta
}

# ─── Vérifications ────────────────────────────────────────────────────────────

Write-Cerbere '═══════════════════════════════════════════════════════' 'Cyan'
Write-Cerbere '  CERBÈRE WATCHDOG — Gardien d''A11' 'Cyan'
Write-Cerbere '  "L''eau qui ranime Luffy contre Crocodile"' 'Yellow'
Write-Cerbere '═══════════════════════════════════════════════════════' 'Cyan'

# Vérifier Node.js
$NodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $NodeCmd) {
    Write-Cerbere 'Node.js introuvable ! Installe Node.js >= 20.' 'Red'
    if (-not $NoPause) { Read-Host 'Appuie sur Entrée pour quitter' }
    exit 1
}

$NodeVersion = & node --version 2>&1
Write-Cerbere "Node.js: $NodeVersion" 'Green'

# Vérifier le script watchdog
if (-not (Test-Path $WatchdogScript)) {
    Write-Cerbere "Script watchdog introuvable: $WatchdogScript" 'Red'
    if (-not $NoPause) { Read-Host 'Appuie sur Entrée pour quitter' }
    exit 1
}

# Vérifier server.cjs
$ServerScript = Join-Path $ServerDir 'server.cjs'
if (-not (Test-Path $ServerScript)) {
    Write-Cerbere "server.cjs introuvable: $ServerScript" 'Red'
    if (-not $NoPause) { Read-Host 'Appuie sur Entrée pour quitter' }
    exit 1
}

# Créer les dossiers
New-Item -ItemType Directory -Force -Path $LogsDir | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $RuntimeDir 'watchdog-snapshots') | Out-Null

Write-Cerbere "Server dir : $ServerDir" 'Gray'
Write-Cerbere "Watchdog   : $WatchdogScript" 'Gray'
Write-Cerbere "Logs       : $WatchdogLog" 'Gray'
Write-Cerbere "Port       : $Port" 'Gray'

# ─── Variables d'environnement ────────────────────────────────────────────────

$env:PORT = $Port
$env:A11_RUNTIME_ROOT = $RuntimeDir

# ─── Lancement ────────────────────────────────────────────────────────────────

Write-Cerbere '' 'White'
Write-Revive 'Cerbère prend position... A11 est sous protection.'
Write-Cerbere 'Ctrl+C pour arrêter proprement.' 'Yellow'
Write-Cerbere '' 'White'

try {
    # Lancer le watchdog directement (bloquant)
    Push-Location $ServerDir
    try {
        & node $WatchdogScript
        $ExitCode = $LASTEXITCODE
    }
    finally {
        Pop-Location
    }

    if ($ExitCode -ne 0) {
        Write-Cerbere "Watchdog terminé avec code $ExitCode" 'Red'
    }
    else {
        Write-Cerbere 'Watchdog arrêté proprement.' 'Green'
    }
}
catch {
    Write-Cerbere "Erreur fatale: $($_.Exception.Message)" 'Red'
    if (-not $NoPause) { Read-Host 'Appuie sur Entrée pour quitter' }
    exit 1
}

if (-not $NoPause) {
    Read-Host 'Appuie sur Entrée pour quitter'
}
