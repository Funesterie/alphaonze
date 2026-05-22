# Funesterie Container Dock

Couche locale pour connecter A11, Kaen44, Railway et Docker Hub sans dependre d'un seul moteur.

Le choix du moteur est automatique :

- Docker Desktop si son daemon repond.
- Podman sinon, qui est actuellement le chemin le plus stable sur cette machine.

Les secrets ne sont jamais ecrits dans le repo. Le login Docker Hub lit `DOCKERHUB_TOKEN` ou le fichier local `C:\Users\Djeff\Desktop\docker.txt`.

Le nom d'equipage pour cette couche est **Thousand Shiny** : le dock qui assemble A11, voice, pgvector, Neo4j local, MCP, cloudflared et les futures briques optionnelles sans forcer Docker Business.

## Commandes

```powershell
npm --prefix D:\projets\funesterie-google-artifact-registry\a11 run docker:health
npm --prefix D:\projets\funesterie-google-artifact-registry\a11 run docker:login
npm --prefix D:\projets\funesterie-google-artifact-registry\a11 run docker:build:a11
npm --prefix D:\projets\funesterie-google-artifact-registry\a11 run docker:push:a11
npm --prefix D:\projets\funesterie-google-artifact-registry\a11 run redhat:login
npm --prefix D:\projets\funesterie-google-artifact-registry\a11 run redhat:health
npm --prefix D:\projets\funesterie-google-artifact-registry\a11 run shiny:plan
npm --prefix D:\projets\funesterie-google-artifact-registry\a11 run shiny:health
npm --prefix D:\projets\funesterie-google-artifact-registry\a11 run shiny:repair-dns -- -DryRun
```

Avant un demarrage compose qui doit servir l'interface depuis le backend, reconstruire le web:

```powershell
npm --prefix D:\projets\funesterie-google-artifact-registry\a11 run build:frontend
```

`thousand-shiny.compose.yml` monte ensuite `frontend/apps/web/dist` en lecture seule sur `/web/dist`.

## Images

Image A11 :

```text
funesterie/a11-backend:<timestamp>
funesterie/a11-backend:latest
```

Railway peut continuer a builder depuis le `Dockerfile` du backend. Quand on veut figer une release, on push l'image Docker Hub avec `docker:push:a11`, puis Railway/GitHub peuvent la recuperer comme artefact commun.

Images Google Artifact Registry verifiees le 2026-05-22:

```text
europe-west4-docker.pkg.dev/alphaonze/funesterie-docker/a11-backend:codex-20260522-secfix
europe-west4-docker.pkg.dev/alphaonze/funesterie-docker/a11-voice-module:secfix-20260522
```

## Red Hat

Le token API Red Hat est stocke localement chiffre via DPAPI hors du repo. Il permet de verifier l'access token et l'etat SCA, mais `registry.redhat.io` demande encore un login Customer Portal ou un Registry Service Account pour tirer les images privees Red Hat.

Etat du 2026-05-22:

- SCA: active.
- DNS Podman vers `registry.redhat.io`: corrige.
- Login `registry.redhat.io`: branche avec le Registry Service Account A11 depuis `A11-auth.json`.
- Validation: `podman pull registry.redhat.io/ubi9/ubi-minimal:latest` OK, Docker manifest inspect OK.

## Securite

- Pas de token dans Git.
- Pas de suppression de volumes.
- Pas de `wsl --unregister`.
- `health.ps1` masque les secrets et ne donne que l'etat du moteur, de Docker Hub et de Railway.
- `redhat-health.ps1` verifie SCA et le login `registry.redhat.io` sans afficher de token.
- `repair-wsl-dns.ps1` corrige uniquement le DNS de la distro Podman WSL avec backup de `/etc/resolv.conf`.

Voir aussi [THOUSAND_SHINY.md](./THOUSAND_SHINY.md).
