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

> Update 2026-05-28: le registre npmjs public est le canon le plus recent pour
> les packages NOSSEN. Derniers patchs publies: `@nossen/all-in-one@0.1.3`,
> `@nossen/morphing@2.0.3`, `@nossen/envapt-superimg@2.0.2`,
> `@nossen/freeland-bros@2.0.3`, `@nossen/rome@2.0.3`, et
> `@funeste/all-in-one-nossen@0.1.1`. Avant un prochain miroir Google Artifact
> Registry, aligner `scripts/google/google-artifact-packages.manifest.json`
> pour ne pas republier les anciennes versions 2.0.0 par erreur.

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
| `runtime/modules/allmight` | `@nossen/allmight@2.0.0` | `@nossen/allmight@2.0.0` | `latest`, `stable` |
| `runtime/modules/bat/packages/bat` | `@nossen/bat@2.0.0` | `@nossen/bat@2.0.0` | `latest`, `stable` |
| `runtime/modules/bat/packages/bat-system` | `@nossen/bat-system@2.0.0` | `@nossen/bat-system@2.0.0` | `latest`, `stable` |
| `runtime/modules/beam` | `@nossen/beam@2.0.0` | `@nossen/beam@2.0.0` | `latest`, `stable` |
| `runtime/modules/envaptex/envapt-superimg` | `@nossen/envapt-superimg@2.0.0` | `@nossen/envapt-superimg@2.0.0` | `latest`, `stable` |
| `runtime/modules/envaptex` | `@nossen/envaptex@2.0.0` | `@nossen/envaptex@2.0.0` | `latest`, `stable` |
| `runtime/modules/freeland` | `@nossen/freeland@2.0.0` | `@nossen/freeland@2.0.0` | `latest`, `stable` |
| `runtime/modules/freeland-bros` | `@nossen/freeland-bros@2.0.0` | `@nossen/freeland-bros@2.0.0` | `latest`, `stable` |
| `runtime/modules/katana` | `@nossen/katana@2.0.0` | `@nossen/katana@2.0.0` | `latest`, `stable` |
| `runtime/modules/morphing` | `@nossen/morphing@2.0.0` | `@nossen/morphing@2.0.0` | `latest`, `stable` |
| `runtime/modules/nezlephant/nezlephant/nezlephant` | `@nossen/nezlephant@2.0.0` | `@nossen/nezlephant@2.0.0` | `latest`, `stable` |
| `a11/backend/libs` | `@nossen/qflush@2.0.0` | `@nossen/qflush@2.0.0` | `latest`, `stable` |
| `runtime/modules/qflush/runner-package` | `@nossen/qflush-runner@2.0.0` | `@nossen/qflush-runner@2.0.0` | `latest`, `stable` |
| `packages/nossen/logic-reduce` | `@nossen/logic-reduce@2.0.0` | `@nossen/logic-reduce@2.0.0` | `latest`, `stable` |
| `runtime/modules/rome` | `@nossen/rome@2.0.0` | `@nossen/rome@2.0.0` | `latest`, `stable` |
| `runtime/modules/scentgate` | `@nossen/scentgate@2.0.0` | `@nossen/scentgate@2.0.0` | `latest`, `stable` |
| `runtime/modules/scream` | `@nossen/scream@2.0.0` | `@nossen/scream@2.0.0` | `latest`, `stable` |
| `runtime/modules/spyder/packages/spyder` | `@nossen/spyder@2.0.0` | `@nossen/spyder@2.0.0` | `latest`, `stable` |
| `a11/dragon/packages/contracts` | `@nossen/dragon-contracts@2.0.0` | `@nossen/dragon-contracts@2.0.0` | `latest`, `stable` |
| `a11/dragon/packages/upstream` | `@nossen/dragon-upstream@2.0.0` | `@nossen/dragon-upstream@2.0.0` | `latest`, `stable` |
| `a11/dragon/apps/dragon-daemon` | `@nossen/dragon@2.0.0` | `@nossen/dragon@2.0.0` | `latest`, `stable` |

Validation 2026-05-23:

- `npm view` confirme `latest` et `stable` en `2.0.0` pour les 21 packages.
- Une installation fraiche des 21 packages depuis Google Artifact Registry
  passe avec `npm audit --audit-level=moderate` a `0` vulnerabilite.

Si un dist-tag scoped doit etre repare directement avec `gcloud`, encoder le
slash du package:

```powershell
gcloud artifacts tags create latest --package='@nossen%2Fenvaptex' --version=2.0.0
gcloud artifacts tags create stable --package='@nossen%2Fenvaptex' --version=2.0.0
```

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
