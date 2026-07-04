# Vivy Twitch + OBS

Vivy Live passe par un flux direct Twitch -> Hetzner, avec le site web comme overlay OBS et panneau de contrôle.

## Architecture

- Twitch chat est lu par `scripts/vivy-twitch-chat-worker.cjs`.
- Le worker poste les messages sur `POST /api/vivy/stream/chat`.
- Le backend garde un état persistant dans `A11_RUNTIME_ROOT/vivy-stream/state.json`.
- OBS affiche `GET /api/vivy/stream/overlay`.
- Le premier sujet lance un vote de 45 secondes, puis le round verrouille automatiquement la graine NOSSEN.
- Si `VIVY_STREAM_AUTOGENERATE_ENABLED=1`, le verrouillage lance le routage musical, l’écriture des paroles et la génération Suno sans navigateur ni session frontend.
- Avant EX44/Suno, `VivyIntentRouter` décide le type de production : chanson vocale, musique instrumentale, scène sound design, hybride cinématographique ou chanson-fable.
- Si Social Autoprompt est configuré, Vivy enrichit l’écriture avec une fiche courte issue des comptes connectés en admin. Cette fiche reste privée et non chantable : elle sert de direction créative, pas de paroles.
- En parallèle de la musique, Vivy peut demander une jaquette 16:9 au backend image et l’attacher au morceau.
- La production publie son avancement via `POST /api/vivy/stream/control`.
- Quand le pack audio + visuel est prêt, l'overlay présente le titre pendant 4 secondes, lance la lecture, alterne entre l'image Vivy et la jaquette ou le clip du morceau, ouvre les étoiles pendant 30 secondes, puis repart sur un nouveau round.
- Le chat Twitch reçoit seulement un lien court vers le morceau ; le récap périodique pointe vers la playlist web au lieu de reposter tous les anciens titres.
- En production Hetzner, le service Compose `vivy-twitch-worker` lance le worker apres le basculement blue/green.

Ce choix évite de dépendre d’un onglet ouvert. Le frontend pourra ensuite lire `/api/vivy/stream/nossen-seed` pour lancer le bouton NOSSEN avec la matière votée.

## Commandes Chat

- `!vivy fais un générique anime sombre sur Bleach`
- `!nossen SAO opening, Kirito et Asuna, guitares nerveuses`
- `!nossen [mureka] chanson électro française sur une ville qui danse`
- `!chanson Jessica Jones, rock noir, enquête et trauma`
- `!vote S1`
- `!etoiles 5 S1`
- `⭐⭐⭐⭐⭐`

Les suggestions deviennent `S1`, `S2`, etc. Les votes changent le classement. Les étoiles nourrissent le vocabulaire préféré du chat.

Le préfixe optionnel `[mureka]` force Mureka V9 pour un essai A/B et est retiré avant l'écriture des paroles. Sans préfixe, Suno reste prioritaire et Mureka est disponible comme second fournisseur configuré. Mureka exige un solde API actif; une clé valide sans quota renvoie HTTP 429 avant toute génération.

Sur le site, le bouton NOSSEN du chat public a aussi un toggle `Suno / Mureka`. `Suno` garde les extensions automatiques quand le morceau est trop court ; `Mureka` lance directement Mureka V9 et saute la boucle d’extension Suno.

## Template histoire

La forme conseillée pour les chansons longues est une mini-histoire :

```text
!nossen [TITRE], chanson avec une vraie histoire du début à la fin. Personnage principal : [qui]. Situation de départ : [où / quand]. Problème : [ce qui bloque]. Évolution : [ce qu’il comprend ou traverse]. Moment fort : [scène dramatique]. Fin : [image finale mémorable]. Structure claire : couplet 1 exposition, couplet 2 conflit, pré-refrain tension, refrain conclusion émotionnelle, pont retournement, refrain final plus épique. Style : [style musical], voix : [solo/duo], refrain très mémorable.
```

Pour un duo, donner un rôle à chaque voix :

