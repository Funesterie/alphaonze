# Funesterie Agent Tree Repair - 2026-05-14

Objectif : rattacher tous les agents visibles au meme arbre Neo4j Funesterie sans suppression ni renommage destructif.

Script :

```txt
D:\projets\funesterie\a11mcp\scripts\Repair-FunesterieAgentTree.cjs
```

Effet :

- `Team {id:"funesterie-team", name:"Funesterie"}` devient la racine.
- 11 `Domain` structurent les zones : orchestration, reasoning, dev, UI, media, runtime, retro, memoire, infra, corpus, securite.
- 38 `Capability` sont rattachees aux domaines.
- 49 `Agent` sont rattaches a `Team`, `Role`, `MemoryScope` et `Capability`.
- 13 variantes sont reliees a leur agent canonique via `IS_VARIANT_OF`.

Verification apres execution :

```txt
totalAgents = 49
teamMembers = 49
treePaths = 49
domains = 11
```

Important :

- Le script est idempotent.
- Il ne stocke aucun secret.
- Il ne supprime aucun noeud existant.
- Il peut etre relance apres un import Aura/local pour restaurer l'arbre.
