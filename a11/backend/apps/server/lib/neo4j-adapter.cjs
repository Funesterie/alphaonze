// neo4j-adapter.cjs
// Adaptateur pour connecter le graphe de connaissances à Neo4j

const { getLogger } = require('./structured-logger.cjs');

const logger = getLogger({ component: 'neo4j-adapter' });

let neo4j = null;
let driver = null;

// Charger le driver Neo4j si disponible
try {
  neo4j = require('neo4j-driver');
  logger.info('Neo4j driver loaded successfully');
} catch (error) {
  logger.warn('Neo4j driver not available. Install with: npm install neo4j-driver');
}

/**
 * Crée une connexion au driver Neo4j
 */
function createNeo4jDriver(options = {}) {
  if (!neo4j) {
    throw new Error('Neo4j driver not installed. Run: npm install neo4j-driver');
  }

  const uri = options.uri || process.env.NEO4J_URI || 'neo4j://localhost:7687';
  const username = options.username || process.env.NEO4J_USERNAME || 'neo4j';
  const password = options.password || process.env.NEO4J_PASSWORD || 'password';
  const database = options.database || process.env.NEO4J_DATABASE || 'neo4j';

  try {
    driver = neo4j.driver(uri, neo4j.auth.basic(username, password), {
      maxConnectionLifetime: 3 * 60 * 60 * 1000, // 3 hours
      maxConnectionPoolSize: 50,
      connectionAcquisitionTimeout: 2 * 60 * 1000, // 2 minutes
    });

    logger.info('Neo4j driver created', { uri, username, database });
    return { driver, database };
  } catch (error) {
    logger.error('Failed to create Neo4j driver', { error, uri });
    throw error;
  }
}

/**
 * Ferme la connexion Neo4j
 */
async function closeNeo4jDriver() {
  if (driver) {
    await driver.close();
    driver = null;
    logger.info('Neo4j driver closed');
  }
}

/**
 * Classe pour gérer le graphe de connaissances avec Neo4j
 */
class Neo4jKnowledgeGraph {
  constructor(options = {}) {
    this.userId = options.userId;
    this.database = options.database || process.env.NEO4J_DATABASE || 'neo4j';
    this.logger = logger.child({ userId: this.userId });

    if (!driver) {
      const connection = createNeo4jDriver(options);
      this.driver = connection.driver;
      this.database = connection.database;
    } else {
      this.driver = driver;
    }
  }

  /**
   * Exécute une requête Cypher
   */
  async runQuery(cypher, params = {}) {
    const session = this.driver.session({ database: this.database });
    try {
      const result = await session.run(cypher, params);
      return result;
    } catch (error) {
      this.logger.error('Neo4j query failed', { error, cypher: cypher.slice(0, 100) });
      throw error;
    } finally {
      await session.close();
    }
  }

  /**
   * Ajoute un nœud (entité)
   */
  async addNode(entity, metadata = {}) {
    const cypher = `
      MERGE (n:Entity {id: $id, userId: $userId})
      ON CREATE SET n.label = $label, n.type = $type, n.created = datetime(), n.occurrences = 1
      ON MATCH SET n.occurrences = n.occurrences + 1, n.lastSeen = datetime()
      SET n += $metadata
      RETURN n
    `;

    const id = this._normalizeEntityId(entity);
    const params = {
      id,
      userId: this.userId,
      label: String(entity).trim(),
      type: metadata.type || 'entity',
      metadata: metadata,
    };

    const result = await this.runQuery(cypher, params);
    return result.records[0]?.get('n').properties;
  }

