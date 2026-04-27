# Changelog - Mémoire Épisodique

**Date** : 2026-04-26  
**Priorité** : C (Recommandation A11)  
**Status** : ✅ Implémenté

---

## 🎯 Objectif

Implémenter une **mémoire épisodique** simple pour stocker les préférences utilisateur et les événements importants sur plusieurs jours/semaines.

**Approche** : Architecture simple sans ML, regex complexe, ou heuristiques.

---

## 📦 Modules Créés

### 1. `lib/episodic-memory.cjs`

Module de stockage et récupération des épisodes.

**Fonctions principales** :

- `addEpisode(userId, type, content, metadata)` : Ajoute un épisode
  - Types : `preference`, `event`, `context`
  - Retour : `{ ok, episode, totalEpisodes }`

- `getEpisodes(userId, options)` : Récupère les épisodes avec filtres
  - Filtres : `type`, `days`, `since`, `until`, `limit`
  - Retour : `{ ok, episodes, total, filtered }`

- `getPreferences(userId)` : Récupère uniquement les préférences
  - Raccourci pour `getEpisodes(userId, { type: 'preference' })`

- `setPreference(userId, key, value, metadata)` : Définit une préférence
  - Raccourci pour `addEpisode(userId, 'preference', ...)`

- `getRecentContext(userId, days)` : Récupère le contexte récent
  - Défaut : 7 derniers jours

- `deleteEpisode(userId, episodeId)` : Supprime un épisode

- `clearUserEpisodes(userId)` : Supprime tous les épisodes

- `buildEpisodicContext(userId, days)` : Construit un contexte textuel formaté
  - Groupe par type (préférences, événements, contexte)
  - Format lisible pour injection dans le chat

- `getStats(userId)` : Statistiques de la mémoire épisodique

**Stockage** :

- Fichiers JSON plats dans `a11_memory/episodic/`
- Un fichier par utilisateur : `{userId}.json`
- Structure : `[{ id, userId, type, content, metadata, timestamp, createdAt }, ...]`

**Nettoyage automatique** :

- Épisodes plus anciens que `EPISODE_RETENTION_DAYS` (défaut: 90 jours)
- Limite de `MAX_EPISODES_PER_USER` (défaut: 1000)

---

### 2. `src/routes/episodic-memory.cjs`

Routes API pour la mémoire épisodique.

**Endpoints** :

#### POST `/api/episodic/add`

Ajoute un épisode.

**Body** :

```json
{
  "type": "preference",
  "content": "Langue préférée: français",
  "metadata": { "key": "language", "value": "fr" }
}
```

#### GET `/api/episodic/list`

Liste les épisodes avec filtres.

**Query params** : `type`, `days`, `since`, `until`, `limit`

#### GET `/api/episodic/preferences`

Récupère uniquement les préférences.

#### POST `/api/episodic/preference`

Définit une préférence (raccourci).

**Body** :

```json
{
  "key": "language",
  "value": "fr"
}
```

#### GET `/api/episodic/context`

Récupère le contexte récent formaté.

**Query params** : `days` (défaut: 7)

#### DELETE `/api/episodic/:episodeId`

Supprime un épisode spécifique.

#### DELETE `/api/episodic/clear`

Supprime tous les épisodes de l'utilisateur.

#### GET `/api/episodic/stats`

Statistiques de la mémoire épisodique.

**Sécurité** : Tous les endpoints nécessitent un JWT valide (`verifyJWT` middleware).

---

## 🔧 Modifications dans `server.cjs`

### Imports ajoutés

```javascript
// Ligne ~25
const { buildEpisodicContext } = require("./lib/episodic-memory.cjs");

// Ligne ~372
const createEpisodicMemoryRouter = require("./src/routes/episodic-memory.cjs");
```

### Router monté

```javascript
// Ligne ~12383
app.use(
  createEpisodicMemoryRouter({
    verifyJWT,
  }),
);
```

### Intégration dans `loadUserMemoryContext()`

```javascript
// Récupérer le contexte épisodique (préférences et événements récents)
let episodicContext = "";
try {
  episodicContext = buildEpisodicContext(normalizedUserId, 7);
} catch (error_) {
  console.warn(
    "[A11][EPISODIC] episodic context retrieval failed:",
    error_?.message,
  );
}

return {
  // ... autres contextes
  episodicContext,
};
```

