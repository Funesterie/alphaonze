# a11llm

Couche LLM locale de l'ecosysteme A11.

Ce repo versionne la partie legere et durable:

- documentation et procedures
- scripts d'amorcage et de verification
- bridge backend local
- inventaire des assets attendus

Ce repo ne versionne pas les gros assets locaux:

- modeles `.gguf`
- binaires `llama-server.exe` et DLL
- `ngrok.exe`
- clone de travail `llama.cpp`

## Structure

- `llm/backend/bridge_server.py`
  Petit bridge Python local.
- `llm/README-SETUP.md`
  Notes de setup et de lancement.
- `llm/models/README.md`
  Inventaire des modeles attendus.
- `llm/server/README.md`
  Inventaire des binaires attendus.
- `scripts/check-local-assets.ps1`
  Verifie si les fichiers locaux critiques sont bien presents.
- `scripts/bootstrap-llama-cpp.ps1`
  Clone `llama.cpp` dans le bon dossier si besoin.
- `UPSTREAMS.md`
  Memo des dependances locales non versionnees ici.

## Philosophie

`a11llm` doit rester leger et versionnable.

Les gros fichiers restent sur la machine locale ou dans un stockage adapte.
Si tu veux versionner les modifs de `llama.cpp`, le bon chemin est plutot:

1. creer un fork dedie de `llama.cpp`
2. y pousser les changements natifs
3. garder ici seulement la couche A11 autour

## Verification rapide

```powershell
pwsh -File .\scripts\check-local-assets.ps1
```

## Demarrage

Le lancement global A11 reste gere depuis:

```text
D:\funesterie\a11\launchers
```
