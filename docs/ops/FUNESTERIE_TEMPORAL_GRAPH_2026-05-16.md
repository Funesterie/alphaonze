# Funesterie Temporal Graph

Date: 2026-05-16
Owner: Codex
Status: active on A11 MCP private endpoint

## But

Ajouter la temporalite au graphe Neo4j Funesterie:

- ce qui existe reste porte par les nodes Agent, Module, Capability, Domain, Memory, MCP;
- ce qui se passe maintenant arrive dans Event, Decision et Run;
- les requetes futures peuvent mesurer fiabilite, recovery, latence et choix d'orchestration.

## Nouveaux outils MCP

- `neo4j_temporal_status`
- `neo4j_temporal_schema`
- `neo4j_temporal_emit_event`
- `neo4j_temporal_emit_decision`
- `neo4j_temporal_reliability`

Les ecritures demandent `ALLOW_NEO4J_TEMPORAL_WRITES=true`.

## Schema

Nodes:

- `(:Event {id, type, timestamp, module, status, durationMs, error, taskType, payloadKeys, payloadJson})`
- `(:Decision {id, timestamp, query, chosenModules, alternatives, reason, score})`
- `(:Run {id, startedAt, endedAt, status, triggeredBy})`
- `(:Module {name, kind, createdAt, lastSeenAt})`

Relations:

- `(Module)-[:EMITTED]->(Event)`
- `(Event)-[:TRIGGERED]->(Event)`
- `(Agent)-[:DECIDED]->(Decision)`
- `(Decision)-[:USED]->(Module)`
- `(Decision)-[:REJECTED]->(Module)`
- `(Decision)-[:PRODUCED]->(Run)`
- `(Run)-[:CONTAINS]->(Event)`
- `(Run)-[:STARTED_BY]->(Decision)`
- `(Module)-[:FAILED_ON]->(Event)`

## Integrations actives

QFlush ecrit des evenements best-effort sur:

- `romstation_mouse`
- `romstation_keyboard`
- `qflush_gamepad_play`
- `qflush_gamepad_pilot`
- `qflush_keyboard_play`
- `qflush_keyboard_pilot`
- `qflush_mouse_click`

Janus/Vivy/media ecrivent aussi:

- `qflush_janus_analyze` -> module `janus`, taskType `vision`
- `qflush_vivy_audio_analyze` -> module `vivy`, taskType `audio`
- `qflush_media_analyze` -> module `qflush-media`, taskType `media`

Les payloads sont nettoyes: pas de secret, pas de token, pas de cookie, pas de credential. Neo4j stocke `payloadJson` et `payloadKeys`, pas une map brute.

## Requete utile

```cypher
MATCH (m:Module)-[:EMITTED]->(e:Event)
WITH
  m,
  count(e) AS total,
  sum(CASE WHEN e.status = 'ok' THEN 1 ELSE 0 END) AS successes,
  sum(CASE WHEN e.status IN ['error', 'timeout', 'failed'] THEN 1 ELSE 0 END) AS failures
RETURN
  m.name AS module,
  total,
  successes,
  failures,
  CASE WHEN (successes + failures) = 0 THEN null ELSE successes * 1.0 / (successes + failures) END AS reliability
ORDER BY reliability DESC, total DESC
```

## Premier test

Schema applique: 10 statements.
Premier event `neo4j-temporal-setup`: OK.
Premier read `neo4j_temporal_reliability`: OK.
