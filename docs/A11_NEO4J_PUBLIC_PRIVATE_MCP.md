# A11 Neo4j Public/Private MCP Plan

Date: 2026-05-22

## Objectif

Deux plans separes:

- Local prive: Neo4j local, miroir riche/dev/backup, acces humain/admin ou MCP local OAuth.
  - Sur le PC Funesterie actuel, le MCP en conteneur doit utiliser `bolt://a11-neo4j-sync:7687`, database `neo4j`.
  - Depuis Windows, le meme Podman Neo4j est expose sur `bolt://127.0.0.1:17687`, database `neo4j`.
  - `bolt://127.0.0.1:7687` correspond au Neo4j Desktop/Docker local et n'utilise pas forcement les memes credentials.
- Cloud public: MCP public `https://a11.funesterie.me/mcp` ou domaine Railway courant, connecte au graphe cloud partage, avec garde-fous.

## Source de verite actuelle

- Aura active: `neo4j+s://aa4680d2.databases.neo4j.io`, database `aa4680d2`.
- Schema lu avec `neo4j-cli query :schema --format toon`.
- Labels deja presents et utiles: `Agent`, `A11AgentProfile`, `A11Capability`, `FunesteriePackage`, `FunesterieRepository`, `FunesterieEcosystemNode`, `FunesterieAccessProfile`, `MemoryNote`, `Job`, `Service`, `Endpoint`, `NossenSourceIndex`.

## Regles de separation

- Secrets/tokens/mots de passe/fichiers perso: Postgres coffre chiffre ou stockage local, jamais Neo4j.
- Neo4j Aura: memoire commune et publique candidate, agents, capacites, NOSSEN shared, Arena.
- Neo4j local: miroir riche, dev, backup, donnees privees ou non nettoyees.
- Sync local vers Aura: seulement apres filtre sanitation.

## Contrat public Neo4j

Tout noeud exposable publiquement doit porter:

- `visibility`: `public`, `shared` ou `private`.
- `owner`: identifiant humain, equipe, agent ou systeme.
- `source`: job/source d'import.
- `canExpose`: boolean.
- `privacy`: `public`, `internal`, `private` ou `secret`.
- `scope`: `public-ai`, `a11-shared`, `local-private` ou `personal`.

Predicate public:

```cypher
n.visibility = 'public' AND n.canExpose = true AND n.privacy = 'public'
```

## Garde MCP ajoute

- `neo4j_write_query` reste exclu du MCP public.
- `neo4j_read_query` existe pour les agents authentifies OAuth/static token.
- En anonyme, `neo4j_read_query` est bloque tant que `A11_PUBLIC_NEO4J_READ_QUERY_ANON=true` n'est pas explicitement pose.
- Deux outils locaux publics aident les agents sans secret:
  - `a11_agent_context`
  - `a11_neo4j_public_contract`

## OAuth Google/Entra

- Google et Microsoft/Entra peuvent connecter un utilisateur.
- Les access/refresh tokens provider sont stockes dans Postgres `oauth_connection_tokens`, chiffres AES-256-GCM.
- L'API `/api/auth/connections` expose uniquement le statut des connexions, jamais les tokens.
- Cle recommandee: `A11_OAUTH_TOKEN_ENCRYPTION_KEY`.

## Suite sure

1. Publier une seconde base Aura dediee au public si on veut une frontiere dure.
2. Migrer vers cette base uniquement les noeuds qui passent le predicate public.
3. Brancher le MCP public sur cette base publique.
4. Seulement apres ca, envisager `A11_PUBLIC_NEO4J_READ_QUERY_ANON=true`.
