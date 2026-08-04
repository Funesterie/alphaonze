# Fortress V1 — Procédure de rollback

## Rollback immédiat (désactivation sans redéploiement)

Mettre toutes les variables à `false` dans `.env` et redémarrer le serveur :

```bash
HENRY_ENABLED=false
CERBERE_ENABLED=false
WAF_ENABLED=false
VAULT_ENABLED=false
SECURITY_BUS_ENABLED=false
CANARY_ENABLED=false
SECURITY_AUDIT_ENABLED=false
RAINBOW_ENABLED=false
DOUBLE_DASH_ENABLED=false
```

Le serveur redémarre sans aucun middleware de sécurité. Les routes publiques
légitimes continuent de fonctionner comme avant.

## Rollback du code

```bash
git checkout main   # ou master selon le repo
git branch -D security/fortress-v1
git push origin --delete security/fortress-v1
```

## Points de rollback

- Les modules de sécurité sont purement additifs — les désactiver revient à l'état précédent
- Aucune migration de base de données n'est requise
- Les logs de sécurité (henry-events.jsonl, cerbere-alerts.jsonl) peuvent être conservés
- Les IP bloquées par Cerbère sont en mémoire — un redémarrage les vide
- Les sessions confinées par HENRY sont en mémoire — un redémarrage les vide

## Seuils de rollback automatique

- Si le taux de 403 dépasse 5% des requêtes → rollback
- Si le taux de 429 dépasse 2% des requêtes → rollback
- Si les erreurs OAuth augmentent de plus de 1% → rollback
