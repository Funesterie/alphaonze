# Nettoyage des Répertoires Runtime - A11

## Situation Identifiée

Deux répertoires `runtime` existent dans le projet :

1. **`D:\projets\funesterie\runtime`** (ANCIEN - À SUPPRIMER)
   - Dernière modification : 26/04/2026 11:26
   - Contenu : 9 fichiers générés (anciens)
   - Utilisé par : Ancienne configuration (obsolète)

2. **`D:\projets\funesterie\a11\runtime`** (ACTIF - À CONSERVER) ✅
   - Dernière modification : 26/04/2026 18:40
   - Contenu : 20 fichiers générés (récents)
   - Utilisé par : Configuration actuelle (`.env.local`)

## Configuration Actuelle

**Fichier** : `a11/backend/apps/server/.env.local`

```bash
A11_WORKSPACE_ROOT=D:\projets\funesterie\a11
A11_RUNTIME_ROOT=D:\projets\funesterie\a11\runtime
A11_SAFE_DATA_ROOT=D:\projets\funesterie\a11\runtime\files
```

## Contenu des Répertoires

### Ancien Runtime (À SUPPRIMER)

```
D:\projets\funesterie\runtime\
├── auth/                    (vide)
├── files/
│   ├── generated/          (9 fichiers anciens)
│   └── uploads/            (à vérifier)
└── launcher/
    ├── desktop-browser-profile/
    ├── funesterie-all/
    ├── logs/
    ├── a11-local.snapshot.json
    └── a11-local.state.json
```

### Nouveau Runtime (ACTIF) ✅

```
D:\projets\funesterie\a11\runtime\
├── auth/
│   └── local-users.json    (utilisateurs locaux)
├── cache/
│   └── async-image-jobs.json
├── files/
│   ├── generated/          (20 fichiers récents)
│   └── uploads/
└── vector-memory/          (mémoire vectorielle RAG)
```

## Plan de Nettoyage

### Étape 1 : Sauvegarder (Optionnel)

Si vous voulez conserver une copie de l'ancien runtime :

```powershell
# Créer une archive de sauvegarde
Compress-Archive -Path "D:\projets\funesterie\runtime" -DestinationPath "D:\projets\funesterie\runtime_backup_$(Get-Date -Format 'yyyyMMdd_HHmmss').zip"
```

### Étape 2 : Vérifier les Fichiers Launcher

Les fichiers `a11-local.snapshot.json` et `a11-local.state.json` dans l'ancien runtime contiennent des références obsolètes. Vérifier s'ils sont encore utilisés :

```powershell
# Chercher les références dans le code
Select-String -Path "D:\projets\funesterie\a11\launchers\*.ps1" -Pattern "a11-local.snapshot.json"
```

**Résultat attendu** : Ces fichiers sont probablement générés dynamiquement et peuvent être supprimés.

### Étape 3 : Migrer les Fichiers Launcher (Si Nécessaire)

Si les fichiers launcher sont encore utilisés, les déplacer vers le nouveau runtime :

```powershell
# Créer le répertoire launcher dans le nouveau runtime
New-Item -ItemType Directory -Path "D:\projets\funesterie\a11\runtime\launcher" -Force

# Copier les fichiers launcher
Copy-Item -Path "D:\projets\funesterie\runtime\launcher\*" -Destination "D:\projets\funesterie\a11\runtime\launcher\" -Recurse -Force
```

### Étape 4 : Supprimer l'Ancien Runtime

```powershell
# Supprimer l'ancien runtime
Remove-Item -Path "D:\projets\funesterie\runtime" -Recurse -Force
```

### Étape 5 : Vérifier

```powershell
# Vérifier que l'ancien runtime est supprimé
Test-Path "D:\projets\funesterie\runtime"
# Doit retourner: False

# Vérifier que le nouveau runtime existe
Test-Path "D:\projets\funesterie\a11\runtime"
# Doit retourner: True

# Vérifier le contenu
Get-ChildItem "D:\projets\funesterie\a11\runtime" -Recurse
```

## Script Automatisé

**Fichier** : `a11/launchers/cleanup-old-runtime.ps1`

