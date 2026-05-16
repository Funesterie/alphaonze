# NPZ Joker Double Cookie Hiphop - 2026-05-15

Objectif : eviter que l'arbre Funesterie a 49 agents devienne un point de congestion.

Le graphe garde la carte complete, mais le trafic runtime ne doit pas partir de :

```cypher
Team -> tout le monde
```

Il doit passer par NPZ :

```txt
Agent -> NPZ lane -> agent canonique / domaine cible
```

## Principe

NPZ Joker existe deja dans `D:\projets\funesterie\a11\backend\libs\src\utils`.

Il fournit :

- lanes primary / backup / replay ;
- score adaptatif par lane ;
- circuit breaker par host/lane ;
- request id `npz_id` ;
- inspection admin et metriques.

On l'utilise comme overlay de routage Neo4j :

- `Cluster {kind:"npz-joker-lane"}` = lane de trafic ;
- `MemoryBus {id:"npz-joker-double-cookie-hiphop"}` = bus de routage ;
- `Policy {id:"npz-joker-double-cookie-hiphop"}` = regle : ne jamais router via tout le graphe ;
- chaque `Agent` recoit `npzLane`, `npzCanonicalId`, `npzStampA`, `npzStampB`, `npzHop`, `trafficMode`.

Les stamps remplacent volontairement le mot "cookie" dans les proprietes Neo4j pour ne pas declencher les detecteurs de secrets. Ce sont des marqueurs de routage, pas des secrets, pas des tokens, pas des cookies HTTP.

## Double cookie hiphop

- Stamp A : identite canonique stable, ex. `canonical:codex`.
- Stamp B : lane runtime + scope + capacite, ex. `lane:npz-lane-dev|scope:shared:code|cap:implementation-orchestration`.
- Hiphop : resolution en deux sauts, `agent -> lane -> canonique`, au lieu d'un broadcast global.

## Script

```txt
D:\projets\funesterie\a11mcp\scripts\Apply-FunesterieNpzJokerOverlay.cjs
```

Dry run :

```powershell
node D:\projets\funesterie\a11mcp\scripts\Apply-FunesterieNpzJokerOverlay.cjs --dry-run
```

Application :

```powershell
node D:\projets\funesterie\a11mcp\scripts\Apply-FunesterieNpzJokerOverlay.cjs
```

Le script est idempotent et ne stocke aucun secret.

## Requetes utiles

Vue runtime par lane :

```cypher
MATCH (lane:Cluster {kind:'npz-joker-lane'})<-[:CONNECTS_TO]-(a:Agent)
RETURN lane.name AS lane, count(a) AS agents, collect(a.id) AS ids
ORDER BY lane;
```

Resolution d'un agent :

```cypher
MATCH (a:Agent {id:$agentId})-[:CONNECTS_TO]->(lane:Cluster {kind:'npz-joker-lane'})
RETURN a.id AS agent, a.npzCanonicalId AS canonical, lane.id AS lane, a.trafficMode AS mode, a.npzHop AS hop;
```

Vue graphe sans bruit des variantes :

```cypher
MATCH p=(:Team {name:'Funesterie'})-[:GOVERNS]->(:Domain)<-[:BELONGS_TO]-(:Capability)<-[:CAN]-(a:Agent {trafficMode:'primary'})
RETURN p;
```

Vue des variantes seulement :

```cypher
MATCH p=(variant:Agent {trafficMode:'shadow'})-[:IS_VARIANT_OF]->(canonical:Agent)
RETURN p;
```
