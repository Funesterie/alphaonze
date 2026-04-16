# A11 Launchers

Ce dossier contient l'orchestration locale transverse de `A11`.

## Fichiers principaux

- `a11-local.bat` / `a11-local.ps1`
  Launcher unifie avec `start`, `desktop`, `stop`, `status`, `check`, `package`.
- `a11-desktop.bat` / `a11-desktop.ps1`
  Ouvre A11 local dans une vraie fenetre app dediee sous Windows.
- `a11-ollama-desktop.bat` / `a11-ollama-desktop.ps1`
  Verifie Ollama puis ouvre le mode desktop; le tunnel reste optionnel via `-WithTunnel`.
- `create-desktop-shortcut.ps1`
  Regenere les raccourcis bureau canoniques.
- `start-prod-a11.bat` / `start-prod-a11.ps1`
  Lance le mode "full en ligne" avec le minimum de local.

## Comportement

Les lanceurs essayent d'eviter l'effet "15 terminaux ouverts":

- lancement discret des processus quand c'est possible
- verification des ports avant de relancer un service
- logs centralises dans `launchers\runtime\logs`
- mode UI `embedded` par defaut: build du frontend puis service par le backend local
- Ollama est le chemin local principal pour le LLM
- qflush reste optionnel et desactive par defaut
- mode `desktop`: ouvre l'UI locale en fenetre app Edge/Chrome sans onglets ni barre classique

## Raison d'etre

Ces scripts vivent ici pour eviter de melanger l'orchestration globale avec:

- `backend` pour le backend
- `frontend` pour le frontend
- une cible LLM locale externe configuree au runtime
- `a11qflushrailway` pour qflush

## Compatibilite

Les anciens wrappers ont ete retires pour ne garder que les points d'entree canoniques.

## Commandes utiles

- `a11-local.bat start`
- `a11-local.bat desktop`
- `a11-ollama-desktop.bat`
- `a11-desktop.bat`
- `a11-local.bat stop`
- `a11-local.bat status`
- `a11-local.bat check`
- `a11-local.bat package --dryrun`

## Config

La config centrale locale se trouve dans:

- `launchers\config\a11-local.env`

Ports, chemins, mode UI et activation de qflush vivent ici.

## Packaging

Le mapping source -> cible est documente dans:

- `launchers\PACKAGE_LAYOUT_PLAN.md`

Le staging local pret a zipper est cree via:

- `a11-local.bat package`