```text
!nossen Duo homme femme, histoire complète racontée en chanson. La voix masculine représente [rôle A]. La voix féminine représente [rôle B]. Couplet 1 voix masculine : [décor/problème]. Couplet 2 voix féminine : [réponse/évolution]. Pré-refrain en alternance question-réponse. Refrain chanté ensemble : [phrase centrale]. Pont dramatique : [bascule]. Refrain final épique : [résolution].
```

Vivy traite maintenant chaque demande comme une progression : décor, problème, tension, refrain, bascule, image finale. Une demande courte fonctionne toujours, mais plus le scénario donne de personnages, d’enjeu et de scène finale, plus le morceau garde une ligne claire.

## Longueur libre

Vivy décide aussi l’ampleur des paroles avant Suno. Par défaut elle vise une chanson compacte et publiable autour de 3 à 4 minutes. Un opening, générique, jingle ou format court reste court même si l’énergie est épique. Une vraie version longue n’est demandée que si le message contient clairement `no limite`, `version longue`, `saga`, `fresque` ou une durée explicite.

Exemples utiles :

```text
!nossen format court, opening anime nerveux sur une course dans les nuages
!nossen no limite, histoire complète en chanson, un pilote tombe, doute, se relève, puis traverse la tempête finale
!nossen 6 minutes, fresque électro-rock sur une ville qui apprend à rêver
```

Le log backend affiche `[VivyLyricScope]` avec la forme choisie, la cible de durée, le minimum acceptable et le budget de paroles. Si les paroles répètent mécaniquement les mêmes lignes, Vivy nettoie les doublons non utiles avant Suno. Un override technique reste possible avec `VIVY_STREAM_FIXED_TARGET_DURATION_SECONDS`, mais sans cet override Vivy choisit.

## Social Autoprompt

La page privée `/admin/social-connect` permet de connecter YouTube en lecture seule, puis de créer des fiches `social_prompt_context` pour Vivy. La V1 ne publie rien automatiquement.

Commandes utiles :

```powershell
npm run worker:social:ingest
npm run worker:social:ingest:loop
```

Variables principales :

```powershell
$env:SOCIAL_TOKEN_ENC_KEY="cle_longue_stable"
$env:SOCIAL_YOUTUBE_CLIENT_ID="..."
$env:SOCIAL_YOUTUBE_CLIENT_SECRET="..."
$env:SOCIAL_YOUTUBE_REDIRECT_URI="https://funesterie.me/api/admin/social-connect/youtube/callback"
$env:VIVY_STREAM_SOCIAL_CONTEXT_DISABLED="0"
```

Le bloc injecté dans Vivy est marqué `Contexte social créatif Funesterie - privé, non chantable`; il ne doit jamais se retrouver dans les paroles.

## Troisième intention

Vivy peut aussi cacher une morale sous l’histoire. La lecture conseillée devient :

```text
sujet visible + sous-thème humain + morale cachée + style musical
```

La morale ne doit pas être expliquée comme une leçon. Elle doit passer par les choix du personnage, les conséquences, la bascule du pont et l’image finale.

Exemple:

```text
!nossen Une grenouille qui voulait fumer, chanson-fable cartoon. Sujet visible : une petite grenouille du marais veut avoir l’air cool. Sous-thème : vouloir être remarquée par les autres. Morale cachée : pas besoin d’imiter une mauvaise habitude pour avoir du style. Couplet 1 : marais et grenouille curieuse. Couplet 2 : elle imite les humains et tousse en faisant des bulles. Pré-refrain : panique drôle. Refrain : elle brille mieux sans fumée. Pont : le brouillard naturel du marais lui révèle sa propre voix. Refrain final : elle devient cool par son énergie. Électro-funk cartoon, basse rebondissante, voix expressive, refrain accrocheur.
```

Validation attendue avant Suno : début clair, problème clair, bascule claire, fin mémorable, comportement risqué non glorifié, message caché perceptible sans être scolaire.

## Humour et sarcasme

Pour les demandes drôles, Vivy cherche maintenant un mécanisme de sens avant d’écrire. Le rire doit venir d’un malentendu humain :

```text
mot innocent -> double lecture cachée -> conséquence concrète
```

Plus le sous-texte est tabou, plus il doit rester caché dans l’objet, la métaphore, la rime ou l’ellipse. Vivy ne doit pas annoncer que c’est drôle : elle doit faire tomber la chute par quiproquo, sarcasme ou inversion logique.

