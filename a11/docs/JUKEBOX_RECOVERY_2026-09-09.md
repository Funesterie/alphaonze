# Jukebox restauré, V11 Pan et titres Claude — 9 septembre 2026

## Périmètre autorisé

Djeff a demandé de récupérer l'historique, a confirmé « Tout rendre public », puis a précisé de ne garder que les audios disponibles, de les passer en V11 Pan et de les titrer avec le parolier Claude. Les fichiers source, essais et variantes restent conservés. Aucun nouveau morceau Suno, clip Comfy ou clonage vocal payant n'a été lancé pendant cette récupération.

## Historique et disponibilité

- Inventaire : 928 callbacks, 805 fichiers locaux inspectés, récupération de fichiers déjà archivés et 19 audios supplémentaires depuis les anciens liens fournisseurs. Les liens restants expirent principalement en 404/403.
- Archive durable : 1 957 fiches, dont **834 audios disponibles** et 1 123 fiches sans audio. Ces dernières restent privées sur disque et sont exclues de l'API publique et de `/nossen/`. Ne pas relancer inutilement les 3 341 tentatives de récupération déjà réalisées.
- Stockage : `/app/runtime/vivy-stream/history/<sha256>.json`, une écriture atomique par piste. La limite de 120 du direct ne tronque plus l'archive. Les anciens liens de partage sont recherchés dans l'archive.
- `/api/vivy/stream/songs.json?summary=1` sert le catalogue compact à tous les visiteurs ; `/songs.json` conserve les paroles. Les données de clés, callbacks bruts, URL signées et chemins privés ne sont pas publiées.
- Les fichiers FLAC, OGG, M4A et AAC bénéficient aussi du type MIME audio approprié sur la route studio.

## Titres Claude : terminé

148 titres génériques disposant de paroles ont été renommés par **Claude Sonnet 4.5**, avec regroupement de 136 textes distincts. Les titres déjà renseignés sont préservés ; 181 fichiers génériques sans paroles conservent leur nom faute de matière fiable.

17 requêtes, 80 275 tokens d'entrée et 3 065 de sortie, estimation API **0,2868 USD**, sur un budget de sécurité de 0,50 USD. Tarif officiel consulté : https://platform.claude.com/docs/en/about-claude/pricing (3 USD / million en entrée et 15 USD / million en sortie). Ce montant concerne uniquement cette API, pas l'utilisation de Codex.

Les nouveaux titres sont des surcharges atomiques dans `history-titles/`, sans réécriture des paroles ni suppression de l'ancien titre. Le journal `jukebox-claude-titles-status.json` est `complete`. Le script refuse une relance aveugle si ce journal existe, afin d'éviter une nouvelle facturation.

## V11 Pan : traitement progressif, pas encore terminé lors de cette livraison

Recette canonique `v11pan-v9electrolysis-blend-1.5-4-v1` : V9 électrolyse, V10 Boom, puis élargissement de la seule résonance M (largeur 1,5 ; décalage 4 ms), et non du mix entier. Le moteur existant `processV10BoomD40` est réutilisé. Les originaux ne sont jamais écrasés.

Chaque sortie est publiée uniquement après contrôle du hash source inchangé, de la durée décodée, des crêtes stéréo/mono et de la perte au repli mono. Les masters vérifiés sont référencés dans `history-masters/`. L'API les sélectionne automatiquement ; le lecteur affiche « V11 Pan » et un lien « Original ». Un compteur montre le nombre de versions prêtes, sans prétendre que tout est déjà converti.

Le premier essai de 199,915 s a demandé environ 35 s : crête -1,1 dBFS, repli mono -0,3 dB, durée conservée. Le traitement complet porte sur près de 41 heures de musique.

Un MP3 sans index de durée fiable (`vivy-music-suno-1a27f3e45fdb09f7.mp3`) annonçait 243,409 s mais ne décodait qu'environ 204,98 s. Le contrôle est corrigé pour compter les échantillons réellement décodés, au lieu de comparer une estimation ffprobe. Le premier passage a été arrêté avec ses 86 masters conservés, puis repris avec ce correctif ; son ancien journal est sauvegardé.

