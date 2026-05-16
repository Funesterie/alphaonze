# A11 Voice Module

Dockerized voice runtime for A11.

It runs Piper on a Debian base image, which avoids the Alpine/glibc ONNX Runtime crash seen in the main backend image. If Piper fails, it falls back to `espeak-ng`.

## Build

```powershell
docker build -t a11-voice-module:local D:\projets\funesterie\a11\backend\apps\voice-module
```

## Run

```powershell
docker run --rm -p 5002:5002 a11-voice-module:local
```

With Podman on WSL, the published Windows port can be flaky depending on loopback forwarding. The reliable path is to run this through `backend/apps/server/docker-compose.yml` and let the A11 backend call `http://a11-voice:5002` on the compose network.

## API

- `GET /health`
- `POST /api/voice/synthesize`
- `POST /api/voice/convert`
- `POST /api/tts`
- `GET /out/<file>.wav`

Example:

```powershell
curl.exe -sS http://127.0.0.1:5002/api/voice/synthesize `
  -H "Content-Type: application/json" `
  --data "{\"text\":\"Salut Jeffrey, voix A11.\",\"vocalMode\":\"adaptive\"}"
```

The module returns an `audio_url` such as `/out/a11-voice-....wav`.

Voice conversion / morphing accepts multipart audio. A11 sends the generated WAV plus the active reference WAV:

```powershell
curl.exe -sS http://127.0.0.1:5002/api/voice/convert `
  -F "generated=@D:\tmp\a11-generated.wav" `
  -F "reference=@D:\projets\funesterie\runtime\sfx\terminator.wav" `
  -F "mode=adaptive" `
  -F "strength=0.45"
```

The built-in engine is `ffmpeg-morph`: pitch/tempo, dynamics and loudness shaping after generation. RVC or XTTS-v2 can be connected behind the same endpoint later without changing the A11 frontend/backend contract.

## A11 Integration

The main compose file declares an `a11-voice` service and configures the backend with:

```env
ENABLE_PIPER_HTTP=1
A11_VOICE_MODULE_URL=http://a11-voice:5002
TTS_URL=http://a11-voice:5002
A11_VOICE_CONVERSION_ENABLED=1
A11_VOICE_CONVERTER_PROVIDER=ffmpeg-morph
```

Generated files are exposed to the web UI through the backend proxy `/api/tts/out/<file>.wav`, so browser clients do not receive the internal container URL.
