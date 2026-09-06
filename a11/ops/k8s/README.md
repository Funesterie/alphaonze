# Kubernetes — scaffold Funesterie (a11 backend)

> **Statut : point de départ, PAS une migration live.** Le stack de prod tourne
> aujourd'hui en **docker-compose blue/green** sur EX44 (Hetzner) et marche bien.
> Ces manifests posent la *fondation* k8s pour le service HTTP `a11-backend` sans
> toucher à la prod. Une migration complète est un projet à part (voir « Périmètre »).

## Ce qui est couvert ici
- `00-namespace.yaml` — namespace `funesterie`.
- `10-a11-backend-configmap.yaml` — env **non secret** (ports, URLs, flags).
- `11-a11-backend-secret.example.yaml` — **gabarit** de secrets (aucune valeur réelle ; à remplir via sealed-secrets / External Secrets / SOPS, jamais en clair dans git).
- `20-a11-backend-deployment.yaml` — Deployment du backend (port 3000, probes `/health`, PVC `runtime`).
- `21-a11-backend-service.yaml` — Service ClusterIP.
- `30-a11-backend-ingress.yaml` — Ingress TLS (à adapter à ton ingress controller).

## Périmètre — ce qui N'EST PAS (encore) couvert
Ces services du compose demandent chacun une vraie décision d'archi avant tout k8s :
- **postgres / redis** — stateful : StatefulSet + PVC + backups, ou managé.
- **ollama / xtts-rvc / whisper** — **GPU** : node pool GPU + device plugin NVIDIA.
- **caddy** — remplacé par un Ingress controller (nginx/traefik) + cert-manager.
- **workers** (twitch, social, MCP, agent-dialogue) — Deployments séparés.
- **secrets** — aujourd'hui fichiers montés ; en k8s → Secrets + External Secrets/SOPS.
- **blue/green** — remplacé par les rollouts natifs (`kubectl rollout`) ou Argo Rollouts.

## Réalité single-box
Sur **un seul serveur**, un cluster complet (control plane + GPU + stateful) apporte
surtout de la complexité. Si l'objectif est k8s sur cette box, viser **k3s** (léger)
et migrer service par service, en gardant docker-compose comme prod tant que k3s n'est
pas validé. Le vrai gain k8s vient avec **plusieurs nodes** (scaling, HA).

## Appliquer (sur un cluster/k3s de test, PAS la prod)
```bash
# 1) construire + pousser l'image dans un registre
#    (voir a11/backend/apps/server/DOCKER_HUB_PUSH.md)
# 2) créer le namespace + les configs
kubectl apply -f 00-namespace.yaml
kubectl apply -f 10-a11-backend-configmap.yaml
kubectl apply -f 11-a11-backend-secret.example.yaml   # après l'avoir rempli hors git
kubectl apply -f 20-a11-backend-deployment.yaml
kubectl apply -f 21-a11-backend-service.yaml
kubectl apply -f 30-a11-backend-ingress.yaml
kubectl -n funesterie rollout status deploy/a11-backend
```

## Recommandation
Ne pas basculer la prod tant que : (1) l'image est dans un registre versionné,
(2) postgres a une stratégie stateful + backups validée, (3) les secrets passent par
un gestionnaire (pas de clair), (4) un k3s de staging a fait tourner le backend + workers
sans régression. D'ici là, le **blue/green docker-compose reste la prod**.