Ces règles sont privées et non chantables. Si le LLM récite `surface`, `sous-texte`, `double lecture`, `règles privées`, `prompt` ou les consignes elles-mêmes, le backend nettoie la sortie et peut demander une réécriture avant Suno. Les morceaux paillards/humour reçoivent aussi plus de budget de paroles pour éviter les mini-brouillons qui tournent en rond.

Vivy distingue maintenant plusieurs mécanismes :

```text
métaphore : un domaine sert d’image à un autre
association saugrenue : forme, texture, odeur, geste, expression ou référence culturelle relient deux univers
jeu phonétique : la seconde lecture apparaît réellement à l’oreille
mot-pivot à deux intentions : le début de la phrase active un sens, la fin force à réentendre le même mot autrement
```

Une demande de jeux phonétiques ou de croisements d’idées déclenche une seconde passe LLM avant Suno. Vivy conserve l’histoire, puis remplace les lignes plates par plusieurs pivots sonores et familles d’associations. Elle ne doit pas écrire la solution entre parenthèses ni juxtaposer les deux orthographes.

Vivy connaît aussi la `césure-piège`, fréquente dans la chanson comique française : la phrase conduit l’auditeur vers un mot compromettant, s’interrompt, puis se termine avec un complément innocent et parfaitement grammatical. Le mot tabou n’est jamais chanté. La pause, le sérieux de l’interprétation et la conséquence dans la scène fabriquent la blague. Deux ou trois césures fortes sont préférables à des points de suspension sur chaque ligne.

Exemple plus utile pour Vivy :

```text
!chanson Le boulanger trop généreux, guinguette funk paillarde mais jamais crue. Un village entier trouve chaque matin une excuse différente pour repasser devant la boutique : panier oublié, monnaie trop lourde, confiture jalouse, facteur qui livre la pâte au mauvais endroit. Les blagues doivent venir des quiproquos, des rimes et des conséquences absurdes, pas d’explications. Refrain innocent qu’on peut chanter à table, mais avec une deuxième lecture claire pour les adultes.
```

Exemple phonétique :

```text
!chanson La voiture et le veau lent, funk absurde à jeux de mots. Une voiture file sur la voie rapide, mais au volant tout ralentit parce que le conducteur entend “veau lent”. Chaque couplet ajoute un mot qui change de sens à l’oreille : frein, phare, marche arrière, route, virage. Les blagues doivent s’entendre sans parenthèses et provoquer des scènes concrètes.
```

Exemple technique :

```text
!chanson La carte graphique qui avale les bits, électro-funk adulte et drôle. Une machine a faim de données, la RAM rame, le ventirad met un vent, les cœurs cadencent, les gigas gigotent. Allusions légères, pivots sonores, rimes internes, jamais d’explication technique plate.
```

## Intent Router

Vivy ne route plus seulement par mots-clés. Elle lit d’abord l’intention :

```text
veut-on une chanson, une musique instrumentale, une scène sonore, un hybride cinéma, ou une fable chantée ?
```

Le routeur produit un JSON strict avec `intent`, `shouldGenerateLyrics`, `shouldUseVocals`, `sfxPriority`, `vocalPolicy`, `reason` et `generationBrief`. Les règles fortes restent appliquées après le LLM : `instrumental`, `sans paroles`, `sans chant`, `no vocals` ou `no lyrics` coupent l’écriture de paroles ; `bruitages`, `SFX`, `foley`, `sound design`, `scène sonore` ou `ambiance sonore` priorisent les SFX. Les `murmures` ne deviennent pas automatiquement du chant : dans un contexte instrumental ou sound design, ils restent une texture distante et indistincte.

## Graphe Neo4j + MCP

Vivy a un manifeste borné pour savoir quels fichiers Funesterie peuvent nourrir le graphe Neo4j. Les secrets, `.env`, tokens, clés, médias runtime et sorties audio/vidéo sont exclus. Le corpus vise surtout :

