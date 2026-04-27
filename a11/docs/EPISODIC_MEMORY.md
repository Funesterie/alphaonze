# Mémoire Épisodique - A11

## Vue d'ensemble

La **mémoire épisodique** stocke les préférences utilisateur et les événements importants sur plusieurs jours/semaines. C'est une mémoire simple, sans ML ni heuristiques complexes.

## Architecture Simple

- **Stockage** : Fichiers JSON plats (un par utilisateur)
- **Structure** : `{ id, userId, type, content, metadata, timestamp, createdAt }`
- **Types** : `preference`, `event`, `context`
- **Pas de** : ML, regex complexe, heuristiques, canonicalisation

## Types d'épisodes

### 1. Préférence (`preference`)

Préférences utilisateur persistantes.

**Exemples** :

- "Langue préférée: français"
- "Format de date: DD/MM/YYYY"
- "Ton de réponse: formel"

### 2. Événement (`event`)

Événements importants dans l'historique utilisateur.

**Exemples** :

- "Projet X lancé le 2026-04-20"
- "Migration vers PostgreSQL terminée"
- "Bug critique résolu"

### 3. Contexte (`context`)

Informations contextuelles récentes.

**Exemples** :

- "Travaille actuellement sur le module auth"
- "En phase de debug du système de paiement"
- "Prépare une démo pour vendredi"

## API REST

Tous les endpoints nécessitent un JWT valide.

### POST `/api/episodic/add`

Ajoute un épisode.

**Body** :

```json
{
  "type": "preference",
  "content": "Langue préférée: français",
  "metadata": {
    "key": "language",
    "value": "fr"
  }
}
```

**Réponse** :

```json
{
  "ok": true,
  "episode": {
    "id": "ep_1714089600000_abc123",
    "userId": "user123",
    "type": "preference",
    "content": "Langue préférée: français",
    "metadata": { "key": "language", "value": "fr" },
    "timestamp": "2026-04-26T10:00:00.000Z",
    "createdAt": 1714089600000
  },
  "totalEpisodes": 42
}
```

### GET `/api/episodic/list`

Liste les épisodes avec filtres optionnels.

**Query params** :

- `type` : Filtrer par type (`preference`, `event`, `context`)
- `days` : Derniers N jours (ex: `7`)
- `since` : Date de début (ISO 8601)
- `until` : Date de fin (ISO 8601)
- `limit` : Nombre max de résultats (défaut: 100, max: 1000)

**Exemple** :

```
GET /api/episodic/list?type=preference&days=30
```

**Réponse** :

```json
{
  "ok": true,
  "episodes": [...],
  "total": 15,
  "filtered": true
}
```

### GET `/api/episodic/preferences`

Récupère uniquement les préférences.

**Réponse** :

```json
{
  "ok": true,
  "episodes": [
    {
      "id": "ep_...",
      "type": "preference",
      "content": "Langue préférée: français",
      ...
    }
  ],
  "total": 5
}
```

### POST `/api/episodic/preference`

Définit une préférence (raccourci pour `add` avec type `preference`).

**Body** :

```json
{
  "key": "language",
  "value": "fr"
}
```

**Réponse** :

```json
{
  "ok": true,
  "episode": {...},
  "totalEpisodes": 43
}
```

### GET `/api/episodic/context`

Récupère le contexte récent formaté.

**Query params** :

- `days` : Nombre de jours (défaut: 7)

**Réponse** :

```json
{
  "ok": true,
  "episodes": [...],
  "total": 12,
  "contextText": "Préférences utilisateur :\n- Langue préférée: français\n\nÉvénements récents :\n- [26/04/2026] Projet X lancé\n..."
}
```

### DELETE `/api/episodic/:episodeId`

Supprime un épisode spécifique.

**Exemple** :

```
DELETE /api/episodic/ep_1714089600000_abc123
```

**Réponse** :

```json
{
  "ok": true,
  "deleted": true,
  "remainingEpisodes": 41
}
```

### DELETE `/api/episodic/clear`

Supprime tous les épisodes de l'utilisateur.

**Réponse** :

```json
{
  "ok": true,
  "cleared": true
}
```

### GET `/api/episodic/stats`

Statistiques de la mémoire épisodique.

**Réponse** :

```json
{
  "ok": true,
  "userId": "user123",
  "totalEpisodes": 42,
  "byType": {
    "preference": 5,
    "event": 30,
    "context": 7
  },
  "oldestEpisode": "2026-01-15T08:00:00.000Z",
  "newestEpisode": "2026-04-26T10:00:00.000Z",
  "retentionDays": 90,
  "maxEpisodes": 1000
}
```

## Utilisation Programmatique

