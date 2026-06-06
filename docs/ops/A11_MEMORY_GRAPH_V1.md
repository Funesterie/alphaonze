# A11 Memory Graph v1

## But

A11 Memory Graph v1 donne aux agents une carte explicable de Funesterie sans exposer de secrets.

Il relie les projets, repos, services, domaines, endpoints, outils MCP, hooks runtime, incidents et decisions. Neo4j stocke la structure et les liens; les secrets restent dans les environnements, vaults et consoles cloud.

## Schema

Noeuds principaux:

- `Project`
- `Repo`
- `Agent`
- `Service`
- `DockerContainer`
- `EnvVar`
- `Domain`
- `Incident`
- `Decision`
- `File`
- `Concept`
- `McpTool`
- `RuntimeHook`

Relations principales:

- `DEPENDS_ON`
- `DEPLOYED_ON`
- `MODIFIED_BY`
- `MENTIONS`
- `CAUSED`
- `FIXED_BY`
- `STORED_IN`
- `EXPOSED_BY_MCP`
- `HAS_ENDPOINT`
- `HAS_AGENT`
- `USES_TOOL`

## Sources

La construction lit uniquement des sources metadata-only:

- `a11/runtime/knowledge-graph/a11-route-map.json`
- `a11/runtime/knowledge-graph/a11-runtime-hooks.json`
- `a11/runtime/knowledge-graph/funesterie-ecosystem-scope.json`
- `a11/runtime/knowledge-graph/funesterie-ecosystem-corpus.json`
- l'etat de session Codex, filtre en incidents/decisions courts

Les valeurs ressemblant a des tokens, mots de passe, cles ou auth headers sont masquees avant stockage.

## API

Routes protegees JWT:

- `GET /api/memory-graph/v1`
- `GET /api/memory-graph/v1?include=full`
- `GET /api/memory-graph/v1/trace-service?service=a11-backend`
- `GET /api/memory-graph/v1/recent-incidents?limit=12`
- `GET /api/memory-graph/v1/explain-agent-context?agent=a11`

## MCP

Outils read-only:

- `a11_memory_graph_trace_service`
- `a11_memory_graph_recent_incidents`
- `a11_memory_graph_explain_agent_context`

Ces outils servent a expliquer un probleme de prod, retrouver les incidents recents ou donner le contexte d'un agent sans passer par une recherche brute.

## Synchronisation Neo4j

Dry-run:

```powershell
npm --prefix D:\projets\funesterie\a11\backend\apps\server run sync:a11-memory-graph-v1:dry-run
```

Sync locale:

```powershell
npm --prefix D:\projets\funesterie\a11\backend\apps\server run sync:a11-memory-graph-v1
```

Sync aura:

```powershell
npm --prefix D:\projets\funesterie\a11\backend\apps\server run sync:a11-memory-graph-v1 -- --target=aura
```

## Document Intelligence

Neo4j Document Intelligence reste en veille seulement. C'est une preview potentiellement payante: aucune activation automatique, aucun import PDF payant, aucune depense sans validation manuelle.
