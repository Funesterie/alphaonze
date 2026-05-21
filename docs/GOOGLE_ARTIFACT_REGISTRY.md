# Google Artifact Registry

Artifact Registry remplace JFrog pour le chemin serieux Funesterie. JFrog peut
rester une sandbox, mais les paquets et images distribuables passent maintenant
par Google Cloud.

## Projet et depots

Projet GCP :

```text
alphaonze
```

Region :

```text
europe-west4
```

Depots crees :

```text
funesterie-npm      npm prive
funesterie-docker   Docker / OCI prive
funesterie-generic  artefacts generiques
```

Pour verifier :

```powershell
npm run google:artifacts:list
```

## npm prive

Le registre npm est :

```text
https://europe-west4-npm.pkg.dev/alphaonze/funesterie-npm/
```

Les scopes connectes par defaut :

```text
@funesterie
@nossen
```

Le fichier `.npmrc.google` est genere localement et ne contient pas de secret :

```powershell
npm run google:npmrc
```

L'auth npm passe par `google-artifactregistry-auth` et ecrit les credentials hors
Git :

```powershell
npm run google:npm-auth
```

Par defaut, les credentials vont ici :

```text
D:\FunesterieSecrets\google\artifact-registry.npmrc
```

## Publication

Dry-run :

```powershell
npm run google:packages:dry
```

Publication :

```powershell
npm run google:packages:publish
```

Le manifeste est dans :

```text
scripts/google/google-artifact-registry.manifest.json
```

Paquet pret aujourd'hui :

```text
@funesterie/qflush@1.0.5
tags: latest, stable, internal
```

Le source reste `a11/backend/libs` et peut encore porter le nom historique
`@nossen/qflush`; le paquet publie est le miroir propre `@funesterie/qflush`.

## Installation

Dans un projet consommateur :

```powershell
npm run google:npmrc
npm run google:npm-auth
npm install @funesterie/qflush@stable
```

Garder le scope Google limite a `@funesterie` et `@nossen`. Ne pas remplacer le
registre npm global, sinon les dependances publiques partent au mauvais endroit.

## Docker / OCI

Docker est configure pour :

```text
europe-west4-docker.pkg.dev
```

Commande locale :

```powershell
gcloud auth configure-docker europe-west4-docker.pkg.dev --quiet
```

Nom d'image type :

```text
europe-west4-docker.pkg.dev/alphaonze/funesterie-docker/a11-backend:stable
```

## Securite

- Pas de token dans le depot.
- Auth locale via `gcloud auth` ou Application Default Credentials.
- CI future via Workload Identity Federation, pas via cle JSON longue duree.
- Scan : Artifact Analysis + OSV-Scanner + Dependabot, selon cout et besoin.

## Sources officielles

- Formats supportes : https://cloud.google.com/artifact-registry/docs/supported-formats
- npm / Node.js : https://cloud.google.com/artifact-registry/docs/nodejs
- Auth npm : https://cloud.google.com/artifact-registry/docs/nodejs/authentication
- Tarifs : https://cloud.google.com/artifact-registry/pricing