- docs Vivy/Twitch/OBS, workflow, MCP, Neo4j et résonance sémantique ;
- routes `vivy-studio` et `vivy-stream`;
- worker Twitch, runner NOSSEN, songcraft et prosodie;
- pont MCP, client MCP, routeur Neo4j et tests Vivy/MCP.

Commandes backend:

```powershell
npm --prefix "D:\projets\funesterie\a11\backend\apps\server" run sync:vivy-graph-neo4j:dry-run
npm --prefix "D:\projets\funesterie\a11\backend\apps\server" run sync:vivy-graph-neo4j -- --target aura
```

Outils MCP locaux:

```text
a11_vivy_graph_manifest
a11_vivy_graph_search
a11_vivy_graph_sync
```

`a11_vivy_graph_sync` écrit seulement des nœuds `VivyGraph*` et exige `confirm=SYNC_VIVY_GRAPH` hors dry-run. Vivy ne doit jamais demander le mot de passe Neo4j dans le chat public : le backend lit les identifiants déjà configurés et passe par le routeur mémoire Aura/local.

## OBS

Ajouter une Browser Source:

```text
https://vivy.funesterie.me/api/vivy/stream/overlay
```

Dimensions conseillees:

```text
1920 x 1080
```

Fond transparent activé. L’overlay se met à jour par Server-Sent Events.
Le fond `vivy-presence-musicale.png` est embarque dans l'image backend: OBS ne depend d'aucun fichier local.
Pendant la lecture, si une jaquette a été générée, l’overlay bascule en diaporama entre Vivy et l’image du morceau. Pendant les votes, l’overlay affiche seulement un titre court et le compteur de votes ; le prompt complet reste dans le chat Twitch.

## Clips et montage

Vivy peut produire une vidéo complète sans dépendre d’une vidéo unique coûteuse. La stratégie recommandée est la débrouille contrôlée :

```text
jaquette forte -> quelques boucles -> montage FFmpeg -> clip complet
```

Par défaut, Vivy cherche le meilleur rapport rendu/coût :

- trois à cinq boucles vidéo pour une chanson normale ;
- reprise de la boucle refrain quand le refrain revient ;
- recadrage de la jaquette pour éviter les faux textes et les fiches UI ;
- montage FFmpeg plein cadre sur toute la durée ;
- coupes alignées sur intro, couplets, refrain, pont et final ;
- points d’entrée différents quand une même boucle revient ;
- ralentis sobres sur pont, outro ou moment dramatique ;
- accélérations légères sur refrain, montée ou drop ;
- fondus courts ou cuts nets selon l’énergie ;
- huit scènes seulement en plein régime ou demande explicite ;
- images fixes animées si le provider vidéo coûte trop cher ou sort un résultat instable.

Réglages utiles pour le montage synchronisé au cas par cas :

```powershell
$env:VIVY_STREAM_FULL_CLIP_PRO_EDIT="auto"
$env:VIVY_STREAM_FULL_CLIP_BPM="150"
$env:VIVY_STREAM_FULL_CLIP_MIN_EDIT_SEGMENT_SECONDS="2.5"
$env:VIVY_STREAM_FULL_CLIP_MAX_EDIT_SEGMENT_SECONDS="8"
$env:VIVY_STREAM_FULL_CLIP_TRANSITION_SECONDS="0.28"
```

Le montage pro ne génère pas plus de vidéos par magie : il coupe, réarrange, allonge, ralentit ou accélère les boucles existantes pour mieux coller au son. En `auto`, Vivy ne l’utilise que si la vidéo générée le justifie; passer à `1` force le montage, passer à `0` garde un assemblage direct.

Le découpage 3x3 est une réparation de fournisseur, pas un style. Il ne se déclenche plus avec un simple booléen ancien. Il faut demander explicitement le mode réparation :

```powershell
$env:VIVY_STREAM_FULL_CLIP_DEMOSAIC_GRID="repair"
```

`1`, `true` ou `on` sont ignorés pour éviter qu’un vieux réglage transforme tous les clips en mosaïque. Si la vidéo est déjà plein cadre, Vivy la garde plein cadre.

Playlist publique:

```text
https://vivy.funesterie.me/api/vivy/stream/songs
```

Version JSON:

```text
https://vivy.funesterie.me/api/vivy/stream/songs.json
```

