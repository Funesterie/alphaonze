# Funesterie WIP Agriculture — Guide de gestion saine des branches

By Djeff / Funesterie. Mis à jour au fil des sessions.

---

## Pourquoi ce guide

Le repo accumule des worktrees, des WIP non commités, des branches oubliées.
À chaque session, on perd du temps à comprendre ce qui est safe, ce qui est en cours, ce qui est récupérable.
Ce guide fixe les règles du jeu pour cultiver proprement.

---

## L'état WIP au 2026-05-28

**Repo principal (`D:\projets\funesterie`)**
- 38 fichiers modifiés non commités (branche `codex/hf-video-huggingface-20260526`)
- Pas prêt à merger tel quel — trop gros, pas cohérent
- Stratégie : découper en tranches par domaine (auth, frontend, voice, ops…)

**Worktrees : 55 au total**
- 17 sales (WIP à préserver) — ne pas toucher
- 38 propres (contenu committé, pas de WIP)
- node_modules nettoyés sur les propres le 2026-05-28 (5.24 Go récupérés)

**Tranches déjà isolées (non pushées)**
- `codex/auth-session-connectors-20260528` → auth/connectors WIP, 15/15 tests OK
- `codex/voice-stack-decision-20260528` → doc voix + manifest, build OK

---

## Règles d'agriculture

### 1 tâche = 1 worktree

```powershell
# Créer un worktree propre depuis master
git worktree add D:\projets\funesterie-worktrees\ma-tache-20260528 -b codex/ma-tache-20260528 origin/master
```

Ne jamais travailler directement dans `D:\projets\funesterie` pour une tâche planifiée.
Le repo principal = urgences et lecture seulement.

### Nommage des branches/worktrees

```
codex/<domaine>-<sujet>-YYYYMMDD
```

Exemples :
- `codex/auth-session-connectors-20260528`
- `codex/frontend-chat-ui-20260528`
- `codex/voice-manifest-20260529`

### Taille des PR

Une PR saine = **1 domaine, ≤ 10 fichiers, ≤ 300 lignes modifiées**.
Si une branche touche plus de 3 domaines : la découper.

### Cycle complet (seed → harvest)

```
1. Créer worktree depuis origin/master
2. Faire 1 chose précise
3. Tests ciblés verts
4. git add -p (patch staging, pas -A)
5. Commit avec message clair
6. PR sur GitHub
7. Merge
8. git worktree remove + git branch -d
```

### Vérifier avant de commencer une session

```powershell
# Script rapide (voir scripts/nossen/wip-status.ps1)
npm --prefix D:\projets\funesterie\a11mcp run session:preflight -- --print
```

Lire `a11/runtime/codex-session-state-current.md` pour l'état stable.

---

## Ce qui est bon à récupérer du gros WIP

Le WIP du repo principal contient plusieurs paquets récupérables :

| Domaine | Fichiers clés | Statut |
|---------|--------------|--------|
| **auth/session** | `src/routes/auth.cjs`, `src/auth/account-connectors.cjs`, tests | Branche `auth-session-connectors-20260528` ✅ |
| **voice manifest** | `src/tts/voice-provider-manifest.cjs`, tests | Branche `voice-stack-decision-20260528` ✅ |
| **chat gates** | `src/routes/chat.cjs` (informative contexts, connector-aware) | À isoler |
| **chat proxy** | `src/routes/protected-chat-proxy.cjs` (executeImage fix) | À isoler |
| **frontend UI** | `App.tsx` (form inputs, disconnect button, auth bridge fix) | À isoler |
| **voice module Python** | `voice-module/app/main.py`, requirements | À isoler |
| **ops/deploy** | `ops/deploy-a11-prod-finland-2.ps1` | À isoler (vérifier secrets) |
| **configs** | `.gitattributes`, `.gitignore`, `.kiro/settings/mcp.json` | PR séparée |
| **data** | `knowledge-graph/tasks.json` (+31k lignes) | Ne pas commiter dans le code |

---

## Ce qu'il ne faut JAMAIS faire

- `git add -A` ou `git add .` sur le repo principal → risque de commiter des secrets ou des données
- `git reset --hard` sans backup → perte de WIP
- Modifier `.kiro/settings/mcp.json` sans vérifier les disabled intentionnels
- Supprimer un worktree sale sans vérifier son contenu
- Pousser `knowledge-graph/tasks.json` (31k lignes de données runtime)
- Modifier `.env.local` ou tout fichier contenant des secrets

---

## Script de démarrage de session

Voir `scripts/nossen/wip-status.ps1` pour un overview rapide au démarrage.

---

## Checklist de fin de session

- [ ] Tout WIP utile est dans un worktree nommé ou une branche
- [ ] Les fichiers secrets ne sont pas stagés
- [ ] Les tests ciblés passent sur chaque tranche
- [ ] L'état de session est mis à jour (`Update-CodexSessionState.ps1`)
- [ ] Les worktrees propres et mergés sont supprimés
