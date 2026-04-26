# Graphe de Connaissances (Knowledge Graph) - A11

## Vue d'ensemble

A11 dispose maintenant d'un **système de graphe de connaissances** qui extrait automatiquement des triplets (Sujet, Prédicat, Objet) des conversations et les stocke dans une structure relationnelle. Ce système permet un **raisonnement structuré** et la **détection de dépendances complexes**.

## Architecture

### Composants

1. **`lib/knowledge-graph.cjs`** : Module principal (stockage JSON)
   - Extraction de triplets via LLM
   - Recherche d'entités et de relations
   - Recherche de chemins entre entités
   - Export vers Neo4j Cypher

2. **`lib/neo4j-adapter.cjs`** : Adaptateur Neo4j (base de données graphe)
   - Connexion à Neo4j Aura ou local
   - Requêtes Cypher optimisées
   - Fallback automatique sur JSON si Neo4j indisponible

3. **`src/routes/knowledge-graph.cjs`** : API REST
   - 8 endpoints pour gérer le graphe
   - Extraction, recherche, relations, chemins, stats

4. **Intégration dans `server.cjs`** :
   - Extraction automatique des triplets après chaque conversation
   - Injection du contexte relationnel dans le prompt

## Fonctionnement

### 1. Extraction automatique de triplets

Chaque échange user/assistant est analysé pour extraire des triplets :

```javascript
// Exemple d'échange
User: "Paris est la capitale de la France. La Tour Eiffel se trouve à Paris.";
Assistant: "Oui, Paris est une belle ville avec de nombreux monuments."[
  // Triplets extraits automatiquement
  ({ subject: "Paris", predicate: "est_capitale_de", object: "France" },
  { subject: "Tour Eiffel", predicate: "se_trouve_à", object: "Paris" },
  { subject: "Paris", predicate: "est", object: "ville" })
];
```

### 2. Stockage dans le graphe

Les triplets sont stockés dans Neo4j (si disponible) ou en JSON :

```
(Paris) --[est_capitale_de]--> (France)
(Tour Eiffel) --[se_trouve_à]--> (Paris)
(Paris) --[est]--> (ville)
```

### 3. Récupération contextuelle

Lors d'une nouvelle requête, A11 recherche les relations pertinentes :

```javascript
User: "Parle-moi de Paris"

// Contexte récupéré du graphe
**Paris** :
  - est_capitale_de → France
  - est → ville
  - Tour Eiffel → se_trouve_à
```

### 4. Injection dans le prompt

Le contexte relationnel est injecté dans le prompt système :

```
# Graphe de connaissances (relations structurées)

Voici les relations connues pertinentes pour cette conversation :

**Paris** :
  - est_capitale_de → France
  - est → ville
  - Tour Eiffel → se_trouve_à

Utilise ces relations pour enrichir ta compréhension et ton raisonnement.
```

## Configuration

### Variables d'environnement

```bash
# Neo4j (optionnel - fallback sur JSON si absent)
NEO4J_URI=neo4j+s://aa4680d2.databases.neo4j.io
NEO4J_USERNAME=aa4680d2
NEO4J_PASSWORD=dehuqGOmjJau6DF4hrdIk03XhEoKOCP9m4mM8cLNm8M
NEO4J_DATABASE=aa4680d2

# Modèle LLM pour extraction de triplets (défaut: gemma4:e4b)
A11_REASONING_MODEL=gemma4:e4b

# Répertoire de stockage JSON (défaut: runtime/knowledge-graph)
A11_RUNTIME_ROOT=./runtime
```

### Neo4j Aura (gratuit)

