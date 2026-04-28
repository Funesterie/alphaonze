# 💰 Stratégie de Tarification A11

## 🎯 Deux Offres Distinctes

### 1. A11 (Le Produit SaaS)

**Modèle** : Freemium + Abonnement

#### Free (Gratuit)

- ✅ Accès à A11
- ✅ Chat illimité
- ✅ 5 générations d'images/jour
- ❌ Pas de génération vidéo
- ❌ Pas de support prioritaire

#### Premium (2,99€/mois)

- ✅ Tout du Free
- ✅ Générations d'images illimitées
- ✅ 10 générations vidéo/jour
- ✅ Support par email
- ✅ Accès aux nouvelles fonctionnalités en avant-première

**Stripe Price ID** : `price_1TQwxHHkqLcMgv548uBa6GDZ`

---

### 2. Blueprint (Le Code Source)

**Modèle** : Paiement unique

#### Blueprint Complet (3000€)

- ✅ Code source complet (backend + frontend)
- ✅ Documentation complète
- ✅ Configuration déploiement
- ✅ Support 30 jours
- ✅ Mises à jour 6 mois
- ✅ Licence commerciale (revente autorisée)

**Stripe Price ID** : À créer avec `create-blueprint-price.cjs`

---

## 📊 Comparaison

| Feature               | Free      | Premium    | Blueprint      |
| --------------------- | --------- | ---------- | -------------- |
| **Prix**              | 0€        | 2,99€/mois | 3000€ (unique) |
| **Accès A11**         | ✅        | ✅         | ✅             |
| **Images**            | 5/jour    | Illimité   | Illimité       |
| **Vidéos**            | ❌        | 10/jour    | Illimité       |
| **Code source**       | ❌        | ❌         | ✅             |
| **Déploiement privé** | ❌        | ❌         | ✅             |
| **White-label**       | ❌        | ❌         | ✅             |
| **Support**           | Community | Email      | Prioritaire    |
| **Revente**           | ❌        | ❌         | ✅             |

---

## 🎯 Cibles

### A11 Free

- **Cible** : Particuliers, étudiants, curieux
- **Objectif** : Acquisition, viralité
- **Conversion** : Vers Premium (2,99€)

### A11 Premium

- **Cible** : Professionnels, créateurs de contenu
- **Objectif** : Revenus récurrents
- **Conversion** : Fidélisation, upsell vers Blueprint

### Blueprint

- **Cible** : Startups, agences, entreprises, développeurs
- **Objectif** : Revenus importants, B2B
- **Conversion** : Support étendu (500€/mois)

---

## 💡 Stratégie de Vente

### A11 (SaaS)

1. **Acquisition** : Free tier généreux
2. **Activation** : Onboarding simple
3. **Rétention** : Fonctionnalités utiles
4. **Revenus** : Upgrade vers Premium
5. **Référence** : Programme de parrainage

### Blueprint (B2B)

1. **Awareness** : Documentation publique, démos
2. **Considération** : Cas d'usage, témoignages
3. **Décision** : Appel de vente, démo personnalisée
4. **Achat** : Paiement Stripe, accès GitHub
5. **Support** : Onboarding, formation

---

## 📈 Projections

### A11 SaaS (Objectif 12 mois)

- **Free** : 1000 utilisateurs
- **Premium** : 100 utilisateurs (10% conversion)
- **MRR** : 299€/mois
- **ARR** : 3588€/an

### Blueprint (Objectif 12 mois)

- **Ventes** : 5 blueprints
- **Revenus** : 15 000€
- **Support étendu** : 2 clients × 500€/mois = 1000€/mois
- **Total** : 15 000€ + 12 000€ = 27 000€/an

### Total Année 1

- **SaaS** : 3 588€
- **Blueprint** : 27 000€
- **Total** : 30 588€

---

## 🔧 Implémentation Technique

### A11 Premium (2,99€/mois)

**Backend** : `a11/backend/apps/server/`

- ✅ Routes subscription déjà implémentées
- ✅ Middleware `check-subscription.cjs`
- ✅ Webhook Stripe configuré
- ✅ Stripe Price ID : `price_1TQwxHHkqLcMgv548uBa6GDZ`

**Frontend** : `a11/frontend/apps/web/`

- ✅ `SubscriptionPanel.tsx` déjà implémenté
- ✅ API calls vers `/api/subscription/*`
- ✅ Gestion des états (non-abonné, abonné, admin)

### Blueprint (3000€ unique)

**À Créer** :

1. Produit Stripe (paiement unique)
2. Lien de paiement Stripe
3. Webhook `/api/blueprint/webhook`
4. Automatisation email + GitHub invite
5. Page de vente `BLUEPRINT_PRICING.md`

**Script** : `create-blueprint-price.cjs`

---

## 📝 TODO

### A11 SaaS

- [x] Intégration Stripe
- [x] Routes subscription
- [x] Frontend subscription panel
- [x] Webhook handling
- [ ] Limites Free tier (5 images/jour)
- [ ] Compteur générations
- [ ] Email confirmation abonnement
- [ ] Programme de parrainage

### Blueprint

- [ ] Créer produit Stripe (3000€)
- [ ] Créer lien de paiement
- [ ] Page de vente professionnelle
- [ ] Webhook blueprint
- [ ] Automatisation GitHub invite
- [ ] Email template achat
- [ ] Documentation acheteur
- [ ] Support Discord privé

---

## 🎯 Prochaines Étapes

1. **Créer le produit Blueprint sur Stripe**

   ```bash
   node create-blueprint-price.cjs
   ```

2. **Créer le lien de paiement**
   - Dashboard Stripe → Payment Links → Create
   - Sélectionner le produit Blueprint
   - Configurer redirection après paiement

3. **Implémenter le webhook Blueprint**
   - Route `/api/blueprint/webhook`
   - Détecter `checkout.session.completed`
   - Envoyer email avec accès GitHub

4. **Créer la page de vente**
   - Héberger `BLUEPRINT_PRICING.md` sur le site
   - Ajouter témoignages
   - Ajouter FAQ
   - Ajouter CTA vers lien Stripe

5. **Marketing**
   - Annoncer sur Twitter/LinkedIn
   - Post sur Reddit (r/SideProject, r/EntrepreneurRideAlong)
   - Article de blog technique
   - Vidéo démo YouTube

---

**Prêt à lancer les deux offres !** 🚀
