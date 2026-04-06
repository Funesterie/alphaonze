# Workspace Boundaries

Date de reference: 2026-03-27

## Regle principale

`D:\funesterie\a11\dragon` fait partie du workspace A11/Funesterie.

Il ne doit pas devenir le depot principal des scripts, lanceurs, services ou fichiers runtime de `A11` par defaut.

## Decoupage A11

- `D:\funesterie\a11\launchers`
  Orchestration locale transverse, raccourcis, tunnel, lancement multi-services.
- `D:\funesterie\a11\backend`
  Backend API A11 et logique serveur propre a A11.
- `D:\funesterie\a11\frontend`
  Frontend A11 et interface web.
- `D:\funesterie\a11\a11qflushrailway`
  Projet Qflush associe a l'ecosysteme A11.

## Regles d'organisation

- Ne pas eclater la logique A11/Dragon hors de `D:\funesterie\a11` par convenience.
- Garder les changements frontend dans `frontend`.
- Garder les changements backend dans `backend`.
- Garder les references LLM locales dans la config `launchers`, pas dans le repo.
- Garder les changements Qflush dans `a11qflushrailway`.
- Garder les scripts de lancement globaux dans `launchers`.
- Si une orchestration transverse devient trop grosse, creer une couche dediee a A11 plutot que de la melanger avec `dragon`.

## Note operative

`dragon` peut rester une experience, un control plane separe, ou un projet parallelle.

Mais pour `A11`, la source de verite reste l'arborescence `D:\funesterie\a11\...`.
