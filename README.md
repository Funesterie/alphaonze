# funesterie

Repo maitre et depot Git unique de l'ecosysteme Funesterie.

Ce depot sert maintenant de source de verite pour:

- la documentation et les conventions workspace
- les lanceurs locaux transverses de `A11`
- les applications Funesterie absorbees dans un seul monorepo

## Structure

- `spaces/a11`
  Space Hugging Face Gradio minimal pour `funeste/a11`.
- `a11/launchers`
  Lanceurs globaux A11 et scripts d'orchestration locale.
- `a11/WORKSPACE_BOUNDARIES.md`
  Regles de separation entre les projets.
- `a11/MONOREPO_STATUS.md`
  Etat de la migration vers le depot unique.
- `a11/backend`
  Backend A11.
- `a11/dragon`
  Stack Dragon.
- `a11/frontend`
  Frontend A11.

## Philosophie

`funesterie` remplace maintenant l'ancien montage en submodules.

Les anciens depots A11 ne sont plus censes etre des frontieres Git actives:
leurs fichiers vivent dans ce depot unique, sur la branche `master`.
On garde seulement leurs remotes historiques comme reference tant que les
services d'hebergement n'ont pas tous ete rebranches sur ce repo.

## Clonage

```bash
git clone https://github.com/Funesterie/funesterie.git
```

## Bootstrap workspace

Depuis la racine `funesterie`, tu peux tout piloter avec:

```powershell
pwsh -File .\bootstrap.ps1 status
pwsh -File .\bootstrap.ps1 setup
pwsh -File .\bootstrap.ps1 local check -NoPause
pwsh -File .\bootstrap.ps1 local start -NoPause
pwsh -File .\bootstrap.ps1 online --check-only --no-pause
```

Ou en double-clic / `cmd`:

```bat
bootstrap.bat status
bootstrap.bat setup
bootstrap.bat local check -NoPause
bootstrap.bat local start -NoPause
bootstrap.bat online --check-only --no-pause
```

## Deploy prod A11

Pour la prod A11, le plus simple est maintenant d'utiliser le flux dedie:

```powershell
pwsh -File .\deploy-a11-prod.ps1 -StatusOnly
pwsh -File .\deploy-a11-prod.ps1 -Message "fix(a11): mon correctif prod"
```

Ou en double-clic / `cmd`:

```bat
deploy-a11-prod.bat -StatusOnly
deploy-a11-prod.bat -Message "fix(a11): mon correctif prod"
```

Ce flux:

- cible seulement les applications utiles a la prod A11
- suppose que la source de verite Git est ce depot unique
- bloque clairement les branches locales qui ont diverge de la branche de deploy
- ignore les fichiers runtime locaux connus, comme les memos techniques

## Paquets et registres

Le registre principal pour sortir JFrog du chemin critique est Google Artifact
Registry:

```powershell
npm run google:artifact:repos
npm run google:npmrc
npm run google:packages:dry
npm run google:packages:publish
```

Etat actuel des versions npm publiques:

- `@nossen/qflush@1.0.1`
- `@nossen/dragon-contracts@1.0.0`
- `@nossen/dragon-upstream@1.0.0`
- `@nossen/dragon@1.0.0`
- tag public: `latest`

Etat actuel du miroir Google Artifact Registry `@nossen`:

- `@nossen/qflush@1.0.2`
- `@nossen/dragon-contracts@1.0.1`
- `@nossen/dragon-upstream@1.0.1`
- `@nossen/dragon@1.0.1`
- tags Google: `latest`, `stable`

Pour installer depuis npm:

```powershell
npm install @nossen/qflush@latest
```

La procedure Google Artifact Registry reste dans
`docs/GOOGLE_ARTIFACT_REGISTRY.md` pour les miroirs prives et les machines
admin. Le fallback GitHub Packages/GHCR reste documente dans
`docs/GITHUB_PACKAGES_AND_GHCR.md`.

## Support / dons

Funesterie/NOSSEN reste maintenu publiquement avec une infrastructure payante
et du travail operateur continu. Pour soutenir le projet, proposer un don,
une aide, un sponsorship ou une coordination directe:

- page contact/support: https://funesterie.me/contact/
- soutien Stripe: https://buy.stripe.com/7sYfZhfKW2DSffZgWU7Re01
- email: contact@funesterie.me

Ne publie jamais de token, cle API, mot de passe, cle privee ou fichier
credential dans une issue, un chat ou une capture.

### Actions disponibles

- `status`
  Affiche l'etat du workspace et des lanceurs.
- `setup`
  Prepare le workspace local.
- `local`
  Delegue vers `a11\launchers\a11-local.ps1` avec `start` par defaut.
- `online`
  Delegue vers `a11\launchers\start-online-a11.ps1`.

## Entrees canoniques A11

- local: `a11\launchers\a11-local.ps1`
- bureau: `a11\launchers\a11-desktop.ps1`
- bureau + Ollama: `a11\launchers\a11-ollama-desktop.ps1`
- prod/online: `a11\launchers\start-online-a11.ps1`
- raccourcis bureau: `a11\launchers\create-desktop-shortcut.ps1`

## Vue IDE

Pour retrouver une vue "un seul tronc / plusieurs arbres" dans VS Code, ouvre:

```text
funesterie.code-workspace
```

Cette workspace affiche separement:

- `A11 Launchers`
- `A11 Backend`
- `A11 Dragon`
- `A11 Frontend`

et masque les gros dossiers bruitants comme `node_modules`, `dist`, `.git`,
`.codex-tmp`, `llama.cpp` et les runtimes locaux.

## Note

La bascule vers un seul depot Git est faite cote code et cote hebergement.

- Railway backend pointe maintenant vers `Funesterie/funesterie` / `master`
  avec `a11/backend/apps/server` comme racine de deploy, et la sante publique
  est validee.
- Netlify frontend pointe maintenant vers `Funesterie/funesterie` / `master`
  avec `a11/frontend` comme base directory, et la prod sert depuis le monorepo.

Le suivi operationnel detaille vit dans `a11/HOSTING_REWIRE_STATUS.md` avant
l'archivage final des anciens depots specialises.
