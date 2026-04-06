# A11 Hosting Rewire Status

Date: 2026-04-06

## Railway Backend

- Project: `a11backend`
- Environment: `production`
- Service: `a11backend`
- Public domain: `https://api.funesterie.pro`
- Target repo: `Funesterie/funesterie`
- Target branch: `master`
- Target root directory: `a11/backend/apps/server`
- Latest successful deployment: `3774690e-1a4a-4944-a79c-82b5f63628aa`

Etat actuel:

- le service Railway a ete reconnecte au repo monorepo `Funesterie/funesterie`
- un deploy valide tourne maintenant avec:
  - rootDirectory: `a11/backend/apps/server`
  - configFile: `a11/backend/apps/server/railway.json`
  - watchPatterns: `a11/backend/apps/server/**`
- la sante publique backend est confirmee (`/health` repond `200`)

Commande de verification utile:

```powershell
railway status --json
railway logs --build --latest -s a11backend -n 120
curl.exe -s -o NUL -w "A11_API /health %{http_code}\n" https://api.funesterie.pro/health
```

## Netlify Frontend

- Site: `a11funesterie`
- Site ID: `62907e1d-70c0-4a65-ae1a-e1bb906be9e3`
- Public domain: `https://a11.funesterie.pro`
- Desired repo: `Funesterie/funesterie`
- Desired branch: `master`
- Desired base directory: `a11/frontend`
- Desired build command: `npm run build`
- Desired publish directory: `dist`
- Latest live deployment: `69d3ed6065e9514faaca98d1`

Etat actuel:

- le site Netlify est bien lie localement et la build monorepo passe
- une config monorepo canonique existe maintenant a `a11/frontend/netlify.toml`
- la config `a11/frontend/apps/web/netlify.toml` a ete corrigee pour rester valide en execution locale
- un deploy production Netlify a ete publie directement depuis `a11/frontend/dist`
- la sante publique frontend est confirmee (`https://a11.funesterie.pro/` repond `200`)
- le repo Git source a ete remplace par `Funesterie/funesterie`
- la branche de production est maintenant `master`
- la base directory active est `a11/frontend`
- `build_settings.repo_path` est desormais `Funesterie/funesterie`

## Archive Readiness

- `Funesterie/a11backendrailway`
  Peut etre archive: Railway deploie sainement depuis `Funesterie/funesterie`.
- `Funesterie/a11frontendnetlify`
  Peut etre archive: Netlify pointe maintenant vers `Funesterie/funesterie`.
- `Funesterie/a11dragonrailway`
  Peut etre prepare a l'archivage une fois les references externes confirmees.
- `Funesterie/a11llm`
  Peut etre prepare a l'archivage une fois les references externes confirmees.

## Delete Readiness

Ne supprimer aucun ancien repo avant:

1. au moins un cycle prod stable depuis `Funesterie/funesterie`
2. une verification de sante Railway et Netlify
3. une confirmation qu'aucune plateforme ne pointe encore vers un ancien repo
