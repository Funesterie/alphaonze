# Configuration du Workspace Ollama

## Problème

**Ollama n'a pas de variable d'environnement pour configurer son workspace** (répertoire de stockage des modèles).

Par défaut, Ollama stocke les modèles dans :

- **Windows** : `%USERPROFILE%\.ollama\models`
- **Linux/Mac** : `~/.ollama/models`

Cela peut poser problème si :

- L'espace disque est limité sur le disque système
- Vous voulez centraliser les modèles dans un autre emplacement
- Vous voulez partager les modèles entre plusieurs projets

## Solutions de Contournement

### Solution 1 : Lien Symbolique (Recommandé)

Créer un lien symbolique depuis le répertoire par défaut vers un emplacement personnalisé.

#### Windows (PowerShell en Admin)

```powershell
# 1. Arrêter Ollama
Stop-Process -Name ollama -Force -ErrorAction SilentlyContinue

# 2. Créer le répertoire de destination sur le disque de données
$CustomPath = "E:\Funesterie\ollama\models"
New-Item -ItemType Directory -Path $CustomPath -Force

# 3. Déplacer les modèles existants (si présents)
$DefaultPath = "$env:USERPROFILE\.ollama\models"
if (Test-Path $DefaultPath) {
    Move-Item -Path "$DefaultPath\*" -Destination $CustomPath -Force
    Remove-Item -Path $DefaultPath -Recurse -Force
}

# 4. Créer le lien symbolique
New-Item -ItemType SymbolicLink -Path $DefaultPath -Target $CustomPath

# 5. Redémarrer Ollama
Start-Process ollama -ArgumentList "serve"
```

#### Linux/Mac

```bash
# 1. Arrêter Ollama
pkill ollama

# 2. Créer le répertoire de destination
CUSTOM_PATH="$HOME/projets/funesterie/a11/runtime/ollama_models"
mkdir -p "$CUSTOM_PATH"

# 3. Déplacer les modèles existants (si présents)
DEFAULT_PATH="$HOME/.ollama/models"
if [ -d "$DEFAULT_PATH" ]; then
    mv "$DEFAULT_PATH"/* "$CUSTOM_PATH/"
    rm -rf "$DEFAULT_PATH"
fi

# 4. Créer le lien symbolique
ln -s "$CUSTOM_PATH" "$DEFAULT_PATH"

# 5. Redémarrer Ollama
ollama serve &
```

### Solution 2 : Variable d'Environnement OLLAMA_MODELS (Expérimental)

Certaines versions récentes d'Ollama supportent `OLLAMA_MODELS` (non documenté officiellement).

#### Windows

```powershell
# Définir la variable d'environnement système
[System.Environment]::SetEnvironmentVariable(
    "OLLAMA_MODELS",
    "E:\Funesterie\ollama\models",
    [System.EnvironmentVariableTarget]::User
)

# Redémarrer Ollama
Stop-Process -Name ollama -Force -ErrorAction SilentlyContinue
Start-Process ollama -ArgumentList "serve"
```

#### Linux/Mac

```bash
# Ajouter dans ~/.bashrc ou ~/.zshrc
export OLLAMA_MODELS="$HOME/projets/funesterie/a11/runtime/ollama_models"

# Recharger le shell
source ~/.bashrc  # ou source ~/.zshrc

# Redémarrer Ollama
pkill ollama
ollama serve &
```

### Solution 3 : Serveur Ollama Dédié avec Docker

Utiliser Docker pour avoir un contrôle total sur le workspace.

```yaml
# docker-compose.yml
version: "3.8"
services:
  ollama:
    image: ollama/ollama:latest
    ports:
      - "11434:11434"
    volumes:
      - E:\Funesterie\ollama\models:/root/.ollama
    environment:
      - OLLAMA_HOST=0.0.0.0
```

```bash
# Démarrer
docker-compose up -d

# Vérifier
curl http://localhost:11434/api/tags
```

## Configuration A11

Une fois le workspace configuré, mettre à jour `.env.local` :

