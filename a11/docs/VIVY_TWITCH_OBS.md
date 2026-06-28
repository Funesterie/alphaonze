# Vivy Twitch + OBS

Vivy Live passe par un flux direct Twitch -> Hetzner, avec le site web comme overlay OBS et panneau de controle.

## Architecture

- Twitch chat est lu par `scripts/vivy-twitch-chat-worker.cjs`.
- Le worker poste les messages sur `POST /api/vivy/stream/chat`.
- Le backend garde un etat persistant dans `A11_RUNTIME_ROOT/vivy-stream/state.json`.
- OBS affiche `GET /api/vivy/stream/overlay`.
- Le premier sujet lance un vote de 45 secondes, puis le round verrouille automatiquement la graine NOSSEN.
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
$env:VIVY_STREAM_SECRET="secret_partage_long"
$env:VIVY_STREAM_INGEST_URL="https://vivy.funesterie.me/api/vivy/stream/chat"
npm run worker:vivy:twitch
```

Option utile si le chat devient trop bruyant:

```powershell
$env:VIVY_STREAM_COMMANDS_ONLY="1"
```

Dans ce mode, seuls les messages de commande, votes et etoiles sont envoyes. C'est le mode conseille en production.

Le bot rappelle les commandes toutes les cinq minutes avec deux messages courts en rotation. L'annonce n'est envoyee que lorsque la connexion Twitch est active.

```powershell
$env:VIVY_STREAM_ANNOUNCE_INTERVAL_MS="300000"
$env:VIVY_STREAM_ANNOUNCE_DISABLED="0"
```

Mettre `VIVY_STREAM_ANNOUNCE_DISABLED=1` coupe completement les annonces.

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
