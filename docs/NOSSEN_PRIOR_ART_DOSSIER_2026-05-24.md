# Dossier d'anteriorite technique NOSSEN/Funesterie

Date de constitution : 2026-05-24

Statut : dossier technique interne et reutilisable, secret-safe. Ce document ne
constitue pas une accusation contre un tiers ni un avis juridique. Il sert a
poser une trace claire, datee et verifiable de l'architecture NOSSEN/Funesterie
autour de la memoire agent, des graphes de connaissance, du MCP, de GraphRAG et
des couches de securite operateur.

## Position courte

La newsletter Neo4j du 2026-05-23 couvre des themes tres proches de NOSSEN :
memoire agent, graph memory, GraphRAG, semantic layer, AI agents et GCP. Cela
confirme surtout que le marche nomme maintenant des problemes deja traites dans
Funesterie/NOSSEN.

Le dossier local ne permet pas d'affirmer une copie par Neo4j. En revanche, il
montre une anteriorite d'implementation et de documentation sur plusieurs axes :

- memoire long terme RAG et memoire episodique ;
- Knowledge Graph Neo4j avec fallback local ;
- orchestration MCP et agents multiples ;
- routeur memoire Aura/local ;
- indexation de sources metadata-only ;
- carte semantique de SHA, BLOOP et Cortex ;
- separation modules publics/adaptateurs prives ;
- couches NEZ, RubixGate, RubixCube vault et preuve par usage sans exposition de
  secrets ;
- interface cockpit et coordination agents.

La posture recommandee est donc : "implementation independante deja avancee",
pas "ils nous ont vole l'idee".

## Difference avec le discours Neo4j public

Les themes Neo4j publics se concentrent sur une pile graphe/agent :

- GraphRAG ;
- memoire court terme / long terme / traces de raisonnement ;
- couche semantique pour reduire le contexte envoye au LLM ;
- agents de production sur GCP ;
- Neo4j MCP server et integrations cloud.

NOSSEN/Funesterie recouvre ces zones, mais ajoute un perimetre operationnel plus
large :

- un bus d'agents et de discussions, pas seulement une base graphe ;
- des agents reels branches sur des surfaces distinctes : Codex, Kiro, A11,
  Kaen44, Vivy, QFlush, Chopper, Discord, GitHub et MCP ;
- une politique "preuve par usage" pour verifier un secret sans jamais l'afficher ;
- une separation explicite entre paquets publics `@nossen/*` et adaptateurs
  prives ;
- un modele de flux internes NEZ en RGBA avec controle sur le canal `A`, plus
  chiffrement authentifie, anti-rejeu et audit ;
- des capsules RubixGate a TTL, scopes, kill-switch et audit ;
- un coffre RubixCube vault qui chiffre puis decoupe les bundles en shards PNG ;
- des outils de cartographie source et LAN qui stockent des metadonnees, pas les
  contenus sensibles ;
- un cockpit MCP heberge, concu pour rendre les fils, jobs et agents visibles
  sans exposer le contenu sensible.

Ce point est important pour un pitch externe : NOSSEN n'est pas "un graph memory
de plus", c'est une couche d'exploitation agentique avec memoire graphe,
orchestration, securite operateur et packaging.

## Chronologie verifiable

Les dates ci-dessous viennent du `git log` local dans le worktree
`D:\projets\funesterie-worktrees\nossen-priority-dossier-20260524`, branche
`codex/nossen-priority-dossier-20260524`, base `origin/master`.

