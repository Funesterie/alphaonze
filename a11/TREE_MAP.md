# A11 Tree Map

But: savoir vite quel arbre corriger sans se perdre dans tout le workspace.

## Ou corriger quoi

- `a11/launchers`
  Lanceurs globaux, profils local/en ligne, tunnel, orchestration multi-services.
- `a11/a11backendrailway`
  Backend API A11, Cerbere, routes serveur, auth, fichiers, TTS cote backend.
- `a11/a11frontendnetlify`
  Interface web, panneaux React, UX, Netlify, appels API frontend.
- `a11/a11llm`
  Couche LLM locale, bridge, doc des modeles/binaires, scripts de verification.
- `a11/a11qflushrailway`
  Couche qflush associee a A11, orchestration qflush, flows et integration dediee.

## Regle simple

- bug UI ou page -> `a11frontendnetlify`
- bug API ou 502 backend -> `a11backendrailway`
- bug lancement local global -> `launchers`
- bug modele local / llama-server -> `a11llm`
- bug qflush -> `a11qflushrailway`

## Important

`D:\funesterie\a11\a11dragonrailway` porte maintenant le repo Dragon dans l'espace A11.
