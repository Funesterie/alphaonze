# A11 / Kaen44 auto init

Date: 2026-05-09

## But

Initialiser A11 et Kaen44 ensemble sans melanger les roles:

- A11 reste le cerveau prive/admin sur `https://a11.funesterie.pro`.
- Kaen44 reste l'application publique/client sur `https://funesterie.me`.
- Les deux utilisent leurs profils secrets separes.
- La vision GPU est activee seulement quand Podman/CUDA fonctionne.
- Le mode stable/preview est explicite.

## Commandes

Avant validation/demarrage, le script lance `D:\projets\funesterie\scripts\Update-FunesterieSource.ps1`.
Ce helper fait un `git fetch` puis un `git pull --ff-only` seulement si l'arbre local est propre.
S'il voit des fichiers modifies, il saute la mise a jour pour ne rien ecraser.

Validation sans demarrer:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File D:\projets\funesterie\a11\backend\apps\server\scripts\Start-A11Kaen44Auto.ps1
```

Demarrage stable:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File D:\projets\funesterie\a11\backend\apps\server\scripts\Start-A11Kaen44Auto.ps1 -Start -ReleaseChannel stable
```

Demarrage preview:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File D:\projets\funesterie\a11\backend\apps\server\scripts\Start-A11Kaen44Auto.ps1 -Start -ReleaseChannel preview
```

Sans vision GPU:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File D:\projets\funesterie\a11\backend\apps\server\scripts\Start-A11Kaen44Auto.ps1 -Start -SkipVision
```

## Fichiers impliques

- `backend/apps/server/server-a11.cjs`
- `backend/apps/server/server-kaen44.cjs`
- `backend/apps/server/profiles/a11.env`
- `backend/apps/server/profiles/kaen44.env`
- `backend/apps/server/docker-compose.yml`
- `backend/apps/server/docker-compose.split.yml`
- `backend/apps/server/docker-compose.vision.yml`
- `backend/apps/server/scripts/Start-A11Kaen44Auto.ps1`

## Projet Google a utiliser

Pour Google Cloud/OAuth, le projet cible est:

```txt
alphaonze
```

Ne pas executer d'actions sur:

```txt
vivid-poet-g213t
```

tant que son proprietaire, son billing et son usage ne sont pas confirmes.
