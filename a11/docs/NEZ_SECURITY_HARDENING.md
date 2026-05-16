# NEZ Security Hardening

Date: 2026-05-09

Objectif: garder le confort local, mais empecher qu'une route sensible soit accessible depuis Internet par erreur.

## Etat applique

- `NEZ_SECURITY_MODE=strict` dans le profil online.
- `NEZ_ALLOW_LOCAL_BYPASS=false` dans le profil online.
- `PUBLIC_API_URL=https://a11.funesterie.pro` dans le profil online.
- CORS online limite aux domaines HTTPS publics A11, Kaen44 et API.
- Le middleware NEZ ne fait plus confiance a `x-forwarded-for` par defaut.
- Les routes dangereuses sont bloquees au niveau Caddy avant d'arriver au backend.

## Routes bloquees au proxy

```txt
/api/v1/vs/*
/api/v1/fs/*
/api/admin/*
/api/tools/run
/api/browse*
/api/agent/shell*
/api/runtime*
```

Principe: meme avec un token valide, ces routes ne doivent pas etre exposees publiquement. Si une action admin est necessaire, elle passe par un canal local, un VPN, ou un outil MCP explicitement whitelist.

## Fichiers Caddy

```txt
D:\projets\funesterie\a11\deploy\caddy\a11.funesterie.pro.Caddyfile
D:\projets\funesterie\a11\deploy\caddy\kaen44.funesterie.me.Caddyfile
```

Verifier avant reload:

```bash
caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

## Variables recommandees serveur

```env
NODE_ENV=production
NEZ_SECURITY_MODE=strict
NEZ_ALLOW_LOCAL_BYPASS=false
NEZ_TRUST_FORWARD_LOCAL=false
PUBLIC_API_URL=https://a11.funesterie.pro
```

Pour le developpement local uniquement:

```env
NEZ_SECURITY_MODE=dev
NEZ_ALLOW_LOCAL_BYPASS=true
```

## MCP public

Le MCP expose actuellement des outils read-only et `ALLOW_WRITE_ACTIONS=false`. Ne pas activer les actions write/restart/deploy tant que l'auth du connecteur n'est pas en place.

Durcissement suivant:

```env
MCP_REQUIRE_AUTH=true
MCP_AUTH_TOKEN=<secret>
ALLOW_WRITE_ACTIONS=false
```

Si ChatGPT est configure sans auth, ce changement coupera le connecteur. Le faire seulement apres configuration OAuth/token cote connecteur.

## Notes de securite

- Ne jamais stocker de vrai mot de passe ou token dans une doc partagee.
- Les exemples doivent rester generiques.
- Les backups Backblaze B2 doivent exclure `.env`, tokens, cles SSH, certificats et dumps non chiffres.
- Toute action dangereuse doit etre resumee dans le heartbeat avant execution.
