# Dossier de validation Google et Microsoft - 2026-05-23

Statut : patch de préparation et vérification publique, sans secret.

Ce document prépare la validation Google OAuth et Microsoft Entra pour Funesterie/NOSSEN. Il ne contient aucun client secret, token, cookie, mot de passe, clé privée ou code de secours.

## Sources vérifiées

- Preflight Codex : `npm --prefix D:\projets\funesterie\a11mcp run session:preflight -- --print`, exécuté le 2026-05-23.
- Fil MCP ouvert : `discussion-2026-05-23T153650507Z-validation-google-microsoft-worktree-propre-2026`.
- Inventaire local : `docs/ops/NOSSEN_DRIVE_CLOUD_INVENTORY_2026-05-22.md`.
- Google OAuth local : `a11/docs/GOOGLE_OAUTH_A11_KAEN44_VIVY.md` et `docs/ops/GOOGLE_OAUTH_UNBLOCK_2026-05-16.md`.
- Documentation officielle Google :
  - `https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification`
  - `https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification`
  - `https://support.google.com/cloud/answer/13463073`
- Documentation officielle Microsoft :
  - `https://learn.microsoft.com/en-us/entra/identity-platform/scopes-oidc`
  - `https://learn.microsoft.com/en-us/azure/active-directory/develop/howto-add-terms-of-service-privacy-statement`
  - `https://learn.microsoft.com/en-us/entra/identity-platform/publisher-verification-overview`

## État public vérifié

Vérifié depuis le worktree propre le 2026-05-23 :

| URL | État |
| --- | --- |
| `https://funesterie.me/` | HTTP 200 |
| `https://funesterie.me/contact/` | HTTP 200 |
| `https://funesterie.me/privacy/` | HTTP 200 |
| `https://funesterie.me/terms/` | HTTP 200 |
| `https://a11.funesterie.me/health` | HTTP 200 |
| `https://k44.funesterie.me/health` | HTTP 200 |
| `https://mcp.funesterie.me/health` | HTTP 200 |

Correction incluse dans ce patch : les routes `/privacy/`, `/terms/`, `/confidentialite/`, `/conditions/`, `/cgu/` et leurs alias K44 servent maintenant les HTML légaux autonomes du build avant la fallback SPA. Avant ce patch, la production répondait bien `200`, mais renvoyait la coque SPA pour ces URLs, ce qui est fragile pour les revues Google/Microsoft.

## Identité publique recommandée

- Nom d'application : `Alphaonze / A11 Funesterie`.
- Domaine autorisé principal : `funesterie.me`.
- Page d'accueil : `https://funesterie.me/`.
- Contact et support : `funeste38@gmail.com`.
- Politique de confidentialité : `https://funesterie.me/privacy/`.
- Conditions d'utilisation : `https://funesterie.me/terms/`.
- Page de contact : `https://funesterie.me/contact/`.

## Google OAuth

### Principe

Google login A11/K44 doit rester un client de connexion, avec scopes d'identité uniquement :

```txt
openid email profile
```

Les scopes media sensibles ou restreints restent dans une famille OAuth séparée pour Vivy. Ne pas ajouter `drive.file`, `drive.readonly` ou `youtube.upload` au client `alphaonze` tant que la validation media n'est pas prête.

### Redirects réellement émis par la prod

Ces routes redirigent vers `accounts.google.com`, avec `response_type=code`, un `state`, et un client ID présent mais non copié ici :

| Surface | Start endpoint | Redirect URI | Scope |
| --- | --- | --- | --- |
| A11 | `https://a11.funesterie.me/api/auth/google/start` | `https://a11.funesterie.me/api/auth/google/callback` | `openid email profile` |
| K44 | `https://k44.funesterie.me/api/auth/google/start` | `https://k44.funesterie.me/api/auth/google/callback` | `openid email profile` |
| Funesterie | `https://funesterie.me/api/auth/google/start` | `https://funesterie.me/api/auth/google/callback` | `openid email profile` |

### Configuration console à aligner

Dans Google Cloud Auth Platform / OAuth consent :

- Homepage : `https://funesterie.me/`
- Privacy policy : `https://funesterie.me/privacy/`
- Terms of service : `https://funesterie.me/terms/`
- Authorized domain : `funesterie.me`
- User support email : `funeste38@gmail.com`
- Developer contact email : `funeste38@gmail.com` ou l'adresse d'administration active.

Dans les clients OAuth Web, déclarer exactement les origins et redirects réellement utilisés :

```txt
https://funesterie.me
https://a11.funesterie.me
https://k44.funesterie.me
https://kaen44.funesterie.me
```

```txt
https://funesterie.me/api/auth/google/callback
https://a11.funesterie.me/api/auth/google/callback
https://k44.funesterie.me/api/auth/google/callback
https://kaen44.funesterie.me/api/auth/google/callback
```

