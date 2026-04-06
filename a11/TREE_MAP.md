# A11 Tree Map

But: savoir vite quel arbre corriger sans se perdre dans tout le workspace.

## Ou corriger quoi

- `a11/launchers`
  Lanceurs globaux, profils local/en ligne, tunnel, orchestration multi-services.
- `a11/backend`
  Backend API A11, Cerbere, routes serveur, auth, fichiers, TTS cote backend.
- `a11/frontend`
  Interface web, panneaux React, UX, Netlify, appels API frontend.
- `a11/a11qflushrailway`
  Couche qflush associee a A11, orchestration qflush, flows et integration dediee.

## Regle simple

- bug UI ou page -> `frontend`
- bug API ou 502 backend -> `backend`
- bug lancement local global -> `launchers`
- bug modele local / llama-server -> `launchers` et la cible locale configuree
- bug qflush -> `a11qflushrailway`

## Important

`D:\funesterie\a11\dragon` porte maintenant le repo Dragon dans l'espace A11.