## Worker Twitch

Variables requises:

```powershell
$env:TWITCH_CHANNEL="ta_chaine"
$env:TWITCH_BOT_USERNAME="nom_du_bot"
$env:TWITCH_OAUTH_TOKEN="oauth:xxxxxxxx"
$env:TWITCH_CLIENT_ID="client_id_twitch"
$env:VIVY_STREAM_SECRET="secret_partage_long"
$env:VIVY_STREAM_INGEST_URL="https://vivy.funesterie.me/api/vivy/stream/chat"
npm run worker:vivy:twitch
```

Par défaut, le worker vérifie l'API officielle Twitch Helix avant d'ouvrir IRC, puis continue de vérifier pendant la connexion. Si la chaîne n'est pas live, il reste en veille et ne poll pas l'état Vivy, n'envoie aucune annonce, et ne lit aucun message chat. Si OBS coupe le stream après que le bot a rejoint IRC, le prochain poll Helix ferme IRC, stoppe annonces/recaps/notices, puis réinitialise la session Vivy.

```powershell
$env:VIVY_TWITCH_LIVE_POLL_INTERVAL_MS="60000"
$env:VIVY_TWITCH_RESET_ON_OFFLINE="1"
$env:VIVY_STREAM_RESET_URL="https://vivy.funesterie.me/api/vivy/stream/reset"
```

`TWITCH_CLIENT_ID` est requis pour ce garde live; le token Helix utilise `TWITCH_ACCESS_TOKEN` si fourni, sinon `TWITCH_OAUTH_TOKEN` sans le préfixe `oauth:`. Le délai réel après l'arrêt OBS dépend du temps de propagation Twitch plus `VIVY_TWITCH_LIVE_POLL_INTERVAL_MS`. Mettre `VIVY_TWITCH_LIVE_GATE_DISABLED=1` force l'ancien comportement, utile seulement pour debug. Le reset offline vide le round, les messages récents, les votes/étoiles de session, les mots appris du chat, la file jukebox et la mémoire épisodique Twitch. L'historique des morceaux reste conservé pour les liens/archives, mais il ne nourrit plus le prochain craft.

Option utile si le chat devient trop bruyant:

```powershell
$env:VIVY_STREAM_COMMANDS_ONLY="1"
```

Dans ce mode, seuls les messages de commande, votes et étoiles sont envoyés. C'est le mode conseillé en production.

Le vote d’une proposition dure 90 secondes par défaut. La durée peut être ajustée sans redéployer :

```powershell
$env:VIVY_STREAM_VOTE_MS="90000"
```

Quand aucune demande n’est en cours, Vivy peut lancer automatiquement un fond musical depuis les chansons Twitch déjà générées. Une nouvelle commande `!nossen`, `!vivy` ou `!chanson` interrompt ce fond et démarre le vote.

```powershell
$env:VIVY_STREAM_IDLE_JUKEBOX_DELAY_MS="12000"
$env:VIVY_STREAM_IDLE_JUKEBOX_DISABLED="0"
```

Mettre `VIVY_STREAM_IDLE_JUKEBOX_DISABLED=1` coupe le fond musical d'attente.

Le bot rappelle les commandes toutes les douze minutes avec deux messages courts en rotation. L’annonce n’est envoyée que lorsque la connexion Twitch est active. Les messages automatiques passent par une file espacée pour éviter les paquets de spam.

```powershell
$env:VIVY_STREAM_ANNOUNCE_INTERVAL_MS="720000"
$env:VIVY_STREAM_ANNOUNCE_DISABLED="0"
$env:VIVY_STREAM_BOT_MESSAGE_GAP_MS="15000"
```

Mettre `VIVY_STREAM_ANNOUNCE_DISABLED=1` coupe complètement les annonces.

Quand une chanson est prête, le worker Twitch peut partager une seule ligne avec le titre, le lien public du MP3 et, si elle existe, la jaquette. Il observe l’état live et ne renvoie pas deux fois la même piste.

