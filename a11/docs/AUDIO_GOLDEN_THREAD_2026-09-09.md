# Fil d'or audio — empreinte du flux principal

## Demande et constat

Demande de Djeff : un SHA/checksum qui lit le flux principal, en reprenant le diagnostic des quatre fichiers Suno récupérés. Le module `funesterie-audio-provenance.cjs` conservait seulement les SHA-256 des fichiers source/master. Son commit d'introduction `82220eb11` (11 août 2026) fait déjà ce choix : aucune rétrogradation antérieure du SHA du flux n'est démontrée par l'historique inspecté.

SoundCloud reste séparément bloqué : le renouvellement du compte connecté `Cellauro Jeffrey` est refusé (`invalid_grant`) et les accès de la base comme de l'environnement répondent HTTP 401. Le compte doit être reconnecté dans `/admin/social-connect` avant de préparer les publications passées/futures. Aucun envoi ni achat d'abonnement n'a été effectué.

## Contrat ajouté

- SHA-256 du **premier flux audio** (`0:a:0`), après démultiplexage, en copie de codec. Ce n'est ni le fichier complet, ni les tags, ni la pochette, ni la vidéo.
- Les paquets audio encodés sont hachés avec FFmpeg `-c:a copy -f streamhash -hash sha256`. Référence officielle : https://ffmpeg.org/ffmpeg-formats.html#streamhash-1
- Un retag ou un changement de conteneur conservant les mêmes paquets audio conserve l'empreinte. Un réencodage, un traitement V11 ou une modification du son produit normalement une autre empreinte. **Ce n'est pas une reconnaissance acoustique** et cela ne promet pas l'égalité de morceaux simplement ressemblants.
- Le manifeste signé v2 contient les SHA de fichiers existants, les deux empreintes de flux et une relation explicite `derived-from`. Le manifeste v1 reste vérifiable. Les deux empreintes de flux sont requises ensemble ; on ne certifie pas une moitié de chaîne.
- Fichier vide, absence de flux audio, échec/timeout FFmpeg, empreinte du flux vide ou mutation du fichier pendant la mesure : erreur explicite. Aucune URL n'est ouverte par ce lecteur local ; les protocoles des sondes sont limités à `file,pipe` et stdin est fermé côté FFmpeg.
- Le mastering studio mesure le flux avant et après traitement et refuse d'écraser une source qui aurait changé entre-temps. Les anciens manifestes ne sont pas réécrits en masse.

## Vérifications

Tests réels : changement de tags, MP3 remuxé dans Matroska, fichier contenant une deuxième piste audio, modification du volume, signature source/master, manifeste altéré et compatibilité v1. Tests unitaires supplémentaires : fichier vide/illisible, empreinte mal formée, mutation concurrente et flux sans paquets.

Les quatre MP3 cités par Djeff ont été retrouvés sur le volume de production. Un conteneur isolé a lu ce volume **en lecture seule**, avec FFmpeg Linux 5.1.9, sans modifier l'application active ni le batch V11. Les quatre flux sont identifiés comme MP3, 48 kHz, stéréo, et leurs SHA de fichiers sont inchangés après mesure.

| Fichier (suffixe Suno) | SHA-256 du flux principal |
| --- | --- |
| e7a5c411db76bdec | c211d25e82b0261558f2fd9bd2adbe8f622d510a8f2e0da9e884cac3321145c5 |
| 18d4e6c2aa329295 | 7a0dd3c0bd673682244c44184198d8b0308ee061c215a74afa73c898cf049d76 |
| f9e31b397a4a6677 | cfcc04b4b3b77b758875b4ba13c765fa2d3ac8b158cec9a7528f845c08a2c833 |
| 04a92197a71590da | 870bd319577e42d4fbc9323a8980838ba9481dcd70609cfae3ae981915ecfcab |

La suite locale studio/provenance initiale donne 287/288 tests réussis. L'échec est un test du frontend préexistant, sur `launchVivyVideoClip({ dream: true })`, extérieur aux fichiers modifiés. Les essais ciblés de flux et de signature passent sous Windows et Linux. Ne pas présenter la suite globale comme entièrement verte.

## État de livraison

Correctif préparé dans le dépôt, testé sur des fichiers réels ; **pas encore déployé dans le backend actif**. La production web reste au commit `261536d30987368f819a95776df9ac0c4d7742ac`. Le batch V11 en cours n'a pas été modifié ni redémarré par ce travail. L'ajout ne résout pas à lui seul une URL fournisseur vide ou refusée : la récupération réseau et le contrôle d'intégrité sont deux étapes distinctes.

## Suite autorisée : V11 historique et ZEN

- `measure()` renseigne désormais `streamSha256` et `streamIntegrity` pour les prochains rendus V11 ; leurs fiches portent aussi la filiation `derived-from` et la recette. Les SHA de fichiers gardent leur rôle de contrôle exact et de reprise du lot.
- `backfill-jukebox-stream-integrity.cjs --apply --follow-master` mesure les couples déjà rendus, puis suit le lot V11 jusqu'à son arrêt. Chaque couple est vérifié contre ses deux SHA de fichiers avant et après mesure. Les preuves vont dans `history-streams/` pour ne jamais concurrencer l'écrivain de `history-masters/`. Aucun rendu ni média n'est modifié. Le catalogue public ne reprend que les preuves rattachées aux bons fichiers source/master. Ces fiches historiques sont des constats techniques, pas des attestations d'auteur signées.
- Le module ZEN existant reste compatible v1. `encodeTrackVerified()` mesure lui-même l'audio original et chaque master ; `decodeTrackVerified()` contrôle les buffers, les flux et la filiation. Un ancien conteneur reste lisible avec `streamIntegrityOk: null`. Le contrôle synchrone historique ne prétend pas avoir mesuré les flux.
- Correction d'un ancien test de corruption qui ne décodait pas réellement la charge altérée ; ajout de cas de faux flux et de fausse filiation. Un master corrompu ne marque plus à tort la pochette comme corrompue.
- Validation locale : 432 tests passent ; le test frontend préexistant `Vivy frontend keeps download` est explicitement exclu. Les 25 tests ciblés couvrent notamment des MP3 réels et le round-trip ZEN.
- Vérification de configuration live : `@nossen/zen` est résolvable, mais `JUKEBOX_ZEN_KEY` et `JUKEBOX_MASTER_SECRET` sont absentes. **La livraison publique chiffrée n'est pas activée et aucune clé n'est créée ou publiée.** Choisir la conservation et la remise des clés avant de brancher le téléchargement.

Déploiement et traitement historique : résultat effectif à compléter après contrôle de la release active.
