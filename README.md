# funesterie

Repo maitre et depot Git unique de l'ecosysteme Funesterie.

Ce depot sert maintenant de source de verite pour:

- la documentation et les conventions workspace
- les lanceurs locaux transverses de `A11`
- les applications Funesterie absorbees dans un seul monorepo

## Structure

- `a11/launchers`
  Lanceurs globaux A11 et scripts d'orchestration locale.
- `a11/WORKSPACE_BOUNDARIES.md`
  Regles de separation entre les projets.
- `a11/MONOREPO_STATUS.md`
  Etat de la migration vers le depot unique.
- `a11/a11backendrailway`
  Backend A11.
- `a11/a11dragonrailway`
  Stack Dragon.
- `a11/a11frontendnetlify`
  Frontend A11.
- `a11/a11llm`
  Couche LLM locale A11.

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
pwsh -File .\bootstrap.ps1 local --check-only --no-pause
pwsh -File .\bootstrap.ps1 online --check-only --no-pause
```

Ou en double-clic / `cmd`:

```bat
bootstrap.bat status
bootstrap.bat setup
bootstrap.bat local --check-only --no-pause
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

### Actions disponibles

- `status`
  Affiche l'etat du workspace et des lanceurs.
- `setup`
  Prepare le workspace local.
- `local`
  Delegue vers `a11\launchers\start-all-a11.ps1`.
- `online`
  Delegue vers `a11\launchers\start-prod-a11.ps1`.

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
- `A11 LLM`

et masque les gros dossiers bruitants comme `node_modules`, `dist`, `.git`,
`.codex-tmp`, `llama.cpp` et les runtimes locaux.

## Note

La bascule vers un seul depot Git est faite cote code.

- Railway backend est maintenant rebascule vers `Funesterie/funesterie` et
  tourne sainement depuis le monorepo.
- Netlify frontend dispose maintenant de sa config monorepo, mais le changement
  de repo source reste a finir cote dashboard Netlify, meme si la prod sert deja
  un deploy publie depuis les artefacts du monorepo.

Le suivi operationnel detaille vit dans `a11/HOSTING_REWIRE_STATUS.md` avant
l'archivage final des anciens depots specialises.
