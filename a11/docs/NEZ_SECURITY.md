# Sécurité NEZ - A11

## Vue d'ensemble

**NEZ** est le système de sécurité d'A11 qui contrôle l'accès aux endpoints API. Il fonctionne en combinaison avec l'authentification JWT.

## Modes de Sécurité

### Mode `off` (Développement Local Pur)

**Configuration** :

```bash
NEZ_SECURITY_MODE=off
```

**Comportement** :

- ✅ Toutes les requêtes sont autorisées (localhost et externe)
- ✅ Pas de vérification de token
- ✅ Pas d'authentification requise
- ⚠️ **DANGEREUX** : À utiliser uniquement en développement local isolé

**Cas d'usage** :

- Développement local sans exposition externe
- Tests rapides
- Debugging

---

### Mode `dev` (Développement avec Exposition) ✅ **ACTIVÉ**

**Configuration** :

```bash
NEZ_SECURITY_MODE=dev
```

**Comportement** :

- ✅ Requêtes depuis `localhost` / `127.0.0.1` : **autorisées sans token**
- 🔒 Requêtes externes : **nécessitent un JWT valide**
- ✅ Protection contre les accès non autorisés
- ✅ Permet le développement local sans friction

**Cas d'usage** :

- Backend exposé via Caddy/tunnel (Free, ngrok, etc.)
- Développement avec frontend distant
- Tests avec plusieurs devices
- **Configuration actuelle d'A11** ✅

**Comment ça marche** :

1. Le middleware `nezAuth` vérifie l'origine de la requête
2. Si `req.ip` est `127.0.0.1` ou `::1` → **autorisé**
3. Sinon, vérifie le header `X-NEZ-TOKEN` ou `Authorization`
4. Si token valide (JWT) → **autorisé**
5. Sinon → **403 Forbidden**

---

### Mode `strict` (Production)

**Configuration** :

```bash
NEZ_SECURITY_MODE=strict
```

**Comportement** :

- 🔒 **Toutes** les requêtes nécessitent un JWT valide (même localhost)
- 🔒 Pas d'exception pour localhost
- 🔒 Vérification stricte des tokens
- 🔒 Rate limiting activé

**Cas d'usage** :

- Déploiement production (Railway, etc.)
- Environnement multi-utilisateurs
- Sécurité maximale

---

## Authentification JWT

### Obtenir un Token

```bash
# Login avec les credentials par défaut
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"Djeff","password":"1991"}'
```

**Réponse** :

```json
{
  "ok": true,
  "token": "<JWT_TOKEN>",
  "user": {
    "id": "1",
    "username": "Djeff",
    "email": "djeff@a11.local"
  }
}
```

### Utiliser le Token

#### Option 1 : Header `Authorization`

```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message":"Hello"}'
```

#### Option 2 : Header `X-NEZ-TOKEN`

```bash
curl -X POST http://localhost:3000/api/chat \
  -H "X-NEZ-TOKEN: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \
  -H "Content-Type: application/json" \
  -d '{"message":"Hello"}'
```

---

## Routes Protégées

### Routes Publiques (pas de JWT requis)

- `GET /` - Page d'accueil
- `GET /health` - Health check
- `POST /api/auth/login` - Login
- `POST /api/auth/register` - Inscription
- `POST /api/auth/forgot-password` - Mot de passe oublié
- `GET /files/*` - Fichiers publics (si configuré)

### Routes Protégées (JWT requis en mode `dev` pour requêtes externes)

- `POST /api/chat` - Chat
- `POST /api/image/generate` - Génération d'image
- `POST /api/video/generate` - Génération de vidéo
- `GET /api/history` - Historique
- `POST /api/vector-memory/*` - Mémoire vectorielle
- `POST /api/knowledge-graph/*` - Graphe de connaissances
- `POST /api/reflection/*` - Reflection Loop
- `POST /api/episodic/*` - Mémoire épisodique
- `POST /api/agent/run` - Exécution d'agent

### Routes Bloquées par Caddy (403 même avec JWT)

Ces routes sont bloquées au niveau du reverse proxy Caddy pour une sécurité supplémentaire :

- `/api/v1/vs/*` - VS Code bridge
- `/api/v1/fs/*` - Filesystem
- `/api/admin/*` - Administration
- `/api/tools/run` - Exécution de tools
- `/api/browse*` - Navigation

**Ces routes ne sont accessibles que depuis localhost**, même avec un JWT valide.

---

## Configuration Frontend

Le frontend A11 envoie automatiquement le JWT dans les requêtes.

### `.env` (Frontend)

```bash
# URL du backend
VITE_A11_API_BASE_URL=http://localhost:3000

# URL du backend online (si exposé)
VITE_A11_ONLINE_API_BASE_URL=https://alphaonze.funesterie.pro
```

### Code Frontend (exemple)

