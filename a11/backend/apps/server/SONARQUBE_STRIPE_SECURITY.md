# SonarQube - Analyse de sécurité pour l'intégration Stripe

## Vue d'ensemble

Ce document décrit les règles de sécurité SonarQube spécifiques à surveiller pour l'intégration Stripe et les paiements.

## Configuration SonarQube

### Fichiers de configuration

- `sonar-project.properties` - Configuration locale SonarQube
- `.sonarcloud.properties` - Configuration SonarCloud
- `run-sonar-analysis.ps1` - Script d'analyse automatique

### Commandes

```bash
# Analyse locale (sans authentification)
npm run sonar:local

# Analyse distante (avec token)
npm run sonar

# Avec paramètres personnalisés
pwsh -File run-sonar-analysis.ps1 -SonarUrl "https://your-sonar.com" -SonarToken "your-token"
```

## Règles de sécurité critiques

### 1. Hardcoded Credentials (S2068)

**Règle** : Ne jamais coder en dur les clés API, tokens, ou secrets.

**Fichiers à surveiller** :

- `lib/stripe-service.cjs`
- `routes/subscription.cjs`
- `server.cjs`

**Bonne pratique** :

```javascript
// ❌ MAUVAIS
const stripe = new Stripe("STRIPE_TEST_SECRET_VALUE");

// ✅ BON
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
```

### 2. SQL Injection (S3649)

**Règle** : Toujours utiliser des requêtes paramétrées.

**Fichiers à surveiller** :

- `routes/subscription.cjs`
- `middleware/check-subscription.cjs`

**Bonne pratique** :

```javascript
// ❌ MAUVAIS
db.query(`SELECT * FROM users WHERE id = '${userId}'`);

// ✅ BON
db.query("SELECT * FROM users WHERE id = $1", [userId]);
```

### 3. Insecure Random (S2245)

**Règle** : Utiliser `crypto.randomBytes()` pour les tokens sensibles.

**Bonne pratique** :

```javascript
// ❌ MAUVAIS
const token = Math.random().toString(36);

// ✅ BON
const crypto = require("crypto");
const token = crypto.randomBytes(32).toString("hex");
```

### 4. XSS Prevention (S5131)

**Règle** : Valider et échapper toutes les entrées utilisateur.

**Fichiers à surveiller** :

- `routes/subscription.cjs`
- `middleware/check-subscription.cjs`

**Bonne pratique** :

```javascript
// ✅ BON - Validation stricte
if (typeof userId !== "string" || userId.length === 0) {
  return res.status(400).json({ error: "Invalid user ID" });
}
```

### 5. CSRF Protection (S5122)

**Règle** : Protéger les endpoints sensibles contre CSRF.

**Implémentation** :

- Utilisation de JWT pour l'authentification
- Vérification de l'origine des requêtes
- Validation de la signature Stripe sur les webhooks

### 6. Webhook Signature Validation

**Règle critique** : Toujours valider la signature Stripe sur les webhooks.

**Implémentation dans `routes/subscription.cjs`** :

```javascript
const sig = req.headers["stripe-signature"];
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

try {
  event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
} catch (error) {
  return res.status(400).send(`Webhook Error: ${error.message}`);
}
```

## Points de contrôle spécifiques Stripe

### 1. Gestion des clés API

**Vérifications** :

- ✅ Clés stockées dans variables d'environnement
- ✅ Pas de clés en dur dans le code
- ✅ Clés de test vs production séparées
- ✅ Rotation régulière des clés

### 2. Validation des webhooks

**Vérifications** :

- ✅ Signature Stripe validée
- ✅ Événements idempotents (pas de double traitement)
- ✅ Logs des événements reçus
- ✅ Gestion des erreurs

### 3. Sécurité des données utilisateur

**Vérifications** :

- ✅ Pas de stockage de numéros de carte
- ✅ Utilisation de `stripe_customer_id` uniquement
- ✅ Chiffrement des données sensibles en DB
- ✅ Logs sans données sensibles

### 4. Contrôle d'accès

**Vérifications** :

