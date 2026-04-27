# Changelog A11 - 2026-04-26 : Graphe de Connaissances (Knowledge Graph)

## 🚀 Nouvelle fonctionnalité majeure : Graphe de Connaissances

### Contexte

Suite à la recommandation #1 (Priorité A) d'A11, nous avons implémenté un **système de graphe de connaissances** qui extrait automatiquement des triplets (Sujet, Prédicat, Objet) des conversations et les stocke dans une structure relationnelle. Cette amélioration permet un **raisonnement structuré** et la **détection de dépendances complexes**.

### Problème résolu

Avant cette implémentation, A11 :

- ❌ Utilisait uniquement la similarité vectorielle (RAG) sans structure relationnelle
- ❌ Ne pouvait pas raisonner sur des relations complexes (transitivité, chemins)
- ❌ Ne pouvait pas détecter les dépendances entre entités
- ❌ Manquait de contexte structuré pour le raisonnement

### Solution implémentée

#### 1. Module de graphe de connaissances (`lib/knowledge-graph.cjs`)

**Fonctionnalités** :

- Extraction de triplets via LLM (Ollama)
- Recherche d'entités par label (fuzzy match)
- Recherche de relations (outgoing/incoming/both)
- Recherche de chemins entre entités (BFS)
- Génération de contexte textuel pour le prompt
- Export vers Neo4j Cypher

**API** :

```javascript
const kg = createKnowledgeGraph(userId);

// Extraire et ajouter des triplets depuis un texte
await kg.extractAndAddFromText("Paris est la capitale de la France.");

// Rechercher des entités
const nodes = kg.findNodes("Paris");

// Obtenir les relations d'une entité
const relations = kg.getRelations("Paris", { direction: "both" });

// Trouver un chemin entre deux entités
const path = kg.findPath("Tour Eiffel", "France", 3);

// Obtenir le contexte pour une requête
const context = kg.getContextForQuery("Paris");
```

#### 2. Adaptateur Neo4j (`lib/neo4j-adapter.cjs`)

**Fonctionnalités** :

- Connexion à Neo4j Aura ou local
- Requêtes Cypher optimisées
- Fallback automatique sur JSON si Neo4j indisponible
- Gestion des index et des performances

**Avantages Neo4j** :

- Recherche O(log n) avec index vs O(n) en JSON
- Algorithmes de graphe optimisés (Dijkstra, A\*)
- Scalabilité (millions de nœuds)
- Requêtes Cypher puissantes

#### 3. Routes API REST (`src/routes/knowledge-graph.cjs`)

**Endpoints** :

- `POST /api/knowledge-graph/extract` - Extraire des triplets d'un texte
- `POST /api/knowledge-graph/add` - Ajouter des triplets au graphe
- `POST /api/knowledge-graph/extract-and-add` - Extraire et ajouter automatiquement
- `GET /api/knowledge-graph/search` - Rechercher des entités
- `GET /api/knowledge-graph/relations` - Obtenir les relations d'une entité
- `GET /api/knowledge-graph/path` - Trouver un chemin entre deux entités
- `GET /api/knowledge-graph/context` - Obtenir le contexte pour une requête
- `GET /api/knowledge-graph/stats` - Statistiques du graphe
- `GET /api/knowledge-graph/export/cypher` - Exporter en Cypher (Neo4j)

#### 4. Intégration dans `server.cjs`

**Modifications** :

1. **Import des modules** :

```javascript
const { createKnowledgeGraph } = require("./lib/knowledge-graph.cjs");
```

2. **Récupération du contexte relationnel** dans `loadUserMemoryContext()` :

```javascript
let knowledgeGraphContext = "";
if (normalizedLatestMessage) {
  const kg = createKnowledgeGraph(normalizedUserId);
  const kgResult = kg.getContextForQuery(normalizedLatestMessage, {
    maxRelations: 10,
  });
  if (kgResult.found) {
    knowledgeGraphContext = kgResult.context;
  }
}
```

