# Alexa Vivy Skill

Minimal Alexa Skill bridge for Vivy singing through A11/Kaen44 audio services.

## Shape

```txt
Alexa Skill
  -> Lambda handler in this package
  -> POST ${VIVY_SERVER_URL}${VIVY_MUSIC_ENDPOINT}
  -> returns an HTTPS MP3/AAC/HLS URL
  -> Alexa AudioPlayer streams it
```

SoundCloud remains useful for public publishing, RSS, embeds and discovery, but Alexa should receive a direct HTTPS audio stream that the Funesterie server controls. Do not scrape SoundCloud pages. Use authorized tracks only.

## Audio policy

- Keep a lossless master for archive and SoundCloud upload: WAV or FLAC.
- Generate an Alexa playback copy: MP3 or AAC, served over HTTPS on port 443.
- Use Cloudflare R2/A11 CDN or another stable HTTPS origin for `audioUrl`.
- Keep generated, private, or test tracks unlisted until rights and metadata are clean.

## Server contract

The skill calls the A11 backend route mounted at `/api/vivy/alexa/song`:

```http
POST /api/vivy/alexa/song
Authorization: Bearer <optional server token>
Content-Type: application/json
```

Request:

```json
{
  "source": "alexa-vivy-skill",
  "requestId": "amzn1.echo-api.request...",
  "locale": "fr-FR",
  "mood": "calme",
  "device": "alexa",
  "timestamp": "2026-05-10T00:00:00.000Z"
}
```

Response:

```json
{
  "title": "Vivy Demo",
  "artist": "Funesterie",
  "audioUrl": "https://media.funesterie.me/vivy/demo.mp3",
  "durationMs": 180000,
  "soundcloudUrl": "https://soundcloud.com/...",
  "source": "soundcloud|r2|a11-generated"
}
```

## Local checks

```powershell
npm install
npm run check
```

For the backend selector, configure either:

```env
VIVY_ALEXA_TRACK_URL=https://media.funesterie.me/vivy/demo.mp3
VIVY_ALEXA_TRACK_TITLE=Vivy Demo
VIVY_ALEXA_TRACK_ARTIST=Funesterie
VIVY_ALEXA_SOUNDCLOUD_URL=https://soundcloud.com/...
VIVY_ALEXA_TOKEN=
```

or copy this example manifest:

```txt
D:\projets\funesterie\a11\backend\runtime\music\vivy-songs.example.json
```

to:

```txt
<A11_RUNTIME_ROOT>\music\vivy-songs.json
```

## Alexa Developer Console

1. Create a Custom Skill.
2. Invocation name: `vivy`.
3. Locale: `fr-FR`.
4. Add the interaction model in `models/fr-FR.json`.
5. Endpoint: AWS Lambda using `src/index.cjs` exported `handler`.
6. Enable the `AudioPlayer` interface.
7. Set Lambda env vars from `.env.example`.

## Safety

- No secrets in the model, prompts, logs, SoundCloud description or MCP shared bus.
- No copyrighted track playback unless Funesterie has rights.
- Public persona can be called Vivy, but keep the voice, lore and music original.

<!-- funesterie-donations:start -->
## Support Funesterie / NOSSEN

Support is voluntary, but it keeps the public modules, registry, compute, and maintenance work alive.

- Wero: `+33 7 83 46 37 61`
- PayPal: https://paypal.me/funeste38
- Stripe/card checkout: https://funesterie.me/subscription
- Custom support/contact: https://funesterie.me/contact/
<!-- funesterie-donations:end -->
