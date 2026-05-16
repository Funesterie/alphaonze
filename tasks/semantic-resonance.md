# Semantic Resonance Agent Tasks

Objectif: apprendre aux agents A11, K44, Vivy, Kiro et Codex a comprendre la
charge humaine des mots, references, blagues, symboles et interactions.

## Etat

- [x] Ajouter la spec source: `a11/docs/A11_SEMANTIC_RESONANCE_ENGINE.md`
- [x] Ajouter le seed initial: `a11/runtime/knowledge-graph/semantic-resonance-seeds.json`
- [x] Ajouter un module de lecture/scoring deterministe.
- [x] Ajouter les premiers tests.
- [ ] Ajouter 20 nouvelles ancres humaines haute valeur.
- [ ] Ajouter un modele de confiance: source, contexte, fraicheur, risque de contresens.
- [ ] Ajouter une projection Neo4j via `graph_write_safe`, sans ecraser les donnees existantes.
- [ ] Brancher A11 chat pour consulter cette couche quand une reference culturelle est detectee.
- [ ] Brancher K44 en mode compagnon quotidien: explication courte, utile, sans surcharger.
- [ ] Brancher Vivy en mode voix: ton, rythme, emotion, pas seulement texte.
- [ ] Brancher la roulette media semantique pour preferer les medias qui resonent avec le contexte user.
- [ ] Ajouter une boucle curator: proposition agent -> revue -> seed valide.
- [ ] Ajouter un check MCP au demarrage: heartbeat + inbox + tasks avant toute action longue.

## Regles de contribution

- Ne pas faire du scraping brut.
- Ne pas transformer toutes les conversations en references pop.
- Ne pas surcharger Djeff avec des consoles Neo4j.
- Garder les secrets hors corpus.
- Toute ecriture graphe passe par un outil safe ou une validation explicite.
- Une entree doit contenir: sens litteral, facettes, tons, interactions, confiance.

## Prochaines ancres suggerees

- Link
- Zelda
- Goku
- Senku
- Soprano Phoenix
- Fresh Prince / Jeffrey
- Joker
- Black Lagoon
- Ultra Instinct
- Atlantis
- NOSSEN
- Vivy
- A11 capuche
- QFlush
- RubixGate
- Rome
- Corpus
- Piccolo
- Doctor
- Janus