```powershell
# cleanup-old-runtime.ps1
# Nettoie l'ancien répertoire runtime et conserve uniquement le nouveau

param(
    [switch]$Backup,
    [switch]$Force
)

$ErrorActionPreference = "Stop"

$oldRuntime = "D:\projets\funesterie\runtime"
$newRuntime = "D:\projets\funesterie\a11\runtime"

Write-Host "=== Nettoyage de l'ancien Runtime ===" -ForegroundColor Cyan
Write-Host ""

# Vérifier que le nouveau runtime existe
if (-not (Test-Path $newRuntime)) {
    Write-Host "ERREUR: Le nouveau runtime n'existe pas: $newRuntime" -ForegroundColor Red
    exit 1
}

# Vérifier que l'ancien runtime existe
if (-not (Test-Path $oldRuntime)) {
    Write-Host "L'ancien runtime n'existe pas. Rien à nettoyer." -ForegroundColor Green
    exit 0
}

Write-Host "Ancien runtime: $oldRuntime" -ForegroundColor Yellow
Write-Host "Nouveau runtime: $newRuntime" -ForegroundColor Green
Write-Host ""

# Backup si demandé
if ($Backup) {
    $backupFile = "D:\projets\funesterie\runtime_backup_$(Get-Date -Format 'yyyyMMdd_HHmmss').zip"
    Write-Host "Création d'une sauvegarde: $backupFile" -ForegroundColor Yellow
    Compress-Archive -Path $oldRuntime -DestinationPath $backupFile
    Write-Host "✓ Sauvegarde créée" -ForegroundColor Green
    Write-Host ""
}

# Confirmation
if (-not $Force) {
    Write-Host "ATTENTION: Cette opération va supprimer l'ancien runtime." -ForegroundColor Yellow
    Write-Host "Ancien runtime: $oldRuntime" -ForegroundColor Yellow
    Write-Host ""
    $confirm = Read-Host "Continuer? (oui/non)"
    if ($confirm -ne "oui") {
        Write-Host "Opération annulée." -ForegroundColor Yellow
        exit 0
    }
}

# Supprimer l'ancien runtime
Write-Host "Suppression de l'ancien runtime..." -ForegroundColor Yellow
Remove-Item -Path $oldRuntime -Recurse -Force
Write-Host "✓ Ancien runtime supprimé" -ForegroundColor Green
Write-Host ""

# Vérification
Write-Host "Vérification..." -ForegroundColor Yellow
if (Test-Path $oldRuntime) {
    Write-Host "✗ ERREUR: L'ancien runtime existe encore" -ForegroundColor Red
    exit 1
}

if (-not (Test-Path $newRuntime)) {
    Write-Host "✗ ERREUR: Le nouveau runtime n'existe plus" -ForegroundColor Red
    exit 1
}

Write-Host "✓ Nettoyage terminé avec succès" -ForegroundColor Green
Write-Host ""
Write-Host "Runtime actif: $newRuntime" -ForegroundColor Green
```

## Utilisation du Script

```powershell
# Avec sauvegarde et confirmation
.\a11\launchers\cleanup-old-runtime.ps1 -Backup

# Sans confirmation (attention!)
.\a11\launchers\cleanup-old-runtime.ps1 -Force

# Avec sauvegarde et sans confirmation
.\a11\launchers\cleanup-old-runtime.ps1 -Backup -Force
```

## Vérification Post-Nettoyage

### 1. Vérifier la Configuration

```bash
# Vérifier que .env.local pointe vers le bon runtime
grep "A11_RUNTIME_ROOT" a11/backend/apps/server/.env.local
# Doit afficher: A11_RUNTIME_ROOT=D:\projets\funesterie\a11\runtime
```

### 2. Tester le Backend

```bash
# Démarrer le backend
cd a11/backend/apps/server
node server.cjs

# Vérifier les logs
# Doit afficher: Runtime root: D:\projets\funesterie\a11\runtime
```

### 3. Tester la Génération de Fichiers

```bash
# Générer un PDF de test
curl -X POST http://localhost:3000/api/agent/run \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action":"generate_pdf","content":"Test"}'

# Vérifier que le fichier est créé dans le bon runtime
ls D:\projets\funesterie\a11\runtime\files\generated\
```

## Autres Doublons Potentiels

### Vérifier d'Autres Doublons

```powershell
# Chercher d'autres répertoires dupliqués
Get-ChildItem -Path "D:\projets\funesterie" -Directory -Recurse -Depth 2 |
    Group-Object Name |
    Where-Object { $_.Count -gt 1 } |
    Select-Object Name, Count, @{Name="Paths";Expression={$_.Group.FullName -join ", "}}
```

### Doublons Courants à Vérifier

- `node_modules/` (peut exister à plusieurs endroits)
- `dist/` (frontend build)
- `logs/` (logs du serveur)
- `.a11_state/` (état de l'application)

## Recommandations

1. ✅ **Conserver uniquement** : `D:\projets\funesterie\a11\runtime`
2. ❌ **Supprimer** : `D:\projets\funesterie\runtime`
3. 💾 **Sauvegarder avant** : Si vous avez des doutes
4. 🧪 **Tester après** : Vérifier que tout fonctionne

---

**Dernière mise à jour** : 2026-04-26  
**Version** : 1.0.0  
**Auteur** : Funesterie / A11 Team
