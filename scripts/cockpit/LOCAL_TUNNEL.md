# Cockpit MCP local par tunnel

Objectif: servir l'interface MCP depuis la machine locale, puis l'exposer sous un sous-domaine `funesterie.me` via Cloudflare Tunnel. Le jeton MCP reste cote serveur local et n'est pas injecte dans le navigateur.

## Demarrage

```powershell
cd D:\projets\funesterie\scripts\cockpit
.\Start-LocalTunnel.ps1
```

Par defaut:

- URL locale: `http://127.0.0.1:8089/mcp`
- URL tunnel: `https://cockpit.funesterie.me/mcp`
- tunnel Cloudflare: `nossen-cockpit-local`

Le serveur cree une session locale temporaire et ouvre le navigateur avec un lien de demarrage. La cle de session n'est pas affichee. Sans session, l'interface repond `403`.

## Verification rapide

```powershell
.\local-server.ps1 -SelfTest
.\Start-LocalTunnel.ps1 -SelfTest
curl.exe -I https://cockpit.funesterie.me/health
```

## Notes de securite

- Ne pas committer les fichiers `.cloudflared`, les tokens, les credentials JSON ou les fichiers `.env`.
- Le proxy MCP local redige les champs sensibles avant de renvoyer une reponse au navigateur.
- Le mode prive utilise d'abord le MCP local `http://127.0.0.1:8787/mcp`, puis le fallback `https://mcp.funesterie.me/mcp`.
- Le domaine racine `funesterie.me` reste reserve au site public; le cockpit local passe par `cockpit.funesterie.me`.