1. Créer un compte sur [Neo4j Aura](https://neo4j.com/cloud/aura/)
2. Créer une instance gratuite
3. Copier les credentials dans `.env.local`
4. Redémarrer le backend

## Stockage

### JSON (fallback)

Les triplets sont stockés dans des fichiers JSON :

```
runtime/knowledge-graph/
  ├── user123_graph.json
  └── user789_graph.json
```

Format :

```json
{
  "nodes": [
    [
      "paris",
      {
        "id": "paris",
        "label": "Paris",
        "type": "entity",
        "metadata": {
          "lastSeen": "2026-04-26T16:30:00.000Z",
          "occurrences": 5
        }
      }
    ]
  ],
  "edges": [
    [
      "paris__est_capitale_de__france",
      {
        "id": "paris__est_capitale_de__france",
        "source": "paris",
        "target": "france",
        "predicate": "est_capitale_de",
        "metadata": {
          "lastSeen": "2026-04-26T16:30:00.000Z",
          "occurrences": 3
        }
      }
    ]
  ]
}
```

### Neo4j (production)

Les triplets sont stockés dans Neo4j avec des requêtes Cypher optimisées :

```cypher
// Nœuds
CREATE (n:Entity {
  id: "paris",
  label: "Paris",
  type: "entity",
  userId: "user123",
  occurrences: 5,
  lastSeen: datetime()
})

// Relations
MATCH (a:Entity {id: "paris"}), (b:Entity {id: "france"})
CREATE (a)-[:EST_CAPITALE_DE {occurrences: 3}]->(b)
```

## API REST

### Extraire des triplets d'un texte

```bash
POST /api/knowledge-graph/extract
Authorization: Bearer <jwt_token>
Content-Type: application/json

{
  "text": "Paris est la capitale de la France."
}
```

Réponse :

```json
{
  "ok": true,
  "tripletCount": 1,
  "triplets": [
    {
      "subject": "Paris",
      "predicate": "est_capitale_de",
      "object": "France"
    }
  ]
}
```

### Ajouter des triplets au graphe

```bash
POST /api/knowledge-graph/add
Authorization: Bearer <jwt_token>
Content-Type: application/json

{
  "triplets": [
    {
      "subject": "Paris",
      "predicate": "est_capitale_de",
      "object": "France"
    }
  ],
  "metadata": {
    "source": "manual"
  }
}
```

### Extraire et ajouter automatiquement

```bash
POST /api/knowledge-graph/extract-and-add
Authorization: Bearer <jwt_token>
Content-Type: application/json

{
  "text": "Paris est la capitale de la France. La Tour Eiffel se trouve à Paris."
}
```

### Rechercher des entités

```bash
GET /api/knowledge-graph/search?q=Paris
Authorization: Bearer <jwt_token>
```

Réponse :

```json
{
  "ok": true,
  "query": "Paris",
  "resultCount": 1,
  "nodes": [
    {
      "id": "paris",
      "label": "Paris",
      "type": "entity",
      "metadata": {
        "occurrences": 5
      }
    }
  ]
}
```

### Obtenir les relations d'une entité

```bash
GET /api/knowledge-graph/relations?entity=Paris&direction=both
Authorization: Bearer <jwt_token>
```

Réponse :

```json
{
  "ok": true,
  "entity": "Paris",
  "relationCount": 3,
  "relations": [
    {
      "type": "outgoing",
      "predicate": "est_capitale_de",
      "target": "France",
      "targetId": "france"
    },
    {
      "type": "incoming",
      "predicate": "se_trouve_à",
      "source": "Tour Eiffel",
      "sourceId": "tour_eiffel"
    }
  ]
}
```

### Trouver un chemin entre deux entités

```bash
GET /api/knowledge-graph/path?start=Tour%20Eiffel&end=France&maxDepth=3
Authorization: Bearer <jwt_token>
```

Réponse :

```json
{
  "ok": true,
  "start": "Tour Eiffel",
  "end": "France",
  "found": true,
  "pathLength": 2,
  "path": [
    {
      "source": "Tour Eiffel",
      "predicate": "se_trouve_à",
      "target": "Paris"
    },
    {
      "source": "Paris",
      "predicate": "est_capitale_de",
      "target": "France"
    }
  ]
}
```

### Obtenir le contexte pour une requête

```bash
GET /api/knowledge-graph/context?q=Paris
Authorization: Bearer <jwt_token>
```

Réponse :

```json
{
  "ok": true,
  "query": "Paris",
  "found": true,
  "context": "\n**Paris** :\n  - est_capitale_de → France\n  - Tour Eiffel → se_trouve_à",
  "entities": ["Paris"]
}
```

### Statistiques du graphe

```bash
GET /api/knowledge-graph/stats
Authorization: Bearer <jwt_token>
```

Réponse :

```json
{
  "ok": true,
  "stats": {
    "nodeCount": 42,
    "edgeCount": 87,
    "avgDegree": 4.14,
    "topEntities": [
      { "label": "Paris", "occurrences": 15 },
      { "label": "France", "occurrences": 12 }
    ]
  }
}
```

### Exporter en Cypher (Neo4j)

```bash
GET /api/knowledge-graph/export/cypher
Authorization: Bearer <jwt_token>
```

Télécharge un fichier `.cypher` avec toutes les commandes pour importer le graphe dans Neo4j.

## Performance

### JSON (fallback)

- **Recherche d'entités** : O(n) linéaire
- **Recherche de relations** : O(n) linéaire
- **Recherche de chemin** : BFS O(V + E)
- **Limite pratique** : ~10 000 nœuds

### Neo4j (production)

- **Recherche d'entités** : O(log n) avec index
- **Recherche de relations** : O(1) avec index
- **Recherche de chemin** : Algorithme optimisé Dijkstra/A\*
- **Limite pratique** : Millions de nœuds

## Exemples d'utilisation

### Exemple 1 : Raisonnement géographique

```
User: "Où se trouve la Tour Eiffel ?"
A11: [Recherche dans le graphe]
     Tour Eiffel --[se_trouve_à]--> Paris
     Paris --[est_capitale_de]--> France

     "La Tour Eiffel se trouve à Paris, la capitale de la France."
```

### Exemple 2 : Raisonnement relationnel

```
User: "Qui est le père de Luke Skywalker ?"
A11: [Recherche dans le graphe]
     Anakin Skywalker --[est_père_de]--> Luke Skywalker

     "Anakin Skywalker est le père de Luke Skywalker."
```

### Exemple 3 : Raisonnement transitif

```
User: "Quelle est la relation entre la Tour Eiffel et la France ?"
A11: [Recherche de chemin]
     Tour Eiffel --[se_trouve_à]--> Paris --[est_capitale_de]--> France

     "La Tour Eiffel se trouve à Paris, qui est la capitale de la France."
```

## Limitations actuelles

1. **Extraction de triplets** : Dépend de la qualité du LLM
2. **Pas de désambiguïsation** : "Paris" (ville) vs "Paris" (prénom)
3. **Pas de fusion d'entités** : "Paris" vs "paris" vs "PARIS"
4. **Pas de validation** : Les triplets extraits ne sont pas vérifiés

## Améliorations futures

1. **Entity Linking** : Lier les entités à des bases de connaissances (Wikidata, DBpedia)
2. **Désambiguïsation** : Distinguer les homonymes
3. **Fusion d'entités** : Détecter et fusionner les doublons
4. **Validation** : Vérifier la cohérence des triplets
5. **Inférence** : Déduire de nouvelles relations (transitivité, symétrie)
6. **Temporal reasoning** : Gérer les relations temporelles

## Changelog

### 2026-04-26 - Implémentation initiale

- ✅ Module `lib/knowledge-graph.cjs` créé (stockage JSON)
- ✅ Module `lib/neo4j-adapter.cjs` créé (Neo4j)
- ✅ Routes API `src/routes/knowledge-graph.cjs` créées
- ✅ Intégration dans le chat pipeline
- ✅ Extraction automatique des triplets
- ✅ Injection du contexte relationnel dans le prompt
- ✅ Fallback automatique JSON ↔ Neo4j
- ✅ Documentation complète

## Références

- [Neo4j Graph Database](https://neo4j.com/)
- [Knowledge Graphs](https://en.wikipedia.org/wiki/Knowledge_graph)
- [RDF Triples](https://www.w3.org/TR/rdf11-concepts/)
- [Cypher Query Language](https://neo4j.com/developer/cypher/)
- [Graph Algorithms](https://neo4j.com/docs/graph-data-science/current/)
