# AlphaOnze Public

Reverse proxy local pour servir A11 sur `alphaonze.funesterie.pro` sans Railway.

Le serveur AlphaOnze standalone retombe maintenant sur `127.0.0.1:8088` par defaut. L'exposition publique doit passer par Caddy uniquement.

## Demarrer

Le backend A11 doit ecouter localement sur `127.0.0.1:3000`, puis Caddy expose uniquement `80/443`.

```bat
start-alphaonze-caddy.bat
```

## Freebox

Ne pas exposer l'administration Freebox OS pour ce site.

Dans Freebox OS, utiliser deux redirections de port:

- Protocole: TCP
- IP destination: IP locale du PC qui lance ce serveur
- Port externe: 80, port interne: 80
- Port externe: 443, port interne: 443

Ne pas exposer directement `3000` ni `8088`.

Depuis `a11`, tu peux reappliquer le hardening Windows local-first puis sortir un rapport avec:

```powershell
powershell -ExecutionPolicy Bypass -File launchers\harden-local-network.ps1
```

Le script `freebox-port-forward.ps1` peut creer une redirection Freebox via l'API locale apres validation sur l'ecran de la Freebox. Il refuse d'ecraser une regle existante qui ne pointe pas vers la meme cible.

```powershell
.\freebox-port-forward.ps1 -LanIp 192.168.1.2 -WanPort 80 -LanPort 80 -Comment "AlphaOnze HTTP"
.\freebox-port-forward.ps1 -LanIp 192.168.1.2 -WanPort 443 -LanPort 443 -Comment "AlphaOnze HTTPS"
```

## HTTPS

Caddy est configure avec `Caddyfile` pour servir `alphaonze.funesterie.pro` en HTTPS et renvoyer vers A11.

Etat actuel: acces public actif via Freebox `80/443 -> 192.168.1.2:80/443`, puis Caddy `alphaonze.funesterie.pro -> 127.0.0.1:3000`.

Pour ce mode, il faut:

- DNS: `alphaonze.funesterie.pro` en `A` vers l'IPv4 publique
- Freebox: TCP port externe 80 vers `192.168.1.2:80`
- Freebox: TCP port externe 443 vers `192.168.1.2:443`
- Freebox OS: acces distant desactive, ping WAN desactive, nouvelles demandes de token desactivees
- Windows: aucun portproxy `80 -> 8088`
- Lancer `start-alphaonze-caddy.bat`
