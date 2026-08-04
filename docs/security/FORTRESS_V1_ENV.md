# Fortress V1 — Variables d'environnement

Toutes les variables sont désactivées par défaut (`false`). Activer individuellement.

## a11mcp/.env

```bash
# Security Fortress (7 modules)
HENRY_ENABLED=false
CERBERE_ENABLED=false
WAF_ENABLED=false
VAULT_ENABLED=false
SECURITY_BUS_ENABLED=false
CANARY_ENABLED=false
SECURITY_AUDIT_ENABLED=false

# Rainbow Route + Double Dash
RAINBOW_ENABLED=false
DOUBLE_DASH_ENABLED=false

# WAF tuning
WAF_MAX_PAYLOAD_BYTES=262144
WAF_MAX_JSON_DEPTH=20
WAF_MAX_HEADER_LENGTH=8192

# Cerbere tuning
CERBERE_AUTO_ESCALATE=true
CERBERE_MAX_IP_BLOCKS=256

# Security Bus tuning
SECURITY_BUS_TTL_MS=3600000
SECURITY_BUS_MAX_MESSAGES=1000

# Canary tuning
CANARY_MAX=500
```

## a11/backend/.env

```bash
# Stéganographie RGBA — sel privé (JAMAIS transmis)
STEGO_SALT=<random-32+chars>
```

## Activation progressive recommandée

1. Vault + Security Audit (lecture seule, pas de blocage)
2. WAF (detection + blocage menaces)
3. Cerbere (blocage IP + révocation)
4. HENRY (confinement)
5. Security Bus + Canary (observation)
6. Rainbow Route + Double Dash (routing)