Traitement actif : conteneur `jukebox-v11pan-20260909-decoded`, image applicative `funesterie-nossen-repair:20260909-121341`, script du commit `b600cb33260e70c61441d40a975e78905c92928d` monté en lecture seule depuis `/home/deploy/a11-prod/jukebox-recovery-20260909/master-jukebox-v11pan.cjs`. SHA-256 du script effectif : `dd5b211bba033df92b36736e5c91d6816ad0b435eed643fb2ecc4ce068c38b36`.

Trois pistes au maximum en parallèle, plafond 8 CPU / 6 Gio et priorité basse sur le serveur existant. Aucun appel IA dans ce traitement. La reprise vérifie les hashes et réutilise les sorties déjà validées.

État exact à lire dans `/app/runtime/vivy-stream/jukebox-v11pan-status.json` : `completed + reused` donne les pistes validées du passage courant ; `errors` liste les pistes gardées en original. Le conteneur termine de lui-même à la fin de l'inventaire. Ne jamais retirer son verrou tant qu'il tourne. Pour une pause ultérieure, SIGTERM arrête la prise de nouveaux morceaux et termine ceux en cours ; attendre la sortie avant toute reprise. Le conteneur du premier passage `jukebox-v11pan-20260909` est arrêté et conservé pour diagnostic.

## Voix Djeff : sources retrouvées, pas de réenregistrement nécessaire à ce stade

- `voice-samples/djeff.mp3` : MP3 valide, 10,44 s ; `djeff-real.mp3` : 30,04 s.
- `voice-library/djeff-rap.wav` : WAV valide, 95,03 s ; la référence officielle effective reste `djeff-rap.wav`. Une autre référence vocale de 30 s est également intacte.
- Le clone ElevenLabs configuré répond HTTP 200, nom « Funesterie Djeff officiel », catégorie `cloned`, un échantillon, sans demande de vérification supplémentaire.
- Le catalogue Suno a une persona Djeff active, récupérée après le dernier échec connu. Il prime sur l'ancien identifiant d'environnement. Ni présence de fichier ni état du catalogue ne prouvent le timbre d'une nouvelle génération : aucun test chant/TTS payant n'a été déclenché.

## Livraison applicative vérifiée

- Commit web/API : `261536d30987368f819a95776df9ac0c4d7742ac`, poussé sur `master`.
- Release active : `/home/deploy/a11-prod/releases/20260909-121341` ; couleur green ; blue en secours avec le même code, sans les workers principaux.
- Image green/blue : `sha256:0a7ed01ac0dc5d03c1f1d4ff3951de29d6718eff91702fd1fd4fbe53409a89a6`. Les neuf fichiers du correctif ont été vérifiés par SHA-256.
- 143 tests réussis localement et dans l'image Linux pour cette livraison ; après le correctif de durée du traitement séparé : 144 tests locaux et 7/7 tests ciblés Linux. Le script de traitement effectif, distinct de l'image applicative, est contrôlé par son hash ci-dessus.
- Le canary puis l'API publique confirment 834 disponibles, zéro indisponible public, 148 titres Claude et des masters V11 effectifs. `/api/build` public annonce le commit applicatif attendu ; les deux conteneurs sont sains.
- La vérification HTTP en masse a reçu 591 réponses audio Range 206 avant le limiteur 429. Il n'a pas été désactivé. La reprise à cadence réduite a terminé avec **920/920 liens audio publics valides**, zéro échec : les 834 pistes du catalogue à cet instant et les originaux complémentaires des 86 masters. La page publique est également vérifiée. Un 429 lors d'un inventaire intensif n'est pas une preuve de fichier manquant.
- Le morceau au mauvais index de durée a ensuite passé les contrôles : source décodée 204,984 s et sortie 204,984014 s, crête -1,6 dBFS, amélioration du repli mono de 0,1 dB. Les 97 premiers originaux ont été re-hashés indépendamment : aucune modification.
- K44, Caddy, les clés et les services annexes ne sont pas modifiés par cette livraison. Les changements utilisateur `sites/habitat/*` restent hors des commits.

Retour arrière applicatif : remettre `current` sur `20260909-113103` et recréer uniquement `a11-backend-green` avec son compose et `--no-deps --no-build`. Les archives, titres et masters sur le volume runtime restent conservés. L'ancienne image et la release sont disponibles. La conversion V11 est un conteneur indépendant : une bascule web ne l'arrête pas.
