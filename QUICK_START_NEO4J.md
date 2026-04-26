# 🚀 Installation Neo4j Desktop - Guide Rapide

## Installation en 1 clic

**Double-cliquez sur** : `install-neo4j.bat`

C'est tout ! Le script va :

1. ✅ Demander les privilèges administrateur
2. ✅ Installer Neo4j Desktop dans `D:\projets\funesterie\Neo4j Desktop 2`
3. ✅ Mettre à jour automatiquement `.env.local`
4. ✅ Afficher les prochaines étapes

## Après l'installation

### 1. Lancez Neo4j Desktop

Trouvez l'icône Neo4j Desktop sur votre bureau ou dans :

```
D:\projets\funesterie\Neo4j Desktop 2\Neo4j Desktop.exe
```

### 2. Créez votre base de données

Dans Neo4j Desktop :

1. Cliquez sur **"New Project"** → Nommez-le **"A11"**
2. Dans le projet, cliquez sur **"Add Database"** → **"Create a Local Database"**
3. Nom : `a11-knowledge-graph`
4. Mot de passe : `neo4j` (vous pourrez le changer après)
5. Cliquez sur **"Create"**
6. Cliquez sur **"Start"** pour démarrer la base

### 3. Testez la connexion

Ouvrez PowerShell dans `funesterie/a11/backend/apps/server/` :

```powershell
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

## 🎉 C'est terminé !

Neo4j est maintenant configuré pour A11. Le système utilisera automatiquement le Knowledge Graph pour :

- 🧠 Stocker les connaissances et relations
- 🔗 Créer des liens sémantiques
- 📊 Analyser les patterns
- 🔍 Améliorer le RAG avec contexte graphe

## ⚙️ Configuration avancée (optionnel)

### Activer SSH pour accès distant

```powershell
.\configure-neo4j.ps1 -EnableSSH
```

### Changer le mot de passe Neo4j

1. Ouvrez Neo4j Browser (bouton "Open" dans Neo4j Desktop)
2. Connectez-vous avec `neo4j` / `neo4j`
3. Changez le mot de passe quand demandé
4. Mettez à jour dans `.env.local` :
   ```env
   NEO4J_PASSWORD=votre-nouveau-mot-de-passe
   ```

## 🐛 Problèmes ?

Consultez `NEO4J_SETUP.md` pour le guide complet et le dépannage.

## 📚 Licence

Neo4j Desktop Community Edition est **gratuit** pour usage personnel et développement. Aucune clé de licence requise.
