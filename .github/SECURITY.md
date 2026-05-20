# Security Policy

## Supported Versions

| Version         | Supported |
| --------------- | --------- |
| latest (master) | ✅        |

## Reporting a Vulnerability

**Ne pas ouvrir une issue publique pour une faille de sécurité.**

Envoyer un email à : djeff@funesterie.me

Inclure :

- Description de la vulnérabilité
- Étapes pour reproduire
- Impact potentiel
- Suggestion de correction si possible

Réponse sous 48h.

## Secrets & Credentials

Tous les secrets (API keys, tokens, passwords) sont gérés via :

- Variables d'environnement (jamais dans le code)
- GitHub Actions Secrets (pour les workflows CI/CD)
- Render Environment Variables (pour la production)

Les fichiers `.env.local` et `.env` sont dans `.gitignore` et ne doivent jamais être committés.
