# Changelog - Multi-LLM & Publicités

## Date : 28 avril 2026

### ✅ Tâche 1 : Intégration des publicités dans l'interface

**Fichiers modifiés :**

- `a11/frontend/apps/web/src/App.tsx`
- `a11/frontend/apps/web/src/components/AdBanner.tsx` (déjà créé)

**Changements :**

- Import du composant `AdBanner` dans `App.tsx`
- Intégration de `AdBanner` juste avant le footer (position bottom)
- Affichage uniquement sur desktop (pas en mode compact)
- Rotation automatique entre 2 publicités :
  1. **Blueprint A11** (8000€) - gradient violet, badge "🔥 HOT"
  2. **Premium A11** (2,99€/mois) - gradient rose
- Rotation toutes les 10 secondes
- Liens cliquables :
  - Blueprint → `mailto:djeff@funesterie.pro`
  - Premium → `/subscription`

**Test :**

```bash
cd a11/frontend/apps/web
npm run build
# ✅ Build réussi sans erreurs TypeScript
```

---

### ✅ Tâche 2 : Configuration Multi-LLM avec Groq et DeepSeek

**Fichiers modifiés :**

- `a11/backend/apps/server/llm-router.cjs`
- `a11/backend/apps/server/.env.online`
- `a11/backend/apps/server/render.yaml`

**Fichiers créés :**

- `a11/backend/apps/server/MULTI_LLM_SETUP.md` (documentation complète)

**Changements dans `llm-router.cjs` :**

1. **Ajout des backends Groq et DeepSeek :**

```javascript
const BACKENDS = {
  openai: "https://api.openai.com/v1",
  ollama: "http://127.0.0.1:11434",
  llama_server: "",
  groq: "https://api.groq.com/openai/v1", // ✅ NOUVEAU
  deepseek: "https://api.deepseek.com/v1", // ✅ NOUVEAU
};
```

2. **Ajout des modèles par défaut :**

```javascript
const DEFAULT_GROQ_MODEL = "llama-3.3-70b-versatile";
const DEFAULT_DEEPSEEK_MODEL = "deepseek-chat";
```

3. **Nouvelles fonctions de résolution :**

```javascript
function resolveGroqTarget(requestedModel, reason)
function resolveDeepSeekTarget(requestedModel, reason)
```

4. **Cascade de fallback améliorée :**

```
Primary: Ollama (local)
  ↓ (si échec)
Fallback 1: llama-server (si configuré)
  ↓ (si échec)
Fallback 2: Groq (ultra rapide, gratuit)
  ↓ (si échec)
Fallback 3: DeepSeek (bon pour le code, pas cher)
  ↓ (si échec)
Fallback 4: OpenAI (fiable, payant)
```

5. **Support des API keys dans les headers :**

```javascript
function buildUpstreamHeaders(backendBase, provider) {
  // Supporte maintenant : openai, groq, deepseek
}
```

**Changements dans `.env.online` :**

```bash
# LLM Cloud Fallbacks (optionnel)
# GROQ_API_KEY=your_groq_api_key_here
# GROQ_MODEL=llama-3.3-70b-versatile
# DEEPSEEK_API_KEY=your_deepseek_api_key_here
# DEEPSEEK_MODEL=deepseek-chat
```

**Changements dans `render.yaml` :**

```yaml
# LLM Fallbacks (optionnel)
- key: A11_LLM_FALLBACK_PROVIDER
  value: groq # groq, deepseek, openai, ou none
- key: GROQ_API_KEY
  sync: false
- key: GROQ_MODEL
  value: llama-3.3-70b-versatile
- key: DEEPSEEK_API_KEY
  sync: false
- key: DEEPSEEK_MODEL
  value: deepseek-chat
```

---

## Stratégies de Déploiement

### Stratégie Recommandée (Production Render)

