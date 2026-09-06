# Fortress V1 — Déploiement

## Prérequis

- Branche `security/fortress-v1` poussée sur origin
- `STEGO_SALT` défini dans le `.env` du serveur A11 (32+ caractères aléatoires)
- Sauvegarde de l'état actuel avant déploiement

## Procédure

1. **Sauvegarde** — Snapshot de l'état actuel (sessions, OAuth, config)
2. **Feature flags désactivés** — Toutes les variables `*_ENABLED=false` par défaut
3. **Déploiement du code** — `deploy-a11-prod.ps1` ou `a11/ops/deploy-a11-prod-finland-2.ps1 -BlueGreen -ReuseRemoteSecrets`
4. **Activation progressive** :
   - Étape 1 : `VAULT_ENABLED=true` + `SECURITY_AUDIT_ENABLED=true` (lecture seule)
   - Vérifier : 401/403 normaux, pas d'erreur OAuth
   - Étape 2 : `WAF_ENABLED=true` (detection)
   - Vérifier : pas de faux positif, pas de 400 inattendu
   - Étape 3 : `CERBERE_ENABLED=true` (blocage IP)
   - Vérifier : IP légitimes non bloquées
   - Étape 4 : `HENRY_ENABLED=true` (confinement)
   - Vérifier : sessions légitimes non confinées
   - Étape 5 : `SECURITY_BUS_ENABLED=true` + `CANARY_ENABLED=true`
   - Étape 6 : `RAINBOW_ENABLED=true` + `DOUBLE_DASH_ENABLED=true`
5. **Surveillance** — Surveiller les codes 401, 403, 429 et erreurs OAuth
6. **Canary** — Activer sur une seule instance d'abord

## Dashboard

```bash
curl -H "Authorization: Bearer <oauth-token>" https://mcp.funesterie.me/admin/security/status
```

## Vérification post-déploiement

- `GET /admin/security/status` retourne tous les modules
- `GET /admin/security/waf` montre les types de détection
- `GET /admin/security/cerbere` montre 0 IP bloquée (démarrage propre)
- `GET /admin/security/vault` montre les secrets enregistrés (masqués)