| Date | Trace | Ce que cela prouve |
| --- | --- | --- |
| 2026-04-09 | `f4defd64 Add image hint memory and vision judge` | Memoire visuelle et evaluation de vision avant le cycle Neo4j de fin avril. |
| 2026-04-25 | `09f5a01c feat(security): harden local-only admin and network access` | Base de securite locale et controle d'acces avant l'empilage agents. |
| 2026-04-26 | `70033f79 feat(a11): implement RAG vector memory for long-term context` | Memoire vectorielle long terme / RAG implementee. |
| 2026-04-26 | `5c21a354 feat(a11): implement Knowledge Graph with Neo4j support` | Knowledge Graph Neo4j deja implemente. |
| 2026-04-26 | `638b9c4e feat(a11): implement Episodic Memory (simple preference and event storage)` | Memoire episodique explicite. |
| 2026-04-26 | `3dc4ffc4 feat(a11): activate NEZ security (dev mode) and document Ollama workspace` | Couche NEZ deja presente dans l'architecture. |
| 2026-04-26 | `c83c2e62 feat: backend routes, checkpoint manager, tool-calling layer, MCP server, Kiro steering + settings` | MCP server, tool-calling et pilotage Kiro presents. |
| 2026-04-27 | `f38e9b52 feat(neo4j): add database import/export and password reset tools` | Outillage Neo4j local, export/import et maintenance. |
| 2026-04-27 | `5d09d878 feat: A11 Autonomous Action System + audio analysis + DB constraints + LLM priority + launcher fix + audio privacy guard` | Systeme autonome, contraintes DB et garde-fous media. |
| 2026-05-12 | `34066f36 feat(kiro): add neo4j mcp orchestration` | Priorite Neo4j + MCP + Kiro formalisee. |
| 2026-05-15 | `681cf503 feat: add identity archivist worker` | Worker d'archivage identite. |
| 2026-05-15 | `87dc54be feat: add persistent identity hashtag layer` | Couche d'identite persistante dans la memoire. |
| 2026-05-16 | `53cdc001 docs: align agent role routing` | Routage de roles agents documente. |
| 2026-05-16 | `5ddf0819 fix: connect A11 MCP token bridge and semantic hooks` | Pont MCP et hooks semantiques. |
| 2026-05-19 | `b976c413 feat(nossen): add source index search` | Recherche dans index de sources NOSSEN. |
| 2026-05-19 | `a52dea6a feat(nossen): add bloop memory sonar` | Sonar memoire BLOOP. |
| 2026-05-19 | `8cc2aa5b feat(nossen): add cortex semantic sha map` | Carte semantique de SHA / Cortex. |
| 2026-05-22 | `ec7d8af2 fix(nossen): map drive roots and package train (#89)` | Cartographie Drive/cloud/package train. |
| 2026-05-22 | `a3631d2c feat(mcp): add RubixCube vault tools (#91)` | Outils coffre RubixCube exposes via MCP. |
| 2026-05-22 | `7a32d590 feat(mcp): check shared token from RubixCube (#92)` | Verification par usage d'un token sans affichage. |
| 2026-05-23 | `fa84afe8 Publish NOSSEN 2.0 stable package train` | Train de packages publics NOSSEN publie. |
| 2026-05-23 | `14268d13 feat(a11): host MCP cockpit in backend` | Cockpit MCP heberge cote backend. |
| 2026-05-23 | `0bdb4063 fix(cockpit): show mcp threads (#114)` | Threads MCP rendus visibles dans le cockpit. |
| 2026-05-23 | `eaed3c50 docs(security): add adaptive NOSSEN security brief` | Brief securite adaptative formalise. |

## Pieces locales principales

Ces fichiers constituent les points de preuve les plus lisibles sans exposer de
secrets.

| Fichier | Role dans l'anteriorite |
| --- | --- |
| `A11_NEO4J_BRIEFING.md` | Decrit le Knowledge Graph Neo4j, Graph RAG, liens semantiques et memoire episodique. |
| `A11_COMPLETE_SETUP_SUMMARY.md` | Resume la mise en place Neo4j, dump de knowledge graph et scripts. |
| `a11/docs/A11_NEO4J_MEMORY_ROUTER.md` | Formalise le routeur memoire Aura/local, backup et synchro. |
| `a11/docs/A11_MCP_AI_AUTOPILOT.md` | Pose la regle : les IA passent par MCP, pas par requetes manuelles. |
| `docs/FUNESTERIE_AGENT_ROSTER.md` | Decrit le roster agents, protocole d'arrivee, routage MCP et regles no-secrets. |
| `docs/NOSSEN_SOURCE_INDEX.md` | Decrit index source metadata-only, BLOOP, Cortex, LAN radar et sync Neo4j. |
| `docs/security/NOSSEN_ADAPTIVE_SECURITY_BRIEF_2026-05-23.md` | Consolide NEZ, RubixGate, RubixCube, MCP, OAuth, preuves et preparation SOC 2. |
| `docs/ops/RUBIXGATE_TIMELOCK_CAPSULE_PLAN_2026-05-14.md` | Decrit capsules temporaires, scopes, TTL, audit et kill-switch. |
| `docs/ops/RUBIXCUBE_VAULT_2026-05-22.md` | Decrit coffre chiffre, shards PNG et verification secret-safe. |
| `a11/docs/A11_DUMP_RGBA_BROTLI.md` | Decrit le format archive RGBA/Brotli reversible et verifiable. |
| `NOSSEN_PACKAGE_MATRIX.md` | Liste le train de packages publics `@nossen/*`. |

## Verification Neo4j du 2026-05-24

La lecture du schema Neo4j a ete effectuee avec :

```powershell
neo4j-cli query :schema --format toon
```

Le schema contient notamment des labels et contraintes pour :

- `MemoryEvent`, `MemoryFlow`, `MemoryNote`, `MemoryScope`, `MemoryBus` ;
- `NossenSourceIndex`, `NossenSourceEntry`, `NossenSemanticMap`,
  `NossenSemanticCluster`, `NossenSha`, `NossenLanMap`, `NossenLanEndpoint` ;
- `FunesterieSemanticTool`, `FunesterieSourceCard`, `FunesteriePackage`,
  `FunesterieCorpusPack`, `FunesterieAccessProfile` ;
- `A11RuntimeHook`, `A11Capability`, `A11RouteNode`, `A11KnowledgeDomain` ;
- `Agent`, `MCPTool`, `Endpoint`, `Service`, `Job`.

Une requete read-only filtree sur `nossen`, `funesterie`, `mcp`, `semantic`,
`memory`, `graphrag` et `nez` a retourne les compteurs suivants :

