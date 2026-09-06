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
  -F "reference=@D:\projets\funesterie\a11\backend\runtime\voice-library\a11-official-stern-french.wav" `
  -F "mode=adaptive" `
  -F "strength=0.45"
```

The built-in fallback engine is `ffmpeg-morph`: pitch/tempo, dynamics and loudness shaping after generation.

For stronger voice identity, run the local Funesterie XTTS/RVC bridge and let this module call it first:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File D:\projets\funesterie\a11\ops\voice\Start-XttsRvcUi.ps1 -InstallOnly
```

The installer uses Python 3.11 so `TTS` can run with modern `numpy` instead of the old Python 3.10 `numpy==1.22` path. If Python 3.11 is missing and `uv` is available, the script installs an isolated Python 3.11 runtime automatically.

Then place RVC models in:

```text
D:\agent-bus\voice\XTTS-RVC-UI\rvcs\a11-official-stern-french.pth
D:\agent-bus\voice\XTTS-RVC-UI\rvcs\kaen44-official-french-narrator.pth
D:\agent-bus\voice\XTTS-RVC-UI\rvcs\vivy.pth
```

Matching `.index` files can be placed next to the `.pth` files. The bridge also reads
`D:\agent-bus\voice\XTTS-RVC-UI\rvcs\funesterie-personas.json`, so the official A11/K44/Vivy
filenames can be changed without editing Python. XTTS can use WAV samples in `voices`; when a
matching RVC `.pth` is missing, the bridge returns XTTS reference output instead of falling back
to the base Piper voice. Add trained `.pth` models for the full RVC pass.

To fabricate the persona models instead of pretending they exist, first build approved datasets
from local voice references:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File D:\projets\funesterie\a11\ops\voice\Update-FunesterieVoiceCorpus.ps1
```

The corpus helper refreshes `D:\agent-bus\voice\personas\corpus-status.json` for A11, Kaen44,
and Vivy from the local approved voice library. Voices do not improve by themselves at runtime:
the reference clips, dataset manifests, RVC `.pth`/`.index` artifacts, and bridge tuning are the
parts that must be improved deliberately.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File D:\projets\funesterie\a11\ops\voice\New-RvcPersonaDataset.ps1 `
  -Persona a11 `
  -Source D:\projets\funesterie\a11\backend\runtime\voice-library\a11-official-stern-french.wav

powershell -NoProfile -ExecutionPolicy Bypass -File D:\projets\funesterie\a11\ops\voice\New-RvcPersonaDataset.ps1 `
  -Persona kaen44 `
  -Source D:\projets\funesterie\a11\backend\runtime\voice-library\kaen44-official-french-narrator.wav

powershell -NoProfile -ExecutionPolicy Bypass -File D:\projets\funesterie\a11\ops\voice\New-RvcPersonaDataset.ps1 `
  -Persona vivy `
  -Source D:\projets\funesterie\a11\backend\runtime\voice-library\vivy.wav,D:\projets\funesterie\a11\backend\runtime\voice-library\vivy-song-context.wav
```

Then check the state:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File D:\projets\funesterie\a11\ops\voice\Test-RvcPersonaAssets.ps1
```

The expected final artifacts remain the persona `.pth` and `.index` files in `rvcs`. The helper
`Invoke-RvcPersonaTraining.ps1` writes a training request and can run the official RVC WebUI trainer.
It does not mark a persona as RVC-ready until real model files exist.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File D:\projets\funesterie\a11\ops\voice\Invoke-RvcPersonaTraining.ps1 `
  -Persona vivy `
  -Epochs 5 `
  -BatchSize 4
```

Start the bridge service:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File D:\projets\funesterie\a11\ops\voice\Start-XttsRvcUi.ps1
```

The script starts the Funesterie bridge on `http://127.0.0.1:5000` / `http://host.docker.internal:5000` for Docker.

## A11 Integration

The main compose file declares an `a11-voice` service and configures the backend with:

```env
ENABLE_PIPER_HTTP=1
A11_VOICE_MODULE_URL=http://a11-voice:5002
TTS_URL=http://a11-voice:5002
A11_VOICE_CONVERSION_ENABLED=1
A11_VOICE_CONVERTER_PROVIDER=xtts-rvc,ffmpeg-morph
A11_VOICE_XTTS_RVC_URL=http://host.docker.internal:5000
A11_VOICE_XTTS_RVC_PROTOCOL=a11
```

Generated files are exposed to the web UI through the backend proxy `/api/tts/out/<file>.wav`, so browser clients do not receive the internal container URL.
