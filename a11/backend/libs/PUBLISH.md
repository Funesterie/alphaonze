# Publishing @nossen/qflush

Use this checklist when releasing QFlush to npmjs and the Funesterie JFrog npm
registry.

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

## JFrog

```powershell
cd D:\projets\funesterie
$env:JFROG_NPM_REGISTRY = "https://trialhnuk69.jfrog.io/artifactory/api/npm/funesterie-npm-local/"
.\scripts\jfrog\Write-JFrogNpmrc.ps1 -Force
.\scripts\jfrog\Publish-FunesteriePackages.ps1 -Publish
```

Use the virtual repository again for installs after publishing:

```powershell
$env:JFROG_NPM_REGISTRY = "https://trialhnuk69.jfrog.io/artifactory/api/npm/funesterie-npm/"
.\scripts\jfrog\Write-JFrogNpmrc.ps1 -Force
```

## GitHub

Tag the exact package version that was published:

```powershell
git tag @nossen/qflush@<version>
git push origin @nossen/qflush@<version>
```

Update `docs/ops/NOSSEN_RELEASE_ALIGNMENT_2026-05-18.md` if the package train
changes.

## Smoke Test

```powershell
npm install -g @nossen/qflush
qflush --version
qflush --help
qflush doctor
```
