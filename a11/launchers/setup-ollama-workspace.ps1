# setup-ollama-workspace.ps1
# Configure le workspace Ollama pour A11
# Crée un lien symbolique depuis %USERPROFILE%\.ollama\models vers a11/runtime/ollama_models

param(
    [string]$CustomPath = "D:\projets\funesterie\a11\runtime\ollama_models",
    [switch]$Force
)

$ErrorActionPreference = "Stop"

Write-Host "=== Configuration du Workspace Ollama pour A11 ===" -ForegroundColor Cyan
Write-Host ""

# Vérifier les permissions admin
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "ERREUR: Ce script nécessite des permissions administrateur." -ForegroundColor Red
    Write-Host "Relancez PowerShell en tant qu'administrateur et réessayez." -ForegroundColor Yellow
    exit 1
}

$DefaultPath = "$env:USERPROFILE\.ollama\models"

Write-Host "Chemin par défaut Ollama : $DefaultPath" -ForegroundColor Gray
Write-Host "Chemin personnalisé A11   : $CustomPath" -ForegroundColor Gray
Write-Host ""

# 1. Arrêter Ollama
Write-Host "[1/6] Arrêt d'Ollama..." -ForegroundColor Yellow
try {
    $ollamaProcesses = Get-Process -Name ollama -ErrorAction SilentlyContinue
    if ($ollamaProcesses) {
        Stop-Process -Name ollama -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 2
        Write-Host "  ✓ Ollama arrêté" -ForegroundColor Green
    }
    else {
        Write-Host "  ✓ Ollama n'était pas en cours d'exécution" -ForegroundColor Green
    }
}
catch {
    Write-Host "  ⚠ Impossible d'arrêter Ollama : $_" -ForegroundColor Yellow
}

# 2. Créer le répertoire de destination
Write-Host "[2/6] Création du répertoire personnalisé..." -ForegroundColor Yellow
try {
    if (-not (Test-Path $CustomPath)) {
        New-Item -ItemType Directory -Path $CustomPath -Force | Out-Null
        Write-Host "  ✓ Répertoire créé : $CustomPath" -ForegroundColor Green
    }
    else {
        Write-Host "  ✓ Répertoire existe déjà : $CustomPath" -ForegroundColor Green
    }
}
catch {
    Write-Host "  ✗ Erreur lors de la création du répertoire : $_" -ForegroundColor Red
    exit 1
}

# 3. Déplacer les modèles existants
Write-Host "[3/6] Déplacement des modèles existants..." -ForegroundColor Yellow
$movedFiles = 0
if (Test-Path $DefaultPath) {
    try {
        # Vérifier si c'est déjà un lien symbolique
        $item = Get-Item $DefaultPath -Force
        if ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
            Write-Host "  ✓ Le chemin est déjà un lien symbolique" -ForegroundColor Green
            
            # Vérifier si le lien pointe vers le bon endroit
            $target = $item.Target
            if ($target -eq $CustomPath) {
                Write-Host "  ✓ Le lien symbolique pointe déjà vers $CustomPath" -ForegroundColor Green
                if (-not $Force) {
                    Write-Host ""
                    Write-Host "Configuration déjà en place. Utilisez -Force pour recréer." -ForegroundColor Yellow
                    exit 0
                }
            }
            else {
                Write-Host "  ⚠ Le lien symbolique pointe vers $target" -ForegroundColor Yellow
                Write-Host "  → Suppression du lien existant..." -ForegroundColor Yellow
                Remove-Item -Path $DefaultPath -Force
            }
        }
        else {
            # C'est un répertoire normal, déplacer les fichiers
            $files = Get-ChildItem -Path $DefaultPath -Recurse -File
            if ($files.Count -gt 0) {
                Write-Host "  → Déplacement de $($files.Count) fichiers..." -ForegroundColor Yellow
                Copy-Item -Path "$DefaultPath\*" -Destination $CustomPath -Recurse -Force
                $movedFiles = $files.Count
                Write-Host "  ✓ $movedFiles fichiers déplacés" -ForegroundColor Green
            }
            else {
                Write-Host "  ✓ Aucun fichier à déplacer" -ForegroundColor Green
            }
            
            # Supprimer le répertoire par défaut
            Remove-Item -Path $DefaultPath -Recurse -Force
            Write-Host "  ✓ Répertoire par défaut supprimé" -ForegroundColor Green
        }
    }
    catch {
        Write-Host "  ✗ Erreur lors du déplacement : $_" -ForegroundColor Red
        exit 1
    }
}
else {
    Write-Host "  ✓ Aucun répertoire par défaut à déplacer" -ForegroundColor Green
}

