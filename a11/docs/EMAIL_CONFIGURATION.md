# Configuration Email - A11

## Vue d'ensemble

A11 supporte l'envoi d'emails via **Resend** (prioritaire) ou **SMTP** (fallback). Le système de mail permet :

- Envoi d'emails simples
- Envoi de ressources (PDF, images, etc.) par email
- Planification d'emails différés
- Pièces jointes multiples

## Configuration Resend (Recommandé) ✅

### Obtenir une Clé API Resend

1. Créer un compte sur [resend.com](https://resend.com)
2. Aller dans **API Keys**
3. Créer une nouvelle clé API
4. Copier la clé (format : `re_...`)

### Configuration dans `.env.local`

```bash
# Email (Resend)
# RESEND_API_KEY is configured via the deployment secret store.
EMAIL_FROM=A11 <a11@funesterie.me>
APP_URL=https://a11.funesterie.me
```

**Variables** :

- `RESEND_API_KEY` : Clé API Resend (obligatoire)
- `EMAIL_FROM` : Adresse d'expéditeur (format : `Nom <email@domain.com>`)
- `APP_URL` : URL de l'application (pour les liens dans les emails)

**Aliases supportés** :

- `RESEND_API_KEY` = `A11_RESEND_API_KEY` = `RESEND_KEY`
- `EMAIL_FROM` = `A11_EMAIL_FROM` = `MAIL_FROM`
- `APP_URL` = `FRONT_URL` = `A11_APP_URL`

### Vérification du Domaine

Pour utiliser une adresse email personnalisée (ex: `a11@funesterie.me`), il faut :

1. Aller dans **Domains** sur Resend
2. Ajouter votre domaine (`funesterie.me`)
3. Configurer les enregistrements DNS (SPF, DKIM, DMARC)
4. Attendre la vérification (~5 minutes)

**Avant vérification** : Utiliser `onboarding@resend.dev` (par défaut)  
**Après vérification** : Utiliser votre domaine personnalisé

---

## Configuration SMTP (Fallback)

Si Resend n'est pas configuré, A11 utilise SMTP comme fallback.

### Configuration dans `.env.local`

```bash
# Email (SMTP)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
SMTP_SECURE=false
SMTP_REQUIRE_TLS=true
EMAIL_FROM=A11 <your-email@gmail.com>
```

**Variables** :

- `SMTP_HOST` : Serveur SMTP (ex: `smtp.gmail.com`)
- `SMTP_PORT` : Port SMTP (587 pour TLS, 465 pour SSL)
- `SMTP_USER` : Nom d'utilisateur SMTP
- `SMTP_PASS` : Mot de passe SMTP (ou mot de passe d'application)
- `SMTP_SECURE` : `true` pour SSL (port 465), `false` pour TLS (port 587)
- `SMTP_REQUIRE_TLS` : `true` pour forcer TLS
- `EMAIL_FROM` : Adresse d'expéditeur

### Exemple Gmail

1. Activer l'authentification à deux facteurs sur votre compte Google
2. Générer un mot de passe d'application : [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords)
3. Utiliser ce mot de passe dans `SMTP_PASS`

```bash
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=abcd efgh ijkl mnop  # Mot de passe d'application (16 caractères)
SMTP_SECURE=false
SMTP_REQUIRE_TLS=true
EMAIL_FROM=A11 <your-email@gmail.com>
```

### Exemple Outlook/Office 365

```bash
SMTP_HOST=smtp.office365.com
SMTP_PORT=587
SMTP_USER=your-email@outlook.com
SMTP_PASS=your-password
SMTP_SECURE=false
SMTP_REQUIRE_TLS=true
EMAIL_FROM=A11 <your-email@outlook.com>
```

---

## Utilisation

### 1. Envoi d'Email Simple

**API** :

```bash
curl -X POST http://localhost:3000/api/mail/send \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "to": "recipient@example.com",
    "subject": "Test Email",
    "text": "Hello from A11!",
    "html": "<h1>Hello from A11!</h1>"
  }'
```

**Réponse** :

```json
{
  "ok": true,
  "mail": {
    "id": "abc123",
    "provider": "resend",
    "to": ["recipient@example.com"]
  }
}
```

### 2. Envoi avec Pièces Jointes

```bash
curl -X POST http://localhost:3000/api/mail/send \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "to": "recipient@example.com",
    "subject": "Document",
    "text": "Voici le document demandé.",
    "attachments": [
      {
        "filename": "document.pdf",
        "content": "base64-encoded-content",
        "contentType": "application/pdf"
      }
    ]
  }'
```

### 3. Planification d'Email Différé

```bash
curl -X POST http://localhost:3000/api/mail/schedule \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "to": "recipient@example.com",
    "subject": "Rappel",
    "text": "Ceci est un rappel.",
    "delaySeconds": 3600
  }'
```

**Paramètres** :

- `delaySeconds` : Délai en secondes (ex: 3600 = 1 heure)
- `delayMinutes` : Délai en minutes (ex: 60 = 1 heure)
- `sendAt` : Date/heure d'envoi (ISO 8601, ex: `2026-04-27T10:00:00Z`)

**Réponse** :

```json
{
  "ok": true,
  "job": {
    "id": "mail_abc123",
    "kind": "scheduled_email",
    "status": "scheduled",
    "sendAt": "2026-04-26T11:00:00Z",
    "to": ["recipient@example.com"]
  }
}
```

### 4. Lister les Emails Planifiés

```bash
curl -X GET "http://localhost:3000/api/mail/scheduled?status=scheduled" \
  -H "Authorization: Bearer $JWT_TOKEN"
```

### 5. Annuler un Email Planifié

```bash
curl -X POST http://localhost:3000/api/mail/scheduled/mail_abc123/cancel \
  -H "Authorization: Bearer $JWT_TOKEN"
```

---

## Outils Agent A11

A11 peut envoyer des emails via les outils agent :

### `send_email`

Envoie un email simple.

```json
{
  "action": "send_email",
  "to": "recipient@example.com",
  "subject": "Test",
  "message": "Hello!"
}
```

### `email_resource`

Envoie une ressource (PDF, image, etc.) par email.

```json
{
  "action": "email_resource",
  "resourceId": 42,
  "to": "recipient@example.com"
}
```

### `email_latest_resource`

Envoie la dernière ressource créée.

```json
{
  "action": "email_latest_resource",
  "to": "recipient@example.com"
}
```

### `schedule_email`

Planifie un email différé.

```json
{
  "action": "schedule_email",
  "to": "recipient@example.com",
  "subject": "Rappel",
  "message": "N'oublie pas!",
  "delaySeconds": 3600
}
```

---

## Vérification

### 1. Vérifier la Configuration

```bash
curl http://localhost:3000/api/status
```

**Réponse** :

```json
{
  "ok": true,
  "features": {
    "hasResend": true,
    ...
  }
}
```

### 2. Tester l'Envoi

```bash
# Obtenir un JWT
TOKEN=$(curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"Djeff","password":"1991"}' | jq -r '.token')

# Envoyer un email de test
curl -X POST http://localhost:3000/api/mail/send \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "to": "your-email@example.com",
    "subject": "Test A11",
    "text": "Email de test depuis A11"
  }'
```

### 3. Vérifier les Logs

```bash
# Logs du backend
grep "MAIL" logs/a11.log

# Logs Resend (si configuré)
# Aller sur resend.com → Logs
```

---

## Limites

### Resend (Plan Gratuit)

- **100 emails/jour**
- **1 domaine vérifié**
- **Pièces jointes** : 40 MB max par email

### Resend (Plan Payant)

- **50,000 emails/mois** (Pro)
- **Domaines illimités**
- **Pièces jointes** : 40 MB max par email

### SMTP (Gmail)

- **500 emails/jour** (compte gratuit)
- **2,000 emails/jour** (Google Workspace)
- **Pièces jointes** : 25 MB max par email

---

## Troubleshooting

### Erreur "mail_provider_not_configured"

**Cause** : Aucun provider email configuré (ni Resend ni SMTP).

**Solution** :

1. Ajouter `RESEND_API_KEY` dans `.env.local`
2. Ou configurer SMTP (`SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`)
3. Redémarrer le backend

### Erreur "Invalid API key"

**Cause** : Clé API Resend invalide.

**Solution** :

1. Vérifier la clé sur [resend.com/api-keys](https://resend.com/api-keys)
2. Régénérer une nouvelle clé si nécessaire
3. Mettre à jour `RESEND_API_KEY` dans `.env.local`

### Erreur "Domain not verified"

**Cause** : Le domaine de l'adresse `EMAIL_FROM` n'est pas vérifié sur Resend.

**Solution** :

1. Utiliser `onboarding@resend.dev` temporairement
2. Ou vérifier votre domaine sur Resend (DNS records)

### Emails non reçus

**Causes possibles** :

- Email dans les spams
- Domaine non vérifié (Resend)
- Limite quotidienne atteinte
- Adresse email invalide

**Solutions** :

1. Vérifier les spams
2. Vérifier les logs Resend
3. Vérifier la limite quotidienne
4. Tester avec une autre adresse

---

## Sécurité

### Bonnes Pratiques

1. **Ne jamais commit** `RESEND_API_KEY` dans Git
2. **Utiliser des variables d'environnement** pour les secrets
3. **Limiter les destinataires** (validation côté backend)
4. **Rate limiting** sur les endpoints mail
5. **Vérifier l'authentification** (JWT requis)

### Protection Anti-Spam

Le backend A11 implémente :

- ✅ Authentification JWT obligatoire
- ✅ Validation des adresses email
- ✅ Limite de pièces jointes (20 MB par requête)
- ⬜ Rate limiting (à implémenter)

---

## Exemples d'Utilisation

### Envoi de PDF Généré

```javascript
// 1. Générer un PDF
const pdfResult = await t_generate_pdf({
  content: "Contenu du document",
  filename: "document.pdf",
});

// 2. Envoyer par email
const emailResult = await t_email_resource({
  resourceId: pdfResult.resourceId,
  to: "client@example.com",
});
```

### Rappel Automatique

```javascript
// Planifier un rappel dans 24h
const scheduleResult = await t_schedule_email({
  to: "user@example.com",
  subject: "Rappel : Réunion demain",
  message: "N'oubliez pas la réunion de demain à 10h.",
  delaySeconds: 86400, // 24 heures
});
```

### Email avec Image Générée

```javascript
// 1. Générer une image
const imageResult = await t_generate_png({
  prompt: "Un chat orange",
});

// 2. Envoyer par email
const emailResult = await t_email_latest_resource({
  to: "user@example.com",
});
```

---

## Roadmap

### Implémenté ✅

- Envoi d'emails simples
- Pièces jointes multiples
- Planification d'emails différés
- Support Resend + SMTP
- Outils agent

### À Faire ⬜

- Rate limiting sur les endpoints mail
- Templates d'emails HTML
- Tracking d'ouverture (Resend)
- Webhooks Resend (bounces, complaints)
- Interface frontend pour gérer les emails planifiés

---

**Dernière mise à jour** : 2026-04-26  
**Version** : 1.0.0  
**Auteur** : Funesterie / A11 Team
