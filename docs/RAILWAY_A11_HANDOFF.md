# Railway A11 Handoff

Date: 2026-05-22

## Etat verifie

- Railway CLI: installe et authentifie.
- Workspace: `Djeff's Projects`.
- Projet: `awake-gratitude`.
- Environnement: `production`.
- Service web utilise: `function-bun` recycle comme backend A11 pour eviter un service payant supplementaire.
- Dernier deploy A11: `1a1a6d28-dbfd-41aa-98c5-7aa8bba18f0f`.
- URL Railway: `https://function-bun-production-2aebd.up.railway.app`.
- Services Railway existants: `Postgres`, `Postgres-lE4W`, `MySQL`, `MongoDB`, `Redis`, `Redis-anZf`, `function-bun`.

`function-bun` etait un service template/placeholder. Il a ete remplace par A11 apres autorisation explicite le 2026-05-22.

## Railway A11

- `GET /health`: OK.
- `GET /api/health`: OK.
- `GET /api/status`: OK.
- `GET /`: sert l'UI embarquee A11.
- `GET /mcp`: OK.
- `GET /api/auth/google/start`: redirige vers Google, plus de `google_auth_not_configured`.
- `GET /api/auth/microsoft/start`: redirige vers Microsoft, plus de `microsoft_auth_not_configured`.
- Variables configurees sans sortie de secrets: OAuth Google, OAuth Microsoft, Google/Vivy API, Stripe, JWT, database Railway.
- Derniere verification apres deploy: 0 erreur 5xx, service `SUCCESS`, instance `RUNNING`.
- Le sommeil d'application Railway est actif pour le service web A11, ce qui limite les couts quand il dort.
- OAuth provider tokens: table Postgres `oauth_connection_tokens`, chiffree AES-256-GCM via `A11_OAUTH_TOKEN_ENCRYPTION_KEY`.
- MCP public: relay amont `https://mcp.funesterie.me/mcp` connecte, token present cote serveur, sans exposition publique.
- Nouveaux outils agents publics: `a11_agent_context`, `a11_neo4j_public_contract`.
- Neo4j public guard: `neo4j_status` OK; `neo4j_read_query` est masque/bloque en anonyme tant que `A11_PUBLIC_NEO4J_READ_QUERY_ANON` n'est pas active.

Le client OAuth Google est autorise pour `https://a11.funesterie.me`, pas pour le domaine Railway genere. Pour un login complet sans erreur de callback, il faut utiliser `a11.funesterie.me` comme domaine public du service ou ajouter le domaine Railway dans Google/Entra.

La preparation du custom domain `a11.funesterie.me` cote Railway a ete tentee, mais la CLI a renvoye `Unauthorized` sur cette operation precise. Le domaine Railway genere reste actif et valide.

## Local A11

- Backend local: `http://127.0.0.1:3000/health` OK.
- Frontend local: `http://127.0.0.1:5173/` OK.
- UI embarquee backend local: OK apres build web et copie/montage du dossier `frontend/apps/web/dist`.
- Stripe: variables de base presentes dans le conteneur local.
- Google/Microsoft OAuth: routes locales configurees, redirection OAuth OK sans afficher de secrets.

## Commandes sures

Verifier sans afficher de secrets:

```powershell
npm --prefix D:\projets\funesterie-google-artifact-registry\a11 run docker:health -- --Json
npm --prefix D:\projets\funesterie-google-artifact-registry\a11 run redhat:health -- --Json
railway service list --json
railway service status --service function-bun --environment production --json
railway metrics --all --since 1h --json
```

Reconstruire le frontend local avant compose:

```powershell
npm --prefix D:\projets\funesterie-google-artifact-registry\a11 run build:frontend
```

## Suite recommandee

1. Decider si `a11.funesterie.me` doit basculer vers Railway.
2. Si oui, ajouter/valider le custom domain Railway puis changer le DNS Cloudflare.
3. Si non, ajouter `https://function-bun-production-2aebd.up.railway.app/api/auth/*/callback` dans Google/Entra.
4. Re-tester un login complet Google et Microsoft avec callback.
5. Pour un Neo4j vraiment public en lecture brute, creer une Aura publique separee, y synchroniser seulement les noeuds `visibility='public' AND canExpose=true AND privacy='public'`, puis seulement activer `A11_PUBLIC_NEO4J_READ_QUERY_ANON=true`.

Le service web Railway est maintenant actif et facture de l'usage tant qu'il tourne. Surveiller Billing/Usage Railway et activer le sommeil d'application dans l'UI si on veut limiter les couts hors tests.

Les autres bases Railway existaient deja avant ce deploy. Ne pas supprimer ni stopper `MySQL`, `MongoDB`, `Redis`, `Redis-anZf` ou `Postgres-lE4W` sans verifier leur usage ou faire un export rapide.
