# 🔐 Réinitialiser le mot de passe Neo4j

## Problème

Vous avez oublié le mot de passe Neo4j ou le compte est bloqué après trop de tentatives.

## Solution 1 : Via Neo4j Desktop (Recommandé)

### Étape 1 : Arrêter la base de données

1. Ouvrir Neo4j Desktop
2. Sélectionner votre projet "A11"
3. Cliquer sur "Stop" pour arrêter la base `a11-knowledge-graph`

### Étape 2 : Réinitialiser le mot de passe

1. Cliquer sur les 3 points (...) à côté de la base
2. Sélectionner "Manage" → "Terminal"
3. Dans le terminal, exécuter :

```bash
# Réinitialiser le mot de passe pour l'utilisateur neo4j
bin/neo4j-admin dbms set-initial-password neoj4neoj4
```

4. Redémarrer la base de données

### Étape 3 : Tester la connexion

```powershell
cd a11/backend/apps/server
npm run test:neo4j
```

## Solution 2 : Via PowerShell

### Script automatique

```powershell
# Trouver l'instance Neo4j
$neo4jHome = "C:\Users\$env:USERNAME\.Neo4jDesktop\relate-data\dbmss"
$instances = Get-ChildItem -Path $neo4jHome -Directory

# Afficher les instances
Write-Host "Instances disponibles:"
for ($i = 0; $i -lt $instances.Count; $i++) {
    Write-Host "$i : $($instances[$i].Name)"
}

# Sélectionner l'instance (par exemple, la première)
$instance = $instances[0]
$neo4jAdminPath = Join-Path $instance.FullName "bin\neo4j-admin.bat"

# Réinitialiser le mot de passe
& $neo4jAdminPath dbms set-initial-password neoj4neoj4
```

## Solution 3 : Supprimer et recréer la base

Si les solutions ci-dessus ne fonctionnent pas :

### Étape 1 : Exporter les données (si nécessaire)

```powershell
cd a11
.\export-neo4j-dump.ps1 -DatabaseName "a11-knowledge-graph"
```

### Étape 2 : Supprimer la base

1. Dans Neo4j Desktop, arrêter la base
2. Cliquer sur les 3 points (...) → "Delete"
3. Confirmer la suppression

### Étape 3 : Créer une nouvelle base

1. Cliquer sur "Add Database" → "Create a Local Database"
2. Nom : `a11-knowledge-graph`
3. Mot de passe : `neoj4neoj4`
4. Cliquer sur "Create"
5. Démarrer la base

### Étape 4 : Importer les données (si vous avez un dump)

```powershell
cd a11
.\import-neo4j-dump.ps1 -DumpFile "chemin\vers\dump.dump"
```

## Mettre à jour .env.local

Après avoir réinitialisé le mot de passe, mettez à jour `.env.local` :

```env
NEO4J_URI=bolt://localhost:7687
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=neoj4neoj4
NEO4J_DATABASE=a11-knowledge-graph
```

## Débloquer le compte après trop de tentatives

Si vous voyez l'erreur :

```
The client has provided incorrect authentication details too many times in a row.
```

**Solution** : Attendre 5 minutes, puis réessayer. Neo4j débloque automatiquement le compte après un délai.

Ou redémarrer complètement Neo4j Desktop :

1. Fermer Neo4j Desktop
2. Tuer le processus Neo4j si nécessaire :
   ```powershell
   Get-Process | Where-Object {$_.Name -like "*neo4j*"} | Stop-Process -Force
   ```
3. Relancer Neo4j Desktop
4. Démarrer la base de données

## Vérification finale

```powershell
cd a11/backend/apps/server
npm run test:neo4j
```

Vous devriez voir :

```
✓ Driver créé
✓ Connectivité vérifiée
✓ Session ouverte
✓ Neo4j 5.x.x (community)
=== ✓ Tous les tests réussis! ===
```

## Mot de passe recommandé

Pour A11, nous utilisons : `neoj4neoj4` (8 caractères minimum requis par Neo4j)

Ce mot de passe est :

- ✅ Facile à retenir
- ✅ Respecte la contrainte de 8 caractères
- ✅ Unique à A11
- ⚠️ Pour usage local uniquement (pas pour production)

## Besoin d'aide ?

Consultez `TROUBLESHOOTING.md` pour plus de solutions.
