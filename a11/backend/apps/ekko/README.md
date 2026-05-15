# Ekko 🎧

> Module d'écoute audio système pour Ivy.  
> Il capte les échos du système et les transforme en contexte.

---

## Architecture

```
Carte son / audio système
        ↓
Ekko Capture  (WASAPI / PulseAudio / PipeWire / BlackHole)
        ↓
VAD / découpage voix  (energy-based → WebRTC VAD → Silero)
        ↓
Transcription locale ou API  (faster-whisper / OpenAI / Groq)
        ↓
Filtrage privacy  (blacklist apps + keywords + scrub patterns)
        ↓
Extraction contexte  (tags, résumé, confidence)
        ↓
POST → Ivy  /api/ekko/ingest
```

---

## Démarrage rapide

```bash
# 1. Dépendances minimales
pip install flask numpy

# 2. Capture Windows
pip install PyAudioWPATCH

# 3. Capture Linux / macOS
pip install sounddevice

# 4. VAD robuste (optionnel mais recommandé)
pip install webrtcvad

# 5. Transcription locale (recommandé)
pip install faster-whisper

# 6. Lancement
python main.py
```

Le serveur démarre sur `http://127.0.0.1:5012`.

---

## API de contrôle

| Méthode | Route               | Description                        |
|---------|---------------------|------------------------------------|
| GET     | `/health`           | Santé du module                    |
| GET     | `/api/ekko/status`  | État courant (listening, paused…)  |
| POST    | `/api/ekko/start`   | Démarre la capture                 |
| POST    | `/api/ekko/stop`    | Arrête tout                        |
| POST    | `/api/ekko/pause`   | Pause (garde le thread actif)      |
| POST    | `/api/ekko/resume`  | Reprend après pause                |
| GET     | `/api/ekko/config`  | Lit la config courante             |
| PATCH   | `/api/ekko/config`  | Modifie les paramètres sûrs        |

---

## Format EkkoEvent (envoyé à Ivy)

```json
{
  "source": "system_audio",
  "module": "ekko",
  "timestamp": "1715780123456",
  "transcript": "",
  "confidence": 0.91,
  "duration_ms": 2400,
  "tags": ["voice", "meeting", "action"],
  "app_name": "OBS Studio",
  "summary": "Jeffrey demande à A11 de lancer le stream.",
  "speaker": null
}
```

Si `store_summary_only = true`, `transcript` est vide et seul `summary` est renseigné.

---

## Charte privacy

Ekko est conçu pour être **local, opt-in et transparent**.

| Règle | Valeur par défaut |
|---|---|
| Opt-in obligatoire | `require_opt_in: true` |
| Indicateur visible quand actif | `visual_indicator: true` |
| TTL audio brut | 60 secondes |
| Stockage résumé seulement | `store_summary_only: true` |
| Blacklist navigateurs | Chrome, Firefox, Edge, Brave… |
| Blacklist gestionnaires de mots de passe | 1Password, Bitwarden, KeePass… |
| Blacklist mots-clés sensibles | "mot de passe", "iban", "cvv"… |
| Scrub patterns | numéros de carte, IBAN détectés automatiquement |
| Kill switch | `POST /api/ekko/stop` — arrêt immédiat |

---

## Configuration

Édite `ekko.config.json` ou passe un chemin en argument :

```bash
python main.py --config /chemin/vers/ma-config.json
```

Paramètres clés :

```json
{
  "backend": "auto",              // auto | wasapi | pulse | pipewire | blackhole
  "transcription_backend": "local",  // local | openai | groq
  "whisper_model": "base",        // tiny | base | small | medium
  "language": "fr",
  "ivy_endpoint": "http://127.0.0.1:3000/api/ekko/ingest",
  "store_summary_only": true,
  "visual_indicator": true
}
```

---

## Structure des fichiers

```
ekko/
  main.py                 — serveur Flask + orchestration
  ekko.config.json        — config par défaut
  requirements.txt
  app/
    __init__.py
    capture.py            — backends audio (WASAPI / Pulse / PipeWire / BlackHole)
    vad.py                — détection de voix (energy / WebRTC)
    transcribe.py         — Whisper local / OpenAI / Groq
    extract.py            — filtrage privacy + extraction contexte
    sender.py             — envoi HTTP async vers Ivy
    config.py             — dataclass config
    schema.py             — EkkoEvent + EkkoStatus
```

---

## Roadmap MVP

- [x] Scaffold architecture
- [x] Capture WASAPI / PulseAudio / PipeWire / BlackHole
- [x] VAD energy-based + WebRTC
- [x] Transcription faster-whisper / OpenAI / Groq
- [x] Filtrage privacy (blacklist + scrub)
- [x] EkkoEvent → Ivy HTTP POST
- [x] API REST start/stop/pause/status
- [ ] Endpoint `/api/ekko/ingest` côté A11/Ivy
- [ ] Indicateur UI (rouge dans le frontend)
- [ ] Whitelist d'apps par process name (Windows: `psutil`)
- [ ] Intégration mémoire Ivy (Neo4j / memory-base)
- [ ] Silero VAD (meilleure qualité, torch requis)
- [ ] ScreenCaptureKit macOS (natif, sans driver tiers)
