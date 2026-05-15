# Funesterie Identity Tags Worker Tasks

- [ ] 1 Scanner ecosystem-scope et ecosystem-corpus pour detecter les agents, modules, univers, pipelines, memoires et services.
- [ ] 2 Executer identity-archivist-worker avec ecriture corpus pour produire identity-tags.json, identity-tags.md et identity-tags.cypher.
- [ ] 3 Verifier que chaque entite a trois familles de hashtags: fonctionnels, narratifs et visuels.
- [ ] 4 Verifier que les modules techniques restent des artefacts ou systemes, pas des personnages humains.
- [ ] 5 Verifier que NOSSEN reste classe comme univers ou nexus, pas comme agent.
- [ ] 6 Synchroniser les relations Neo4j HAS_IDENTITY_TAG quand la connexion graph est disponible.
- [ ] 7 Publier un etat dispatcher/orchestrator lisible sur le bus MCP sans exposer de secret.
- [ ] 8 Relancer les checks worker et archiver le resume dans la memoire/corpus Funesterie.
