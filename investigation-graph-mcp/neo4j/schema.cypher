// Demo schema. Do not run production with NEO4J_AUTH=none.
// Production must create separate users outside this file through a secret
// manager and a reviewed migration.

CREATE CONSTRAINT sensitive_node_id IF NOT EXISTS
FOR (n:SensitiveNode)
REQUIRE n.id IS UNIQUE;

CREATE INDEX sensitive_tenant_case IF NOT EXISTS
FOR (n:SensitiveNode)
ON (n.tenant_id, n.case_id);

CREATE INDEX sensitive_source IF NOT EXISTS
FOR (n:SensitiveNode)
ON (n.source_id, n.source_type);

CREATE FULLTEXT INDEX sensitive_lexical IF NOT EXISTS
FOR (n:SensitiveNode)
ON EACH [n.label, n.normalized_label];

// Neo4j 5 vector index example. Dimension is a placeholder for production.
CREATE VECTOR INDEX sensitive_semantic IF NOT EXISTS
FOR (n:SensitiveNode)
ON (n.embedding)
OPTIONS { indexConfig: { `vector.dimensions`: 384, `vector.similarity_function`: 'cosine' } };

// Production role template, to execute manually with real secret-managed users:
// CREATE ROLE app_reader IF NOT EXISTS;
// CREATE ROLE app_writer IF NOT EXISTS;
// CREATE ROLE mcp_readonly IF NOT EXISTS;
// GRANT MATCH {*} ON GRAPH neo4j NODES SensitiveNode TO mcp_readonly;
// DENY WRITE ON GRAPH neo4j TO mcp_readonly;

