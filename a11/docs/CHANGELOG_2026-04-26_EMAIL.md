# Changelog - Configuration Email (Resend)

**Date** : 2026-04-26  
**Priorité** : Moyenne  
**Status** : ✅ Configuré

---

## 🎯 Objectif

Configurer le système d'envoi d'emails d'A11 avec **Resend** pour permettre :

- Envoi d'emails simples
- Envoi de ressources (PDF, images) par email
- Planification d'emails différés
- Pièces jointes multiples

---

## 📧 Configuration Resend

### Token API Ajouté

**Fichier** : `.env.local`

```bash
# Email (Resend)
# RESEND_API_KEY is configured via the deployment secret store.
EMAIL_FROM=A11 <a11@funesterie.pro>
APP_URL=https://alphaonze.funesterie.pro
```

**Variables** :

- `RESEND_API_KEY` : Clé API Resend (obtenue depuis resend.com)
- `EMAIL_FROM` : Adresse d'expéditeur (format : `Nom <email@domain.com>`)
- `APP_URL` : URL de l'application (pour les liens dans les emails)

---

## 🔧 Système Email Existant

Le système email d'A11 était déjà implémenté, il manquait juste la configuration.

### Modules Existants

1. **`lib/email-service.cjs`**
   - Service email avec support Resend + SMTP fallback
   - Gestion des pièces jointes
   - Validation des destinataires

2. **`src/routes/mail.cjs`**
   - POST `/api/mail/send` - Envoi d'email simple
   - POST `/api/mail/schedule` - Planification d'email différé
   - GET `/api/mail/scheduled` - Liste des emails planifiés
   - POST `/api/mail/scheduled/:id/cancel` - Annulation d'email planifié

3. **Outils Agent**
   - `send_email` - Envoi d'email simple
   - `email_resource` - Envoi de ressource par email
   - `email_latest_resource` - Envoi de la dernière ressource
   - `schedule_email` - Planification d'email
   - `schedule_resource_email` - Planification d'envoi de ressource
   - `schedule_latest_resource_email` - Planification d'envoi de dernière ressource

---

## 📦 Dépendances

### Package Resend

**Déjà installé** : `resend@^6.10.0`

Aucune installation supplémentaire nécessaire.

---

## 🧪 Tests

### Test 1 : Vérifier la Configuration

```bash
curl http://localhost:3000/api/status
```

**Résultat attendu** :

```json
{
  "ok": true,
  "features": {
    "hasResend": true,
    ...
  }
}
```

### Test 2 : Envoyer un Email de Test

```bash
# 1. Obtenir un JWT
TOKEN=$(curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"Djeff","password":"1991"}' | jq -r '.token')

# 2. Envoyer un email
curl -X POST http://localhost:3000/api/mail/send \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "to": "cellaurojeffrey@gmail.com",
    "subject": "Test A11",
    "text": "Email de test depuis A11"
  }'
```

**Résultat attendu** :

```json
{
  "ok": true,
  "mail": {
    "id": "abc123",
    "provider": "resend",
    "to": ["cellaurojeffrey@gmail.com"]
  }
}
```

### Test 3 : Planifier un Email

```bash
curl -X POST http://localhost:3000/api/mail/schedule \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "to": "cellaurojeffrey@gmail.com",
    "subject": "Rappel Test",
    "text": "Ceci est un rappel de test.",
    "delaySeconds": 60
  }'
```

**Résultat attendu** :

```json
{
  "ok": true,
  "job": {
    "id": "mail_abc123",
    "kind": "scheduled_email",
    "status": "scheduled",
    "sendAt": "2026-04-26T10:01:00Z"
  }
}
```

---

## 📚 Documentation Créée

### `a11/docs/EMAIL_CONFIGURATION.md`

Documentation complète sur la configuration email.

**Contenu** :

- Configuration Resend (recommandé)
- Configuration SMTP (fallback)
- Utilisation des endpoints API
- Outils agent A11
- Vérification et tests
- Limites (Resend, SMTP)
- Troubleshooting
- Exemples d'utilisation
- Roadmap

---

## 🔒 Sécurité

### Protection Implémentée

- ✅ **Authentification JWT** : Tous les endpoints mail nécessitent un JWT valide
- ✅ **Validation des destinataires** : Vérification du format email
- ✅ **Limite de pièces jointes** : 20 MB max par requête
- ✅ **NEZ Security** : Mode `dev` activé (localhost autorisé, externe nécessite JWT)

### À Implémenter

