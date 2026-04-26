# Mémoire Vectorielle (RAG) - A11

## Vue d'ensemble

A11 dispose maintenant d'un système de **mémoire long terme** basé sur RAG (Retrieval-Augmented Generation). Ce système permet à A11 de se souvenir des conversations passées et d'utiliser ce contexte pour enrichir ses réponses.

## Architecture

### Composants

1. **`lib/vector-memory.cjs`** : Module principal de gestion de la mémoire vectorielle
   - Génération d'embeddings via Ollama (`nomic-embed-text`)
   - Recherche par similarité cosinus
   - Stockage JSONL par user/conversation
   - Méthodes : `addExchange()`, `search()`, `getRelevantContext()`

2. **`src/routes/vector-memory.cjs`** : API REST pour la mémoire vectorielle
   - `GET /api/vector-memory/search` - Recherche sémantique
   - `GET /api/vector-memory/context` - Contexte pertinent
   - `POST /api/vector-memory/add` - Ajouter échange
   - `GET /api/vector-memory/stats` - Statistiques
   - `DELETE /api/vector-memory/prune` - Nettoyer anciennes entrées

3. **Intégration dans `server.cjs`** :
   - `loadUserMemoryContext()` : Récupère le contexte vectoriel pertinent
   - `buildChatMessagesWithMemory()` : Injecte le contexte dans le prompt
   - `saveChatMemoryMessageWithVector()` : Sauvegarde automatique des échanges

## Fonctionnement

### 1. Sauvegarde automatique

Chaque échange user/assistant est automatiquement sauvegardé dans la mémoire vectorielle :

```javascript
// Message user → stocké temporairement
await saveChatMemoryMessageWithVector(
  userId,
  "user",
  userMessage,
  conversationId,
);

// Message assistant → échange complet sauvegardé avec embedding
await saveChatMemoryMessageWithVector(
  userId,
  "assistant",
  assistantMessage,
  conversationId,
);
```

### 2. Récupération contextuelle

Lors d'une nouvelle requête, A11 recherche les échanges passés pertinents :

```javascript
const vectorMemory = createVectorMemory(userId, conversationId);
const contextResult = await vectorMemory.getRelevantContext(userMessage, {
  k: 3, // Top 3 résultats
  minSimilarity: 0.6, // Seuil de similarité minimum
});
```

### 3. Injection dans le prompt

Le contexte pertinent est injecté dans le prompt système :

```
# Contexte pertinent (mémoire long terme)

Voici des échanges passés pertinents pour cette conversation :

[Échange pertinent #1 - il y a 2h - similarité: 85.3%]
User: Comment générer une image avec A11 ?
Assistant: Pour générer une image, utilise simplement une description...

[Échange pertinent #2 - il y a 1j - similarité: 72.1%]
User: Peux-tu me rappeler comment faire une vidéo ?
Assistant: Pour créer une vidéo, décris la scène...

Utilise ces informations pour enrichir ta réponse si elles sont pertinentes.
```

## Configuration

### Variables d'environnement

```bash
# Modèle d'embedding Ollama (défaut: nomic-embed-text)
A11_EMBEDDING_MODEL=nomic-embed-text

# URL Ollama (défaut: http://127.0.0.1:11434)
OLLAMA_BASE=http://127.0.0.1:11434

# Répertoire de stockage (défaut: runtime/vector-memory)
A11_RUNTIME_ROOT=./runtime
```

### Paramètres par défaut

- **Nombre max d'entrées par conversation** : 1000
- **Top K résultats** : 3
- **Seuil de similarité minimum** : 0.6 (60%)

## Stockage

Les embeddings sont stockés dans des fichiers JSONL :

```
runtime/vector-memory/
  ├── user123_default.jsonl
  ├── user123_conv456.jsonl
  └── user789_default.jsonl
```

Format d'une entrée :

```json
{
  "id": "exchange_1714089600000_abc123",
  "timestamp": "2026-04-26T14:30:00.000Z",
  "userMessage": "Comment générer une image ?",
  "assistantMessage": "Pour générer une image...",
  "embedding": [0.123, -0.456, 0.789, ...],
  "metadata": {
    "userId": "user123",
    "conversationId": "default"
  }
}
```

## API REST

### Recherche sémantique

```bash
GET /api/vector-memory/search?q=comment+générer+image&k=5&minSimilarity=0.6
Authorization: Bearer <jwt_token>
```

