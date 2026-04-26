#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Installe (ou désinstalle) A11 en démarrage automatique via le Task Scheduler Windows.
    Lance start-local-a11.ps1 au login de l'utilisateur courant.

.PARAMETER Uninstall
    Supprime la tâche planifiée au lieu de la créer.

.EXAMPLE
    pwsh -File install-autostart.ps1
    pwsh -File install-autostart.ps1 -Uninstall
#>
param(
    [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'
$TaskName = 'A11-LocalBackend'
$LauncherRoot = Split-Path -Parent $PSCommandPath
$StartScript = Join-Path $LauncherRoot 'start-local-a11.ps1'

function Write-Info { param([string]$m) Write-Host "[A11 Autostart] $m" }
function Write-OK { param([string]$m) Write-Host "[OK] $m" -ForegroundColor Green }
function Write-Warn { param([string]$m) Write-Host "[WARN] $m" -ForegroundColor Yellow }

# --- Désinstallation ---
if ($Uninstall) {
    if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
        Write-OK "Tâche '$TaskName' supprimée."
    }
    else {
        Write-Warn "Tâche '$TaskName' introuvable — rien à faire."
    }
    exit 0
}

# --- Vérifications ---
if (-not (Test-Path $StartScript)) {
    Write-Error "Script de démarrage introuvable : $StartScript"
    exit 1
}

$pwsh = (Get-Command pwsh -ErrorAction SilentlyContinue)?.Source
if (-not $pwsh) {
    $pwsh = (Get-Command powershell -ErrorAction SilentlyContinue)?.Source
}
if (-not $pwsh) {
    Write-Error "PowerShell introuvable."
    exit 1
}

Write-Info "PowerShell : $pwsh"
Write-Info "Script     : $StartScript"

# --- Création de la tâche ---
# Action : lancer start-local-a11.ps1 en fenêtre minimisée
$action = New-ScheduledTaskAction `
    -Execute $pwsh `
    -Argument "-WindowStyle Minimized -NonInteractive -File `"$StartScript`" -NoPause" `
    -WorkingDirectory $LauncherRoot

# Déclencheur : au login de l'utilisateur courant
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME

# Paramètres : délai de 10s après login pour laisser le bureau charger
$settings = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit (New-TimeSpan -Hours 0) `
    -MultipleInstances IgnoreNew `
    -StartWhenAvailable `
    -DontStopIfGoingOnBatteries `
    -AllowStartIfOnBatteries

# Délai de démarrage de 10 secondes
$trigger.Delay = 'PT10S'

# Supprimer l'ancienne tâche si elle existe
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Write-Warn "Tâche existante '$TaskName' — remplacement."
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Description "Démarre le backend A11 local (Ollama + Express) au login." `
    -RunLevel Limited | Out-Null

Write-OK "Tâche '$TaskName' installée."
Write-Info "A11 démarrera automatiquement au prochain login."
Write-Info ""
Write-Info "Pour désinstaller : pwsh -File install-autostart.ps1 -Uninstall"
Write-Info "Pour voir la tâche : taskschd.msc"