3. **Injection du contexte** dans `buildChatMessagesWithMemory()` :

```javascript
if (normalizedKgContext) {
  messages.push({
    role: "system",
    content: `# Graphe de connaissances (relations structurées)\n\n${normalizedKgContext}`,
  });
}
```

4. **Extraction automatique des triplets** dans `saveChatMemoryMessageWithVector()` :

```javascript
const kg = createKnowledgeGraph(normalizedUserId);
const exchangeText = `User: ${lastUserMessage}\nAssistant: ${normalizedContent}`;
await kg.extractAndAddFromText(exchangeText, {
  conversationId: normalizedConversationId,
  timestamp: new Date().toISOString(),
});
```

5. **Montage du router API** :

```javascript
app.use(createKnowledgeGraphRouter({ verifyJWT }));
```

### Fichiers créés/modifiés

| Fichier                                                  | Type       | Description                              |
| -------------------------------------------------------- | ---------- | ---------------------------------------- |
| `a11/backend/apps/server/lib/knowledge-graph.cjs`        | ✨ Nouveau | Module de graphe de connaissances (JSON) |
| `a11/backend/apps/server/lib/neo4j-adapter.cjs`          | ✨ Nouveau | Adaptateur Neo4j                         |
| `a11/backend/apps/server/src/routes/knowledge-graph.cjs` | ✨ Nouveau | Routes API REST                          |
| `a11/backend/apps/server/server.cjs`                     | 🔧 Modifié | Intégration dans le chat pipeline        |
| `a11/backend/apps/server/package.json`                   | 🔧 Modifié | Ajout de neo4j-driver                    |
| `a11/docs/KNOWLEDGE_GRAPH.md`                            | 📝 Nouveau | Documentation complète                   |
| `a11/docs/CHANGELOG_2026-04-26_KG.md`                    | 📝 Nouveau | Ce changelog                             |

### Impact utilisateur

#### Avant

```
User: "Où se trouve la Tour Eiffel ?"
A11: [Recherche vectorielle uniquement]
     "La Tour Eiffel se trouve à Paris."
```

#### Après

```
User: "Où se trouve la Tour Eiffel ?"
A11: [Recherche dans le graphe]
     Tour Eiffel --[se_trouve_à]--> Paris
     Paris --[est_capitale_de]--> France

     "La Tour Eiffel se trouve à Paris, la capitale de la France."
```

### Configuration

#### Variables d'environnement (optionnelles)

```bash
# Neo4j (optionnel - fallback sur JSON si absent)
NEO4J_URI=neo4j+s://your-instance.databases.neo4j.io
NEO4J_USERNAME=your-username
NEO4J_PASSWORD=your-password
NEO4J_DATABASE=neo4j

# Modèle LLM pour extraction de triplets (défaut: gemma4:e4b)
A11_REASONING_MODEL=gemma4:e4b
```

#### Installation Neo4j (optionnel)

```bash
# Installer le driver
npm install neo4j-driver

# Créer une instance Neo4j Aura gratuite
# https://neo4j.com/cloud/aura/

# Configurer les credentials dans .env.local
```

### Stockage

#### JSON (fallback, par défaut)

```
runtime/knowledge-graph/
  ├── user123_graph.json
  └── user789_graph.json
