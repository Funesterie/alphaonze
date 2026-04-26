# Configuration Neo4j Desktop pour A11

Ce guide explique comment installer et configurer Neo4j Desktop pour le système A11.

## 📋 Prérequis

- Windows 10/11
- PowerShell 5.1 ou supérieur
- Installateur Neo4j Desktop: `D:\projets\funesterie\neo4j-desktop-2.1.4-x64.exe`

## 🚀 Installation rapide

### Étape 1: Installation de Neo4j Desktop

```powershell
# Depuis le répertoire funesterie/
.\install-neo4j-desktop.ps1
```

Ce script va :

- ✅ Installer Neo4j Desktop dans `D:\projets\funesterie\Neo4j Desktop 2`
- ✅ Mettre à jour automatiquement `.env.local` avec le bon chemin
- ✅ Afficher les prochaines étapes

### Étape 2: Configuration (optionnel)

```powershell
# Configuration de base
.\configure-neo4j.ps1

# Configuration avec SSH activé
.\configure-neo4j.ps1 -EnableSSH
```

Ce script va :

- ✅ Vérifier l'installation
- ✅ Configurer OpenSSH Server (si -EnableSSH)
- ✅ Créer un script de tunnel SSH
- ✅ Valider la configuration dans `.env.local`

### Étape 3: Configuration manuelle dans Neo4j Desktop

1. **Lancez Neo4j Desktop** depuis `D:\projets\funesterie\Neo4j Desktop 2\Neo4j Desktop.exe`

2. **Créez un nouveau projet**
   - Cliquez sur "New Project"
   - Nommez-le "A11"

3. **Créez une base de données locale**
   - Dans le projet A11, cliquez sur "Add Database"
   - Sélectionnez "Create a Local Database"
   - Nom: `a11-knowledge-graph`
   - Version: Dernière version stable (5.x recommandé)
   - Mot de passe: `neo4j` (ou personnalisé)

4. **Démarrez la base de données**
   - Cliquez sur "Start" sur votre base de données
   - Attendez que le statut passe à "Active"

5. **Changez le mot de passe par défaut** (recommandé)
   - Ouvrez Neo4j Browser (bouton "Open")
   - Première connexion: `neo4j` / `neo4j`
   - Vous serez invité à changer le mot de passe
   - Mettez à jour `.env.local` avec le nouveau mot de passe

### Étape 4: Test de connexion

```powershell
# Depuis funesterie/a11/backend/apps/server/
npm run test:neo4j
```

Vous devriez voir :

```
=== Test de connexion Neo4j ===
✓ Driver créé
✓ Connectivité vérifiée
✓ Session ouverte
✓ Neo4j 5.x.x (community)
✓ Nœud créé
✓ Nombre de nœuds A11Test: 1
✓ 1 nœud(s) supprimé(s)
=== ✓ Tous les tests réussis! ===
```

## 🔧 Configuration

### Variables d'environnement (.env.local)

```env
# Neo4j (Graphe de connaissances)
NEO4J_URI=bolt://localhost:7687
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=neo4j
NEO4J_DATABASE=neo4j
NEO4J_DESKTOP_PATH=D:\projets\funesterie\Neo4j Desktop 2
```

### Ports utilisés

- **7687**: Bolt protocol (connexion driver)
- **7474**: HTTP (Neo4j Browser)
- **7473**: HTTPS (Neo4j Browser)

## 🔐 Licence

Neo4j Desktop Community Edition est **gratuit** pour :

- ✅ Usage personnel
- ✅ Développement local
- ✅ Projets open source
- ✅ Évaluation et apprentissage

**Aucune clé de licence n'est requise** pour Community Edition.

Pour un usage commercial en production, consultez [Neo4j Licensing](https://neo4j.com/licensing/).

## 🌐 Accès distant via SSH

### Configuration SSH sur Windows

Le script `configure-neo4j.ps1 -EnableSSH` installe et configure automatiquement OpenSSH Server.

### Créer un tunnel SSH

```powershell
# Depuis une machine distante
ssh -L 7687:localhost:7687 votre-user@votre-serveur-windows

# Ou utilisez le script généré
.\neo4j-ssh-tunnel.ps1 -RemoteHost votre-serveur-windows
```

Ensuite, connectez-vous à `bolt://localhost:7687` depuis votre machine locale.

### Configuration du pare-feu

Le script configure automatiquement le pare-feu Windows pour autoriser SSH (port 22).

Pour Neo4j, si vous voulez un accès direct (non recommandé) :

```powershell
# Autoriser le port Bolt (7687)
New-NetFirewallRule -Name 'Neo4j-Bolt-In-TCP' -DisplayName 'Neo4j Bolt Protocol' -Enabled True -Direction Inbound -Protocol TCP -Action Allow -LocalPort 7687

# Autoriser Neo4j Browser (7474)
New-NetFirewallRule -Name 'Neo4j-HTTP-In-TCP' -DisplayName 'Neo4j Browser HTTP' -Enabled True -Direction Inbound -Protocol TCP -Action Allow -LocalPort 7474
```

**⚠️ Recommandation** : Utilisez toujours un tunnel SSH plutôt qu'une exposition directe.

## 🐛 Dépannage

### Erreur: "Impossible de se connecter"

1. Vérifiez que Neo4j Desktop est lancé
2. Vérifiez que la base de données est démarrée (statut "Active")
3. Vérifiez `NEO4J_URI` dans `.env.local`
4. Testez la connexion : `npm run test:neo4j`

### Erreur: "Authentication failed"

1. Vérifiez `NEO4J_USERNAME` et `NEO4J_PASSWORD` dans `.env.local`
2. Credentials par défaut : `neo4j` / `neo4j`
3. Si vous avez changé le mot de passe, mettez à jour `.env.local`

### Erreur: "Database not found"

1. Vérifiez que la base de données existe dans Neo4j Desktop
2. Vérifiez `NEO4J_DATABASE` dans `.env.local` (par défaut: `neo4j`)
3. Créez la base de données si nécessaire

### Neo4j Desktop ne démarre pas

1. Vérifiez les logs dans Neo4j Desktop
2. Vérifiez que le port 7687 n'est pas déjà utilisé :
   ```powershell
   netstat -ano | findstr :7687
   ```
3. Redémarrez Neo4j Desktop en tant qu'administrateur

## 📚 Ressources

- [Neo4j Desktop Documentation](https://neo4j.com/docs/desktop-manual/current/)
- [Neo4j Driver for Node.js](https://neo4j.com/docs/javascript-manual/current/)
- [Cypher Query Language](https://neo4j.com/docs/cypher-manual/current/)
- [Neo4j Graph Academy](https://graphacademy.neo4j.com/)

## 🔄 Intégration avec A11

Une fois Neo4j configuré, A11 l'utilisera automatiquement pour :

- 🧠 **Knowledge Graph** : Stockage des connaissances et relations
- 🔗 **Semantic Memory** : Liens entre concepts et entités
- 📊 **Graph Analytics** : Analyse de patterns et insights
- 🔍 **Graph RAG** : Retrieval-Augmented Generation avec contexte graphe

Le backend A11 détecte automatiquement la disponibilité de Neo4j et bascule entre :

- **Neo4j** (si disponible) : Stockage graphe complet
- **JSON fallback** (si indisponible) : Stockage fichier local

## 🎯 Prochaines étapes

1. ✅ Installer Neo4j Desktop
2. ✅ Configurer la base de données
3. ✅ Tester la connexion
4. 🚀 Lancer A11 et profiter du Knowledge Graph !

```powershell
# Lancer A11 avec Neo4j
cd a11
npm run start:online
```