### Intégration dans `buildChatMessagesWithMemory()`

**Signature mise à jour** :

```javascript
function buildChatMessagesWithMemory(
  baseMessages,
  logicalMemory,
  structuredMemoryContext,
  conversationResourceContext,
  systemPrompt,
  ephemeralMemoryContext = '',
  vectorContext = '',
  knowledgeGraphContext = '',
  episodicContext = ''  // ← Nouveau paramètre
)
```

**Injection du contexte** :

```javascript
// Injecter le contexte épisodique si disponible
const normalizedEpisodicContext = String(episodicContext || "").trim();
if (normalizedEpisodicContext) {
  messages.push({
    role: "system",
    content: `# Mémoire épisodique (préférences et contexte récent)\n\n${normalizedEpisodicContext}\n\nTiens compte de ces préférences et événements récents dans ta réponse.`,
  });
}
```

### Mise à jour de tous les appels

4 appels à `buildChatMessagesWithMemory()` mis à jour :

1. `buildQflushMessagesWithMemory()` (ligne ~10365)
2. `proxyQflushChat()` (ligne ~10413)
3. `shouldAutoUseInternetAgent()` (ligne ~10709)
4. Route `/v1/chat/completions` (ligne ~10774)
5. Route `/api/agent/run` (ligne ~12062)

---

## 🌐 Variables d'Environnement

### Nouvelles variables (optionnelles)

```bash
# Répertoire de stockage (défaut: a11_memory/episodic)
A11_EPISODIC_MEMORY_DIR=/path/to/episodic

# Nombre max d'épisodes par utilisateur (défaut: 1000)
A11_MAX_EPISODES_PER_USER=1000

# Durée de rétention en jours (défaut: 90)
A11_EPISODE_RETENTION_DAYS=90
```

---

## 📊 Flux d'Intégration

### Injection Automatique dans le Chat

```
1. Utilisateur envoie un message
   ↓
2. loadUserMemoryContext(userId, message, conversationId)
   ↓
3. buildEpisodicContext(userId, 7)  ← Récupère 7 derniers jours
   ↓
4. Format le contexte en texte :
   - Préférences utilisateur
   - Événements récents (5 derniers)
   - Contexte récent (3 derniers)
   ↓
5. buildChatMessagesWithMemory(..., episodicContext)
   ↓
6. Injection dans les messages système
   ↓
7. LLM reçoit le contexte épisodique
```

### Exemple de Contexte Injecté

```
# Mémoire épisodique (préférences et contexte récent)

Préférences utilisateur :
- Langue préférée: français
- Format de date: DD/MM/YYYY
- Ton de réponse: formel

Événements récents :
- [26/04/2026] Projet X lancé
- [25/04/2026] Migration PostgreSQL terminée
- [24/04/2026] Bug critique résolu

Contexte récent :
- Travaille actuellement sur le module auth
- En phase de debug du système de paiement
- Prépare une démo pour vendredi

Tiens compte de ces préférences et événements récents dans ta réponse.
```

---

## 🧪 Tests

### Tests manuels effectués

```bash
# Vérifier la syntaxe
node --check a11/backend/apps/server/lib/episodic-memory.cjs
node --check a11/backend/apps/server/src/routes/episodic-memory.cjs
node --check a11/backend/apps/server/server.cjs

# Tester les endpoints (nécessite un JWT valide)
# 1. Ajouter un épisode
curl -X POST http://localhost:3000/api/episodic/add \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"type":"preference","content":"Langue préférée: français"}'

# 2. Lister les épisodes
curl -X GET "http://localhost:3000/api/episodic/list?days=7" \
  -H "Authorization: Bearer $JWT_TOKEN"

# 3. Récupérer le contexte
curl -X GET "http://localhost:3000/api/episodic/context?days=7" \
  -H "Authorization: Bearer $JWT_TOKEN"

# 4. Statistiques
curl -X GET http://localhost:3000/api/episodic/stats \
  -H "Authorization: Bearer $JWT_TOKEN"
