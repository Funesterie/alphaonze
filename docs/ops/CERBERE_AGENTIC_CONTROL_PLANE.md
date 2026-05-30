# Cerbère — Plan de Contrôle Agentique

Date: 2026-05-30  
Status: draft — validé en conversation Djeff/Claude Code

---

## Principe

Cerbère n'est pas un nouvel hébergeur ni un service externe.  
C'est une couche de routage + garde-fou qui tourne sur l'infra existante (A11/K44/Codex/qflush/Neo4j).

```
Djeff demande un truc
→ Cerbère découpe / protège / route
→ A11 répond si dispo
→ sinon fallback vers agents/outils
→ Codex implémente
→ Claude/Gemini/Copilot servent à revue ou second avis
→ Qflush/Chopper testent
→ Neo4j garde la mémoire courte propre
```

Prod réelle + routes canary cachées + flags désactivables + smoke après chaque tranche + rollback simple.  
Pas de YOLO. Les garde-fous sont actifs par défaut.

---

## Composants

| Composant | Rôle |
|-----------|------|
| `Cerbere-Mega` | Garde auth/session/capabilities — qui peut faire quoi |
| `Worker Supervisor` | Ne lance que des workers autorisés (13 connus, 12 idle) |
| `mcp-job-queue` | File de tâches (`job_enqueue` / `job_lease` / `job_complete`) |
| `logic-reduce` | Réduit les plans trop bordéliques avant dispatch |
| `katana` | Découpe le WIP en tranches PR propres |
| `allmight` | Cherche duplications et zones suspectes dans le repo |
| `rome` | Index sémantique du repo (nossen-source-index) |
| `qflush/chopper` | Smoke, doctor, validation post-deploy |

## Rôles par agent

| Agent | Usage |
|-------|-------|
| Codex | Pilote implémentation / tests / deploy |
| A11 | Priorité réponse / persona utilisateur |
| Cerbère | Fallback + arbitre + garde-fou |
| Claude | Revue statique, critique PR, second avis UX/auth |
| Gemini | Second avis large, "est-ce qu'on rate un truc ?" |
| Copilot | GitHub PR/issues, pas cerveau central |
| qflush | Smoke tests, flows publics approuvés |
| Chopper | Doctor post-deploy, health validation |

---

## Lanes

Les lanes sont les unités de travail routables. Un job Cerbère appartient à exactement une lane.

| Lane | Périmètre | Agent recommandé | Tests |
|------|-----------|------------------|-------|
| `prod-smoke` | Health checks A11/K44/Vivy/MCP, endpoints 200 | qflush/chopper | smoke + doctor |
| `wip-harvest` | Collecte WIP dirty, wip-rescue, katana slice | Codex + katana | lint + diff clean |
| `voice` | voice-module, tts routes, tts-api, vivy-studio | Codex | test:voice + smoke |
| `auth-drive` | auth.cjs, protected-chat-proxy, session bridge | Codex + Claude review | test:auth + contracts |
| `vivy-gate` | vivy-studio route, gate, capabilities check | A11 + Codex | test:vivy + gate check |
| `math-ocr` | prime-spiral, OCR scripts, research corpus | Codex + Gemini review | Test-SymetrieOpTable.ps1 |

---

## Fichier de plan

`scripts/nossen/cerbere-plan.cjs` sort un JSON secret-safe :

```json
{
  "generated_at": "...",
  "prod_status": { "a11": true, "kaen44": true, "vivy": "...", "mcp": "..." },
  "lanes": {
    "voice": {
      "dirty_files": [...],
      "tasks": [...],
      "risks": [...],
      "agent": "codex",
      "tests": [...]
    }
  }
}
```

Usage :
```powershell
node scripts/nossen/cerbere-plan.cjs
node scripts/nossen/cerbere-plan.cjs --lane voice
node scripts/nossen/cerbere-plan.cjs --out D:\agent-bus\cerbere-plan.json
```

---

## Garde-fous

- Aucun secret inliné dans les outputs
- Payloads MCP courts — gros états → R2 bucket `mcp-generated/`
- Tout changement de convention validé par Djeff ou Codex
- Canary flags désactivables sans rollback complexe
- runtimeHooks doit être OK avant tout dispatch en prod (actuellement moduleCount=0 → à corriger)

---

## Branchement MCP

Les jobs Cerbère passent par `job_enqueue` / `job_lease` / `job_complete` (MCP Funesterie).  
Pas de Render/Spark. Pas de service externe.

Séquence standard :
```
cerbere-plan.cjs --lane X   → JSON plan
→ job_enqueue (lane, agent, tasks, tests)
→ agent lease + execute
→ job_complete / job_fail
→ smoke (qflush/chopper)
→ Neo4j: emit_decision si changement structurant
```

---

## Prochaines tranches

1. `cerbere-plan.cjs` — script plan JSON (fait, voir scripts/nossen/)
2. Corriger runtimeHooks (moduleCount=0) — lane prod-smoke bloquée
3. Trier wip-harvest : transformer fichiers dirty en jobs routables
4. Brancher lane `auth-drive` sur job-board MCP
5. Mini UI admin locale (après les lanes core stables)
