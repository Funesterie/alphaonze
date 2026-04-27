# 🔧 A11 - Guide de dépannage

## Erreurs courantes et solutions

### ❌ Erreur: "Neo4j query failed - Failed to connect to server"

**Cause** : Neo4j Desktop n'est pas démarré ou la base de données n'est pas active.

**Solution** :

1. **Installer Neo4j Desktop** (si pas encore fait) :

   ```
   Double-clic sur : install-neo4j.bat
   ```

2. **Lancer Neo4j Desktop** :
   - Ouvrir `D:\projets\funesterie\Neo4j Desktop 2\Neo4j Desktop.exe`

3. **Créer et démarrer la base de données** :
   - Créer un projet "A11"
   - Créer une base "a11-knowledge-graph"
   - Cliquer sur "Start" pour démarrer la base
   - Attendre que le statut passe à "Active"

4. **Tester la connexion** :

   ```powershell
   cd a11/backend/apps/server
   npm run test:neo4j
   ```

5. **Si vous ne voulez pas utiliser Neo4j** :
   - A11 bascule automatiquement sur le fallback JSON local
   - Aucune action requise, l'erreur est normale et gérée

**Note** : Le fallback JSON fonctionne sans Neo4j, mais le Knowledge Graph offre des capacités avancées.

---

### ❌ Erreur: "Ollama embeddings failed: 404 Not Found"

**Cause** : Le modèle d'embeddings `nomic-embed-text` n'est pas installé dans Ollama.

**Solution rapide** : Désactiver les embeddings (déjà fait par défaut)

Les embeddings sont maintenant désactivés par défaut dans `.env.local` :

```env
A11_ENABLE_EMBEDDINGS=false
```

**Solution complète** : Installer le modèle d'embeddings

1. **Installer le modèle** :

   ```powershell
   cd a11
   .\install-embedding-model.ps1
   ```

2. **Ou manuellement** :

   ```powershell
   ollama pull nomic-embed-text
   ```

3. **Activer les embeddings** dans `.env.local` :

   ```env
   A11_ENABLE_EMBEDDINGS=true
   ```

4. **Redémarrer A11**

**Avantages des embeddings** :

- Recherche sémantique dans l'historique des conversations
- Meilleure mémoire contextuelle
- RAG (Retrieval-Augmented Generation) amélioré

**Sans embeddings** :

- A11 fonctionne normalement
- Pas de recherche vectorielle dans l'historique
- Mémoire basée sur le contexte immédiat uniquement

---

### ❌ Erreur: "Authentication failed" (Neo4j)

**Cause** : Credentials incorrects dans `.env.local`.

**Solution** :

1. **Vérifier les credentials** dans `.env.local` :

   ```env
   NEO4J_USERNAME=neo4j
   NEO4J_PASSWORD=neo4j
   ```

2. **Si vous avez changé le mot de passe** dans Neo4j Desktop :
   - Mettre à jour `NEO4J_PASSWORD` dans `.env.local`
   - Redémarrer A11

3. **Réinitialiser le mot de passe** :
   - Dans Neo4j Desktop, supprimer la base
   - Recréer une nouvelle base avec le mot de passe par défaut `neo4j`

---

### ❌ Erreur: "Database not found" (Neo4j)

**Cause** : La base de données spécifiée n'existe pas.

**Solution** :

1. **Vérifier le nom de la base** dans `.env.local` :

   ```env
   NEO4J_DATABASE=neo4j
   ```

2. **Créer la base** dans Neo4j Desktop :
   - Le nom par défaut est `neo4j`
   - Ou créer une base avec le nom spécifié dans `.env.local`

---

### ⚠️ Warning: "Failed to generate embedding for exchange"

**Cause** : Les embeddings sont activés mais le modèle n'est pas disponible.

**Solution** :

1. **Désactiver les embeddings** (recommandé si vous ne les utilisez pas) :

   ```env
   A11_ENABLE_EMBEDDINGS=false
   ```

2. **Ou installer le modèle** :
   ```powershell
   cd a11
   .\install-embedding-model.ps1
   ```

---

## 🚀 Vérification rapide de l'état du système

### Vérifier Ollama

```powershell
# Vérifier si Ollama est installé
ollama --version

# Lister les modèles installés
ollama list

# Vérifier si Ollama répond
curl http://127.0.0.1:11434/api/tags
```

### Vérifier Neo4j

```powershell
# Tester la connexion Neo4j
cd a11/backend/apps/server
npm run test:neo4j
```

### Vérifier A11

```powershell
# Vérifier les logs A11
cd a11/backend/apps/server
npm run dev
# Regarder les logs de démarrage
```

---

## 📋 Configuration recommandée

### Configuration minimale (fonctionne sans Neo4j ni embeddings)

```env
# .env.local
A11_LLM_PROVIDER=ollama
OLLAMA_BASE=http://127.0.0.1:11434
A11_OLLAMA_PRIMARY_MODEL=gemma4:e4b
A11_ENABLE_EMBEDDINGS=false
```

### Configuration complète (avec Neo4j et embeddings)

```env
# .env.local
A11_LLM_PROVIDER=ollama
OLLAMA_BASE=http://127.0.0.1:11434
A11_OLLAMA_PRIMARY_MODEL=gemma4:e4b

# Neo4j
NEO4J_URI=bolt://localhost:7687
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=votre-mot-de-passe
NEO4J_DATABASE=neo4j

# Embeddings
A11_ENABLE_EMBEDDINGS=true
A11_EMBEDDING_MODEL=nomic-embed-text
```

---

## 🔍 Diagnostic avancé

### Logs détaillés

Les logs A11 se trouvent dans :

```
a11/backend/apps/server/logs/
```

### Vérifier les ports

```powershell
# Vérifier si les ports sont utilisés
netstat -ano | findstr :11434  # Ollama
netstat -ano | findstr :7687   # Neo4j Bolt
netstat -ano | findstr :7474   # Neo4j Browser
netstat -ano | findstr :3000   # A11 Backend
```

### Redémarrer les services

```powershell
# Redémarrer Ollama
taskkill /F /IM ollama.exe
ollama serve

# Redémarrer Neo4j Desktop
# Fermer Neo4j Desktop et le relancer

# Redémarrer A11
cd a11
npm run start:online
```

---

## 📚 Documentation complète

- **Neo4j** : `NEO4J_SETUP.md` et `QUICK_START_NEO4J.md`
- **A11** : `A11_NEO4J_BRIEFING.md`
- **Architecture** : `a11/backend/A11_ARCHITECTURE_REFERENCE.md`

---

## 💡 Besoin d'aide ?

Si le problème persiste :

1. Vérifier les logs dans `a11/backend/apps/server/logs/`
2. Consulter la documentation complète
3. Vérifier que tous les services sont démarrés
4. Redémarrer A11 après toute modification de `.env.local`
