# funesterie

Repo maitre de l'ecosysteme Funesterie.

Ce depot sert de point d'entree pour:

- la documentation et les conventions workspace
- les lanceurs locaux transverses de `A11`
- les sous-repos specialises relies en submodules

## Structure

- `a11/launchers`
  Lanceurs globaux A11 et scripts d'orchestration locale.
- `a11/WORKSPACE_BOUNDARIES.md`
  Regles de separation entre les projets.
- `a11/a11backendrailway`
  Backend A11.
- `a11/a11frontendnetlify`
  Frontend A11.
- `a11/a11llm`
  Couche LLM locale A11.
- `a11/a11qflushrailway`
  Integration qflush pour A11.

## Philosophie

Chaque composant garde son propre depot, son propre historique et son propre cycle de vie.

Le repo `funesterie` ne remplace pas ces depots: il les relie et versionne seulement la couche workspace commune.

## Clonage

```bash
git clone --recurse-submodules https://github.com/jEFFLEZ/funesterie.git
```

Si le repo est deja clone:

```bash
git submodule update --init --recursive
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

- cible seulement les depots utiles a la prod A11
- pousse vers `main`, ce qui est le plus simple si Railway / Netlify surveillent `main`
- bloque clairement les branches locales qui ont diverge de `main`, au lieu de donner l'impression qu'un push a "fait quelque chose"
- ignore les fichiers runtime locaux connus, comme les memos techniques

### Actions disponibles

- `status`
  Affiche l'etat du workspace, des submodules et des lanceurs.
- `setup`
  Initialise et resynchronise les submodules.
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
- `A11 Frontend`
- `A11 LLM`
- `A11 Qflush`

et masque les gros dossiers bruitants comme `node_modules`, `dist`, `.git` et les runtimes locaux.

## Note

`D:\dragon` reste un projet separe et est pousse dans son propre depot `dragon`.
