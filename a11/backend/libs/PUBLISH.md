# Publishing QFlush

Use this checklist when releasing QFlush to the Funesterie registries.

Current distributable mirror:

```text
@funesterie/qflush@1.0.5
tags: latest, stable, internal
```

## Preflight

```powershell
cd D:\projets\funesterie\a11\backend\libs
npm install
npm run build
npm test
npm pack --dry-run
```

Verify the pack output includes:

- `dist/**`
- `README.md`
- `PUBLISH.md`
- license and trademark files
- installer and example assets that are intentionally published

## Version

Npm versions are immutable. If the package was already published, bump the
patch version before publishing again:

```powershell
npm version patch
```

## npmjs

```powershell
npm whoami
npm publish --access public
```

If the npm account enforces two-factor authentication, npm will ask for the OTP
during publish.

## Google Artifact Registry

```powershell
cd D:\projets\funesterie
npm run google:npmrc
npm run google:npm-auth
npm run google:packages:dry
npm run google:packages:publish
```

## GitHub Packages

```powershell
npm run github:npmrc
$env:NODE_AUTH_TOKEN = "<token GitHub avec write:packages>"
npm run github:packages:dry
npm run github:packages:publish
```

## Tags

Tag the exact package version that was published:

```powershell
git tag @funesterie/qflush@<version>
git push origin @funesterie/qflush@<version>
```

Update `docs/ops/NOSSEN_RELEASE_ALIGNMENT_2026-05-18.md` if the package train
changes.

## Smoke Test

```powershell
npm install -g @funesterie/qflush@stable
qflush --version
qflush --help
qflush doctor
```
