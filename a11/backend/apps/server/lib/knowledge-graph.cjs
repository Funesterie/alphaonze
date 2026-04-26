// knowledge-graph.cjs
// Système de graphe de connaissances pour A11
// Extrait des triplets (Sujet, Prédicat, Objet) et permet un raisonnement relationnel

const fs = require('node:fs');
const path = require('node:path');
const { getLogger } = require('./structured-logger.cjs');

const logger = getLogger({ component: 'knowledge-graph' });

/**
 * Extrait des triplets (Sujet, Prédicat, Objet) d'un texte via LLM
 */
async function extractTriplets(text, options = {}) {
  const ollamaBase = options.ollamaBase || process.env.OLLAMA_BASE || 'http://127.0.0.1:11434';
  const model = options.model || process.env.A11_REASONING_MODEL || process.env.LOCAL_DEFAULT_MODEL || 'gemma4:e4b';

  const prompt = `Tu es un extracteur de triplets de connaissances. Analyse le texte suivant et extrais tous les triplets sous la forme (Sujet, Prédicat, Objet).

Règles :
- Un triplet représente une relation : Sujet → Prédicat → Objet
- Le Sujet et l'Objet sont des entités (personnes, lieux, concepts, objets)
- Le Prédicat est une relation ou action entre eux
- Extrais TOUS les triplets pertinents, même implicites
- Réponds UNIQUEMENT avec un JSON array de triplets

Exemple :
Texte: "Paris est la capitale de la France. La Tour Eiffel se trouve à Paris."
Réponse: [
  {"subject": "Paris", "predicate": "est_capitale_de", "object": "France"},
  {"subject": "Tour Eiffel", "predicate": "se_trouve_à", "object": "Paris"}
]

Texte à analyser :
${text}

Réponds UNIQUEMENT avec le JSON array de triplets :`;

  try {
    const response = await fetch(`${ollamaBase}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        format: 'json',
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama generate failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const rawResponse = String(data.response || '').trim();

    // Parser le JSON
    let triplets = [];
    try {
      // Essayer de parser directement
      triplets = JSON.parse(rawResponse);
    } catch {
      // Si échec, chercher un array JSON dans la réponse
      const jsonMatch = rawResponse.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        triplets = JSON.parse(jsonMatch[0]);
      }
    }

    // Valider et normaliser les triplets
    const validTriplets = Array.isArray(triplets)
      ? triplets
          .filter((t) => t && t.subject && t.predicate && t.object)
          .map((t) => ({
            subject: String(t.subject).trim(),
            predicate: String(t.predicate).trim().toLowerCase().replace(/\s+/g, '_'),
            object: String(t.object).trim(),
          }))
      : [];

    return validTriplets;
  } catch (error) {
    logger.error('Failed to extract triplets', { error, text: text.slice(0, 100) });
    return [];
  }
}

/**
 * Classe pour gérer le graphe de connaissances
 */
class KnowledgeGraph {
  constructor(options = {}) {
    this.userId = options.userId;
    this.storageDir = options.storageDir || path.join(
      process.env.A11_RUNTIME_ROOT || process.cwd(),
      'knowledge-graph'
    );
    this.nodes = new Map(); // Map<entityId, {id, label, type, metadata}>
    this.edges = new Map(); // Map<edgeId, {id, source, target, predicate, metadata}>
    this.logger = logger.child({ userId: this.userId });

    this._ensureStorageDir();
    this._load();
  }

  _ensureStorageDir() {
    try {
      if (!fs.existsSync(this.storageDir)) {
        fs.mkdirSync(this.storageDir, { recursive: true });
      }
    } catch (error) {
      this.logger.error('Failed to create storage directory', { error });
    }
  }

  _getStoragePath() {
    const filename = `${this.userId}_graph.json`;
    return path.join(this.storageDir, filename);
  }

  _load() {
    const storagePath = this._getStoragePath();
    if (!fs.existsSync(storagePath)) {
      this.nodes = new Map();
      this.edges = new Map();
      return;
    }

    try {
      const content = fs.readFileSync(storagePath, 'utf8');
      const data = JSON.parse(content);
      this.nodes = new Map(data.nodes || []);
      this.edges = new Map(data.edges || []);
      this.logger.info('Loaded knowledge graph', {
        nodeCount: this.nodes.size,
        edgeCount: this.edges.size,
      });
    } catch (error) {
      this.logger.error('Failed to load knowledge graph', { error });
      this.nodes = new Map();
      this.edges = new Map();
    }
  }

  _save() {
    const storagePath = this._getStoragePath();
    try {
      const data = {
        nodes: Array.from(this.nodes.entries()),
        edges: Array.from(this.edges.entries()),
        metadata: {
          userId: this.userId,
          lastUpdated: new Date().toISOString(),
          nodeCount: this.nodes.size,
          edgeCount: this.edges.size,
        },
      };
      fs.writeFileSync(storagePath, JSON.stringify(data, null, 2), 'utf8');
    } catch (error) {
      this.logger.error('Failed to save knowledge graph', { error });
    }
  }

  /**
   * Normalise un nom d'entité en ID
   */
  _normalizeEntityId(entity) {
    return String(entity)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  /**
   * Ajoute ou met à jour un nœud (entité)
   */
  addNode(entity, metadata = {}) {
    const id = this._normalizeEntityId(entity);
    const existing = this.nodes.get(id);

    const node = {
      id,
      label: String(entity).trim(),
      type: metadata.type || 'entity',
      metadata: {
        ...existing?.metadata,
        ...metadata,
        lastSeen: new Date().toISOString(),
        occurrences: (existing?.metadata?.occurrences || 0) + 1,
      },
    };

    this.nodes.set(id, node);
    return node;
  }

  /**
   * Ajoute une relation (arête) entre deux entités
   */
  addEdge(subject, predicate, object, metadata = {}) {
    const sourceId = this._normalizeEntityId(subject);
    const targetId = this._normalizeEntityId(object);
    const edgeId = `${sourceId}__${predicate}__${targetId}`;

    // Ajouter les nœuds s'ils n'existent pas
    this.addNode(subject, { type: 'entity' });
    this.addNode(object, { type: 'entity' });

    const existing = this.edges.get(edgeId);

    const edge = {
      id: edgeId,
      source: sourceId,
      target: targetId,
      predicate: String(predicate).trim().toLowerCase(),
      metadata: {
        ...existing?.metadata,
        ...metadata,
        lastSeen: new Date().toISOString(),
        occurrences: (existing?.metadata?.occurrences || 0) + 1,
      },
    };

    this.edges.set(edgeId, edge);
    return edge;
  }

  /**
   * Ajoute des triplets au graphe
   */
  async addTriplets(triplets, metadata = {}) {
    if (!Array.isArray(triplets) || triplets.length === 0) {
      return { added: 0, nodes: 0, edges: 0 };
    }

    const nodesBefore = this.nodes.size;
    const edgesBefore = this.edges.size;

    for (const triplet of triplets) {
      if (!triplet.subject || !triplet.predicate || !triplet.object) continue;
      this.addEdge(triplet.subject, triplet.predicate, triplet.object, metadata);
    }

    this._save();

    const result = {
      added: triplets.length,
      nodes: this.nodes.size - nodesBefore,
      edges: this.edges.size - edgesBefore,
    };

    this.logger.debug('Added triplets to graph', result);
    return result;
  }

  /**
   * Extrait et ajoute des triplets depuis un texte
   */
  async extractAndAddFromText(text, metadata = {}) {
    const triplets = await extractTriplets(text);
    return this.addTriplets(triplets, metadata);
  }

  /**
   * Recherche des nœuds par label (fuzzy match)
   */
  findNodes(query) {
    const normalizedQuery = String(query).trim().toLowerCase();
    const results = [];

    for (const [id, node] of this.nodes.entries()) {
      const normalizedLabel = node.label.toLowerCase();
      if (
        normalizedLabel.includes(normalizedQuery) ||
        normalizedQuery.includes(normalizedLabel) ||
        id.includes(normalizedQuery)
      ) {
        results.push(node);
      }
    }

    return results.sort((a, b) => {
      const aOccurrences = a.metadata?.occurrences || 0;
      const bOccurrences = b.metadata?.occurrences || 0;
      return bOccurrences - aOccurrences;
    });
  }

  /**
   * Trouve toutes les relations d'une entité
   */
  getRelations(entity, options = {}) {
    const entityId = this._normalizeEntityId(entity);
    const direction = options.direction || 'both'; // 'outgoing', 'incoming', 'both'
    const relations = [];

    for (const [edgeId, edge] of this.edges.entries()) {
      if (direction === 'outgoing' || direction === 'both') {
        if (edge.source === entityId) {
          const targetNode = this.nodes.get(edge.target);
          relations.push({
            type: 'outgoing',
            predicate: edge.predicate,
            target: targetNode?.label || edge.target,
            targetId: edge.target,
            metadata: edge.metadata,
          });
        }
      }

      if (direction === 'incoming' || direction === 'both') {
        if (edge.target === entityId) {
          const sourceNode = this.nodes.get(edge.source);
          relations.push({
            type: 'incoming',
            predicate: edge.predicate,
            source: sourceNode?.label || edge.source,
            sourceId: edge.source,
            metadata: edge.metadata,
          });
        }
      }
    }

    return relations.sort((a, b) => {
      const aOccurrences = a.metadata?.occurrences || 0;
      const bOccurrences = b.metadata?.occurrences || 0;
      return bOccurrences - aOccurrences;
    });
  }

  /**
   * Trouve un chemin entre deux entités (BFS)
   */
  findPath(startEntity, endEntity, maxDepth = 3) {
    const startId = this._normalizeEntityId(startEntity);
    const endId = this._normalizeEntityId(endEntity);

    if (startId === endId) return [];
    if (!this.nodes.has(startId) || !this.nodes.has(endId)) return null;

    const queue = [[startId]];
    const visited = new Set([startId]);

    while (queue.length > 0) {
      const path = queue.shift();
      const current = path[path.length - 1];

      if (path.length > maxDepth) continue;

      // Trouver tous les voisins
      const neighbors = [];
      for (const [edgeId, edge] of this.edges.entries()) {
        if (edge.source === current && !visited.has(edge.target)) {
          neighbors.push({ id: edge.target, edge });
        }
        if (edge.target === current && !visited.has(edge.source)) {
          neighbors.push({ id: edge.source, edge });
        }
      }

      for (const neighbor of neighbors) {
        if (neighbor.id === endId) {
          // Chemin trouvé !
          const fullPath = [...path, neighbor.id];
          return this._buildPathDescription(fullPath);
        }

        visited.add(neighbor.id);
        queue.push([...path, neighbor.id]);
      }
    }

    return null; // Pas de chemin trouvé
  }

  _buildPathDescription(pathIds) {
    const description = [];
    for (let i = 0; i < pathIds.length - 1; i++) {
      const sourceId = pathIds[i];
      const targetId = pathIds[i + 1];
      const sourceNode = this.nodes.get(sourceId);
      const targetNode = this.nodes.get(targetId);

      // Trouver l'arête
      let edge = null;
      for (const [edgeId, e] of this.edges.entries()) {
        if ((e.source === sourceId && e.target === targetId) || (e.source === targetId && e.target === sourceId)) {
          edge = e;
          break;
        }
      }

      description.push({
        source: sourceNode?.label || sourceId,
        predicate: edge?.predicate || 'connected_to',
        target: targetNode?.label || targetId,
      });
    }
    return description;
  }

  /**
   * Génère un contexte textuel pour le prompt
   */
  getContextForQuery(query, options = {}) {
    const maxRelations = options.maxRelations || 10;
    const nodes = this.findNodes(query);

    if (nodes.length === 0) {
      return {
        found: false,
        context: '',
        entities: [],
      };
    }

    const contextLines = [];
    const entities = [];

    for (const node of nodes.slice(0, 3)) {
      const relations = this.getRelations(node.label, { direction: 'both' });
      if (relations.length === 0) continue;

      entities.push(node.label);
      contextLines.push(`\n**${node.label}** :`);

      const outgoing = relations.filter((r) => r.type === 'outgoing').slice(0, maxRelations);
      const incoming = relations.filter((r) => r.type === 'incoming').slice(0, maxRelations);

      if (outgoing.length > 0) {
        for (const rel of outgoing) {
          contextLines.push(`  - ${rel.predicate.replace(/_/g, ' ')} → ${rel.target}`);
        }
      }

      if (incoming.length > 0) {
        for (const rel of incoming) {
          contextLines.push(`  - ${rel.source} → ${rel.predicate.replace(/_/g, ' ')}`);
        }
      }
    }

    return {
      found: contextLines.length > 0,
      context: contextLines.join('\n'),
      entities,
    };
  }

  /**
   * Statistiques du graphe
   */
  getStats() {
    return {
      nodeCount: this.nodes.size,
      edgeCount: this.edges.size,
      avgDegree: this.edges.size > 0 ? (this.edges.size * 2) / this.nodes.size : 0,
      topEntities: Array.from(this.nodes.values())
        .sort((a, b) => (b.metadata?.occurrences || 0) - (a.metadata?.occurrences || 0))
        .slice(0, 10)
        .map((n) => ({ label: n.label, occurrences: n.metadata?.occurrences || 0 })),
    };
  }

  /**
   * Exporte le graphe au format compatible Neo4j Cypher
   */
  exportToCypher() {
    const statements = [];

    // CREATE nodes
    for (const [id, node] of this.nodes.entries()) {
      const props = JSON.stringify({
        id: node.id,
        label: node.label,
        type: node.type,
      }).replace(/"/g, '\\"');
      statements.push(`CREATE (n_${id}:Entity {${props}})`);
    }

    // CREATE relationships
    for (const [edgeId, edge] of this.edges.entries()) {
      const predicate = edge.predicate.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
      statements.push(
        `MATCH (a:Entity {id: "${edge.source}"}), (b:Entity {id: "${edge.target}"}) CREATE (a)-[:${predicate}]->(b)`
      );
    }

    return statements.join(';\n') + ';';
  }
}

/**
 * Factory pour créer une instance de KnowledgeGraph
 * Utilise Neo4j si disponible, sinon fallback sur JSON
 */
function createKnowledgeGraph(userId, options = {}) {
  // Essayer d'utiliser Neo4j si disponible
  try {
    const { isNeo4jAvailable, createNeo4jKnowledgeGraph } = require('./neo4j-adapter.cjs');
    if (isNeo4jAvailable() && !options.forceJson) {
      return createNeo4jKnowledgeGraph(userId, options);
    }
  } catch (error) {
    // Fallback sur JSON si Neo4j n'est pas disponible
  }

  // Fallback sur le stockage JSON
  return new KnowledgeGraph({
    userId,
    ...options,
  });
}

module.exports = {
  KnowledgeGraph,
  createKnowledgeGraph,
  extractTriplets,
};
