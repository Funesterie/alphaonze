# GitHub Packages et GHCR

Ce chemin sort JFrog du chemin critique. JFrog peut rester une sandbox locale, mais les paquets et images distribuables passent par GitHub.

## NPM GitHub Packages

Le fichier local `.npmrc.github` ne contient pas de token en clair. Il pointe vers `${NODE_AUTH_TOKEN}`.

```powershell
npm run github:npmrc
$env:NODE_AUTH_TOKEN = "<token GitHub avec write:packages>"
npm run github:packages:dry
npm run github:packages:publish
```

Le manifeste est dans `scripts/github/github-packages.manifest.json`.

Aujourd'hui, les miroirs GitHub Packages actifs sont :

- `a11/backend/libs` -> `@funesterie/qflush@2.0.0`, tags `latest`, `stable` et `internal`
- `a11/dragon/packages/contracts` -> `@funesterie/dragon-contracts@2.0.0`, tags `latest` et `stable`
- `a11/dragon/packages/upstream` -> `@funesterie/dragon-upstream@2.0.0`, tags `latest` et `stable`
- `a11/dragon/apps/dragon-daemon` -> `@funesterie/dragon@2.0.0`, tags `latest` et `stable`

Le script packe le paquet source, réécrit le `package.json` dans un dossier temporaire, puis publie le miroir. Le `package.json` source reste en `@nossen/qflush`.

Pour connecter un module sans se prendre la tête :

```bash
npm install @funesterie/qflush@stable
```

`latest` sert au chemin simple, `stable` sert aux consommateurs prod qui ne doivent pas bouger tant qu'on ne retague pas volontairement.

Dans A11, le chargement local essaie maintenant `@funesterie/qflush` en premier, puis retombe sur `@nossen/qflush` si le miroir GitHub Packages n'est pas installé. En production, garder `@funesterie/qflush@stable`; en dev rapide, `@funesterie/qflush@latest` suffit.

## GHCR

La workflow `.github/workflows/docker-build-push.yml` construit l'image backend et pousse vers :

```text
ghcr.io/<owner>/<image>
```

Par défaut :

```text
ghcr.io/funesterie/a11-backend
```

La variable de repo `GHCR_IMAGE` peut remplacer `a11-backend`.

## CI

- Pull requests : dry-run de packaging npm et build Docker sans push.
- Pushes `master` : dry-run de packaging npm, puis build et push GHCR.
- Tags `packages/*` ou déclenchement manuel avec `publish=true` : publication GitHub Packages.
- Déclenchement manuel Docker : build et push GHCR.

## Secrets nécessaires

GitHub Actions utilise `GITHUB_TOKEN` avec `packages: write`.

En local, utiliser un PAT GitHub via `NODE_AUTH_TOKEN`. Ne jamais écrire le token dans `.npmrc.github`; le fichier garde seulement le placeholder.
