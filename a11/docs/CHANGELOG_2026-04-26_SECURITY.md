# Changelog - Sécurité NEZ & Workspace Ollama

**Date** : 2026-04-26  
**Priorité** : Haute (Sécurité)  
**Status** : ✅ Implémenté

---

## 🎯 Objectifs

1. **Activer la sécurité NEZ** en mode `dev` pour protéger les endpoints API
2. **Documenter le problème du workspace Ollama** et fournir des solutions
3. **Créer un script d'installation** pour configurer le workspace Ollama

---

## 🔒 Activation de la Sécurité NEZ

### Modification dans `.env.local`

**Avant** :

```bash
NEZ_SECURITY_MODE=off
```

**Après** :

```bash
# Sécurité NEZ activée (mode dev)
# Mode dev : localhost autorisé sans token, requêtes externes nécessitent JWT
NEZ_SECURITY_MODE=dev
```

### Comportement en Mode `dev`

| Origine                   | Token Requis | Comportement                                       |
| ------------------------- | ------------ | -------------------------------------------------- |
| `localhost` / `127.0.0.1` | ❌ Non       | ✅ Autorisé sans token                             |
| Requêtes externes         | ✅ Oui       | 🔒 JWT requis via `X-NEZ-TOKEN` ou `Authorization` |

### Impact

- ✅ Développement local sans friction (pas de token requis)
- 🔒 Protection contre les accès externes non autorisés
- ✅ Compatible avec l'exposition via Caddy/tunnel
- ✅ Pas de changement pour le développement local

### Obtenir un Token JWT

```bash
# Login
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"Djeff","password":"1991"}'

# Réponse
{
  "ok": true,
  "token": "<JWT_TOKEN>",
  "user": { "id": "1", "username": "Djeff" }
}
```

### Utiliser le Token

```bash
# Option 1 : Header Authorization
curl -X POST http://localhost:3000/api/chat \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"message":"Hello"}'

# Option 2 : Header X-NEZ-TOKEN
curl -X POST http://localhost:3000/api/chat \
  -H "X-NEZ-TOKEN: <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"message":"Hello"}'
```

---

## 📁 Workspace Ollama

### Problème Identifié

**Ollama n'a pas de variable d'environnement pour configurer son workspace** (répertoire de stockage des modèles).

Par défaut, Ollama stocke les modèles dans :

- **Windows** : `%USERPROFILE%\.ollama\models`
- **Linux/Mac** : `~/.ollama/models`

**Conséquences** :

- Espace disque limité sur le disque système
- Impossible de centraliser les modèles dans `a11/runtime/`
- Difficile de gérer les backups

### Solutions Proposées

#### Solution 1 : Lien Symbolique (Recommandé) ✅

Créer un lien symbolique depuis le répertoire par défaut vers `a11/runtime/ollama_models`.

**Avantages** :

- ✅ Compatible avec toutes les versions d'Ollama
- ✅ Transparent pour Ollama
- ✅ Facile à mettre en place
- ✅ Réversible

**Script automatisé** : `a11/launchers/setup-ollama-workspace.ps1`

#### Solution 2 : Variable OLLAMA_MODELS (Expérimental)

Certaines versions récentes d'Ollama supportent `OLLAMA_MODELS` (non documenté).

**Avantages** :

- ✅ Pas de lien symbolique
- ✅ Configuration via variable d'environnement

**Inconvénients** :

- ⚠️ Non documenté officiellement
- ⚠️ Peut ne pas fonctionner sur toutes les versions

#### Solution 3 : Docker

Utiliser Docker pour un contrôle total.

**Avantages** :

- ✅ Isolation complète
- ✅ Configuration via volumes

**Inconvénients** :

- ⚠️ Nécessite Docker
- ⚠️ Plus complexe à mettre en place

---

## 📦 Fichiers Créés

### 1. `a11/docs/NEZ_SECURITY.md`

Documentation complète sur la sécurité NEZ.

**Contenu** :

- Vue d'ensemble des modes de sécurité (`off`, `dev`, `strict`)
- Authentification JWT (obtenir et utiliser un token)
- Routes protégées vs publiques
- Configuration frontend
- Implémentation du middleware
- Activation et tests
- Gestion des tokens
- Troubleshooting

### 2. `a11/docs/OLLAMA_WORKSPACE.md`

Documentation sur le workspace Ollama.

**Contenu** :

- Problème identifié
- 3 solutions de contournement (lien symbolique, variable env, Docker)
- Configuration A11
- Vérification et tests
- Gestion des modèles
- Problèmes courants
- Recommandations

### 3. `a11/launchers/setup-ollama-workspace.ps1`

Script PowerShell pour automatiser la configuration du workspace Ollama.

**Fonctionnalités** :

- ✅ Vérification des permissions admin
- ✅ Arrêt d'Ollama
- ✅ Création du répertoire personnalisé
- ✅ Déplacement des modèles existants
- ✅ Création du lien symbolique
- ✅ Vérification du lien
- ✅ Redémarrage d'Ollama
- ✅ Rapport détaillé

**Usage** :

```powershell
# Avec le chemin par défaut
.\setup-ollama-workspace.ps1

# Avec un chemin personnalisé
.\setup-ollama-workspace.ps1 -CustomPath "E:\ollama_models"

# Forcer la recréation
.\setup-ollama-workspace.ps1 -Force
```

### 4. `a11/docs/CHANGELOG_2026-04-26_SECURITY.md`

Ce fichier.

---

## 🔧 Modifications dans `.env.local`

### Changement Principal

