# Thousand Shiny

Thousand Shiny est le dock local Funesterie pour faire tourner les briques utiles sans dependre de Docker Business.

L'objectif n'est pas de remplacer Docker Inc. C'est un cockpit technique simple autour de Podman/Docker Engine :

- A11 backend en image locale/publiee.
- A11 voice module pour la synthese vocale locale.
- pgvector pour la memoire relationnelle/vectorielle.
- Neo4j local en miroir/cache optionnel, Aura restant la memoire principale.
- MCP local, MCP Aura et tunnel cloudflared.
- Redis et Ollama comme briques optionnelles quand elles deviennent utiles.

## Commandes

```powershell
npm --prefix D:\projets\funesterie-google-artifact-registry\a11 run shiny:plan
npm --prefix D:\projets\funesterie-google-artifact-registry\a11 run shiny:health
npm --prefix D:\projets\funesterie-google-artifact-registry\a11 run redhat:health
npm --prefix D:\projets\funesterie-google-artifact-registry\a11 run shiny:repair-dns
```

Le compose est volontairement un manifeste lisible avant d'etre une commande de prod :

```powershell
npm --prefix D:\projets\funesterie-google-artifact-registry\a11 run shiny:compose-path
```

## Regles

- Aucun secret dans Git.
- Aucun volume supprime par les scripts.
- Podman est le moteur stable actuel.
- Docker Desktop peut revenir plus tard si son backend cesse de planter.
- Docker Business n'est pas necessaire pour ce dock local.

## Red Hat

Le token Red Hat offline peut etre stocke localement via DPAPI si disponible :

```text
%USERPROFILE%\.funesterie\secrets\redhat-offline-token.dpapi.txt
```

Le check `redhat:health` verifie :

- l'echange offline token -> access token ;
- l'etat Simple Content Access ;
- l'etat du login local `registry.redhat.io`.

Important : Simple Content Access et login registry sont deux sujets differents. SCA peut etre actif, mais `registry.redhat.io` demande encore un Red Hat Registry Service Account pour `podman login`.

## DNS WSL

Si Podman sait parler au moteur mais ne resout plus `registry.redhat.io` ou `registry-1.docker.io`, utiliser d'abord le dry-run :

```powershell
npm --prefix D:\projets\funesterie-google-artifact-registry\a11 run shiny:repair-dns -- -DryRun
```

Le script ne supprime rien. Il sauvegarde `/etc/resolv.conf`, puis pointe la distro WSL Podman vers un DNS WSL detecte automatiquement, ou vers `-Nameserver` si fourni.

## Premier cap

Thousand Shiny commence comme un dock sobre : il donne les chemins, les checks, les images et les volumes. Ensuite on branche les modules Funesterie un par un, avec backup avant toute operation risquee.