- ✅ JWT requis sur toutes les routes d'abonnement
- ✅ Vérification du rôle utilisateur
- ✅ Admins exemptés de l'abonnement
- ✅ Pas de bypass possible

### 5. Gestion des erreurs

**Vérifications** :

- ✅ Pas de stack traces exposées
- ✅ Messages d'erreur génériques pour l'utilisateur
- ✅ Logs détaillés côté serveur uniquement
- ✅ Codes d'erreur explicites

## Analyse automatique

### Intégration CI/CD

Ajouter dans votre pipeline (GitHub Actions, GitLab CI, etc.) :

```yaml
# .github/workflows/sonar.yml
name: SonarQube Analysis

on:
  push:
    branches: [main, master, develop]
  pull_request:
    branches: [main, master]

jobs:
  sonar:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
        with:
          fetch-depth: 0

      - name: SonarQube Scan
        uses: sonarsource/sonarqube-scan-action@master
        env:
          SONAR_TOKEN: ${{ secrets.SONAR_TOKEN }}
          SONAR_HOST_URL: ${{ secrets.SONAR_HOST_URL }}
```

### Pre-commit Hook

Ajouter dans `.git/hooks/pre-commit` :

```bash
#!/bin/bash
echo "Running SonarQube analysis..."
npm run sonar:local
```

## Métriques de qualité

### Objectifs

- **Security Hotspots** : 0 (critique)
- **Vulnerabilities** : 0 (critique)
- **Bugs** : < 5 (majeur)
- **Code Smells** : < 50 (mineur)
- **Coverage** : > 80% (recommandé)
- **Duplications** : < 3% (recommandé)

### Seuils d'alerte

- **Security Rating** : A (obligatoire)
- **Reliability Rating** : A ou B (acceptable)
- **Maintainability Rating** : A ou B (acceptable)
- **Technical Debt** : < 5% (recommandé)

## Rapports et monitoring

### Tableau de bord SonarQube

Accéder au tableau de bord :

- Local : http://localhost:9000/dashboard?id=a11-backend-server
- Distant : https://your-sonar.com/dashboard?id=a11-backend-server

### Sections à surveiller

1. **Security** :
   - Security Hotspots
   - Vulnerabilities
   - Security Review Rating

2. **Reliability** :
   - Bugs
   - Reliability Rating

3. **Maintainability** :
   - Code Smells
   - Technical Debt
   - Maintainability Rating

4. **Coverage** :
   - Line Coverage
   - Branch Coverage
   - Uncovered Lines

## Actions correctives

### Priorités

1. **Critique** : Corriger immédiatement
   - Security Hotspots
   - Vulnerabilities
   - Bugs critiques

2. **Haute** : Corriger avant déploiement
   - Bugs majeurs
   - Code Smells critiques
   - Duplications importantes

3. **Moyenne** : Corriger dans le sprint
   - Code Smells majeurs
   - Complexité cognitive élevée
   - Duplications mineures

4. **Basse** : Corriger progressivement
   - Code Smells mineurs
   - Optimisations de performance
   - Améliorations de lisibilité

## Checklist de sécurité Stripe

Avant chaque déploiement, vérifier :

- [ ] Analyse SonarQube exécutée
- [ ] 0 Security Hotspots
- [ ] 0 Vulnerabilities
- [ ] Security Rating = A
- [ ] Clés Stripe en variables d'environnement
- [ ] Webhook signature validée
- [ ] Tests de sécurité passés
- [ ] Logs sans données sensibles
- [ ] Contrôle d'accès vérifié
- [ ] Gestion des erreurs sécurisée

## Ressources

- [SonarQube Documentation](https://docs.sonarqube.org/)
- [Stripe Security Best Practices](https://stripe.com/docs/security)
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Node.js Security Checklist](https://github.com/goldbergyoni/nodebestpractices#6-security-best-practices)

## Support

Pour toute question sur l'analyse SonarQube :

- Documentation : `SONARQUBE_STRIPE_SECURITY.md` (ce fichier)
- Logs : Rechercher `[Sonar]` dans les logs
- Issues : Créer un ticket avec le tag `security`