```powershell
$env:VIVY_STREAM_STATE_URL="https://vivy.funesterie.me/api/vivy/stream/state"
$env:VIVY_PUBLIC_BASE_URL="https://vivy.funesterie.me"
$env:VIVY_STREAM_TRACK_NOTICE_POLL_INTERVAL_MS="10000"
$env:VIVY_STREAM_TRACK_NOTICE_DISABLED="0"
```

Mettre `VIVY_STREAM_TRACK_NOTICE_DISABLED=1` coupe uniquement le partage automatique de lien de chanson.

La jaquette Twitch peut être activée ou coupée sans changer le code :

```powershell
$env:VIVY_STREAM_COVER_ENABLED="1"
$env:VIVY_STREAM_COVER_URL="http://127.0.0.1:3000/api/tools/generate_sd"
$env:VIVY_STREAM_COVER_TIMEOUT_MS="120000"
```

Si le backend image renvoie un job asynchrone, Vivy suit automatiquement `asyncJob.pollUrl` en stratégie `bat-sleep/rome-poll` ; la génération musicale n’attend pas la jaquette et l’overlay se met à jour quand l’image arrive.

Vivy peut ensuite animer cette jaquette. Quand le clip long est coupé, elle produit un mini-clip muet en parallèle, puis remplace automatiquement la petite jaquette dans le panneau de lecture. Quand le clip long est actif, ce mini-clip court est sauté pour ne pas dépenser un appel vidéo inutile.

```powershell
$env:VIVY_STREAM_CLIP_ENABLED="1"
$env:VIVY_STREAM_CLIP_PROVIDER="auto"
$env:VIVY_STREAM_CLIP_DURATION_SECONDS="3"
$env:VIVY_STREAM_CLIP_TIMEOUT_MS="600000"
```

Le clip utilise un seul plan de 3 secondes, boucle sans son et conserve l’image comme poster et solution de secours. Mettre `VIVY_STREAM_CLIP_ENABLED=0` revient instantanément aux jaquettes fixes.

Avec `VIVY_STREAM_CLIP_PROVIDER=auto`, Vivy utilise d’abord Comfy Cloud direct quand `A11_COMFY_CLOUD_API_KEY` est configurée sur le serveur. Sinon elle utilise une passerelle vidéo (`A11_VIDEO_LOCAL_RUNNER_URL`, `A11_VIDEO_PROXY_URL` ou `VIDEO_PROXY_URL`) puis garde Replicate/xAI en secours pour éviter de bloquer le live.

Branchement Comfy Cloud direct sur Hetzner/EX44:

```powershell
$env:A11_VIDEO_COMFY_CLOUD_ENABLED="1"
$env:A11_COMFY_CLOUD_API_KEY="clé_comfy_cloud"
$env:A11_COMFY_CLOUD_BASE_URL="https://cloud.comfy.org"
$env:A11_COMFY_CLOUD_TIMEOUT_MS="2700000"
$env:A11_VIDEO_PROXY_TIMEOUT_MS="2700000"
$env:A11_VIDEO_ASYNC_JOB_TTL_MS="2700000"
$env:A11_COMFY_CLOUD_POLL_INTERVAL_MS="5000"
$env:A11_COMFY_CLOUD_WAN_MODEL="wan2.5-i2v-preview"
$env:A11_COMFY_CLOUD_WAN_RESOLUTION="480P"
$env:VIVY_STREAM_CLIP_PROVIDER="auto"
```

Le provider `comfy_cloud` exécute le workflow API JSON embarqué dans `backend/apps/server/src/video/workflows/comfy-wan-image-to-video-api.json` : upload de la jaquette, `POST /api/prompt`, polling `/api/job/{prompt_id}/status`, récupération `/api/jobs/{prompt_id}` puis téléchargement via `/api/view`. Garder la clé Comfy uniquement dans les secrets serveur, jamais dans le dépôt.

Vivy peut aussi construire un clip long pour toute la chanson. Dès que la jaquette existe, elle lance les boucles vidéo de storyboard pendant que Suno ou Mureka termine l’audio. Une fois l’audio prêt, elle attend le pack vidéo, cale les scènes sur la durée réelle du morceau avec FFmpeg, upload le montage, puis seulement publie le morceau à l’overlay.