| Labels | Nombre |
| --- | ---: |
| `FunesterieEcosystemNode`, `NossenSourceEntry` | 1020 |
| `FunesterieEcosystemNode`, `NossenSha` | 553 |
| `NossenConversation`, `ChatGPTConversation` | 32 |
| `FunesterieEcosystemNode`, `FunesterieSourceCard` | 20 |
| `MemoryNote`, `AgentDecision` | 18 |
| `FunesterieEcosystemNode`, `NossenSemanticCluster` | 12 |
| `FunesterieEcosystemNode`, `FunesteriePackage` | 12 |
| `MCPTool` | 5 |

Interpretation prudente : le graphe actuel contient deja une projection
NOSSEN/Funesterie de sources, hashes, clusters semantiques, conversations,
packages, outils MCP et decisions agents. Ce n'est pas une preuve publique en
soi, car une base peut evoluer ; c'est une piece de corroboration a associer aux
commits, PR, checks CI et exports horodates.

## Angle public reutilisable

Titre possible :

> NOSSEN: operational graph memory for agent fleets

Resume :

> NOSSEN/Funesterie est une architecture d'orchestration pour agents IA qui
> combine memoire graphe, GraphRAG, indexation metadata-only, MCP, routage
> multi-agent et securite operateur. Le systeme separe les paquets publics
> reutilisables des adaptateurs prives, verifie les secrets par usage sans les
> afficher, et garde une piste d'audit secret-safe pour les operations sensibles.

Points differenciants a citer :

- memoire graphe hybride : Aura pour memoire partagee courte, graphe local riche
  pour exploration, backups SHA-256 ;
- agent bus : discussions, jobs, presences, heartbeats, dialogue jusqu'a
  resolution ;
- source index : metadonnees et empreintes, pas ingestion brute de Drive ou de
  fichiers sensibles ;
- NEZ/RGBA : flux internes verifies, avec canal `A` pour controle et garanties
  cryptographiques portees par chiffrement/MAC/anti-rejeu ;
- RubixGate/RubixCube : capsules temporaires et coffre chiffre orientes
  operateur ;
- packaging : train `@nossen/*` public et adaptateurs prives separes.

Phrase courte pour contact Neo4j/NODES :

> Nous avons construit un cas terrain NOSSEN/Funesterie autour de la memoire
> graphe pour agents : Neo4j/Aura + MCP + bus d'agents + source indexing
> metadata-only + securite operateur. Votre newsletter du 23 mai recoupe
> beaucoup de sujets ; nous aimerions proposer un retour d'experience sur les
> points qui deviennent concrets quand plusieurs agents operent en meme temps.

## Checklist de conservation

Actions recommandees, sans exposer de secrets :

1. Exporter un `git log --date=iso --stat` vers un fichier horodate.
2. Creer un `git bundle` de la branche principale et de la branche dossier.
3. Generer un manifeste SHA-256 des docs et scripts cites.
4. Exporter le schema Neo4j uniquement, puis un resume read-only des compteurs
   par label. Ne pas exporter les valeurs completes avant revue secret-safe.
5. Conserver les PR GitHub, checks CI, scans Gitleaks/CodeQL et tags npm comme
   preuves publiques ou semi-publiques.
6. Garder les captures de newsletter et mails dans un dossier local horodate, en
   evitant les captures avec codes, secrets ou donnees personnelles inutiles.
7. Si un usage legal ou depot formel devient necessaire, demander un avis
   specialise avant de partager des exports complets.

## Commandes de regeneration secret-safe

Ces commandes ne doivent pas afficher de secrets si elles sont lancees depuis un
repo propre et un Neo4j correctement configure :

```powershell
git -C D:\projets\funesterie log --all --date=short --pretty=format:"%ad %h %s" -- "*neo4j*" "*memory*" "*mcp*" "*nossen*" "*graph*" "*NEZ*"

neo4j-cli query :schema --format toon

neo4j-cli query "MATCH (n) WITH n, toLower(coalesce(n.id,'') + ' ' + coalesce(n.name,'') + ' ' + coalesce(n.title,'') + ' ' + coalesce(n.label,'') + ' ' + coalesce(n.summary,'') + ' ' + coalesce(n.description,'') + ' ' + coalesce(n.kind,'') + ' ' + coalesce(n.semanticKey,'')) AS text WHERE text CONTAINS 'nossen' OR text CONTAINS 'funesterie' OR text CONTAINS 'mcp' OR text CONTAINS 'semantic' OR text CONTAINS 'memory' OR text CONTAINS 'nez' RETURN labels(n) AS labels, count(*) AS count ORDER BY count DESC LIMIT 25" --format toon
```

## Conclusion

NOSSEN/Funesterie a une anteriorite locale documentee sur les themes que Neo4j
met en avant dans sa newsletter : memoire agent, graph memory, GraphRAG,
semantic layer, MCP et agents de production. La difference strategique est que
NOSSEN les traite comme une exploitation multi-agent complete, avec securite
operateur, preuves secret-safe, packaging public/prive et cockpit d'operation.

La bonne prochaine action n'est pas de contester. C'est de publier une version
propre, proposer un retour d'experience, et garder les preuves techniques en
ordre.
