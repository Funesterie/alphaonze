# A11 Local Desktop

Wrapper Tauri Windows pour `A11 local`.

## Objectif

- demarrer la stack locale A11 sans ouvrir 15 terminaux
- ouvrir ensuite le vrai chat A11 dans une fenetre native
- garder le backend, le TTS, le LLM, qflush et le launcher separes

## Structure

- `src/`
  Shell desktop minimal de demarrage
- `src-tauri/`
  Runtime Rust + fenetre Tauri + commandes launcher
- `desktop.config.json`
  Config compilee pour les chemins repo et packaged
- `scripts/sync-local-package.ps1`
  Recopie `launchers/dist/a11-local` vers `resources/a11-local`
- `scripts/build-installer-lite.ps1`
  Prepare un bundle `installer-lite` sans modele GGUF embarque, puis lance NSIS
- `scripts/tauri.ps1`
  Ajoute `C:\Users\cella\.cargo\bin` au `PATH` de la session et lance Tauri

## Commandes

- `npm install`
- `npm run tauri:dev`
- `npm run tauri:build`
- `npm run tauri:installer-lite`

## Notes

- pas besoin de redemarrer Windows tant que Rust existe dans `C:\Users\cella\.cargo\bin`
- le mode `dev` utilise directement `..\launchers\a11-local.ps1`
- le mode `build` prepare d'abord une copie `resources/a11-local` pour le bundle Tauri
- le mode `installer-lite` retire le modele local du bundle, puis laisse le shell importer ou telecharger un GGUF externe au premier lancement
