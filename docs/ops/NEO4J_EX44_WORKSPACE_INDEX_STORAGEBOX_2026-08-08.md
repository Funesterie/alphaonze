# Neo4j EX44, inventaire workspace et Storage Box

Date de l'audit: 2026-08-08. Les releves distants ont ete effectues en lecture seule. Aucune image n'a ete tiree, aucun script n'a ete depose et aucun graphe, snapshot Restic, service ou timer n'a ete modifie pendant cet audit.

## Etat verifie

| Element | Etat observe |
|---|---|
| Hote | `a11-prod-finland` (EX44) |
| Neo4j | conteneur `a11-neo4j`, image `neo4j:5-community`, actif |
| Bolt hote | `127.0.0.1:7687` uniquement |
| Bolt Docker | `a11-neo4j:7687` depuis le backend |
| Volume | `a11-neo4j-data`, environ 531 Mio dans `/data` |
| Graphe | 5 643 noeuds, 16 282 relations |
| Disque EX44 | environ 75 Gio disponibles, utilisation 82 % |
| Recherche | index plein texte actifs pour chats, sessions, recherches et constats |
| Sauvegarde existante | Restic SFTP chiffre, timer quotidien reussi, runtime/uploads/PostgreSQL |
| Lacune sauvegarde | aucun export logique Neo4j dans le script quotidien observe |
| Ancien montage | `alphaonze-storage-1tb` est distinct et etait inactif |

La capacite de 50 Go de la nouvelle Storage Box vient de l'information operateur; elle n'a pas ete verifiee depuis le fournisseur pendant cet audit.

Provenance historique declaree par Djeff: le travail de memoire graphe a commence avec ChatGPT dans le projet jEFFLEZ avant sa migration vers Funesterie. Cette information doit rester marquee `operator-asserted` tant qu'une archive datee jEFFLEZ n'est pas rattachee; elle ne doit pas etre effacee ni presentee comme une verification externe.

## Regle de port canonique

- `7687`: Neo4j canonique sur EX44 et sur une installation locale standard.
- `17687`: miroir Podman historique `a11-neo4j-sync`, seulement quand son lanceur ou `A11_SYNC_MIRROR_NEO4J_URI` le demande explicitement.
- Le routeur general ne doit jamais prendre `17687` comme cible principale implicite.

## Inventaire incremental

Le script `a11/backend/apps/server/scripts/sync-workspace-files-neo4j.cjs` est sans effet par defaut. Il ne se connecte a Neo4j que si `--apply` est present.

Il enregistre uniquement:

- chemin relatif, nom, extension, langage et domaines fonctionnels;
- taille, lignes, date de modification et SHA-256;
- provenance Git, branche, HEAD, statut suivi/non suivi;
- hierarchie des dossiers et references locales resolues;
- liens exacts vers `VivyGraphFile` et `ResearchDoc` deja enrichis.

Il n'enregistre aucun contenu brut. Il exclut `.git`, dependances, builds, caches, sauvegardes, uploads, runtime prive, fichiers d'environnement/credentials, cles, modeles, medias et binaires. Une detection de formats de secrets a haute confiance forme une seconde barriere.

Dry-run mesure sur le depot principal:

- 2 097 candidats;
- 1 900 fichiers surs;
- 288 dossiers;
- 1 142 references locales;
- 23 113 346 octets haches;
- 197 exclusions, dont 146 binaires/modeles, 29 noms sensibles et 4 contenus a signature de secret.

Le depot Git imbrique `a11mcp` est ignore par le depot parent et exige une seconde passe, avec un `rootId` distinct. Son dry-run ajoute 148 fichiers surs, 14 dossiers et 1 reference, pour 1 588 667 octets; un fichier sensible est exclu. Total prepare: 2 048 fichiers metadata-only sur les deux depots.

```powershell
npm --prefix D:\projets\funesterie\a11\backend\apps\server run sync:workspace-files-neo4j:dry-run
```

## Activation future sur EX44

Ne pas activer pendant un deploiement. Faire d'abord une sauvegarde et un essai de restauration. Pour indexer le workspace Windows complet, utiliser un tunnel temporaire plutot que scanner seulement `/app` dans le conteneur:

```powershell
$neo4jTunnelPort = 27688
ssh -i C:\Users\cella\.ssh\codex-a11-hetzner-20260627_ed25519 -N -L "${neo4jTunnelPort}:127.0.0.1:7687" deploy@37.27.63.109
```

Dans un autre terminal, charger les identifiants Neo4j depuis le coffre local approuve, jamais depuis l'historique Git, puis:

```powershell
$env:A11_LOCAL_NEO4J_URI = "bolt://127.0.0.1:$neo4jTunnelPort"
$env:A11_LOCAL_NEO4J_USER = '<depuis-le-coffre>'
$env:A11_LOCAL_NEO4J_PASSWORD = '<depuis-le-coffre>'
node D:\projets\funesterie\a11\backend\apps\server\scripts\sync-workspace-files-neo4j.cjs --apply --target local --root D:\projets\funesterie --root-id funesterie-alphaonze
node D:\projets\funesterie\a11\backend\apps\server\scripts\sync-workspace-files-neo4j.cjs --apply --target local --root D:\projets\funesterie\a11mcp --root-id funesterie-a11mcp
```

Le sync est idempotent: nouveau/modifie/inchange sont mesures; les fichiers disparus sont marques `missing`, jamais supprimes. Les contraintes et index utilisent `IF NOT EXISTS`. Les relations de references derivees sont reconstruites uniquement pour les fichiers de ce workspace.

## Sauvegarde Storage Box preparee

Le lot `a11/ops/backup/` ajoute:

- inventaire logique de diagnostic, explicitement non restaurable;
- dump natif Neo4j pendant un bref arret controle, avec redemarrage garanti par trap;
- restauration automatique dans un volume/conteneur jetable et comparaison noeuds, relations, contraintes et index;
- manifestes, preuve de restauration et SHA-256;
- Restic chiffre vers la Storage Box;
- retention 14 quotidiens, 8 hebdomadaires, 12 mensuels;
- verification partielle `1/200`;
- verrou de concurrence, staging `0700`, plafond de 40 Go et nettoyage borne;
- mode Restic hote sous service systemd root, reutilisant le binaire et l'alias SFTP deja verifies;
- mode Docker uniquement comme secours apres epinglage par digest et essai de restauration; Docker n'est pas une frontiere de privilege;
- service/timer systemd root a `04:17`, apres la sauvegarde Vivy existante. Une crontab `deploy` n'est pas recommandee.

Le script est `dry-run` par defaut. `--apply` est obligatoire. La retention filtre le tag `a11-neo4j-storagebox`, afin de ne pas supprimer les snapshots de l'autre campagne Restic.

## Ordre recommande

1. Relire et fusionner le code, sans chevaucher un deployement Claude.
2. Verifier/faire tourner les identifiants qui ont pu apparaitre dans d'anciennes documentations.
3. Installer le lot Storage Box et executer son dry-run.
4. Lancer une premiere sauvegarde manuelle.
5. Restaurer dans un Neo4j jetable et comparer noeuds, relations, contraintes et index.
6. Ouvrir le tunnel temporaire et appliquer l'inventaire workspace.
7. Verifier les metriques, puis seulement activer le timer.
