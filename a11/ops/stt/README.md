# A11 local STT - faster-whisper

Ce dossier branche un worker local de transcription audio pour A11.

## Modele

- Par defaut : `Systran/faster-whisper-large-v3`
- Cache, modele, logs et temporaires : `E:\Funesterie\stt\faster-whisper`
- Endpoint local : `http://127.0.0.1:17911/v1/audio/transcriptions`

## Lancement local

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Start-LocalFasterWhisper.ps1
```

Premier telechargement du modele :

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Start-LocalFasterWhisper.ps1 -DownloadModel
```

## Activation cote backend A11

```powershell
$env:A11_STT_PROVIDER = "faster-whisper"
$env:A11_STT_FAST_WHISPER_ENABLED = "true"
$env:A11_STT_FAST_WHISPER_BASE_URL = "http://127.0.0.1:17911"
$env:A11_STT_FAST_WHISPER_MODEL = "Systran/faster-whisper-large-v3"
```

La prod garde `A11_STT_FAST_WHISPER_ENABLED=false` tant que le worker n'est pas expose via un pont prive fiable.