```typescript
// lib/api-client.ts
const token = localStorage.getItem("a11_jwt_token");

const response = await fetch(`${API_BASE_URL}/api/chat`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-NEZ-TOKEN": token || "",
  },
  body: JSON.stringify({ message: "Hello" }),
});
```

---

## Middleware NEZ

### Implémentation

Le middleware `nezAuth` est défini dans `src/middleware/nez-auth.cjs` :

```javascript
function nezAuth(req, res, next) {
  const mode = process.env.NEZ_SECURITY_MODE || "off";

  // Mode off : tout passe
  if (mode === "off") {
    return next();
  }

  // Mode dev : localhost autorisé sans token
  if (mode === "dev") {
    const ip = req.ip || req.connection.remoteAddress;
    if (ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1") {
      return next();
    }
  }

  // Vérifier le token JWT
  const token =
    req.headers["x-nez-token"] ||
    req.headers.authorization?.replace("Bearer ", "");

  if (!token) {
    return res.status(403).json({
      ok: false,
      error: "nez_token_required",
      message: "NEZ token required for external requests",
    });
  }

  // Vérifier la validité du JWT
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(403).json({
      ok: false,
      error: "invalid_token",
      message: "Invalid or expired token",
    });
  }
}
```

---

## Activation de la Sécurité NEZ

### Étape 1 : Modifier `.env.local`

```bash
# Passer de off à dev
NEZ_SECURITY_MODE=dev
```

### Étape 2 : Redémarrer le Backend

```bash
cd a11/backend/apps/server
node server.cjs
```

### Étape 3 : Tester

#### Test 1 : Requête depuis localhost (doit passer)

```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"Hello"}'
```

**Résultat attendu** : ✅ Réponse normale

#### Test 2 : Requête externe sans token (doit échouer)

```bash
# Depuis une autre machine ou via le tunnel
curl -X POST https://alphaonze.funesterie.pro/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"Hello"}'
```

**Résultat attendu** : ❌ 403 Forbidden

#### Test 3 : Requête externe avec token (doit passer)

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

---

## Gestion des Tokens

### Durée de Vie

```bash
# Dans .env.local
JWT_EXPIRY=7d  # 7 jours
```

### Renouvellement

Le frontend doit gérer le renouvellement automatique :

```typescript
// Vérifier si le token expire bientôt
const decoded = jwt_decode(token);
const expiresIn = decoded.exp * 1000 - Date.now();

if (expiresIn < 24 * 60 * 60 * 1000) {
  // Moins de 24h avant expiration → renouveler
  const newToken = await refreshToken(token);
  localStorage.setItem("a11_jwt_token", newToken);
}
```

### Révocation

Pour révoquer un token, il faut :

1. Changer le `JWT_SECRET` dans `.env.local`
2. Redémarrer le backend
3. Tous les tokens existants deviennent invalides

---

## Sécurité Supplémentaire

### CORS

```bash
# Dans .env.local
CORS_ORIGINS=http://127.0.0.1:3000,http://localhost:5173,https://alphaonze.funesterie.pro
```

### Rate Limiting (à implémenter)

```javascript
// Limiter à 100 requêtes par minute par IP
const rateLimit = require("express-rate-limit");

const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100,
  message: "Too many requests, please try again later",
});

app.use("/api/", limiter);
```

### HTTPS

En production, toujours utiliser HTTPS :

- Caddy gère automatiquement les certificats Let's Encrypt
- Railway fournit HTTPS par défaut

---

## Troubleshooting

### Erreur "NEZ token required"

**Cause** : Requête externe sans token en mode `dev`.

**Solution** :

1. Obtenir un token via `/api/auth/login`
2. Inclure le token dans le header `X-NEZ-TOKEN` ou `Authorization`

### Erreur "Invalid or expired token"

**Cause** : Token JWT invalide ou expiré.

**Solution** :

1. Se reconnecter via `/api/auth/login`
2. Vérifier que `JWT_SECRET` n'a pas changé

### Requête localhost bloquée en mode `dev`

**Cause** : L'IP n'est pas détectée comme localhost.

**Solution** :

1. Vérifier `req.ip` dans les logs
2. Ajouter l'IP dans la whitelist du middleware

---

## Résumé

| Mode     | Localhost     | Externe       | Production     |
| -------- | ------------- | ------------- | -------------- |
| `off`    | ✅ Sans token | ✅ Sans token | ❌ Dangereux   |
| `dev`    | ✅ Sans token | 🔒 JWT requis | ⚠️ OK pour dev |
| `strict` | 🔒 JWT requis | 🔒 JWT requis | ✅ Recommandé  |

**Configuration actuelle d'A11** : `dev` ✅

---

**Dernière mise à jour** : 2026-04-26  
**Version** : 1.0.0  
**Auteur** : Funesterie / A11 Team