```bash
A11_LLM_PROVIDER=openai
A11_LLM_FALLBACK_PROVIDER=groq
# OPENAI_API_KEY is configured via the deployment secret store.
# GROQ_API_KEY is configured via the deployment secret store.
```

**Avantages :**

- ✅ OpenAI (primary) : fiable, excellente qualité
- ✅ Groq (fallback) : ultra rapide (500+ tokens/s), gratuit
- ✅ Coût maîtrisé : ~$10-20/mois pour usage modéré
- ✅ Haute disponibilité : 2 providers indépendants

### Obtenir les API Keys

**Groq (Gratuit) :**

1. https://console.groq.com/
2. Créer une clé : https://console.groq.com/keys
3. Copier la clé (commence par `gsk_`)

**DeepSeek (Payant, pas cher) :**

1. https://platform.deepseek.com/
2. Créer une clé : https://platform.deepseek.com/api_keys
3. Copier la clé (commence par `sk-`)

---

## Tests à Effectuer

### Frontend

```bash
cd a11/frontend/apps/web
npm run dev
# Vérifier que les publicités s'affichent en bas de page
# Vérifier la rotation toutes les 10 secondes
# Vérifier les liens cliquables
```

### Backend

```bash
cd a11/backend/apps/server
node server.cjs
# Vérifier les logs :
# [Cerbère] Backends configurés: {...}
# [Cerbère] LLM provider=openai primary=gpt-4o-mini fallback=groq
```

### API de monitoring

```bash
curl http://localhost:3000/api/llm/active
# Doit retourner le provider actif et la config
```

---

## Déploiement sur Render

1. **Commit et push :**

```bash
git add .
git commit -m "feat(a11): add multi-LLM support (Groq, DeepSeek) + ad banners"
git push origin master
```

2. **Configurer les API keys sur Render :**
   - Dashboard : https://dashboard.render.com/
   - Service : `a11-backend`
   - Environment → Add Environment Variable :
     - `GROQ_API_KEY` : `gsk_...`
     - `DEEPSEEK_API_KEY` : `sk_...` (optionnel)

3. **Redéployer :**
   - Render détecte automatiquement le push
   - Ou forcer : "Manual Deploy" → "Deploy latest commit"

4. **Vérifier :**

```bash
curl https://a11-backend.onrender.com/api/llm/active
```

---

## Documentation

Voir `a11/backend/apps/server/MULTI_LLM_SETUP.md` pour :

- Configuration détaillée
- Stratégies de fallback
- Coûts estimés
- Monitoring
- Troubleshooting

---

## Résumé des Changements

### Frontend

- ✅ Publicités intégrées (Blueprint 8000€ + Premium 2,99€/mois)
- ✅ Rotation automatique toutes les 10 secondes
- ✅ Design responsive avec hover effects
- ✅ Build réussi sans erreurs

### Backend

- ✅ Support Groq (llama-3.3-70b-versatile)
- ✅ Support DeepSeek (deepseek-chat)
- ✅ Cascade de fallback intelligente (4 niveaux)
- ✅ Configuration flexible via variables d'environnement
- ✅ Monitoring via `/api/llm/active`
- ✅ Documentation complète

### Déploiement

- ✅ `render.yaml` mis à jour avec les nouveaux providers
- ✅ Variables d'environnement documentées
- ✅ Prêt pour déploiement sur Render

---

## Prochaines Étapes

1. **Obtenir les API keys** :
   - Groq : https://console.groq.com/keys
   - DeepSeek (optionnel) : https://platform.deepseek.com/api_keys

2. **Configurer Render** :
   - Ajouter `GROQ_API_KEY` dans les variables d'environnement
   - Ajouter `DEEPSEEK_API_KEY` (optionnel)

3. **Déployer** :
   - Commit + push
   - Vérifier le déploiement sur Render

4. **Tester** :
   - Vérifier les publicités sur https://alphaonze.funesterie.pro
   - Vérifier le fallback LLM avec `/api/llm/active`

---

**Status : ✅ TERMINÉ**
