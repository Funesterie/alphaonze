# AlphaOnze AFK

Mini-site statique pour servir `afkop.png` sans Netlify ni Cloudflare Worker.

## Demarrer

```bat
start-alphaonze-afk.bat
```

Par defaut le serveur ecoute sur `0.0.0.0:8088`.

## Freebox

Ne pas exposer l'administration Freebox OS pour ce site.

Dans Freebox OS, utiliser une redirection de port:

- Protocole: TCP
- IP destination: IP locale du PC qui lance ce serveur
- Port externe: 80
- Port interne: 80

Sur Windows, `enable-windows-portproxy.ps1` relaie ensuite le port local `80` vers le serveur local `8088`.

```powershell
.\enable-windows-portproxy.ps1
```

Puis remplacer le CNAME actuel de `alphaonze.funesterie.pro` par un enregistrement `A` vers ton IPv4 publique.

Le script `freebox-port-forward.ps1` peut creer une redirection Freebox via l'API locale apres validation sur l'ecran de la Freebox. Il refuse d'ecraser une regle existante qui ne pointe pas vers la meme cible.

```powershell
.\freebox-port-forward.ps1 -LanIp 192.168.1.2 -WanPort 80 -LanPort 80 -Comment "AlphaOnze HTTP"
```

## HTTPS

Caddy est configure avec `Caddyfile` pour servir `alphaonze.funesterie.pro` en HTTPS et renvoyer vers le serveur local.

Etat actuel: HTTP public actif via Freebox `80 -> 192.168.1.2:80`, puis Windows portproxy `80 -> 127.0.0.1:8088`.

Pour ce mode, il faut:

- DNS: `alphaonze.funesterie.pro` en `A` vers l'IPv4 publique
- Freebox: TCP port externe 80 vers `192.168.1.2:80`
- Freebox: TCP port externe 443 vers `192.168.1.2:443`
- Freebox OS: donner a l'application `AlphaOnze AFK` le droit `settings`, ou ajouter la regle `443` a la main
- Windows: supprimer le portproxy `80 -> 8088` avant de lancer Caddy sur le port 80
- Lancer `start-alphaonze-caddy.bat`

Ne lance Caddy qu'une fois le DNS et les redirections prets, sinon l'obtention du certificat public echouera jusqu'a propagation.
