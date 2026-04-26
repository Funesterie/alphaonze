# Analyse des Doublons - Projet Funesterie

**Date d'analyse** : 2026-04-26  
**Répertoire analysé** : `D:\projets\funesterie`

---

## 🔍 Répertoires Runtime Identifiés

### 1. `runtime/` (Racine) ❌ À SUPPRIMER

**Chemin** : `D:\projets\funesterie\runtime`

**Statistiques** :

- **Fichiers** : 808
- **Taille** : 62.79 MB
- **Dernière modification** : 26/04/2026 19:26

**Contenu** :

- `auth/` (vide)
- `files/generated/` (9 fichiers anciens)
- `files/uploads/` (à vérifier)
- `launcher/` (logs et états)

**Statut** : **ANCIEN - À SUPPRIMER**

**Raison** : Ce répertoire était utilisé par l'ancienne configuration. La configuration actuelle utilise `a11/runtime`.

---

### 2. `a11/runtime/` ✅ ACTIF - À CONSERVER

**Chemin** : `D:\projets\funesterie\a11\runtime`

**Statistiques** :

- **Fichiers** : 23
- **Taille** : 80.75 MB
- **Dernière modification** : 26/04/2026 18:40

**Contenu** :

- `auth/local-users.json` (utilisateurs locaux)
- `cache/async-image-jobs.json` (jobs d'images)
- `files/generated/` (20 fichiers récents)
- `files/uploads/` (uploads utilisateur)
- `vector-memory/` (mémoire vectorielle RAG)

**Statut** : **ACTIF - À CONSERVER** ✅

**Configuration** : `.env.local`

```bash
A11_RUNTIME_ROOT=D:\projets\funesterie\a11\runtime
A11_SAFE_DATA_ROOT=D:\projets\funesterie\a11\runtime\files
```

---

### 3. `a11/launchers/runtime/` ❌ À SUPPRIMER

**Chemin** : `D:\projets\funesterie\a11\launchers\runtime`

**Statistiques** :

- **Fichiers** : 0
- **Taille** : 0 MB
- **Dernière modification** : N/A

**Statut** : **VIDE - À SUPPRIMER**

**Raison** : Répertoire vide, probablement créé par erreur.

---

### 4. `alphaonze-afk/runtime/` ⚠️ À VÉRIFIER

**Chemin** : `D:\projets\funesterie\alphaonze-afk\runtime`

**Statistiques** :

- **Fichiers** : 5
- **Taille** : 0.01 MB
- **Dernière modification** : 24/04/2026 21:48

**Statut** : **PROJET SÉPARÉ - À VÉRIFIER**

**Raison** : Semble être un projet séparé (`alphaonze-afk`). Vérifier s'il est encore utilisé.

---

## 📊 Autres Doublons Identifiés

### Répertoires Dupliqués

| Nom       | Occurrences | Chemins                                                                    |
| --------- | ----------- | -------------------------------------------------------------------------- |
| `.github` | 3           | `a11/.github`, `a11/backend/.github`, `a11/frontend/.github`               |
| `.vscode` | 4           | `.vscode`, `a11/.vscode`, `a11/backend/.vscode`, `a11/frontend/.vscode`    |
| `a11`     | 2           | `a11`, `alphaonze-afk/a11` (?)                                             |
| `apps`    | 3           | `a11/backend/apps`, `a11/frontend/apps`, `a11/launchers/apps` (?)          |
| `auth`    | 2           | `runtime/auth`, `a11/runtime/auth`                                         |
| `dist`    | 2           | `dist`, `a11/frontend/apps/web/dist`                                       |
| `files`   | 2           | `runtime/files`, `a11/runtime/files`                                       |
| `runtime` | 4           | `runtime`, `a11/runtime`, `a11/launchers/runtime`, `alphaonze-afk/runtime` |
| `scripts` | 2           | `scripts`, `a11/scripts` (?)                                               |

**Note** : Certains doublons sont normaux (ex: `.vscode` par workspace, `dist` par projet).

---

## 🎯 Plan d'Action

### Priorité 1 : Nettoyer les Runtime

#### 1.1. Supprimer `runtime/` (racine)

```powershell
# Avec sauvegarde
.\a11\launchers\cleanup-old-runtime.ps1 -Backup

# Sans sauvegarde (attention!)
.\a11\launchers\cleanup-old-runtime.ps1 -Force
```

**Impact** : Libère 62.79 MB

#### 1.2. Supprimer `a11/launchers/runtime/`

```powershell
Remove-Item -Path "D:\projets\funesterie\a11\launchers\runtime" -Force
```

**Impact** : Aucun (vide)

#### 1.3. Vérifier `alphaonze-afk/runtime/`

```powershell
# Vérifier le contenu
Get-ChildItem "D:\projets\funesterie\alphaonze-afk\runtime" -Recurse

# Si obsolète, supprimer
Remove-Item -Path "D:\projets\funesterie\alphaonze-afk\runtime" -Recurse -Force
```

**Impact** : Libère 0.01 MB

---

### Priorité 2 : Vérifier les Autres Doublons

#### 2.1. `.github` (3 occurrences)

**Normal** : Chaque projet (backend, frontend) peut avoir sa propre config GitHub Actions.

**Action** : Aucune

#### 2.2. `.vscode` (4 occurrences)

**Normal** : Chaque workspace peut avoir sa propre config VS Code.

**Action** : Aucune

#### 2.3. `dist` (2 occurrences)

**Normal** : `dist` à la racine peut être un build global, `a11/frontend/apps/web/dist` est le build du frontend.

**Action** : Vérifier si `dist/` à la racine est utilisé. Si non, supprimer.

```powershell
# Vérifier le contenu
Get-ChildItem "D:\projets\funesterie\dist" -Recurse

# Si obsolète, supprimer
Remove-Item -Path "D:\projets\funesterie\dist" -Recurse -Force
```

---

## 🧹 Script de Nettoyage Global

**Fichier** : `a11/launchers/cleanup-duplicates.ps1`

```powershell
# cleanup-duplicates.ps1
# Nettoie tous les doublons identifiés

param(
    [switch]$Backup,
    [switch]$Force
)

$ErrorActionPreference = "Stop"

Write-Host "=== Nettoyage des Doublons ===" -ForegroundColor Cyan
Write-Host ""

# 1. Nettoyer runtime/ (racine)
Write-Host "[1/3] Nettoyage de runtime/ (racine)..." -ForegroundColor Yellow
& ".\a11\launchers\cleanup-old-runtime.ps1" -Backup:$Backup -Force:$Force

# 2. Supprimer a11/launchers/runtime/ (vide)
Write-Host "[2/3] Suppression de a11/launchers/runtime/ (vide)..." -ForegroundColor Yellow
$launcherRuntime = "D:\projets\funesterie\a11\launchers\runtime"
if (Test-Path $launcherRuntime) {
    Remove-Item -Path $launcherRuntime -Force
    Write-Host "  ✓ Supprimé" -ForegroundColor Green
} else {
    Write-Host "  ✓ N'existe pas" -ForegroundColor Green
}

# 3. Vérifier alphaonze-afk/runtime/
Write-Host "[3/3] Vérification de alphaonze-afk/runtime/..." -ForegroundColor Yellow
$afkRuntime = "D:\projets\funesterie\alphaonze-afk\runtime"
if (Test-Path $afkRuntime) {
    $files = Get-ChildItem $afkRuntime -Recurse -File
    Write-Host "  Fichiers: $($files.Count)" -ForegroundColor Gray

    if (-not $Force) {
        $confirm = Read-Host "  Supprimer alphaonze-afk/runtime/? (oui/non)"
        if ($confirm -eq "oui") {
            Remove-Item -Path $afkRuntime -Recurse -Force
            Write-Host "  ✓ Supprimé" -ForegroundColor Green
        } else {
            Write-Host "  ⊘ Conservé" -ForegroundColor Yellow
        }
    } else {
        Remove-Item -Path $afkRuntime -Recurse -Force
        Write-Host "  ✓ Supprimé" -ForegroundColor Green
    }
} else {
    Write-Host "  ✓ N'existe pas" -ForegroundColor Green
}

Write-Host ""
Write-Host "=== Nettoyage terminé ===" -ForegroundColor Cyan
```

---

## ✅ Checklist de Nettoyage

- [ ] Sauvegarder `runtime/` (racine) si nécessaire
- [ ] Exécuter `cleanup-old-runtime.ps1`
- [ ] Supprimer `a11/launchers/runtime/`
- [ ] Vérifier et supprimer `alphaonze-afk/runtime/` si obsolète
- [ ] Vérifier `dist/` à la racine
- [ ] Redémarrer le backend A11
- [ ] Tester la génération de fichiers
- [ ] Vérifier que tout fonctionne

---

## 📈 Gain d'Espace Estimé

| Répertoire               | Taille        | Statut      |
| ------------------------ | ------------- | ----------- |
| `runtime/` (racine)      | 62.79 MB      | À supprimer |
| `a11/launchers/runtime/` | 0 MB          | À supprimer |
| `alphaonze-afk/runtime/` | 0.01 MB       | À vérifier  |
| **Total**                | **~62.80 MB** |             |

---

## 🔒 Sécurité

### Avant de Supprimer

1. ✅ **Vérifier la configuration** : `.env.local` pointe vers `a11/runtime`
2. ✅ **Sauvegarder** : Utiliser `-Backup` pour créer une archive
3. ✅ **Tester** : Vérifier que le backend fonctionne après nettoyage

### Après Suppression

1. ✅ **Redémarrer le backend**
2. ✅ **Tester la génération de fichiers**
3. ✅ **Vérifier les logs**

---

**Dernière mise à jour** : 2026-04-26  
**Version** : 1.0.0  
**Auteur** : Funesterie / A11 Team
