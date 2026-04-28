# Configuration Multi-LLM pour A11

A11 supporte maintenant plusieurs providers LLM avec un système de fallback intelligent.

## Providers Supportés

### 1. **Ollama** (Local, gratuit)

- **Modèle par défaut** : `gemma4:e4b`
- **Avantages** : Gratuit, privé, rapide pour les petites tâches
- **Inconvénients** : Nécessite installation locale, limité en capacité

### 2. **Groq** (Cloud, gratuit)

- **Modèle par défaut** : `llama-3.3-70b-versatile`
- **Avantages** : Ultra rapide (500+ tokens/s), gratuit, excellent pour les tâches moyennes
- **Inconvénients** : Rate limits sur le plan gratuit
- **API Key** : https://console.groq.com/keys

### 3. **DeepSeek** (Cloud, pas cher)

- **Modèle par défaut** : `deepseek-chat`
- **Avantages** : Excellent pour le code, très bon rapport qualité/prix
- **Inconvénients** : Moins rapide que Groq
- **API Key** : https://platform.deepseek.com/api_keys

### 4. **OpenAI** (Cloud, payant)

- **Modèle par défaut** : `gpt-4o-mini`
- **Avantages** : Très fiable, excellente qualité
- **Inconvénients** : Payant, plus lent que Groq
- **API Key** : https://platform.openai.com/api-keys

## Configuration

### Variables d'environnement

Ajoutez ces variables dans `.env.local` ou `.env.online` :

```bash
# Provider principal (ollama, openai, groq, deepseek)
A11_LLM_PROVIDER=openai

# Provider de fallback (groq, deepseek, openai, none)
A11_LLM_FALLBACK_PROVIDER=groq

# OpenAI
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini

# Groq (optionnel)
GROQ_API_KEY=gsk_...
GROQ_MODEL=llama-3.3-70b-versatile

# DeepSeek (optionnel)
DEEPSEEK_API_KEY=sk-...
DEEPSEEK_MODEL=deepseek-chat

# Ollama (local)
OLLAMA_BASE=http://127.0.0.1:11434
A11_OLLAMA_PRIMARY_MODEL=gemma4:e4b
```

## Stratégies de Fallback

### Stratégie 1 : Production fiable (Render)

```bash
A11_LLM_PROVIDER=openai
A11_LLM_FALLBACK_PROVIDER=groq
OPENAI_API_KEY=sk-...
GROQ_API_KEY=gsk_...
```

- **Primary** : OpenAI (gpt-4o-mini) - fiable, qualité
- **Fallback** : Groq (llama-3.3-70b) - ultra rapide si OpenAI est débordé

### Stratégie 2 : Économique

```bash
A11_LLM_PROVIDER=groq
A11_LLM_FALLBACK_PROVIDER=deepseek
GROQ_API_KEY=gsk_...
DEEPSEEK_API_KEY=sk-...
```

- **Primary** : Groq (gratuit, rapide)
- **Fallback** : DeepSeek (pas cher, bon pour le code)

### Stratégie 3 : Local-first

```bash
A11_LLM_PROVIDER=ollama
A11_LLM_FALLBACK_PROVIDER=groq
OLLAMA_BASE=http://127.0.0.1:11434
GROQ_API_KEY=gsk_...
```

- **Primary** : Ollama (local, gratuit, privé)
- **Fallback** : Groq (cloud, gratuit, rapide)

### Stratégie 4 : Cascade complète

```bash
A11_LLM_PROVIDER=ollama
A11_LLM_FALLBACK_PROVIDER=none
OLLAMA_BASE=http://127.0.0.1:11434
GROQ_API_KEY=gsk_...
DEEPSEEK_API_KEY=sk-...
OPENAI_API_KEY=sk-...
```

- **Primary** : Ollama (local)
- **Fallback 1** : Groq (si clé disponible)
- **Fallback 2** : DeepSeek (si clé disponible)
- **Fallback 3** : OpenAI (si clé disponible)

## Obtenir les API Keys

### Groq (Gratuit)

1. Créer un compte : https://console.groq.com/
2. Aller dans "API Keys" : https://console.groq.com/keys
3. Créer une nouvelle clé
4. Copier la clé (commence par `gsk_`)

### DeepSeek (Payant, pas cher)

1. Créer un compte : https://platform.deepseek.com/
2. Aller dans "API Keys" : https://platform.deepseek.com/api_keys
3. Créer une nouvelle clé
4. Copier la clé (commence par `sk-`)

### OpenAI (Payant)

1. Créer un compte : https://platform.openai.com/
2. Aller dans "API Keys" : https://platform.openai.com/api-keys
3. Créer une nouvelle clé
4. Copier la clé (commence par `sk-`)

## Déploiement sur Render

Le fichier `render.yaml` est déjà configuré avec Groq et DeepSeek comme fallbacks.

Pour activer les fallbacks :

1. Aller dans le dashboard Render : https://dashboard.render.com/
2. Sélectionner le service `a11-backend`
3. Aller dans "Environment"
4. Ajouter les variables :
   - `GROQ_API_KEY` : votre clé Groq
   - `DEEPSEEK_API_KEY` : votre clé DeepSeek (optionnel)
5. Sauvegarder et redéployer

## Monitoring

Pour vérifier quel provider est actif :

```bash
curl https://your-backend.onrender.com/api/llm/active
```

Réponse :

```json
{
  "ok": true,
  "active": {
    "provider": "openai",
    "model": "gpt-4o-mini",
    "baseUrl": "https://api.openai.com/v1",
    "reason": null
  },
  "configured": {
    "provider": "openai",
    "fallbackProvider": "groq"
  }
}
```

## Logs

Les logs montrent quel provider est utilisé :

```
[Cerbère] LLM provider=openai primary=gpt-4o-mini fallback=groq
[LLM] provider=openai model=gpt-4o-mini
```

En cas de fallback :

```
[LLM] A11/Ollama indisponible (ollama_timeout) — activation du fallback Cerbère/Groq
[LLM] fallback=groq (ultra rapide) reason=ollama_timeout
```

## Coûts Estimés

### Groq (Gratuit)

- **Limite** : 30 requêtes/minute, 14,400 requêtes/jour
- **Coût** : $0

### DeepSeek

- **Prix** : ~$0.14 / 1M tokens input, ~$0.28 / 1M tokens output
- **Exemple** : 1000 conversations (500 tokens chacune) = ~$0.07

### OpenAI (gpt-4o-mini)

- **Prix** : $0.15 / 1M tokens input, $0.60 / 1M tokens output
- **Exemple** : 1000 conversations (500 tokens chacune) = ~$0.38

## Recommandation

Pour la production sur Render :

```bash
A11_LLM_PROVIDER=openai
A11_LLM_FALLBACK_PROVIDER=groq
OPENAI_API_KEY=sk-...
GROQ_API_KEY=gsk_...
```

Cette configuration offre :

- ✅ Fiabilité maximale (OpenAI)
- ✅ Fallback ultra rapide et gratuit (Groq)
- ✅ Coût maîtrisé (~$10-20/mois pour usage modéré)
