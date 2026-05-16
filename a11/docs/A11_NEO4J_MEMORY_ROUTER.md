# A11 Neo4j Memory Router

Le routeur memoire lit Aura et le graphe local riche A11.

Etat courant :

- Aura : `neo4j+s://aa4680d2.databases.neo4j.io`, database `aa4680d2`.
- Local riche : `bolt://127.0.0.1:7687`, database `a11-knowledge-graph`.
- Le local riche reste le meilleur graphe pour explorer/comprendre A11.
- Le miroir Podman `bolt://127.0.0.1:17687` peut rester utile pour infra, mais n'est plus la cible locale par defaut du routeur memoire.

## Regle

- Lecture : Aura d'abord, local riche en second si Aura ne repond pas, ou en fusion explicite.
- Ecriture : Aura d'abord, puis tentative de miroir local riche.
- Synchronisation : projection Aura vers local avec le label `A11AuraMirror`, sans effacer les donnees locales existantes.
- Backup : export JSON Aura + local vers Seagate, avec manifeste SHA-256.

## Commandes

Depuis `D:\projets\funesterie\a11\backend\apps\server` :

```powershell
npm run memory:status
npm run memory:search -- "memory"
npm run memory:write-note -- "note a retenir"
npm run memory:sync-local
npm run memory:backup-seagate
```

Depuis n'importe quel dossier, utilise `--prefix` :

```powershell
npm --prefix "D:\projets\funesterie\a11\backend\apps\server" run memory:status
npm --prefix "D:\projets\funesterie\a11\backend\apps\server" run memory:search -- "memory"
npm --prefix "D:\projets\funesterie\a11\backend\apps\server" run memory:write-note -- "note a retenir"
npm --prefix "D:\projets\funesterie\a11\backend\apps\server" run memory:sync-local
npm --prefix "D:\projets\funesterie\a11\backend\apps\server" run memory:backup-seagate
```

Le CLI charge `.env`, `.env.local`, puis `C:\Users\Djeff\Desktop\pass.txt` si present. Les secrets restent hors des exports et des logs.

## Backup courant

Dernier backup cree :

`E:\A11_BACKUPS\a11-neo4j-memory\2026-05-13T18-25-36-104Z`

Contenu :

- `aura-graph.json`
- `local-graph.json`
- `manifest.json`
