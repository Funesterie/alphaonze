#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Installe (ou desinstalle) A11 en demarrage automatique via le dossier Startup Windows.
    Methode simple : raccourci dans shell:startup, pas de Task Scheduler.

.PARAMETER Uninstall
    Supprime le raccourci de demarrage automatique.

.EXAMPLE
    pwsh -File install-autostart.ps1
    pwsh -File install-autostart.ps1 -Uninstall
#>
param(
    [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'
$LauncherRoot = Split-Path -Parent $PSCommandPath
$StartupFolder = [Environment]::GetFolderPath('Startup')
$StartBat = Join-Path $LauncherRoot 'a11-mcp-start.bat'
$ShortcutPath = Join-Path $StartupFolder 'A11-MCP-Autostart.lnk'

function Write-Info { param([string]$m) Write-Host "[A11 Autostart] $m" }
function Write-OK { param([string]$m) Write-Host "[OK] $m" -ForegroundColor Green }
function Write-Warn { param([string]$m) Write-Host "[WARN] $m" -ForegroundColor Yellow }

# --- Desinstallation ---
if ($Uninstall) {
    if (Test-Path $ShortcutPath) {
        Remove-Item $ShortcutPath -Force
        Write-OK "Raccourci de demarrage supprime : $ShortcutPath"
    }
    else {
        Write-Warn "Aucun raccourci trouve dans Startup."
    }
    exit 0
}

# --- Verification ---
if (-not (Test-Path $StartBat)) {
    Write-Error "Fichier de demarrage introuvable : $StartBat"
    exit 1
}

# --- Copie du .bat dans le dossier Startup ---
# On copie directement le .bat — pas de WScript.Shell, pas de COM, pas de scheduler
$destBat = Join-Path $StartupFolder 'A11-MCP-Autostart.bat'
Copy-Item -Path $StartBat -Destination $destBat -Force

Write-OK "A11 ajouté au demarrage automatique : $destBat"
Write-Info "Le backend A11 demarrera au prochain login Windows."
Write-Info ""
Write-Info "Pour desinstaller : supprimer $destBat"
Write-Info "Ou relancer : pwsh -File install-autostart.ps1 -Uninstall"