```

#### Neo4j (production, si configuré)

- Nœuds : `Entity` avec propriétés `id`, `label`, `type`, `userId`, `occurrences`
- Relations : Types dynamiques basés sur les prédicats
- Index automatiques sur `userId` et `id`

### Performance

| Opération              | JSON       | Neo4j             |
| ---------------------- | ---------- | ----------------- |
| Recherche d'entités    | O(n)       | O(log n)          |
| Recherche de relations | O(n)       | O(1)              |
| Recherche de chemin    | BFS O(V+E) | Dijkstra optimisé |
| Limite pratique        | ~10K nœuds | Millions de nœuds |

### Sécurité

⚠️ **IMPORTANT** : Les credentials Neo4j ont été exposés dans cette session et doivent être rotés.

**Actions de sécurité prises** :

1. ✅ Credentials retirés de `.env.local` et remplacés par des placeholders
2. ✅ `.env.local` confirmé dans `.gitignore`
3. ⚠️ **TODO** : Régénérer le mot de passe Neo4j Aura

**Règles de sécurité permanentes** :

- Ne jamais lire `.env`, `.env.local`, ou fichiers de credentials sauf demande explicite
- Ne jamais afficher de token, password, API key ou URI avec credentials
- Ne jamais commit `.env` ou secrets
- Avant chaque commit, vérifier `git status --short`
- Si un secret a été affiché, le considérer compromis et demander rotation

### Limitations actuelles

1. **Extraction de triplets** : Dépend de la qualité du LLM
2. **Pas de désambiguïsation** : "Paris" (ville) vs "Paris" (prénom)
3. **Pas de fusion d'entités** : "Paris" vs "paris" vs "PARIS"
4. **Pas de validation** : Les triplets extraits ne sont pas vérifiés
5. **Pas d'inférence** : Pas de déduction de nouvelles relations

### Améliorations futures

1. **Entity Linking** : Lier les entités à des bases de connaissances (Wikidata, DBpedia)
2. **Désambiguïsation** : Distinguer les homonymes
3. **Fusion d'entités** : Détecter et fusionner les doublons
4. **Validation** : Vérifier la cohérence des triplets
5. **Inférence** : Déduire de nouvelles relations (transitivité, symétrie)
6. **Temporal reasoning** : Gérer les relations temporelles

### Tests recommandés

1. **Test basique** :

```bash
# Conversation 1
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Paris est la capitale de la France."}]}'

# Vérifier le graphe
curl http://localhost:3000/api/knowledge-graph/stats \
  -H "Authorization: Bearer <token>"
```

2. **Test API** :

```bash
# Extraire des triplets
curl -X POST http://localhost:3000/api/knowledge-graph/extract \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"text":"Paris est la capitale de la France."}'

# Rechercher des entités
curl http://localhost:3000/api/knowledge-graph/search?q=Paris \
  -H "Authorization: Bearer <token>"

# Obtenir les relations
curl http://localhost:3000/api/knowledge-graph/relations?entity=Paris \
  -H "Authorization: Bearer <token>"
```

### Rollback

Si nécessaire, pour désactiver temporairement le Knowledge Graph :

1. **Désactiver la récupération du contexte** dans `loadUserMemoryContext()` :

```javascript
// Commenter ces lignes
// let knowledgeGraphContext = '';
// if (normalizedLatestMessage) { ... }
```

2. **Désactiver l'extraction automatique** dans `saveChatMemoryMessageWithVector()` :

```javascript
// Commenter le bloc try/catch pour kg.extractAndAddFromText()
```

3. **Démonter le router** :

```javascript
// Commenter cette ligne
// app.use(createKnowledgeGraphRouter({ verifyJWT }));
```

### Références

- [Neo4j Graph Database](https://neo4j.com/)
- [Knowledge Graphs](https://en.wikipedia.org/wiki/Knowledge_graph)
- [RDF Triples](https://www.w3.org/TR/rdf11-concepts/)
- [Cypher Query Language](https://neo4j.com/developer/cypher/)

### Crédits

Cette amélioration a été implémentée suite à la recommandation Priorité A d'A11 lui-même :

> **A11** : "Le RAG nous fournit des blocs de texte sémantiquement riches, mais ils manquent de structure relationnelle. Passer d'une simple recherche de similarité vectorielle à un raisonnement relationnel (entité → relation → entité) est la priorité absolue."

---

**Date** : 2026-04-26  
**Version** : A11 v1.1.0-kg  
**Auteur** : Kiro + A11 (auto-amélioration)  
**Statut** : ✅ Implémenté (JSON), ⚠️ Neo4j nécessite rotation credentials
