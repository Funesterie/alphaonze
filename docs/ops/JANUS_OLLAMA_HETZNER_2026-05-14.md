# Janus / Ollama Hetzner Install - 2026-05-14

Objectif : préparer Janus local pour la couche vision/Qflush sans achat ni secret dans les logs.

Modele installe :

```txt
erwan2/DeepSeek-Janus-Pro-7B:latest
```

## Serveurs

| Serveur | Etat |
| --- | --- |
| `alphaonze-rhdh-01` / `178.105.86.89` | Ollama host actif sur `127.0.0.1:11434`, modele Janus present. |
| `a11-prod-finland-2` / `62.238.43.32` | Ollama via conteneur Docker `a11-ollama` sur `127.0.0.1:11434`, modele Janus present. Service host Ollama desactive pour eviter le conflit de port. |

## Notes importantes

- Aucun GPU NVIDIA/AMD detecte sur les deux serveurs via `nvidia-smi`; fonctionnement CPU-only.
- Le serveur Finlande a plus de RAM et doit etre le candidat principal pour les tests Janus serveur.
- Le petit serveur `alphaonze-rhdh-01` est utilisable comme fallback/validation, pas comme vision temps reel confortable.
- Pas de PayPal, pas de cle Pro, pas de secret ajoute pendant cette operation.

## Commandes de verification

```bash
curl -fsS http://127.0.0.1:11434/api/tags
ollama list
ollama show erwan2/DeepSeek-Janus-Pro-7B
```

## Suite logique

1. Brancher le watcher Janus/Qflush sur un endpoint Ollama local ou distant.
2. Garder `ki_state` en lecture seule pour les agents externes.
3. Garder `ki_play`/inputs uniquement cote agents de confiance.
4. Si une vraie vision faible latence est necessaire, prevoir une machine GPU ou un provider vision dedie.
