# A11 Monorepo Transition

## Goal

Make `D:\\funesterie\\a11` the single operational home for the A11 stack without breaking current production.

## What Should Be Unified

These repositories are all part of the same runtime product and are good candidates for one A11 monorepo:

- `a11backendrailway`
- `a11frontendnetlify`
- `a11qflushrailway`
- `a11desktoptauri`
- `a11llm`
- `launchers`

## What Should Stay Separate

These are reusable packages and it is healthier to keep them versioned independently:

- `freeland`
- `morphing`
- `freeland-bros`
- `rome`
- `nezlephant`
- `bat`
- `beam`
- `spyder`
- `envaptex`

If needed, A11 can consume them as npm packages or git dependencies, but they do not need to live inside the A11 deploy repo.

## Recommended Final Shape

Target layout inside one repo:

```txt
a11/
  apps/
    backend/
    frontend/
    qflush/
    desktop/
  llm/
  launchers/
  docs/
```

## Important

Do not delete the current deploy repositories until the hosting providers are switched to the new source of truth.

Today, production still depends on these repos directly:

- Railway backend: `a11backendrailway`
- Railway qflush: `a11qflushrailway`
- Netlify frontend: `a11frontendnetlify`

## Safe Migration Order

1. Keep the current repos alive while `D:\\funesterie\\a11` becomes the control root.
2. Move code into the final folder layout in one source repo.
3. Point Railway and Netlify to the monorepo with the correct root directories.
4. Verify builds and runtime health.
5. Archive old repos.
6. Delete old repos only after at least one stable production cycle.

## Railway / Netlify Baseline

If you later switch providers to the monorepo, the source should still stay on `main`.

Recommended root directories after consolidation:

- Railway backend:
  `a11/apps/backend`
- Railway qflush:
  `a11/apps/qflush`
- Netlify frontend:
  `a11/apps/frontend`

## Current Reality

Right now, Railway backend has been following the backend branch `sync/backend-main-20260328`, and qflush has been following `deploy/trigger-qflush-20260327`.

That is exactly why the system felt confusing: the hosting source of truth was not consistently `main`.

## Recommendation

Yes, simplify.

But simplify in two phases:

1. First, make `D:\\funesterie\\a11` the operational control center.
2. Then migrate hosting to a single A11 repo and retire the legacy repos.

That path is much safer than deleting everything now.