```

### Tests à ajouter

- [ ] Tests unitaires pour `episodic-memory.cjs`
- [ ] Tests d'intégration pour les endpoints API
- [ ] Tests du nettoyage automatique
- [ ] Tests de l'injection dans le chat

---

## 📚 Documentation

### Fichiers créés

- **`a11/docs/EPISODIC_MEMORY.md`** : Documentation complète
  - Vue d'ensemble et architecture
  - Types d'épisodes (preference, event, context)
  - Documentation API REST (8 endpoints)
  - Utilisation programmatique
  - Intégration dans le chat
  - Configuration et cas d'usage

- **`a11/docs/CHANGELOG_2026-04-26_EPISODIC.md`** : Ce fichier

---

## 🚀 Déploiement

### Local

1. Vérifier que le répertoire `a11_memory/episodic/` existe (créé automatiquement)

2. Redémarrer le backend :

   ```bash
   cd a11/backend/apps/server
   node server.cjs
   ```

3. Tester un endpoint :

   ```bash
   # Obtenir un JWT
   curl -X POST http://localhost:3000/api/auth/login \
     -H "Content-Type: application/json" \
     -d '{"username":"Djeff","password":"1991"}'

   # Ajouter une préférence
   curl -X POST http://localhost:3000/api/episodic/preference \
     -H "Authorization: Bearer $JWT_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"key":"language","value":"fr"}'
   ```

### Production (Railway)

1. Push vers Railway :

   ```bash
   git push railway master
   ```

2. Le répertoire `a11_memory/episodic/` sera créé automatiquement au premier ajout

---

## 📈 Différences avec les Autres Mémoires

| Mémoire               | Durée     | Contenu                 | Recherche     | Complexité |
| --------------------- | --------- | ----------------------- | ------------- | ---------- |
| **Épisodique**        | 90 jours  | Préférences, événements | Par type/date | Simple     |
| **Vectorielle (RAG)** | Illimitée | Échanges passés         | Sémantique    | Moyenne    |
| **Knowledge Graph**   | Illimitée | Relations structurées   | Par entité    | Moyenne    |
| **Logique**           | Session   | Résumé conversation     | N/A           | Simple     |

---

## ✅ Checklist de Complétion

- [x] Module `lib/episodic-memory.cjs` créé
- [x] Routes API `src/routes/episodic-memory.cjs` créées (8 endpoints)
- [x] Import ajouté dans `server.cjs`
- [x] Router monté dans `server.cjs`
- [x] Intégration dans `loadUserMemoryContext()`
- [x] Intégration dans `buildChatMessagesWithMemory()`
- [x] Mise à jour de tous les appels (5 endroits)
- [x] Documentation `EPISODIC_MEMORY.md` créée
- [x] Changelog `CHANGELOG_2026-04-26_EPISODIC.md` créé
- [x] Vérification syntaxe (`node --check`)
- [ ] Tests unitaires
- [ ] Tests d'intégration
- [ ] Extraction automatique des préférences (futur)

---

## 🚦 Prochaines Étapes

### Priorité A (immédiat)

1. ✅ Créer la documentation complète
2. ✅ Créer le changelog
3. ✅ Vérifier la syntaxe avec `node --check`
4. ⬜ Commit et push

### Priorité B (court terme)

1. ⬜ Ajouter des tests automatisés
2. ⬜ Interface frontend pour gérer les épisodes
3. ⬜ Extraction automatique des préférences depuis les messages

### Priorité C (moyen terme)

1. ⬜ Export/import des épisodes
2. ⬜ Synchronisation multi-device
3. ⬜ Métriques et monitoring

---

## 🎓 Philosophie de Design

**Simplicité avant tout** :

- ❌ Pas de ML
- ❌ Pas de regex complexe
- ❌ Pas d'heuristiques
- ❌ Pas de canonicalisation
- ✅ Stockage JSON simple
- ✅ Filtrage par type/date
- ✅ Nettoyage automatique basique

**Pourquoi ?**

- Facile à comprendre et maintenir
- Pas de dépendances lourdes
- Performances prévisibles
- Debugging simple

---

**Auteur** : Funesterie / A11 Team  
**Dernière mise à jour** : 2026-04-26  
**Version** : 1.0.0
