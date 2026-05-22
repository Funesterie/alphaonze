# Google Artifact Registry

JFrog reste une sandbox. La distribution sobre passe par Google Artifact
Registry dans le projet `alphaonze`, region `europe-west4`.

Depots attendus:

- `funesterie-npm` pour les paquets npm prives Funesterie.
- `funesterie-docker` pour les images Docker/OCI.
- `funesterie-generic` pour les artefacts generiques.

## Verification des depots

```powershell
npm run google:artifact:repos
```

Cette commande active l'API Artifact Registry si besoin et cree les depots
manquants. Elle ne manipule aucun secret.

## NPM

Le fichier local `.npmrc.google` est ignore par Git. Il ne contient pas de
token; il garde seulement le placeholder `${GOOGLE_ARTIFACT_ACCESS_TOKEN}`.

```powershell
npm run google:npmrc
npm run google:packages:dry
npm run google:packages:publish
```

`google:packages:publish` recupere un access token via `gcloud auth
print-access-token`, le garde seulement en variable d'environnement de
processus, puis publie avec `npm`.

Le miroir Google publie les packages canoniques `@nossen/*`. Les anciens noms
`@funesterie/*` ne sont plus la cible de ce flux.

Aujourd'hui, les packages prets sont:

| Source | Source package | Package distribue | Tags |
| --- | --- | --- | --- |
| `a11/backend/libs` | `@nossen/qflush@1.0.2` | `@nossen/qflush@1.0.2` | `latest`, `stable` |
| `a11/dragon/packages/contracts` | `@nossen/dragon-contracts@1.0.1` | `@nossen/dragon-contracts@1.0.1` | `latest`, `stable` |
| `a11/dragon/packages/upstream` | `@nossen/dragon-upstream@1.0.1` | `@nossen/dragon-upstream@1.0.1` | `latest`, `stable` |
| `a11/dragon/apps/dragon-daemon` | `@nossen/dragon@1.0.1` | `@nossen/dragon@1.0.1` | `latest`, `stable` |

Pour installer:

```powershell
npm run google:npmrc
$env:GOOGLE_ARTIFACT_ACCESS_TOKEN = (gcloud auth print-access-token).Trim()
npm install @nossen/qflush@stable --userconfig .\.npmrc.google
Remove-Item Env:\GOOGLE_ARTIFACT_ACCESS_TOKEN
```

Quand le contenu du paquet change, augmenter la version publiee dans
`scripts/google/google-artifact-packages.manifest.json`, puis republier.

## Docker / OCI

Le depot existe sous:

```text
europe-west4-docker.pkg.dev/alphaonze/funesterie-docker
```

Avant de pousser localement:

```powershell
gcloud auth configure-docker europe-west4-docker.pkg.dev
```

## CI future

Le flux local est pret. Pour publier depuis GitHub Actions sans secret long, le
prochain cran propre est Workload Identity Federation:

- `GCP_WORKLOAD_IDENTITY_PROVIDER`
- `GCP_SERVICE_ACCOUNT`
- permission IAM minimale sur Artifact Registry

Tant que cette partie n'est pas branchee, on publie depuis la machine admin avec
`gcloud auth`.
