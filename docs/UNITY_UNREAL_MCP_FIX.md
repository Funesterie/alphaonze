# Unity & Unreal MCP ("AI Game Developer") — Résolution

> Outil : plugin **Unreal MCP / Unity MCP (AI Game Developer)** de Ivan Murzak (v9.2.x),
> piloté par l'app desktop **ai-game-dev** (ai-game.dev). Agent : **Codex** (et Claude Code).

## Diagnostic — ce qui cassait

1. **Pont (bridge) editor ↔ serveur MCP déconnecté.**
   Le fichier de config du plugin était en mode `Custom` avec `host = "http://localhost"`
   (port manquant → le bridge tentait `http://localhost:80/hub/mcp-server` → *connexion refusée*).
   Résultat : aucun outil n'était enregistré sur le serveur MCP, `tools/list` renvoyait vide / timeout.
2. **Config Codex obsolète.**
   `[mcp_servers.unreal-mcp]` lançait un *serveur stdio* sur le projet **NOSSEN 5.8** (port 28105)
   — mauvais projet, pas de bridge → 0 outil. Et **`unity-mcp` était absent** de `config.toml`.
3. **Token cloud expiré.** Le `cloudToken` (mode Cloud) expirait le 09/08 08:57 → l'auth ai-game.dev
   échouait (`invalid_grant`). Le mode local (Custom) était donc la bonne voie, mais mal configuré.

## Architecture (mode Local, retenue)

```
Éditeur (UE/Unity) ──bridge──► gamedev-mcp-server (HTTP/SignalR sur port fixe) ◄──HTTP /mcp── Agent (Codex)
                                     28105 = Unreal (FUNESTERIE)
                                     28106 = Unity  (My project)
```

En mode `Custom` + transport `http`, l'éditeur **parse le port depuis le `host`** et y lance le
`gamedev-mcp-server` (en tuant tout orphan sur ce port). Le bridge s'y connecte (`/hub/mcp-server`),
l'agent s'y connecte (`/mcp`). → **port stable** = pas de reconfig à chaque redémarrage.

## Corrections déjà appliquées (fichiers)

| Fichier | Changement |
|---|---|
| `C:\Users\cella\.codex\config.toml` | `[mcp_servers.unreal-mcp]` → `url = "http://127.0.0.1:28105/mcp"` ; ajout `[mcp_servers.unity-mcp]` → `url = "http://127.0.0.1:28106/mcp"` (HTTP, plus de stdio) |
| `D:\projets\funesterie\.mcp.json` (Claude Code) | `unreal-mcp` / `unity-mcp` → HTTP `:28105` / `:28106` |
| `…\FUNESTERIE\Saved\Config\UnrealMcp\ai-game-developer-config.json` | `connectionMode=Custom`, `transport=http`, `host=http://localhost:28105`, `authOption=None` |
| `…\Unity\My project\UserSettings\AI-Game-Developer-Config.json` | `connectionMode=Custom`, `transport=http`, `host=http://localhost:28106`, `authOption=None` |

Sauvegardes : `D:\projets\funesterie\codex-backups\mcp-gamedev-fix-20260810-075034\`

⚠️ Les **éditeurs tournent** et peuvent réécrire leur config plugin depuis la mémoire (le panneau
*AI Game Developer* est la source de vérité quand l'éditeur est ouvert). D'où l'étape obligatoire ci-dessous.

## Étapes obligatoires (côté éditeur) — à faire une fois

Dans **chaque** éditeur, ouvre le panneau **"AI Game Developer"** et règle :

| Champ | Unreal (FUNESTERIE) | Unity (My project) |
|---|---|---|
| Connection mode | **Custom** | **Custom** |
| Transport | **HTTP** | **HTTP** |
| Host | **`http://localhost:28105`** | **`http://localhost:28106`** |
| Auth | **None** | **None** |

Puis clique **Start / Connect**. L'éditeur va : libérer le port (kill l'orphelin stdio qui squatte),
lancer `gamedev-mcp-server` sur le port, et y connecter le bridge → les outils s'enregistrent.

> Alternative : fermer puis rouvrir les éditeurs (ils reliront la config corrigée ci-dessus).

## Étapes obligatoires (côté agent)

- **Redémarrer Codex** → il charge `unreal-mcp` + `unity-mcp` en HTTP sur 28105/28106.
- (Optionnel) Redémarrer Claude Code → il utilise les URLs HTTP du `.mcp.json` corrigé.

## Vérification

```powershell
powershell -ExecutionPolicy Bypass -File D:\projets\funesterie\scripts\verify-gamedev-mcp.ps1
```

Doit afficher, pour chaque serveur : `listener`, `server: gamedev-mcp-server 9.2.x`, et
`tools: <N>`. Si `tools: 0` → le bridge n'est pas connecté (revoir le panneau AI Game Developer).

## Notes

- Les ports **28105/28106** correspondent à ta convention d'origine et sont stables (plus d'aléas).
- Le mode Cloud (ai-game.dev) reste possible plus tard : remettre `connectionMode=Cloud` et refaire
  le sign-in (device-code) dans le panneau — le token actuel est expiré. Le mode Local ci-dessus
  fonctionne sans compte cloud.
- Si tu rouvres un **autre** projet UE/Unity, sa config plugin lui est propre : recopie
  `host=http://localhost:28105` (UE) / `:28106` (Unity) dans son `…/ai-game-developer-config.json`.