  /**
   * Ajoute une relation (arête) entre deux entités
   */
  async addEdge(subject, predicate, object, metadata = {}) {
    const sourceId = this._normalizeEntityId(subject);
    const targetId = this._normalizeEntityId(object);
    const relationshipType = String(predicate).trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');

    // D'abord créer les nœuds
    await this.addNode(subject, { type: 'entity' });
    await this.addNode(object, { type: 'entity' });

    // Puis créer la relation
    const cypher = `
      MATCH (a:Entity {id: $sourceId, userId: $userId})
      MATCH (b:Entity {id: $targetId, userId: $userId})
      MERGE (a)-[r:${relationshipType}]->(b)
      ON CREATE SET r.created = datetime(), r.occurrences = 1
      ON MATCH SET r.occurrences = r.occurrences + 1, r.lastSeen = datetime()
      SET r += $metadata
      RETURN r
    `;

    const params = {
      sourceId,
      targetId,
      userId: this.userId,
      metadata: metadata,
    };

    const result = await this.runQuery(cypher, params);
    return result.records[0]?.get('r').properties;
  }

  /**
   * Ajoute des triplets au graphe
   */
  async addTriplets(triplets, metadata = {}) {
    if (!Array.isArray(triplets) || triplets.length === 0) {
      return { added: 0 };
    }

    let added = 0;
    for (const triplet of triplets) {
      if (!triplet.subject || !triplet.predicate || !triplet.object) continue;
      try {
        await this.addEdge(triplet.subject, triplet.predicate, triplet.object, metadata);
        added++;
      } catch (error) {
        this.logger.warn('Failed to add triplet', { error, triplet });
      }
    }

    this.logger.debug('Added triplets to Neo4j', { added, total: triplets.length });
    return { added };
  }

  /**
   * Recherche des nœuds par label (fuzzy match)
   */
  async findNodes(query, limit = 10) {
    const cypher = `
      MATCH (n:Entity)
      WHERE n.userId = $userId
        AND (toLower(n.label) CONTAINS toLower($query) OR toLower(n.id) CONTAINS toLower($query))
      RETURN n
      ORDER BY n.occurrences DESC
      LIMIT $limit
    `;

    const params = {
      userId: this.userId,
      query: String(query).trim(),
      limit,
    };

    const result = await this.runQuery(cypher, params);
    return result.records.map((record) => record.get('n').properties);
  }

  /**
   * Trouve toutes les relations d'une entité
   */
  async getRelations(entity, options = {}) {
    const entityId = this._normalizeEntityId(entity);
    const direction = options.direction || 'both';
    const limit = options.limit || 50;

    let cypher = '';
    if (direction === 'outgoing') {
      cypher = `
        MATCH (a:Entity {id: $entityId, userId: $userId})-[r]->(b:Entity)
        RETURN 'outgoing' as type, type(r) as predicate, b.label as target, b.id as targetId, r
        ORDER BY r.occurrences DESC
        LIMIT $limit
      `;
    } else if (direction === 'incoming') {
      cypher = `
        MATCH (a:Entity)-[r]->(b:Entity {id: $entityId, userId: $userId})
        RETURN 'incoming' as type, type(r) as predicate, a.label as source, a.id as sourceId, r
        ORDER BY r.occurrences DESC
        LIMIT $limit
      `;
    } else {
      cypher = `
        MATCH (a:Entity {id: $entityId, userId: $userId})-[r]->(b:Entity)
        RETURN 'outgoing' as type, type(r) as predicate, b.label as target, b.id as targetId, r
        UNION
        MATCH (a:Entity)-[r]->(b:Entity {id: $entityId, userId: $userId})
        RETURN 'incoming' as type, type(r) as predicate, a.label as source, a.id as sourceId, r
        ORDER BY r.occurrences DESC
        LIMIT $limit
      `;
    }

    const params = {
      entityId,
      userId: this.userId,
      limit,
    };

    const result = await this.runQuery(cypher, params);
    return result.records.map((record) => ({
      type: record.get('type'),
      predicate: record.get('predicate').toLowerCase(),
      target: record.get('target') || undefined,
      targetId: record.get('targetId') || undefined,
      source: record.get('source') || undefined,
      sourceId: record.get('sourceId') || undefined,
      metadata: record.get('r').properties,
    }));
  }

