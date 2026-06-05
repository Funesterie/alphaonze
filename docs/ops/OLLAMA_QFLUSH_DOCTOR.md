# Ollama pour Qflush et Doctor

Objectif: avoir un LLM local pour les diagnostics, la synthese de logs, la vision faible cout et les brouillons Qflush/Doctor, sans exposer de port public et sans remplir `C:/`.

## Stockage

Par defaut les modeles sont stockes ici:

```text
E:/Funesterie/ollama
```

Tu peux changer ce chemin avec `A11_OLLAMA_VOLUME`.

## Demarrage Docker

CPU simple:

```powershell
npm run ollama:up
```

Avec GPU NVIDIA:

```powershell
npm run ollama:up:gpu
```

Arret:

```powershell
npm run ollama:down
```

## Modeles conseilles

Pour commencer leger:

```powershell
docker exec -it a11-ollama ollama pull qwen2.5-coder:7b
docker exec -it a11-ollama ollama pull llama3.2:3b
```

Pour vision ou analyse d'image, utiliser un modele multimodal seulement si la machine a assez de RAM/VRAM.

## Branchement A11

Depuis le PC hote:

```text
OLLAMA_BASE=http://127.0.0.1:11434
A11_OLLAMA_PRIMARY_MODEL=qwen2.5-coder:7b
```

Depuis un conteneur A11 local:

```text
OLLAMA_BASE=http://host.docker.internal:11434
A11_OLLAMA_PRIMARY_MODEL=qwen2.5-coder:7b
```

Pour Qflush/Doctor, garder une file bornee:

```text
OLLAMA_BACKEND_PARALLEL=1
OLLAMA_BACKEND_QUEUE_SIZE=8
OLLAMA_BACKEND_TIMEOUT_MS=120000
```

## Regle importante

Ne pas mettre ce conteneur Ollama dans Render. Le backend web principal reste sur Hetzner/Caddy; Render est seulement un secours API leger. Ollama doit tourner sur une machine locale, Hetzner dedie, ou une machine GPU privee. Qflush/Doctor peuvent ensuite l'appeler via une URL interne ou un tunnel controle.