Ne pas mélanger avec les callbacks Cloudflare Access :

```txt
https://<team>.cloudflareaccess.com/cdn-cgi/access/callback
```

### Validation Google

Si le client principal ne demande que `openid email profile`, la revue de scopes sensibles ne devrait pas être déclenchée. La revue de marque peut quand même être demandée si l'application est externe et affiche un nom/logo public sur l'écran de consentement.

Si Vivy doit utiliser Drive ou YouTube en production, préparer un dossier séparé avec :

- client OAuth Vivy distinct ;
- scopes minimaux justifiés ;
- vidéo démo non répertoriée montrant le consentement, le nom de l'app, les scopes et l'usage exact ;
- preuve que l'utilisateur initie l'action et que rien n'est publié sans validation.

## Microsoft Entra

### Principe

Le code utilise Microsoft OAuth v2 et Microsoft Graph `me`. Le tenant par défaut côté serveur est `organizations`, sauf configuration explicite par variable d'environnement.

Scopes réellement demandés :

```txt
openid profile email offline_access User.Read
```

`offline_access` est nécessaire seulement si l'application doit obtenir/renouveler des refresh tokens. S'il n'y a pas de besoin de session longue Microsoft, réduire ce scope avant soumission.

### Redirects réellement émis par la prod

Ces routes redirigent vers `login.microsoftonline.com`, avec `response_type=code`, `response_mode=query`, un `state`, et un client ID présent mais non copié ici :

| Surface | Start endpoint | Redirect URI | Scope |
| --- | --- | --- | --- |
| A11 | `https://a11.funesterie.me/api/auth/microsoft/start` | `https://a11.funesterie.me/api/auth/microsoft/callback` | `openid profile email offline_access User.Read` |
| K44 | `https://k44.funesterie.me/api/auth/microsoft/start` | `https://k44.funesterie.me/api/auth/microsoft/callback` | `openid profile email offline_access User.Read` |
| Funesterie | `https://funesterie.me/api/auth/microsoft/start` | `https://funesterie.me/api/auth/microsoft/callback` | `openid profile email offline_access User.Read` |

### Configuration Entra à aligner

Dans Microsoft Entra / App registrations :

- Name : `Alphaonze / A11 Funesterie` ou nom public cohérent.
- Supported account types : à décider selon cible réelle.
  - `Accounts in any organizational directory` si on reste sur le tenant `organizations`.
  - `Accounts in any organizational directory and personal Microsoft accounts` seulement si le code et le tenant passent à `common` et que les comptes personnels sont testés.
- Redirect URIs Web :

```txt
https://funesterie.me/api/auth/microsoft/callback
https://a11.funesterie.me/api/auth/microsoft/callback
https://k44.funesterie.me/api/auth/microsoft/callback
https://kaen44.funesterie.me/api/auth/microsoft/callback
```

- Terms of service URL : `https://funesterie.me/terms/`
- Privacy statement URL : `https://funesterie.me/privacy/`
- Support URL : `https://funesterie.me/contact/`

Pour la validation publisher, Microsoft demande une identité d'éditeur vérifiée via Microsoft AI Cloud Partner Program et un domaine éditeur cohérent ou vérifié DNS. Ce n'est pas un patch code : c'est une étape console/admin.

## Restant manuel

1. Déployer ce patch pour que les URLs légales servent les HTML autonomes en prod.
2. Refaire les probes `privacy/terms` après déploiement et vérifier que le titre HTML est bien légal, pas seulement la coque SPA.
3. Dans Google Console, vérifier que les URLs de marque et de callbacks correspondent exactement aux URLs ci-dessus.
4. Dans Microsoft Entra, vérifier `informationalUrls` et les redirect URIs.
5. Décider si Microsoft doit viser `organizations` ou `common`; ne pas annoncer les comptes personnels tant que ce n'est pas testé.
6. Garder Drive/YouTube hors du client Google principal tant que Vivy media n'a pas son dossier de validation séparé.

## Commandes de vérification sans secret

```powershell
Invoke-WebRequest https://funesterie.me/privacy/ -MaximumRedirection 5
Invoke-WebRequest https://funesterie.me/terms/ -MaximumRedirection 5
Invoke-WebRequest https://a11.funesterie.me/health -MaximumRedirection 5
Invoke-WebRequest https://k44.funesterie.me/health -MaximumRedirection 5
Invoke-WebRequest https://mcp.funesterie.me/health -MaximumRedirection 5
```

Pour les redirects OAuth, inspecter uniquement `redirect_uri`, `scope`, `response_type`, `response_mode`, et la présence de `state` / `client_id`; ne pas copier de secret.