```powershell
$env:VIVY_STREAM_FULL_CLIP_ENABLED="1"
$env:VIVY_STREAM_FULL_CLIP_MODE="economy"
$env:VIVY_STREAM_FULL_CLIP_SCENES="8"
$env:VIVY_STREAM_FULL_CLIP_INSTRUMENTAL_SCENES="8"
$env:VIVY_STREAM_FULL_CLIP_UNIQUE_LOOPS="5"
$env:VIVY_STREAM_FULL_CLIP_REUSE_CHORUS="1"
$env:VIVY_STREAM_FULL_CLIP_GENERATE_SCENE_LOOPS="1"
$env:VIVY_STREAM_FULL_CLIP_LOOP_SECONDS="8"
$env:VIVY_STREAM_FULL_CLIP_WIDTH="1280"
$env:VIVY_STREAM_FULL_CLIP_HEIGHT="720"
$env:VIVY_STREAM_FULL_CLIP_FPS="24"
$env:VIVY_STREAM_FULL_CLIP_CROP_SOURCE_IMAGE="1"
$env:VIVY_STREAM_FULL_CLIP_SOURCE_CROP_WIDTH_RATIO="0.58"
$env:VIVY_STREAM_FULL_CLIP_SOURCE_CROP_X_BIAS="0.62"
$env:VIVY_STREAM_FULL_CLIP_SOURCE_CROP_Y_BIAS="0.5"
```

`VIVY_STREAM_FULL_CLIP_MODE=economy` est le mode normal : Vivy fabrique un clip complet avec peu de boucles, du montage, des reprises de refrain et des solutions de secours propres. C'est le mode à garder pour le live quotidien, parce qu'il évite de brûler du crédit vidéo sur des plans presque fixes.

Le mode `dreamclip` est volontairement plus ambitieux et plus cher. Il sert quand on veut tester un vrai clip généré de A à Z, scène par scène, sur toute la chanson utile. Il ne doit pas être activé par accident.

```powershell
$env:VIVY_STREAM_FULL_CLIP_MODE="dreamclip"
$env:VIVY_STREAM_DREAMCLIP_SCENES="8"
$env:VIVY_STREAM_DREAMCLIP_MAX_DURATION_SECONDS="300"
$env:VIVY_STREAM_DREAMCLIP_MIN_GENERATED_COVERAGE="0.72"
$env:VIVY_STREAM_DREAMCLIP_ALLOW_STATIC_FALLBACK="0"
```

En `dreamclip`, Vivy génère chaque scène prévue, ne réutilise pas automatiquement les boucles de refrain, limite le rendu à cinq minutes maximum et refuse les faux clips faits d'images fixes qui clignotent. Si trop de scènes reviennent avec du texte parasite, une mosaïque involontaire ou un plan quasi statique, le clip échoue proprement au lieu de consommer encore plus pour publier un résultat bancal.

Si `VIVY_STREAM_FULL_CLIP_GENERATE_SCENE_LOOPS=1`, Vivy construit une timeline complète de 8 scènes maximum, mais elle ne génère par défaut que 5 boucles vidéo uniques. Les refrains et pré-refrains réutilisent la même boucle visuelle pour créer une signature reconnaissable, tandis que l’intro, les couplets et le pont gardent leurs propres plans. Le montage final dure toujours toute la chanson.

Si une scène rate mais qu’au moins une boucle existe, FFmpeg réutilise une boucle disponible pour garder une vidéo à la durée du morceau. Si tout le pack vidéo échoue, Vivy publie quand même l’audio avec la jaquette fixe.

`VIVY_STREAM_FULL_CLIP_CROP_SOURCE_IMAGE=1` crée une source vidéo recadrée depuis la jaquette avant Wan/Comfy. Le recadrage est volontairement resserré vers le personnage ou le sujet central pour éviter que le modèle vidéo recopie les fiches, logos, paragraphes ou faux textes de la jaquette. La jaquette complète peut rester une référence d’identité, mais elle ne doit pas devenir l’image animée directe.

Le découpage 3x3 est un mode de secours uniquement. Il ne faut pas l’activer en production normale : si le générateur renvoie déjà un vrai plan plein écran, ce mode recadre un neuvième de l’image et casse le clip. L’ancien booléen `1` est volontairement ignoré. Utiliser uniquement `repair` pour retraiter une vraie planche vidéo 3x3 identifiée.

