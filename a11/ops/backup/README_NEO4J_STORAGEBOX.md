# Neo4j et artefacts vers la Storage Box

Ce lot est volontairement inactif tant qu'il n'est pas installe explicitement. Le script est en `dry-run` par defaut et `--apply` est obligatoire pour exporter ou contacter Restic.

## Etat observe le 2026-08-08

- EX44: `a11-neo4j` ecoute uniquement sur `127.0.0.1:7687` et stocke ses donnees dans le volume `a11-neo4j-data`.
- Le graphe lu sans mutation contenait 5 643 noeuds et 16 282 relations; le volume `/data` occupait environ 531 Mio.
- Le serveur avait environ 75 Gio libres sur son RAID local.
- Un depot Restic SFTP chiffre `vivy-storage` et un timer quotidien existaient deja. La sauvegarde en place couvrait runtime, uploads et PostgreSQL, mais pas un dump natif Neo4j.
- Le montage rclone `alphaonze-storage-1tb` est un stockage different et etait inactif; il ne faut pas le confondre avec la nouvelle enveloppe de 50 Go.

## Contenu du lot

1. Inventaire logique local par le routeur existant, avec comptes et schema. Il est explicitement marque `restorable=false`: certains types Neo4j ne peuvent pas etre reconstruits fidelement depuis ce JSON.
2. Dump natif `neo4j-admin database dump`, obtenu pendant un bref arret controle du conteneur. Le trap redemarre Neo4j meme si le dump echoue.
3. Chargement du dump dans un volume et un conteneur jetables, puis comparaison des noeuds, relations, contraintes et index avant transfert.
4. `BACKUP-MANIFEST.txt`, preuve `RESTORE-VERIFICATION.txt` et SHA-256 pour tous les fichiers de campagne.
5. Ajout des artefacts de graphe et de memoire selectionnes, sans modeles, uploads video, corpus bruts, archives MCP ou fichiers d'environnement.
6. Chiffrement et authentification client Restic avant transfert SFTP.
7. Retention: 14 quotidiens, 8 hebdomadaires et 12 mensuels, puis verification partielle `1/200`.
8. Verrou `flock`, staging en mode `0700`, plafond source de 40 Go et suppression du staging apres succes ou erreur.

Le dump natif est obligatoire par defaut. Il provoque une courte indisponibilite de Neo4j, pas du backend entier. `A11_BACKUP_NATIVE_DUMP_MODE=disabled` existe uniquement pour un diagnostic sans garantie de restauration et ne doit pas etre utilise comme sauvegarde canonique.

## Verification locale, sans effet

```bash
bash a11/ops/backup/a11-neo4j-storagebox-backup.sh --dry-run
```

Le dry-run ne cree aucun dossier, ne se connecte pas a Restic et ne lance aucun export.

## Installation future sur EX44

Ne pas executer ces commandes pendant un deploiement blue/green. Relire d'abord le diff et verifier l'alias SSH Restic.

```bash
sudo install -d -m 0700 /etc/a11-backup /home/deploy/a11-data/runtime/backup-staging/neo4j-storagebox /var/cache/a11-restic
sudo install -m 0750 a11/ops/backup/a11-neo4j-storagebox-backup.sh /usr/local/sbin/a11-neo4j-storagebox-backup
sudo install -m 0600 a11/ops/backup/a11-neo4j-storagebox.env.example /etc/a11-backup/neo4j-storagebox.env
sudo install -m 0644 a11/ops/backup/a11-neo4j-storagebox.service /etc/systemd/system/
sudo install -m 0644 a11/ops/backup/a11-neo4j-storagebox.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo /usr/local/sbin/a11-neo4j-storagebox-backup --dry-run
sudo systemd-analyze verify /etc/systemd/system/a11-neo4j-storagebox.service /etc/systemd/system/a11-neo4j-storagebox.timer
sudo systemctl start a11-neo4j-storagebox.service
sudo systemctl status --no-pager a11-neo4j-storagebox.service
sudo systemctl enable --now a11-neo4j-storagebox.timer
```

Sur l'EX44 actuel, le chemin canonique est le service systemd root avec `A11_BACKUP_RESTIC_MODE=host`: c'est le meme binaire Restic et le meme alias SFTP deja verifies par `a11-vivy-backup`. Ne pas presenter le mode Docker comme une separation de privilege: un compte autorise a piloter le daemon Docker est de fait privilegie. Ne pas recopier le mot de passe Restic dans une release ou la crontab de `deploy`.

Le mode Docker reste un secours explicite. Avant de l'utiliser, epingler l'image par digest, confirmer qu'elle contient un client SSH compatible avec l'alias `vivy-storage`, puis effectuer un restore complet dans un repertoire jetable. Le premier lancement ne doit jamais dependre d'un `docker pull` automatique non relu.

La campagne ne reussit que si le dump a deja ete restaure dans une base Neo4j jetable et si les nombres de noeuds, relations, contraintes et index correspondent. Un `restic check` seul prouve l'integrite du depot, pas la restaurabilite applicative.
