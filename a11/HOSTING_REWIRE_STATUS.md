# A11 Hosting Rewire Status

Date: 2026-04-06

## Railway Backend

- Project: `a11backend`
- Environment: `production`
- Service: `a11backend`
- Public domain: `https://api.funesterie.pro`
- Target repo: `Funesterie/funesterie`
- Target branch: `master`
- Target root directory: `a11/a11backendrailway/apps/server`

Etat actuel:

- le service Railway a ete reconnecte au repo monorepo `Funesterie/funesterie`
- Railway cherche encore son ancien chemin config-as-code `apps/server/railway.json`
- un shim de compatibilite a ete ajoute dans le monorepo a `apps/server/railway.json`
- un deploy valide tourne maintenant avec:
  - rootDirectory: `a11/a11backendrailway/apps/server`
  - configFile: `a11/a11backendrailway/apps/server/railway.json`
  - watchPatterns: `a11/a11backendrailway/apps/server/**`
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
- Desired base directory: `a11/a11frontendnetlify`
- Desired build command: `npm run build`
- Desired publish directory: `dist`

Etat actuel:

- le site Netlify est bien lie localement et la build monorepo passe
- une config monorepo canonique existe maintenant a `a11/a11frontendnetlify/netlify.toml`
- la config `a11/a11frontendnetlify/apps/web/netlify.toml` a ete corrigee pour rester valide en execution locale
- un deploy production Netlify a ete publie directement depuis `a11/a11frontendnetlify/dist`
- la sante publique frontend est confirmee (`https://a11.funesterie.pro/` repond `200`)
- l'API/CLI Netlify disponible ici permet de lire le site et de deployer, mais pas de remplacer effectivement le repo Git source existant
- le dashboard Netlify affiche encore `Funesterie/a11frontendnetlify` sur la branche `main`

Action dashboard restante:

1. Ouvrir le projet `a11funesterie`.
2. Remplacer le repo par `Funesterie/funesterie`.
3. Passer la branche de production a `master`.
4. Fixer la base directory a `a11/a11frontendnetlify`.
5. Laisser `npm run build` et `dist`.

## Archive Readiness

- `Funesterie/a11backendrailway`
  Archive seulement apres une build Railway saine depuis `Funesterie/funesterie`.
- `Funesterie/a11frontendnetlify`
  Archive seulement apres le changement de repo source dans Netlify et un deploy prod sain.
- `Funesterie/a11dragonrailway`
  Peut etre prepare a l'archivage une fois les references externes confirmees.
- `Funesterie/a11llm`
  Peut etre prepare a l'archivage une fois les references externes confirmees.

## Delete Readiness

Ne supprimer aucun ancien repo avant:

1. au moins un cycle prod stable depuis `Funesterie/funesterie`
2. une verification de sante Railway et Netlify
3. une confirmation qu'aucune plateforme ne pointe encore vers un ancien repo