```powershell
$env:VIVY_STREAM_FULL_CLIP_DEMOSAIC_GRID="repair"
$env:VIVY_STREAM_FULL_CLIP_DEMOSAIC_COLUMNS="3"
$env:VIVY_STREAM_FULL_CLIP_DEMOSAIC_ROWS="3"
$env:VIVY_STREAM_FULL_CLIP_DEMOSAIC_ACTIVE_HEIGHT_RATIO="0.9"
$env:VIVY_STREAM_FULL_CLIP_DEMOSAIC_SEGMENT_SECONDS="1.25"
$env:VIVY_STREAM_FULL_CLIP_DEMOSAIC_ORDER="4,1,5,7,2,8"
```

`DEMOSAIC_ORDER` utilise les index de cases de gauche à droite et de haut en bas : `0,1,2 / 3,4,5 / 6,7,8`. L’ordre conseillé `4,1,5,7,2,8` part du centre puis alterne les plans propres.

Toutes les 25 à 30 minutes, le bot peut poster un lien unique vers la playlist des morceaux passés dans le live.

```powershell
$env:VIVY_STREAM_RECAP_INTERVAL_MS="1680000"
$env:VIVY_STREAM_RECAP_DISABLED="0"
```

Mettre `VIVY_STREAM_RECAP_DISABLED=1` coupe uniquement ce récap périodique.

La génération automatique Twitch est active en production :

```powershell
$env:VIVY_STREAM_AUTOGENERATE_ENABLED="1"
```

Un round verrouillé ne peut lancer qu’un craft à la fois. Pour relancer manuellement un round resté bloqué après une ancienne version :

```text
POST /api/vivy/stream/round/generate
```

Cette route exige le secret live Vivy.

## API utile

Etat public:

```text
GET https://vivy.funesterie.me/api/vivy/stream/state
```

Graine NOSSEN:

```text
GET https://vivy.funesterie.me/api/vivy/stream/nossen-seed
```

Nouveau round:

```powershell
Invoke-RestMethod https://vivy.funesterie.me/api/vivy/stream/round/start `
  -Method Post `
  -ContentType application/json `
  -Headers @{ "X-Vivy-Stream-Secret" = $env:VIVY_STREAM_SECRET } `
  -Body '{"title":"Vivy Live"}'
```

Verrouiller le gagnant:

```powershell
Invoke-RestMethod https://vivy.funesterie.me/api/vivy/stream/round/lock `
  -Method Post `
  -ContentType application/json `
  -Headers @{ "X-Vivy-Stream-Secret" = $env:VIVY_STREAM_SECRET } `
  -Body '{}'
```

Publier l’avancement de la production :

```powershell
Invoke-RestMethod https://vivy.funesterie.me/api/vivy/stream/control `
  -Method Post `
  -ContentType application/json `
  -Headers @{ "X-Vivy-Stream-Secret" = $env:VIVY_STREAM_SECRET } `
  -Body '{"action":"progress","stage":"lyrics","progress":65}'
```

Les etapes reconnues sont `analysis`, `lyrics`, `composition` et `mix`. Sans information exacte de Suno, l'overlay anime une estimation basee sur les temps habituels; une progression publiee par le pipeline reste prioritaire.

Publier le morceau termine:

```powershell
Invoke-RestMethod https://vivy.funesterie.me/api/vivy/stream/control `
  -Method Post `
  -ContentType application/json `
  -Headers @{ "X-Vivy-Stream-Secret" = $env:VIVY_STREAM_SECRET } `
  -Body '{"action":"ready","title":"Les lumieres de la ville","trackUrl":"https://vivy.funesterie.me/api/double-harmonic/out/morceau.mp3","durationSeconds":222}'
```

Actions supplementaires: `playing`, `rating`, `next` et `error`.

## Securite

En production, définir `VIVY_STREAM_SECRET`. Sans ce secret, les routes d’écriture refusent les messages. Ne pas exposer de génération Suno automatique tant qu’il n’y a pas de modération et de quota crédits.