Réponse :

```json
{
  "ok": true,
  "query": "comment générer image",
  "resultCount": 3,
  "results": [
    {
      "userMessage": "Comment générer une image ?",
      "assistantMessage": "Pour générer une image...",
      "timestamp": "2026-04-26T14:30:00.000Z",
      "similarity": 0.853,
      "metadata": { ... }
    }
  ]
}
```

### Contexte pertinent

```bash
GET /api/vector-memory/context?q=comment+faire+vidéo&k=3
Authorization: Bearer <jwt_token>
```

Réponse :

```json
{
  "ok": true,
  "query": "comment faire vidéo",
  "found": true,
  "context": "[Échange pertinent #1 - il y a 2h - similarité: 85.3%]\n...",
  "exchangeCount": 3,
  "exchanges": [...]
}
```

### Ajouter un échange manuellement

```bash
POST /api/vector-memory/add
Authorization: Bearer <jwt_token>
Content-Type: application/json

{
  "userMessage": "Quelle est la capitale de la France ?",
  "assistantMessage": "La capitale de la France est Paris.",
  "conversationId": "default",
  "metadata": {}
}
```

### Statistiques

```bash
GET /api/vector-memory/stats?conversationId=default
Authorization: Bearer <jwt_token>
```

Réponse :

```json
{
  "ok": true,
  "stats": {
    "entryCount": 42,
    "maxEntries": 1000,
    "oldestEntry": "2026-04-20T10:00:00.000Z",
    "newestEntry": "2026-04-26T14:30:00.000Z",
    "storageSize": 524288
  }
}
```

### Nettoyer anciennes entrées

```bash
DELETE /api/vector-memory/prune?maxAgeDays=30
Authorization: Bearer <jwt_token>
```

Réponse :

```json
{
  "ok": true,
  "removed": 15,
  "remaining": 27
}
```

## Prérequis

### Ollama avec nomic-embed-text

Le modèle d'embedding doit être disponible dans Ollama :

```bash
# Vérifier si le modèle est disponible
ollama list | grep nomic-embed-text

# Si absent, le télécharger
ollama pull nomic-embed-text
```

### Tester l'embedding

```bash
curl http://127.0.0.1:11434/api/embeddings -d '{
  "model": "nomic-embed-text",
  "prompt": "Comment générer une image ?"
}'
```

## Performance

- **Génération d'embedding** : ~50-200ms (local Ollama)
- **Recherche par similarité** : ~1-5ms pour 1000 entrées
- **Taille d'un embedding** : ~768 dimensions × 4 bytes = ~3KB
- **Taille moyenne d'une entrée** : ~5-10KB (avec texte + embedding)

## Limitations actuelles

1. **Pas de clustering** : Recherche linéaire O(n) sur toutes les entrées
2. **Pas d'index vectoriel** : Pas de FAISS/Annoy pour recherche approximative
3. **Stockage fichier** : Pas de base vectorielle dédiée (Pinecone, Weaviate, etc.)
4. **Pas de compression** : Embeddings stockés en float32 complet

## Améliorations futures

1. **Index vectoriel** : Intégrer FAISS ou hnswlib pour recherche rapide
2. **Clustering temporel** : Grouper les échanges par période
3. **Compression** : Quantification des embeddings (float16, int8)
4. **Base vectorielle** : Migration vers Qdrant ou Weaviate
5. **Filtrage avancé** : Par date, par sujet, par importance
6. **Résumés hiérarchiques** : Résumer les clusters d'échanges

## Changelog

### 2026-04-26 - Implémentation initiale

- ✅ Module `lib/vector-memory.cjs` créé
- ✅ Routes API `src/routes/vector-memory.cjs` créées
- ✅ Intégration dans le chat pipeline
- ✅ Sauvegarde automatique des échanges
- ✅ Injection du contexte vectoriel dans le prompt
- ✅ Documentation complète

## Références

- [Ollama Embeddings API](https://github.com/ollama/ollama/blob/main/docs/api.md#generate-embeddings)
- [nomic-embed-text](https://huggingface.co/nomic-ai/nomic-embed-text-v1)
- [Cosine Similarity](https://en.wikipedia.org/wiki/Cosine_similarity)
- [RAG (Retrieval-Augmented Generation)](https://arxiv.org/abs/2005.11401)
