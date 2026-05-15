# Fonctionnalités Session A11

## ✅ Activé et fonctionnel

### Authentification JWT

- **Login** : `POST /api/auth/login` (username/email + password)
- **Register** : `POST /api/auth/register` (username + email + password)
- **Password Reset** : `POST /api/auth/forgot-password` + `POST /api/auth/reset-password`
- **Token JWT** : Valide 7 jours, signé avec `JWT_SECRET`
- **Local Auth Store** : Fichier JSON `runtime/auth/local-users.json` (pas besoin de PostgreSQL)
- **Admin par défaut** : `Djeff` / `1991` (configurable via env vars)

### Historique de Conversation

- **Par utilisateur** : Chaque user a son propre historique isolé
- **Par conversation** : Conversations multiples avec ID unique
- **Endpoints** :
  - `GET /api/a11/history` - Liste toutes les conversations
  - `GET /api/a11/history/:id` - Messages d'une conversation
  - `DELETE /api/a11/history` - Effacer tout l'historique
  - `DELETE /api/a11/history/:id` - Effacer une conversation
- **Stockage** :
  - Phantom memory (RAM) - toujours actif
  - PostgreSQL `messages` table - optionnel, pour persistance long-terme
  - JSONL log files - `a11_memory/conversations/YYYYMMDD.jsonl`

### Mémoire Structurée

- **Facts** : Faits clés avec score de pertinence
- **Tasks** : Tâches avec statut (open/in_progress/done/blocked)
- **Files** : Références de fichiers avec expiration
- **Endpoints** :
  - `GET /api/memory` - Récupérer la mémoire structurée
  - `POST /api/memory/facts` - Ajouter un fait
  - `POST /api/memory/tasks` - Ajouter une tâche
  - `DELETE /api/memory/prune` - Nettoyer la mémoire expirée
- **Rétention** :
  - Facts : 30 jours (configurable via `FACT_RETENTION_DAYS`)
  - Tasks : 60 jours (configurable via `TASK_RETENTION_DAYS`)
  - Files : 30 jours (configurable via `FILE_RETENTION_DAYS`)

### Mémoire Phantom (Éphémère)

- **États** : `active` (court-terme), `useful` (moyen-terme), `ghost` (marqué pour suppression), `archive`
- **TTL adaptatif** : Basé sur utilité, confiance, type de mémoire
- **Stockage** : RAM (pas besoin de Redis)
- **Scope** : Par conversation ou par utilisateur

### Ressources de Conversation

- **Types** : `file`, `artifact`, `image`, `video`
- **Expiration** : Fichiers temporaires expirent après 24h (configurable)
- **Endpoints** :
  - `GET /api/resources` - Liste les ressources
  - `POST /api/resources` - Créer une ressource
  - `DELETE /api/resources/:id` - Supprimer une ressource

### Sécurité NEZ

- **Mode `off`** : Pas d'auth (dev local uniquement)
- **Mode `dev`** : Autorise localhost + tokens JWT de session
- **Mode `prod`** : Vérifie toujours les tokens
- **Headers acceptés** : `X-NEZ-TOKEN`, `Authorization: Bearer`, `x-api-key`
- **Tokens JWT** : Enregistrés automatiquement après login

## 🔧 Configuration

### Variables d'environnement essentielles

```bash
# JWT (obligatoire pour les sessions)
# JWT_SECRET is configured via the deployment secret store.
JWT_EXPIRY=7d

# Admin par défaut (local auth)
DEFAULT_ADMIN_USERNAME=Djeff
DEFAULT_ADMIN_PASSWORD=1991
DEFAULT_ADMIN_EMAIL=djeff@a11.local

# Sécurité NEZ
NEZ_SECURITY_MODE=off  # dev local
NEZ_SECURITY_MODE=dev  # exposé via Caddy

# LLM Router (fix erreur 502)
LLM_ROUTER_URL=http://127.0.0.1:11434
OLLAMA_BASE=http://127.0.0.1:11434
```

### Variables optionnelles (PostgreSQL)

