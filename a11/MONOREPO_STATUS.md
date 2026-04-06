# A11 Monorepo Status

Date de migration: 2026-04-06

## Cible

`D:\funesterie` devient le depot unique de reference.

L'arborescence A11 reste concentree dans `D:\funesterie\a11` pour limiter les
ruptures de chemins locaux, mais les anciens depots imbriques ne doivent plus
rester des frontieres Git separees.

## Depots absorbes

- `a11/backend`
- `a11/frontend`
- `a11/dragon`

Le support LLM local reste documente historiquement, mais n'est plus versionne
dans l'arborescence courante du monorepo.

## Etat source capture avant absorption

- `a11backendrailway`
  - HEAD: `99b3ac60ffd1c1b43817f1a39b31fd67003bbba7`
  - origin: `https://github.com/Funesterie/a11backendrailway.git`
- `a11frontendnetlify`
  - HEAD: `5021d2893acdaf8bc3e75ad8d5b50dfd1ca9add0`
  - origin: `https://github.com/Funesterie/a11frontendnetlify.git`
- `a11dragonrailway`
  - HEAD: `d231753699535282b64f4a08c478cac1bd809e97`
  - origin: `https://github.com/Funesterie/a11dragonrailway.git`
- `a11llm`
  - HEAD: `aa7524c5ef3b660865f7c5cd982fe4802ab949dd`
  - origin local actuel: `https://github.com/jEFFLEZ/a11llm.git`
  - miroir Funesterie pousse: `https://github.com/Funesterie/a11llm.git`

## Regles apres absorption

- Le repo parent versionne directement les fichiers des apps A11.
- Les anciens depots distants servent uniquement de reference historique tant
  qu'ils ne sont pas archives ou supprimes.
- Les services de deploy doivent a terme pointer vers `Funesterie/funesterie`
  sur la branche `master`.
- Les dossiers temporaires `.codex-tmp` ne font pas partie du mono-repo.

## Rewire Hosting

- Railway backend:
  - source repointee vers `Funesterie/funesterie`
  - branche active: `master`
  - cible monorepo: `a11/backend/apps/server`
  - dernier deployment valide: `3774690e-1a4a-4944-a79c-82b5f63628aa`
  - sante publique confirmee
- Netlify frontend:
  - site confirme: `a11funesterie`
  - build monorepo valide depuis `a11/frontend`
  - config canonique ajoutee: `a11/frontend/netlify.toml`
  - repo source repointe vers `Funesterie/funesterie`
  - branche active: `master`
  - base directory: `a11/frontend`
  - dernier deploy live: `69d3ed6065e9514faaca98d1`
  - production publiee et servie depuis le monorepo

Voir `a11/HOSTING_REWIRE_STATUS.md` pour les IDs, les commandes, et l'etat
de preparation a l'archivage.

## Note de prudence

La suppression des anciens repos Git distants ne doit intervenir qu'apres
verification des pipelines de build et des deploys sur la source monorepo.