  /**
   * Trouve un chemin entre deux entités
   */
  async findPath(startEntity, endEntity, maxDepth = 3) {
    const startId = this._normalizeEntityId(startEntity);
    const endId = this._normalizeEntityId(endEntity);

    const cypher = `
      MATCH path = shortestPath(
        (a:Entity {id: $startId, userId: $userId})-[*..${maxDepth}]-(b:Entity {id: $endId, userId: $userId})
      )
      RETURN path
    `;

    const params = {
      startId,
      endId,
      userId: this.userId,
    };

    try {
      const result = await this.runQuery(cypher, params);
      if (result.records.length === 0) return null;

      const path = result.records[0].get('path');
      const description = [];

      for (let i = 0; i < path.segments.length; i++) {
        const segment = path.segments[i];
        description.push({
          source: segment.start.properties.label,
          predicate: segment.relationship.type.toLowerCase(),
          target: segment.end.properties.label,
        });
      }

      return description;
    } catch (error) {
      this.logger.warn('Path finding failed', { error, startId, endId });
      return null;
    }
  }

  /**
   * Génère un contexte textuel pour le prompt
   */
  async getContextForQuery(query, options = {}) {
    const maxRelations = options.maxRelations || 10;
    const nodes = await this.findNodes(query, 3);

    if (nodes.length === 0) {
      return {
        found: false,
        context: '',
        entities: [],
      };
    }

    const contextLines = [];
    const entities = [];

    for (const node of nodes) {
      const relations = await this.getRelations(node.label, { direction: 'both', limit: maxRelations });
      if (relations.length === 0) continue;

      entities.push(node.label);
      contextLines.push(`\n**${node.label}** :`);

      const outgoing = relations.filter((r) => r.type === 'outgoing');
      const incoming = relations.filter((r) => r.type === 'incoming');

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
  async getStats() {
    const cypher = `
      MATCH (n:Entity {userId: $userId})
      OPTIONAL MATCH (n)-[r]->()
      RETURN count(DISTINCT n) as nodeCount, count(r) as edgeCount
    `;

    const result = await this.runQuery(cypher, { userId: this.userId });
    const record = result.records[0];

    const topEntitiesCypher = `
      MATCH (n:Entity {userId: $userId})
      RETURN n.label as label, n.occurrences as occurrences
      ORDER BY n.occurrences DESC
      LIMIT 10
    `;

    const topResult = await this.runQuery(topEntitiesCypher, { userId: this.userId });

    return {
      nodeCount: record.get('nodeCount').toNumber(),
      edgeCount: record.get('edgeCount').toNumber(),
      topEntities: topResult.records.map((r) => ({
        label: r.get('label'),
        occurrences: r.get('occurrences').toNumber(),
      })),
    };
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
   * Ferme la session
   */
  async close() {
    // Le driver est partagé, ne pas le fermer ici
  }
}

/**
 * Factory pour créer une instance de Neo4jKnowledgeGraph
 */
function createNeo4jKnowledgeGraph(userId, options = {}) {
  if (!neo4j) {
    throw new Error('Neo4j driver not installed. Run: npm install neo4j-driver');
  }
  return new Neo4jKnowledgeGraph({
    userId,
    ...options,
  });
}

/**
 * Vérifie si Neo4j est disponible et configuré avec de vraies credentials
 */
function isNeo4jAvailable() {
  if (!neo4j) return false;
  const uri = String(process.env.NEO4J_URI || '').trim();
  if (!uri) return false;
  
  // Rejeter les placeholders évidents (mais accepter localhost qui est valide)
  if (uri.includes('your-instance') || uri.includes('your-password') || uri.includes('your-username')) {
    return false;
  }
  
  // Vérifier que le mot de passe n'est pas un placeholder
  const password = String(process.env.NEO4J_PASSWORD || '').trim();
  if (!password || password === 'password' || password === 'your-password-here') {
    return false;
  }
  
  return true;
}

module.exports = {
  Neo4jKnowledgeGraph,
  createNeo4jKnowledgeGraph,
  createNeo4jDriver,
  closeNeo4jDriver,
  isNeo4jAvailable,
};