```javascript
const {
  addEpisode,
  getEpisodes,
  getPreferences,
  setPreference,
  getRecentContext,
  deleteEpisode,
  clearUserEpisodes,
  buildEpisodicContext,
  getStats,
} = require("./lib/episodic-memory.cjs");

// Ajouter un épisode
const result = addEpisode("user123", "event", "Projet X lancé", {
  projectId: "proj_x",
});

// Récupérer les épisodes récents
const recent = getRecentContext("user123", 7);

// Définir une préférence
const pref = setPreference("user123", "language", "fr");

// Construire le contexte textuel
const context = buildEpisodicContext("user123", 7);
console.log(context);
// Préférences utilisateur :
// - Langue préférée: français
//
// Événements récents :
// - [26/04/2026] Projet X lancé
```

## Intégration dans le Chat

Le contexte épisodique est **automatiquement injecté** dans le chat pipeline via `loadUserMemoryContext()`.

### Flux

1. L'utilisateur envoie un message
2. `loadUserMemoryContext()` récupère le contexte épisodique (7 derniers jours)
3. `buildEpisodicContext()` formate le contexte en texte
4. Le contexte est injecté dans les messages système
5. Le LLM reçoit les préférences et événements récents

### Message Système Injecté

```
# Mémoire épisodique (préférences et contexte récent)

Préférences utilisateur :
- Langue préférée: français
- Format de date: DD/MM/YYYY

Événements récents :
- [26/04/2026] Projet X lancé
- [25/04/2026] Migration PostgreSQL terminée

Contexte récent :
- Travaille actuellement sur le module auth

Tiens compte de ces préférences et événements récents dans ta réponse.
```

## Configuration

### Variables d'environnement

```bash
# Répertoire de stockage (défaut: a11_memory/episodic)
A11_EPISODIC_MEMORY_DIR=/path/to/episodic

# Nombre max d'épisodes par utilisateur (défaut: 1000)
A11_MAX_EPISODES_PER_USER=1000

# Durée de rétention en jours (défaut: 90)
A11_EPISODE_RETENTION_DAYS=90
```

### Stockage

Les épisodes sont stockés dans `a11_memory/episodic/` :

```
a11_memory/
  episodic/
    user123.json
    user456.json
    anonymous.json
```

Chaque fichier contient un tableau JSON d'épisodes.

## Nettoyage Automatique

- Les épisodes plus anciens que `A11_EPISODE_RETENTION_DAYS` sont supprimés automatiquement
- Si le nombre d'épisodes dépasse `A11_MAX_EPISODES_PER_USER`, les plus anciens sont supprimés
- Le nettoyage se fait à chaque ajout d'épisode

## Cas d'Usage

### 1. Préférences Utilisateur

```javascript
// L'utilisateur dit : "Je préfère les réponses courtes"
addEpisode("user123", "preference", "Préfère les réponses courtes");

// Plus tard, le LLM voit cette préférence et adapte ses réponses
```

### 2. Suivi de Projet

```javascript
// L'utilisateur dit : "J'ai lancé le projet X aujourd'hui"
addEpisode("user123", "event", "Projet X lancé", { projectId: "proj_x" });

// Plus tard, le LLM se souvient du contexte du projet
```

### 3. Contexte de Travail

```javascript
// L'utilisateur dit : "Je travaille sur le module auth cette semaine"
addEpisode("user123", "context", "Travaille sur le module auth");

// Le LLM adapte ses suggestions au contexte actuel
```

## Limitations

1. **Pas de recherche sémantique** : Filtrage simple par type/date uniquement
2. **Pas de déduplication** : Les épisodes similaires ne sont pas fusionnés
3. **Pas d'extraction automatique** : Les épisodes doivent être ajoutés manuellement (via API ou frontend)
4. **Stockage local** : Pas de base de données, juste des fichiers JSON

## Différences avec les Autres Mémoires

| Mémoire               | Durée     | Contenu                 | Recherche               |
| --------------------- | --------- | ----------------------- | ----------------------- |
| **Épisodique**        | 90 jours  | Préférences, événements | Par type/date           |
| **Vectorielle (RAG)** | Illimitée | Échanges passés         | Sémantique (embeddings) |
| **Knowledge Graph**   | Illimitée | Relations structurées   | Par entité/relation     |
| **Logique**           | Session   | Résumé conversation     | N/A                     |

## Roadmap

### Implémenté ✅

- Stockage JSON simple
- API REST complète (8 endpoints)
- Intégration automatique dans le chat
- Nettoyage automatique
- Filtrage par type/date

### À Faire ⬜

- Extraction automatique des préférences depuis les messages
- Interface frontend pour gérer les épisodes
- Export/import des épisodes
- Synchronisation multi-device

## Support

Pour toute question :

1. Vérifier que le répertoire `a11_memory/episodic/` existe
2. Vérifier les logs : `grep "episodic-memory" logs/a11.log`
3. Tester les endpoints API avec curl
4. Consulter les stats : `GET /api/episodic/stats`

---

**Dernière mise à jour** : 2026-04-26  
**Version** : 1.0.0  
**Auteur** : Funesterie / A11 Team