```bash
# PostgreSQL (optionnel, pour persistance long-terme)
DATABASE_URL=postgresql://user:pass@host:5432/dbname

# Redis (optionnel, pour mémoire phantom distribuée)
QFLUSH_REDIS_URL=redis://localhost:6379

# Email (optionnel, pour password reset)
# RESEND_API_KEY is configured via the deployment secret store.
# ou SMTP
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=user
SMTP_PASS=pass
```

## 📊 Stockage des données

### Sans PostgreSQL (mode local auth)

- **Users** : `runtime/auth/local-users.json`
- **Messages** : Phantom memory (RAM) + JSONL logs
- **Facts/Tasks/Files** : Phantom memory (RAM)
- **Conversations** : JSONL logs `a11_memory/conversations/`

### Avec PostgreSQL

- **Users** : Table `users`
- **Messages** : Table `messages` + phantom memory + JSONL logs
- **Facts** : Table `user_facts`
- **Tasks** : Table `user_tasks`
- **Files** : Table `user_files`
- **Resources** : Table `conversation_resources`

## 🚀 Utilisation Frontend

### Login/Register

```typescript
import { login, register, hasAuthToken, getAuthIdentity } from "@/lib/api";

// Register
await register("username", "email@example.com", "password");

// Login
await login("username", "password");

// Check auth
if (hasAuthToken()) {
  const { id, username } = getAuthIdentity();
  console.log("Logged in as:", username);
}
```

### API Calls avec Auth

```typescript
import { authFetch, buildAuthHeaders } from "@/lib/api";

// Fetch avec auth automatique
const response = await authFetch("/api/a11/history");

// Headers manuels
const headers = buildAuthHeaders();
// { 'Authorization': 'Bearer <jwt>', 'X-NEZ-TOKEN': '<jwt>' }
```

### Historique de Conversation

```typescript
// Liste des conversations
const conversations = await fetch("/api/a11/history", {
  headers: buildAuthHeaders(),
}).then((r) => r.json());

// Messages d'une conversation
const messages = await fetch("/api/a11/history/conv-123", {
  headers: buildAuthHeaders(),
}).then((r) => r.json());
```

## 🔐 Routes Protégées

### Nécessitent JWT (middleware `verifyJWT`)

- `/api/ai/*` - Chat
- `/api/agent/*` - Agent/tools
- `/api/files/*` - Fichiers
- `/api/artifacts/*` - Artifacts
- `/api/resources/*` - Ressources
- `/api/mail/*` - Email
- `/api/a11/history` - Historique
- `/api/memory/*` - Mémoire
- `/api/a11host/*` - A11Host control

### Bloquées par Caddy (local-only)

- `/api/v1/vs/*` - VS Code bridge
- `/api/v1/fs/*` - Filesystem
- `/api/admin/*` - Admin
- `/api/tools/run` - Execution
- `/api/browse*` - Navigation

## 📝 Notes

1. **Local Auth** : Fonctionne sans PostgreSQL, idéal pour dev/démo
2. **Phantom Memory** : Fonctionne en RAM, pas besoin de Redis
3. **JSONL Logs** : Backup automatique des conversations dans `a11_memory/`
4. **JWT Tokens** : Stockés dans localStorage frontend, envoyés automatiquement
5. **NEZ Security** : Protège toutes les routes quand activé, accepte les JWT de session
6. **Admin Default** : Créé automatiquement au premier démarrage si aucun user existe

## 🐛 Troubleshooting

### Erreur 502 "upstream_unreachable 127.0.0.1:8080"

→ Ajouter `LLM_ROUTER_URL=http://127.0.0.1:11434` dans `.env.local`

### Erreur 401 "JWT token manquant"

→ Vérifier que `JWT_SECRET` est défini dans `.env.local`

### Erreur 403 "Nezlephant ne te reconnaît pas"

→ Vérifier `NEZ_SECURITY_MODE` (mettre `off` en dev local)

### Historique vide après redémarrage

→ Normal sans PostgreSQL (phantom memory en RAM). Activer PostgreSQL pour persistance.

### Password reset ne fonctionne pas

→ Configurer `RESEND_API_KEY` ou SMTP dans `.env.local`
