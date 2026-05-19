# Funesterie Container Dock

Couche locale pour connecter A11, Kaen44, Railway et Docker Hub sans dependre d'un seul moteur.

Le choix du moteur est automatique :

- Docker Desktop si son daemon repond.
- Podman sinon, qui est actuellement le chemin le plus stable sur cette machine.

Les secrets ne sont jamais ecrits dans le repo. Le login Docker Hub lit `DOCKERHUB_TOKEN` ou le fichier local `C:\Users\Djeff\Desktop\docker.txt`.

## Commandes

```powershell
npm --prefix D:\projets\funesterie\a11 run docker:health
npm --prefix D:\projets\funesterie\a11 run docker:login
npm --prefix D:\projets\funesterie\a11 run docker:build:a11
npm --prefix D:\projets\funesterie\a11 run docker:push:a11
```

## Images

Image A11 :

```text
funesterie/a11-backend:<timestamp>
funesterie/a11-backend:latest
```

Railway peut continuer a builder depuis le `Dockerfile` du backend. Quand on veut figer une release, on push l'image Docker Hub avec `docker:push:a11`, puis Railway/GitHub peuvent la recuperer comme artefact commun.

## Securite

- Pas de token dans Git.
- Pas de suppression de volumes.
- Pas de `wsl --unregister`.
- `health.ps1` masque les secrets et ne donne que l'etat du moteur, de Docker Hub et de Railway.
