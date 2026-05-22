# Codex session preflight

But: eviter qu'une session Codex reponde avant d'avoir regarde ce que les autres sessions et le MCP viennent deja de faire.

## Commande

Depuis `D:\projets\funesterie\a11mcp`:

```powershell
npm run session:preflight -- --print
```

La commande ecrit aussi:

- `D:\agent-bus\codex-session-preflight.md`
- `D:\agent-bus\codex-session-preflight.json`

## Ce que le preflight lit

- `C:\Users\Djeff\.codex\session_index.jsonl`
- les fichiers recents `C:\Users\Djeff\.codex\sessions\...\rollout-*.jsonl`
- `D:\agent-bus\discussions\discussion-index.json`
- `D:\agent-bus\jobs\jobs-snapshot.json`
- `D:\agent-bus\presence.json`

## Regle d'usage

Avant de parler d'infra, auth, Neo4j, MCP, workers, deploy, Docker/Podman ou routage:

1. lancer le preflight;
2. regarder si une autre session a deja la main;
3. coordonner via MCP/discussion si le sujet est deja pris;
4. ne jamais copier de secret brut dans une reponse ou un fil MCP.

Le script redacte les tokens, mots de passe, cles privees, blocs PGP et longs blobs base64 avant d'ecrire le rapport.