- ⬜ **Rate limiting** : Limiter le nombre d'emails par utilisateur/heure
- ⬜ **Whitelist de domaines** : Restreindre les domaines autorisés
- ⬜ **Logs d'audit** : Tracer tous les envois d'emails

---

## 📊 Fonctionnalités Email

### Envoi Simple

```bash
POST /api/mail/send
{
  "to": "recipient@example.com",
  "subject": "Test",
  "text": "Hello!",
  "html": "<h1>Hello!</h1>"
}
```

### Envoi avec Pièces Jointes

```bash
POST /api/mail/send
{
  "to": "recipient@example.com",
  "subject": "Document",
  "text": "Voici le document.",
  "attachments": [
    {
      "filename": "doc.pdf",
      "content": "base64...",
      "contentType": "application/pdf"
    }
  ]
}
```

### Planification

```bash
POST /api/mail/schedule
{
  "to": "recipient@example.com",
  "subject": "Rappel",
  "text": "N'oublie pas!",
  "delaySeconds": 3600
}
```

### Envoi de Ressource

```bash
# Via outil agent
{
  "action": "email_resource",
  "resourceId": 42,
  "to": "recipient@example.com"
}
```

---

## 🚀 Déploiement

### Local

1. **Configuration déjà faite** : Token Resend ajouté dans `.env.local`

2. **Redémarrer le backend** :

   ```bash
   cd a11/backend/apps/server
   node server.cjs
   ```

3. **Tester** :
   ```bash
   curl http://localhost:3000/api/status | jq '.features.hasResend'
   # Doit retourner: true
   ```

### Production (Railway)

1. **Ajouter les variables d'environnement** :

   ```bash
   # RESEND_API_KEY is configured via the deployment secret store.
   EMAIL_FROM=A11 <a11@funesterie.pro>
   APP_URL=https://alphaonze.funesterie.pro
   ```

2. **Vérifier le domaine sur Resend** :
   - Aller sur [resend.com/domains](https://resend.com/domains)
   - Ajouter `funesterie.pro`
   - Configurer les DNS (SPF, DKIM, DMARC)
   - Attendre la vérification

3. **Déployer** :
   ```bash
   git push railway master
   ```

---

## 📈 Limites

### Resend (Plan Gratuit)

- **100 emails/jour**
- **1 domaine vérifié**
- **Pièces jointes** : 40 MB max par email

### Recommandation

Pour un usage intensif, passer au plan Pro :

- **50,000 emails/mois**
- **Domaines illimités**
- **Support prioritaire**

---

## ✅ Checklist de Complétion

- [x] Token Resend ajouté dans `.env.local`
- [x] Configuration `EMAIL_FROM` et `APP_URL`
- [x] Documentation `EMAIL_CONFIGURATION.md` créée
- [x] Changelog `CHANGELOG_2026-04-26_EMAIL.md` créé
- [ ] Tests d'envoi d'email
- [ ] Vérification du domaine sur Resend
- [ ] Commit et push

---

## 🚦 Prochaines Étapes

### Priorité A (immédiat)

1. ⬜ Tester l'envoi d'email
2. ⬜ Vérifier le domaine `funesterie.pro` sur Resend
3. ⬜ Commit et push

### Priorité B (court terme)

1. ⬜ Implémenter rate limiting
2. ⬜ Ajouter templates HTML
3. ⬜ Configurer webhooks Resend (bounces, complaints)

### Priorité C (moyen terme)

1. ⬜ Interface frontend pour gérer les emails planifiés
2. ⬜ Tracking d'ouverture
3. ⬜ Statistiques d'envoi

---

## 🎓 Exemples d'Utilisation

### Cas 1 : Envoi de PDF Généré

```javascript
// Agent A11 génère un PDF et l'envoie par email
const pdfResult = await t_generate_pdf({
  content: "Rapport mensuel",
  filename: "rapport.pdf",
});

const emailResult = await t_email_resource({
  resourceId: pdfResult.resourceId,
  to: "client@example.com",
});
```

### Cas 2 : Rappel Automatique

```javascript
// Planifier un rappel dans 24h
const scheduleResult = await t_schedule_email({
  to: "user@example.com",
  subject: "Rappel : Réunion demain",
  message: "N'oubliez pas la réunion de demain à 10h.",
  delaySeconds: 86400,
});
```

### Cas 3 : Email avec Image Générée

```javascript
// Générer une image et l'envoyer
const imageResult = await t_generate_png({
  prompt: "Un paysage de montagne",
});

const emailResult = await t_email_latest_resource({
  to: "user@example.com",
});
```

---

**Auteur** : Funesterie / A11 Team  
**Dernière mise à jour** : 2026-04-26  
**Version** : 1.0.0
