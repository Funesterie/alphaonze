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
- Tauri Rust: `tauri@2.11.1`
- Cargo lock patche: `rustls-webpki@0.103.13`, `rand@0.9.4`
- `glib@0.18.x` reste tire par la pile Linux GTK/WebKit de Tauri; le corriger demande une montee de pile Tauri/GTK, pas seulement un bump de lock.

## Notes

- pas besoin de redemarrer Windows tant que Rust existe dans `%USERPROFILE%\.cargo\bin`
- le mode `dev` utilise directement `..\launchers\a11-local.ps1`
- le mode `build` prepare d'abord une copie `resources/a11-local` pour le bundle Tauri
- le mode `installer-lite` retire le modele local du bundle, puis laisse le shell importer ou telecharger un GGUF externe au premier lancement

<!-- funesterie-donations:start -->
## Support Funesterie / NOSSEN

Support is voluntary, but it keeps the public modules, registry, compute, and maintenance work alive.

- Wero: `+33 7 83 46 37 61`
- PayPal: https://paypal.me/funeste38
- Stripe/card checkout: https://funesterie.me/subscription
- Custom support/contact: https://funesterie.me/contact/
<!-- funesterie-donations:end -->
