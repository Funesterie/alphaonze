# Thousand Shiny

Thousand Shiny est le dock local Funesterie pour faire tourner les briques utiles sans dependre de Docker Business.

L'objectif n'est pas de remplacer Docker Inc. C'est un cockpit technique simple autour de Podman/Docker Engine :

- A11 en image locale/publiee.
- Redis pour les files legeres et le cache.
- Neo4j local en miroir/cache optionnel, Aura restant la memoire principale.
- Ollama en runtime local optionnel pour suivre les modeles locaux.
- MCP/NOSSEN comme routeur de contexte quand la brique est prete.

## Commandes

```powershell
npm --prefix D:\projets\funesterie\a11 run shiny:plan
npm --prefix D:\projets\funesterie\a11 run shiny:health
npm --prefix D:\projets\funesterie\a11 run redhat:health
npm --prefix D:\projets\funesterie\a11 run shiny:repair-dns
```

Le compose est volontairement un manifeste lisible avant d'etre une commande de prod :

```powershell
npm --prefix D:\projets\funesterie\a11 run shiny:compose-path
```

## Regles

- Aucun secret dans Git.
- Aucun volume supprime par les scripts.
- Podman est le moteur stable actuel.
- Docker Desktop peut revenir plus tard si son backend cesse de planter.
- Docker Business n'est pas necessaire pour ce dock local.

## Red Hat

Le token Red Hat offline est stocke localement via DPAPI si disponible :

```text
%USERPROFILE%\.funesterie\secrets\redhat-offline-token.dpapi.txt
```

Le check `redhat:health` verifie :

- l'echange offline token -> access token ;
- l'etat Simple Content Access ;
- l'etat du login local `registry.redhat.io`.

Important : Simple Content Access et login registry sont deux sujets differents. SCA peut etre actif, mais `registry.redhat.io` demande encore un Red Hat Registry Service Account pour `podman login`.

## DNS WSL

Si Podman sait parler au moteur mais ne resout plus `registry.redhat.io` ou `registry-1.docker.io`, utiliser :

```powershell
npm --prefix D:\projets\funesterie\a11 run shiny:repair-dns
```

Le script ne supprime rien. Il sauvegarde `/etc/resolv.conf`, puis pointe la distro `podman-a11-wsl` vers le DNS WSL actif.

## Premier cap

Thousand Shiny commence comme un dock sobre : il donne les chemins, les checks, les images et les volumes. Ensuite on branche les modules Funesterie un par un, avec backup avant toute operation risquee.