```bash
# URL du serveur Ollama
OLLAMA_BASE=http://127.0.0.1:11434

# Modèle principal
A11_OLLAMA_PRIMARY_MODEL=gemma4:e4b

# Modèle de fallback
A11_OLLAMA_FALLBACK_MODEL=llama3.2:latest

# Parallélisme Ollama (nombre de requêtes simultanées)
OLLAMA_BACKEND_PARALLEL=2

# Taille de la queue
OLLAMA_BACKEND_QUEUE_SIZE=8

# Timeout (ms)
OLLAMA_BACKEND_TIMEOUT_MS=120000
```

## Vérification

### 1. Vérifier que Ollama fonctionne

```bash
curl http://127.0.0.1:11434/api/tags
```

**Réponse attendue** :

```json
{
  "models": [
    {
      "name": "gemma4:e4b",
      "modified_at": "2026-04-26T10:00:00Z",
      "size": 5000000000
    }
  ]
}
```

### 2. Vérifier l'emplacement des modèles

#### Windows

```powershell
# Vérifier le lien symbolique
Get-Item "$env:USERPROFILE\.ollama\models" | Select-Object Target

# Vérifier l'espace disque
Get-ChildItem -Path "$env:USERPROFILE\.ollama\models" -Recurse |
    Measure-Object -Property Length -Sum |
    Select-Object @{Name="Size (GB)"; Expression={[math]::Round($_.Sum / 1GB, 2)}}
```

#### Linux/Mac

```bash
# Vérifier le lien symbolique
ls -la ~/.ollama/models

# Vérifier l'espace disque
du -sh ~/.ollama/models
```

### 3. Tester avec A11

```bash
# Démarrer le backend
cd a11/backend/apps/server
node server.cjs

# Tester un appel
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"Hello"}'
```

## Gestion des Modèles

### Lister les modèles

```bash
ollama list
```

### Télécharger un modèle

```bash
ollama pull gemma4:e4b
ollama pull llama3.2:latest
```

### Supprimer un modèle

```bash
ollama rm gemma4:e4b
```

### Vérifier l'espace disque

```bash
# Windows
Get-ChildItem -Path "D:\projets\funesterie\a11\runtime\ollama_models" -Recurse |
    Measure-Object -Property Length -Sum

# Linux/Mac
du -sh ~/projets/funesterie/a11/runtime/ollama_models
```

## Problèmes Courants

### Ollama ne démarre pas après le lien symbolique

**Cause** : Permissions insuffisantes ou lien symbolique cassé.

**Solution** :

```powershell
# Windows (PowerShell en Admin)
Remove-Item "$env:USERPROFILE\.ollama\models" -Force
New-Item -ItemType SymbolicLink -Path "$env:USERPROFILE\.ollama\models" -Target "D:\projets\funesterie\a11\runtime\ollama_models"
```

### Les modèles ne sont pas trouvés

**Cause** : Le lien symbolique pointe vers un répertoire vide.

**Solution** :

```bash
# Télécharger à nouveau les modèles
ollama pull gemma4:e4b
ollama pull llama3.2:latest
```

### Erreur "connection refused"

**Cause** : Ollama n'est pas démarré.

**Solution** :

```bash
# Windows
Start-Process ollama -ArgumentList "serve"

# Linux/Mac
ollama serve &
```

## Recommandations

1. **Utiliser la Solution 1 (lien symbolique)** : C'est la plus fiable et compatible avec toutes les versions d'Ollama

2. **Centraliser dans `a11/runtime/ollama_models`** : Facilite la gestion et le backup

3. **Ajouter au `.gitignore`** :

   ```
   a11/runtime/ollama_models/
   ```

4. **Monitorer l'espace disque** : Les modèles LLM peuvent être volumineux (5-10 GB par modèle)

5. **Backup régulier** : Sauvegarder le répertoire des modèles pour éviter de les re-télécharger

## Script d'Installation Automatique

Voir `a11/launchers/setup-ollama-workspace.ps1` pour un script automatisé.

---

**Dernière mise à jour** : 2026-04-26  
**Version** : 1.0.0  
**Auteur** : Funesterie / A11 Team