# 4. Créer le lien symbolique
Write-Host "[4/6] Création du lien symbolique..." -ForegroundColor Yellow
try {
    if (Test-Path $DefaultPath) {
        Remove-Item -Path $DefaultPath -Force
    }
    
    New-Item -ItemType SymbolicLink -Path $DefaultPath -Target $CustomPath -Force | Out-Null
    Write-Host "  ✓ Lien symbolique créé" -ForegroundColor Green
    Write-Host "    $DefaultPath → $CustomPath" -ForegroundColor Gray
}
catch {
    Write-Host "  ✗ Erreur lors de la création du lien symbolique : $_" -ForegroundColor Red
    exit 1
}

# 5. Vérifier le lien symbolique
Write-Host "[5/6] Vérification du lien symbolique..." -ForegroundColor Yellow
try {
    $item = Get-Item $DefaultPath -Force
    if ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
        $target = $item.Target
        if ($target -eq $CustomPath) {
            Write-Host "  ✓ Lien symbolique valide" -ForegroundColor Green
        }
        else {
            Write-Host "  ✗ Le lien pointe vers $target au lieu de $CustomPath" -ForegroundColor Red
            exit 1
        }
    }
    else {
        Write-Host "  ✗ Le chemin n'est pas un lien symbolique" -ForegroundColor Red
        exit 1
    }
}
catch {
    Write-Host "  ✗ Erreur lors de la vérification : $_" -ForegroundColor Red
    exit 1
}

# 6. Redémarrer Ollama
Write-Host "[6/6] Redémarrage d'Ollama..." -ForegroundColor Yellow
try {
    Start-Process -FilePath "ollama" -ArgumentList "serve" -WindowStyle Hidden
    Start-Sleep -Seconds 3
    
    # Vérifier qu'Ollama répond
    try {
        $response = Invoke-WebRequest -Uri "http://127.0.0.1:11434/api/tags" -Method GET -TimeoutSec 5 -ErrorAction Stop
        if ($response.StatusCode -eq 200) {
            Write-Host "  ✓ Ollama démarré et répond" -ForegroundColor Green
        }
        else {
            Write-Host "  ⚠ Ollama démarré mais ne répond pas correctement" -ForegroundColor Yellow
        }
    }
    catch {
        Write-Host "  ⚠ Ollama démarré mais ne répond pas encore (attendez quelques secondes)" -ForegroundColor Yellow
    }
}
catch {
    Write-Host "  ✗ Erreur lors du démarrage d'Ollama : $_" -ForegroundColor Red
    Write-Host "  → Démarrez Ollama manuellement : ollama serve" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "=== Configuration terminée ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "Résumé :" -ForegroundColor White
Write-Host "  • Workspace Ollama : $CustomPath" -ForegroundColor Gray
Write-Host "  • Lien symbolique  : $DefaultPath → $CustomPath" -ForegroundColor Gray
if ($movedFiles -gt 0) {
    Write-Host "  • Fichiers déplacés : $movedFiles" -ForegroundColor Gray
}
Write-Host ""
Write-Host "Prochaines étapes :" -ForegroundColor White
Write-Host "  1. Vérifier qu'Ollama fonctionne : curl http://127.0.0.1:11434/api/tags" -ForegroundColor Gray
Write-Host "  2. Télécharger les modèles si nécessaire : ollama pull gemma4:e4b" -ForegroundColor Gray
Write-Host "  3. Démarrer le backend A11 : cd a11/backend/apps/server && node server.cjs" -ForegroundColor Gray
Write-Host ""
Write-Host "Documentation : a11/docs/OLLAMA_WORKSPACE.md" -ForegroundColor Cyan
