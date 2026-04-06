# A11 Monorepo Status

Date de migration: 2026-04-06

## Cible

`D:\funesterie` devient le depot unique de reference.

L'arborescence A11 reste concentree dans `D:\funesterie\a11` pour limiter les
ruptures de chemins locaux, mais les anciens depots imbriques ne doivent plus
rester des frontieres Git separees.

## Depots absorbes

- `a11/a11backendrailway`
- `a11/a11frontendnetlify`
- `a11/a11dragonrailway`
- `a11/a11llm`

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

## Note de prudence

La suppression des anciens repos Git distants ne doit intervenir qu'apres
verification des pipelines de build et des deploys sur la source monorepo.
