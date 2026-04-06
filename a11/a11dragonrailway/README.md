# Dragon

Dragon is the canonical Funesterie control-plane workspace.

It keeps the ecosystem map that points toward `qflush`, `A11`, `a11ba`, `a11frontend` and the shared Funesterie libraries, while giving us one clean source root for the daemon, the API cockpit and the web cockpit.

## Workspace

- `apps/dragon-daemon`: published as `@funeste38/dragon`
- `apps/dragon-api`: Railway-ready API shell
- `apps/dragon-web`: Netlify-ready React cockpit
- `packages/contracts`: published as `@funeste38/dragon-contracts`
- `packages/upstream`: published as `@funeste38/dragon-upstream`

## Local Commands

```bash
npm install
npm run dev
npm run build
npm run typecheck
```

## Deployment

- Netlify: root config in `netlify.toml`, publishing `apps/dragon-web/dist`
- Railway: root config in `railway.toml` and `Dockerfile`
- Railway runtime mode:
  set `DRAGON_SERVICE=api` for `dragon-api`
  set `DRAGON_SERVICE=daemon` for `dragon-daemon`

## npm Releases

```bash
npm run publish:contracts
npm run publish:upstream
npm run publish:dragon
```

## Default Ports

- `dragon-api`: `4600`
- `dragon-daemon`: `4700`
- `dragon-web`: `5174`

## Notes

`D:\funesterie\a11\a11dragonrailway` is the canonical source for the Dragon workspace.
The GitHub repository for this workspace is `https://github.com/Funesterie/a11dragonrailway`.
