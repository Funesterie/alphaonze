# A11 MCP AI Autopilot

Objectif: ne plus utiliser Neo4j Desktop/Query pour l'exploitation quotidienne.

Les IA doivent passer par les MCP:

- `a11mcp-shared`: `https://mcp.funesterie.me/mcp`
- `a11mcp-aura-local`: `http://127.0.0.1:8788/mcp`
- Local rich Neo4j reste disponible pour A11, mais l'humain n'a pas besoin d'ouvrir la console.

## Regle d'usage

- Lecture: utiliser `neo4j_status` et `neo4j_read_query`.
- Ecriture: utiliser seulement `memory_write_safe`, `graph_write_safe`, `discussion_post` et `discussion_set_status`.
- Ne pas demander a l'humain de lancer des requetes Neo4j manuelles.
- Ne pas utiliser `neo4j_write_query` sauf maintenance explicite.
- Le bouton Aura de Neo4j Desktop sur une connexion locale peut lancer un flux d'upload/ecrasement: ne pas l'utiliser pour les operations courantes.

## Autopilote local

Script:

```powershell
D:\projets\funesterie\a11\ops\a11-mcp-ai-autopilot.ps1
```

Commandes depuis le backend:

```powershell
npm --prefix "D:\projets\funesterie\a11\backend\apps\server" run mcp:autopilot
npm --prefix "D:\projets\funesterie\a11\backend\apps\server" run mcp:autopilot:sync
npm --prefix "D:\projets\funesterie\a11\backend\apps\server" run mcp:autopilot:backup
```

## Hook Codex MCP Neo

Commande courte depuis la racine du workspace:

```powershell
npm run mcp:hook
```

Cette commande:

- verifie MCP local partage (`127.0.0.1:8787`) et MCP Aura (`127.0.0.1:8788`);
- lit les compteurs Aura/local via le routeur memoire A11;
- rafraichit dans Aura le noeud `(:Job {id:'codex-mcp-neo-hook'})` via `graph_write_safe`;
- ajoute une note append-only via `memory_write_safe` seulement quand `-PostOk` est fourni;
- ecrit le resultat local dans `D:\projets\funesterie\a11\runtime\mcp-autopilot\status.json`.

Pour tester sans ecriture:

```powershell
npm run mcp:hook:dry-run
```

Le script:

- demarre les conteneurs Podman existants si besoin;
- si Podman est indisponible, lance `a11mcp` en fallback Node local sur `8787` et `8788`;
- verifie MCP public, MCP local, MCP Aura;
- utilise MCP Aura pour le statut et le checkpoint;
- utilise le routeur memoire A11 pour les compteurs, la synchro Aura -> local et le backup;
- en tache planifiee, peut synchroniser Aura vers local, lancer le backup Seagate et rafraichir le noeud `Job`;
- n'ajoute une note memoire append-only que lorsque `-PostOk` est fourni, pour eviter de polluer Aura toutes les 15 minutes;
- ecrit son etat dans `D:\projets\funesterie\a11\runtime\mcp-autopilot\status.json`;
- poste dans le fil MCP seulement si on demande `-PostOk` ou en cas d'erreur.

## Taches Windows installees

- `A11 MCP AI Autopilot`: toutes les 15 minutes.
- `A11 MCP AI Autopilot Logon`: a l'ouverture de session.

Les deux taches sont configurees pour fonctionner aussi sur batterie et pour ignorer un nouveau lancement si un controle est deja en cours.

## Routage attendu

- Pour comprendre/explorer A11: local rich en premier.
- Pour memoire partagee courte et agents: Aura via `a11mcp-aura-local`.
- Pour coordination multi-agent stable: `a11mcp-shared`.
