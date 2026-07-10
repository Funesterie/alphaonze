# Azure / Microsoft Entra — télémétrie + MCP sécurisé

Modules ajoutés (tous **inertes tant que leur env n'est pas rempli** — aucun impact
sur le comportement actuel, aucun secret en git) :

| Module | Rôle | Activé par |
|--------|------|-----------|
| `src/telemetry/otel-bootstrap.cjs` | Traces/logs/métriques → Application Insights (OpenTelemetry) | `APPLICATIONINSIGHTS_CONNECTION_STRING` |
| `src/mcp-oauth/entra-auth.cjs` | Valide un token Entra (issuer/audience/scope) sur le MCP public | `MCP_ISSUER` + `MCP_AUDIENCE` |
| `src/auth/azure-graph-client.cjs` | Token app-only (client credentials) pour Microsoft Graph | `AZURE_TENANT_ID` + `AZURE_CLIENT_ID` + secret |
| `src/azure-startup-diagnostics.cjs` | Log de démarrage **masqué** (IDs tronqués, jamais de secret) | dès qu'un des trois est configuré |

Câblage : `server.cjs` initialise la télémétrie **avant** tout autre module (auto-instrumentation) ;
`public-mcp.cjs` accepte un token Entra **en plus** des tokens statiques / OAuth existants
(l'auth actuelle est inchangée tant que l'Entra n'est pas configuré).

## Règles de sécurité (respectées par le code)
- Jamais de log de secret / connection string / token — uniquement des IDs masqués.
- `AZURE_CLIENT_SECRET` : préférer `AZURE_CLIENT_SECRET_FILE` (fichier secret monté, ex.
  `/app/runtime/secrets/azure_client_secret`, chmod 600) ou Key Vault. Jamais en git/chat.
- Validation stricte : algorithme `RS256` seulement (les tokens `none`/`HS*` sont rejetés),
  issuer + audience + scope vérifiés, allow-lists optionnelles sur `appid` et groupes.
- `DEV_AUTH_BYPASS=1` : dev local uniquement, **ignoré si `NODE_ENV=production`**.

## Activation (dépendance télémétrie)
La télémétrie lazy-require `@azure/monitor-opentelemetry`. Non ajouté au `package.json`
(évite tout risque de build). Pour l'activer côté serveur :
```bash
npm i @azure/monitor-opentelemetry
```
Sans ce paquet, le module log « not installed » et reste inactif — rien ne casse.

## Où placer les valeurs
- **Non secrets** (Tenant ID, Client ID, Subscription ID, Resource Group, audience, scope) :
  variables d'env classiques (`a11.env`).
- **Secrets** (Client Secret VALUE, connection string) : fichier secret monté ou Key Vault.
  Le serveur relit le fichier à chaud (`fs.readFileSync`), pas besoin de rebuild.

## Deux app registrations recommandées
1. `funesterie-mcp-api` — représente l'API MCP ; expose le scope `MCP.Access` ;
   audience `api://<client-id>`. → `MCP_AUDIENCE`, `MCP_SCOPE`.
2. `funesterie-mcp-client` — le worker/serveur qui appelle le MCP ; a un secret/certificat ;
   reçoit la permission vers `funesterie-mcp-api`. → son `appid` va dans `MCP_ALLOWED_CLIENT_IDS`.

Pour Microsoft Graph app-only : `API permissions → Microsoft Graph → Application permissions`,
ajouter le minimum nécessaire, puis **Grant admin consent**.

## Vérifier
```bash
node --check src/telemetry/otel-bootstrap.cjs
node --test test/entra-auth.node.test.cjs
```
Au démarrage, chercher la ligne `[azure] startup diagnostics (masked):`.
