# Vivy Twitch + OBS

Vivy Live passe par un flux direct Twitch -> Hetzner, avec le site web comme overlay OBS et panneau de controle.

## Architecture

- Twitch chat est lu par `scripts/vivy-twitch-chat-worker.cjs`.
- Le worker poste les messages sur `POST /api/vivy/stream/chat`.
- Le backend garde un etat persistant dans `A11_RUNTIME_ROOT/vivy-stream/state.json`.
- OBS affiche `GET /api/vivy/stream/overlay`.
- Le premier sujet lance un vote de 45 secondes, puis le round verrouille automatiquement la graine NOSSEN.
- Si `VIVY_STREAM_AUTOGENERATE_ENABLED=1`, le verrouillage lance le routage musical, l'ecriture des paroles et la generation Suno sans navigateur ni session frontend.
- La production publie son avancement via `POST /api/vivy/stream/control`.
- Quand l'audio est prêt, l'overlay présente le titre pendant 4 secondes, lance la lecture, ouvre les étoiles pendant 30 secondes, puis repart sur un nouveau round.
- En production Hetzner, le service Compose `vivy-twitch-worker` lance le worker apres le basculement blue/green.

Ce choix evite de dependre d'un onglet ouvert. Le frontend pourra ensuite lire `/api/vivy/stream/nossen-seed` pour lancer le bouton NOSSEN avec la matiere votee.

## Commandes Chat

- `!vivy fais un generique anime sombre sur Bleach`
- `!nossen SAO opening, Kirito et Asuna, guitares nerveuses`
- `!chanson Jessica Jones, rock noir, enquete et trauma`
- `!vote S1`
- `!etoiles 5 S1`
- `⭐⭐⭐⭐⭐`

Les suggestions deviennent `S1`, `S2`, etc. Les votes changent le classement. Les etoiles nourrissent le vocabulaire prefere du chat.

## Template histoire

La forme conseillee pour les chansons longues est une mini-histoire:

```text
!nossen [TITRE], chanson avec une vraie histoire du debut a la fin. Personnage principal: [qui]. Situation de depart: [ou / quand]. Probleme: [ce qui bloque]. Evolution: [ce qu'il comprend ou traverse]. Moment fort: [scene dramatique]. Fin: [image finale memorable]. Structure claire: couplet 1 exposition, couplet 2 conflit, pre-refrain tension, refrain conclusion emotionnelle, pont retournement, refrain final plus epique. Style: [style musical], voix: [solo/duo], refrain tres memorable.
```

Pour un duo, donner un role a chaque voix:

```text
!nossen Duo homme femme, histoire complete racontee en chanson. La voix masculine represente [role A]. La voix feminine represente [role B]. Couplet 1 voix masculine: [decor/probleme]. Couplet 2 voix feminine: [reponse/evolution]. Pre-refrain en alternance question-reponse. Refrain chante ensemble: [phrase centrale]. Pont dramatique: [bascule]. Refrain final epique: [resolution].
```

Vivy traite maintenant chaque demande comme une progression: decor, probleme, tension, refrain, bascule, image finale. Une demande courte fonctionne toujours, mais plus le scenario donne de personnages, d'enjeu et de scene finale, plus le morceau garde une ligne claire.

## OBS

Ajouter une Browser Source:

```text
https://vivy.funesterie.me/api/vivy/stream/overlay
```

Dimensions conseillees:

```text
1920 x 1080
```

Fond transparent active. L'overlay se met a jour par Server-Sent Events.
Le fond `vivy-presence-musicale.png` est embarque dans l'image backend: OBS ne depend d'aucun fichier local.

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

Dans ce mode, seuls les messages de commande, votes et etoiles sont envoyes. C'est le mode conseille en production.

Le vote d'une proposition dure 90 secondes par defaut. La duree peut etre ajustee sans redeployer:

```powershell
$env:VIVY_STREAM_VOTE_MS="90000"
```

Quand aucune demande n'est en cours, Vivy peut lancer automatiquement un fond musical depuis les chansons Twitch deja generees. Une nouvelle commande `!nossen`, `!vivy` ou `!chanson` interrompt ce fond et demarre le vote.

```powershell
$env:VIVY_STREAM_IDLE_JUKEBOX_DELAY_MS="12000"
$env:VIVY_STREAM_IDLE_JUKEBOX_DISABLED="0"
```

Mettre `VIVY_STREAM_IDLE_JUKEBOX_DISABLED=1` coupe le fond musical d'attente.

Le bot rappelle les commandes toutes les cinq minutes avec deux messages courts en rotation. L'annonce n'est envoyee que lorsque la connexion Twitch est active.

```powershell
$env:VIVY_STREAM_ANNOUNCE_INTERVAL_MS="300000"
$env:VIVY_STREAM_ANNOUNCE_DISABLED="0"
```

Mettre `VIVY_STREAM_ANNOUNCE_DISABLED=1` coupe completement les annonces.

Quand une chanson est prete, le worker Twitch peut partager une seule ligne avec le titre, le demandeur et le lien public du MP3. Il observe l'etat live et ne renvoie pas deux fois la meme piste.

```powershell
$env:VIVY_STREAM_STATE_URL="https://vivy.funesterie.me/api/vivy/stream/state"
$env:VIVY_PUBLIC_BASE_URL="https://vivy.funesterie.me"
$env:VIVY_STREAM_TRACK_NOTICE_POLL_INTERVAL_MS="10000"
$env:VIVY_STREAM_TRACK_NOTICE_DISABLED="0"
```

Mettre `VIVY_STREAM_TRACK_NOTICE_DISABLED=1` coupe uniquement le partage automatique de lien de chanson.

Toutes les 25 a 30 minutes, le bot peut poster le recap des morceaux passes dans le live, dans l'ordre, avec note moyenne et lien court de telechargement.

```powershell
$env:VIVY_STREAM_RECAP_INTERVAL_MS="1680000"
$env:VIVY_STREAM_RECAP_DISABLED="0"
```

Mettre `VIVY_STREAM_RECAP_DISABLED=1` coupe uniquement ce recap periodique.

La generation automatique Twitch est active en production:

```powershell
$env:VIVY_STREAM_AUTOGENERATE_ENABLED="1"
```

Un round verrouille ne peut lancer qu'un craft a la fois. Pour relancer manuellement un round reste bloque apres une ancienne version:

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

Publier l'avancement de la production:

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

En production, definir `VIVY_STREAM_SECRET`. Sans ce secret, les routes d'ecriture refusent les messages. Ne pas exposer de generation Suno automatique tant qu'il n'y a pas de moderation et de quota credits.
