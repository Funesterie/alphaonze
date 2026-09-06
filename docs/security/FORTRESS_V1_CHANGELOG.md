# Fortress V1 — Changelog

## security/fortress-v1 (2026-08-04)

### Modules de sécurité (a11mcp — TypeScript)

- **WAF** (`src/waf.ts`) — Pare-feu applicatif : 9 types de détection (SQL/XSS/cmd/path traversal/SSRF/header/size/depth/MCP protocol). Bloque par défaut, ne modifie jamais le payload.
- **Cerbère** (`src/cerbere.ts`) — Chien de garde : blocage IP avec TTL (5min→24h) et escalade auto, révocation de session, rotation de token, fan-out d'alertes.
- **HENRY** (`src/henry.ts`) — Sas de confinement : 5 patterns d'anomalie, 8 leurres avec canaris, bouton d'urgence unique vers sécurité interne.
- **Vault** (`src/vault.ts`) — Gestion des secrets : auto-register depuis env (17 secrets), masquage, détection de fuite.
- **Security Bus** (`src/security-bus.ts`) — Canal QFlush dédié : 6 canaux (henry/cerbere/waf/canary/vault/audit), hash SHA-256, TTL, priorité.
- **Canary** (`src/canary.ts`) — Canaris traçables : 5 types (url/token/file/endpoint/email), liés à une session.
- **Security Audit** (`src/security-audit.ts`) — Graphe Neo4j : (Session)-[:EMITTED]->(Event), (Session)-[:TRIGGERED]->(Canary), fallback fichier.
- **Rainbow Route** (`src/rainbow-route.ts`) — Route arc-en-ciel : 6 couleurs (rouge=bloqué, orange=confiné, jaune=throtté, vert=normal, bleu=admin, violet=interne).
- **Double Dash** (`src/double-dash.ts`) — Double authentification : Dash 1 (identité externe) + Dash 2 (autorisation interne).

### Modules stéganographiques (a11 backend — CommonJS)

- **RGBA Stego** (`a11/backend/src/dump/rgba-stego.cjs`) — Stéganographie LSB dans les canaux RGBA, format STG1 avec SHA-256.
- **Quinté Key** (`a11/backend/src/dump/quinte-key.cjs`) — Dérivation de clé AES-256 depuis quinté/loterie/euromillions + sel privé.
- **RubixCube** (`a11/backend/src/dump/rubix-cube.cjs`) — Transport stéganographique à rotation : R/G/B = fragments, A = checksum, rotation du cube change les positions logiques.
- **Epoch Sync** (`a11/backend/src/dump/epoch-sync.cjs`) — Synchronisation horaire : seed = époque + événement public (quinté/loterie) + sel Vault, fenêtre de transition 5 min.
- **NEZ Levels** (`a11/backend/src/dump/nez-levels.cjs`) — 10 niveaux d'accès : 1=visiteur → 10=gestionnaire, per-level pipelines + outils MCP.

### Intégration

- Middleware chain dans `server.ts` : WAF → Cerbère → HENRY → Rainbow → Double Dash → NEZ → route handler
- Dashboard unifié : `GET /admin/security/status` (admin-only)
- Endpoints par module : `/admin/security/{waf,cerbere,vault,bus,canary,audit,rainbow,double-dash}`
- 11 flags de config dans `.env` (tous désactivés par défaut)

### Tests

- 19 tests stéganographie : LSB, key derivation, encrypt/decrypt, full pipeline
- 23 tests RubixCube/epoch/NEZ : fragmentation, rotation, niveaux, full fortress pipeline
- Total : 42 tests, 0 échec
