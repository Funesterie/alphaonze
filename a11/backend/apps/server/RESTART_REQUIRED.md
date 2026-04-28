# ⚠️ Redémarrage du Backend Requis

## Problème

L'erreur `sd_disabled` persiste car le backend tourne encore avec l'ancienne configuration.
Le fichier `.env.local` a été mis à jour mais les variables ne sont chargées qu'au démarrage.

## Solution

**Redémarre le backend :**

```powershell
# Depuis funesterie/
pwsh -File .\bootstrap.ps1 local start -NoPause

# Ou directement depuis le dossier server :
cd a11/backend/apps/server
node server.cjs
```

## Ce qui a été activé dans .env.local

```bash
# Images
ENABLE_SD=true                        # ✅ SD activé
A11_ENABLE_OPENAI_IMAGE=true          # ✅ Fallback DALL-E activé
A11_OPENAI_IMAGE_MODEL=dall-e-3       # ✅ Modèle DALL-E 3
A11_IMAGE_PROVIDER_ORDER=sd,openai    # ✅ SD d'abord, OpenAI en fallback
A11_DEV_ALLOW_PLACEHOLDER_PNG=true    # ✅ Placeholder si tout échoue

# Embeddings
A11_ENABLE_EMBEDDINGS=true            # ✅ RAG activé (nécessite nomic-embed-text)

# Autres
A11_ENABLE_DEFINITION_LOOKUP=true     # ✅ Enrichissement contextuel
A11_ALLOW_PUBLIC_TUNNEL_LLM=1         # ✅ Tunnel public LLM autorisé
```

## Cascade de génération d'images

1. **SD local** (si script Python présent) → génère via Stable Diffusion
2. **OpenAI DALL-E** (si OPENAI_API_KEY configurée) → génère via DALL-E 3
3. **Placeholder PNG** (toujours en dev) → génère un SVG placeholder

## Pour activer DALL-E (optionnel)

Ajoute ta clé OpenAI dans `.env.local` :

```bash
OPENAI_API_KEY=sk-...
```

Sans clé OpenAI, le placeholder PNG sera utilisé automatiquement.