```diff
- # Sécurité locale désactivée
- NEZ_SECURITY_MODE=off
+ # Sécurité NEZ activée (mode dev)
+ # Mode dev : localhost autorisé sans token, requêtes externes nécessitent JWT
+ NEZ_SECURITY_MODE=dev
```

### Variables Existantes (inchangées)

```bash
# JWT pour les sessions utilisateur
JWT_SECRET=<JWT_SECRET>
JWT_EXPIRY=7d

# Admin par défaut
DEFAULT_ADMIN_USERNAME=Djeff
DEFAULT_ADMIN_PASSWORD=1991
DEFAULT_ADMIN_EMAIL=djeff@a11.local

# CORS
CORS_ORIGINS=http://127.0.0.1:3000,http://localhost:5173,http://localhost:3000,https://alphaonze.funesterie.pro
```

---

## 🧪 Tests

### Test 1 : Requête Localhost (doit passer)

```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"Hello"}'
```

**Résultat attendu** : ✅ Réponse normale (pas de token requis)

### Test 2 : Requête Externe sans Token (doit échouer)

```bash
curl -X POST https://alphaonze.funesterie.pro/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"Hello"}'
```

**Résultat attendu** : ❌ 403 Forbidden

```json
{
  "ok": false,
  "error": "nez_token_required",
  "message": "NEZ token required for external requests"
}
```

### Test 3 : Requête Externe avec Token (doit passer)

```bash
# 1. Obtenir un token
TOKEN=$(curl -X POST https://alphaonze.funesterie.pro/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"Djeff","password":"1991"}' | jq -r '.token')

# 2. Utiliser le token
curl -X POST https://alphaonze.funesterie.pro/api/chat \
  -H "X-NEZ-TOKEN: $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message":"Hello"}'
```

**Résultat attendu** : ✅ Réponse normale

### Test 4 : Workspace Ollama

```powershell
# 1. Exécuter le script (PowerShell en Admin)
.\a11\launchers\setup-ollama-workspace.ps1

# 2. Vérifier le lien symbolique
Get-Item "$env:USERPROFILE\.ollama\models" | Select-Object Target

# 3. Vérifier qu'Ollama fonctionne
curl http://127.0.0.1:11434/api/tags

# 4. Télécharger un modèle
ollama pull gemma4:e4b
```

---

## 📊 Impact

### Sécurité

| Aspect             | Avant       | Après                      |
| ------------------ | ----------- | -------------------------- |
| Localhost          | ✅ Autorisé | ✅ Autorisé (inchangé)     |
| Externe sans token | ✅ Autorisé | ❌ Bloqué (403)            |
| Externe avec token | N/A         | ✅ Autorisé                |
| Protection         | ❌ Aucune   | ✅ JWT requis pour externe |

### Workspace Ollama

| Aspect         | Avant                          | Après                       |
| -------------- | ------------------------------ | --------------------------- |
| Emplacement    | `%USERPROFILE%\.ollama\models` | `a11/runtime/ollama_models` |
| Contrôle       | ❌ Aucun                       | ✅ Lien symbolique          |
| Centralisation | ❌ Non                         | ✅ Oui                      |
| Backup         | ⚠️ Difficile                   | ✅ Facile                   |

---

## 🚀 Déploiement

### Local

1. **Activer la sécurité NEZ** (déjà fait) :

   ```bash
   # .env.local
   NEZ_SECURITY_MODE=dev
   ```

2. **Configurer le workspace Ollama** :

   ```powershell
   # PowerShell en Admin
   .\a11\launchers\setup-ollama-workspace.ps1
   ```

3. **Redémarrer le backend** :

   ```bash
   cd a11/backend/apps/server
   node server.cjs
   ```

4. **Tester** :

   ```bash
   # Localhost (doit passer)
   curl http://localhost:3000/api/chat -d '{"message":"Hello"}'

   # Externe (doit échouer sans token)
   curl https://alphaonze.funesterie.pro/api/chat -d '{"message":"Hello"}'
   ```

### Production (Railway)

1. **Passer en mode `strict`** :

   ```bash
   # Variables d'environnement Railway
   NEZ_SECURITY_MODE=strict
   ```

2. **Vérifier les CORS** :

   ```bash
   CORS_ORIGINS=https://a11.funesterie.pro,https://alphaonze.funesterie.pro
   ```

3. **Workspace Ollama** : Non applicable (Railway n'utilise pas Ollama local)

---

## ✅ Checklist de Complétion

- [x] Activer `NEZ_SECURITY_MODE=dev` dans `.env.local`
- [x] Créer documentation `NEZ_SECURITY.md`
- [x] Créer documentation `OLLAMA_WORKSPACE.md`
- [x] Créer script `setup-ollama-workspace.ps1`
- [x] Créer changelog `CHANGELOG_2026-04-26_SECURITY.md`
- [ ] Tester la sécurité NEZ (localhost + externe)
- [ ] Tester le script Ollama workspace
- [ ] Commit et push

---

## 🚦 Prochaines Étapes

### Priorité A (immédiat)

1. ⬜ Tester la sécurité NEZ
2. ⬜ Tester le script Ollama workspace
3. ⬜ Commit et push

### Priorité B (court terme)

1. ⬜ Implémenter rate limiting
2. ⬜ Ajouter logs de sécurité
3. ⬜ Créer dashboard de monitoring

### Priorité C (moyen terme)

1. ⬜ Passer en mode `strict` pour production
2. ⬜ Implémenter refresh token
3. ⬜ Ajouter 2FA (optionnel)

---

**Auteur** : Funesterie / A11 Team  
**Dernière mise à jour** : 2026-04-26  
**Version** : 1.0.0
