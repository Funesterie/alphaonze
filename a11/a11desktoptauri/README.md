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
  Ajoute `%USERPROFILE%\.cargo\bin` au `PATH` de la session et lance Tauri

## Commandes

- `npm install`
- `npm run tauri:dev`
- `npm run tauri:build`
- `npm run tauri:installer-lite`

## Versions surveillees

- Rust local valide avec `cargo 1.95.0` / `rustc 1.95.0`
- Tauri JS: `@tauri-apps/api@2.11.0`, CLI `@tauri-apps/cli@2.11.2`
- Tauri Rust: `tauri@2.11.2`
- Cargo lock patche: `rustls-webpki@0.103.13`, `rand@0.9.4`
- Alerte GitHub Dependabot #4 / RustSec `RUSTSEC-2024-0429`: `glib@0.18.x` reste tire par la pile Linux GTK3/WebKit de `tauri@2.11.2` (`gtk@0.18.2`, `webkit2gtk@2.0.2`). `glib>=0.20.0` est le correctif annonce, mais il est incompatible avec `gtk@0.18`; le corriger demande une montee upstream Tauri/GTK, pas seulement un bump de lock.
- Statut risque 2026-06-02: wrapper legacy Windows, non requis pour lancer A11 et non deployee en production web/backend. Dependabot Cargo est active pour detecter automatiquement une future montee Tauri/GTK corrigee.

## Notes

- pas besoin de redemarrer Windows tant que Rust existe dans `%USERPROFILE%\.cargo\bin`
- le mode `dev` utilise directement `..\launchers\a11-local.ps1`
- le mode `build` prepare d'abord une copie `resources/a11-local` pour le bundle Tauri
- le mode `installer-lite` retire le modele local du bundle, puis laisse le shell importer ou telecharger un GGUF externe au premier lancement
