# A11 Monorepo Transition

## Goal

Make `D:\\funesterie` the single Git source of truth for the A11 stack without
breaking current production.

## Current Status

Phase 1 is done on the code side:

- the nested Git repositories have been absorbed into `funesterie`
- the root repository now versions the A11 applications directly
- the workspace now uses simple app folders under `a11/`

## What Is Inside The Monorepo

These folders now live in the same Git repository:

- `backend`
- `frontend`
- `dragon`
- `llm`
- `launchers`

## Stable Layout For The First Cut

The code now stays here:

```text
funesterie/
  a11/
    launchers/
    backend/
    frontend/
    dragon/
    llm/
```

## Important

Do not delete the legacy remote repositories until Railway / Netlify are
switched to the new source of truth.

Today, production still depends on these repos directly:

- Railway backend: `backend`
- Netlify frontend: `frontend`

## Next Safe Steps

1. Keep the legacy remotes alive while `Funesterie/funesterie` becomes the operational control root.
2. Finish provider rewiring with the monorepo roots documented in `HOSTING_REWIRE_STATUS.md`.
3. Verify builds and runtime health from the monorepo branch used in production.
4. Archive old repositories.
5. Delete old repositories only after at least one stable production cycle.

## Railway / Netlify Baseline

If you switch providers to the monorepo, the source should stay on the
monorepo default branch.

Recommended roots with the current stable layout:

- Railway backend:
  `a11/backend/apps/server`
- Netlify frontend:
  `a11/frontend/apps/web`

## Recommendation

The monorepo is now the code truth.

The remaining work is operational:

1. finish the provider-side switch described in `HOSTING_REWIRE_STATUS.md`
2. validate one full production cycle
3. archive then delete the legacy remotes
