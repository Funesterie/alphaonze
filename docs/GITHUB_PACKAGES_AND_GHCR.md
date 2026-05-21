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

Aujourd'hui, seul le miroir suivant est prêt :

- `a11/backend/libs` -> `@funesterie/qflush@1.0.5`, tags `latest`, `stable` et `internal`

Le script packe le paquet source, réécrit le `package.json` dans un dossier temporaire, puis publie le miroir. Le `package.json` source reste en `@nossen/qflush`.

Le miroir GitHub retire les anciens modules `@nossen/*` des dépendances du paquet publié. Un `npm install @funesterie/qflush@stable` fonctionne donc même si les anciens paquets NPM ne sont plus accessibles.

Pour connecter un module sans se prendre la tête :

```bash
npm install @funesterie/qflush@stable
```

Ne pas utiliser `--registry=https://npm.pkg.github.com` globalement pour cette installation : seul le scope `@funesterie` doit pointer vers GitHub Packages, sinon les dépendances publiques partiront au mauvais registre. `npm run github:npmrc` génère le bon fichier.

`latest` sert au chemin simple, `stable` sert aux consommateurs prod qui ne doivent pas bouger tant qu'on ne retague pas volontairement.

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
