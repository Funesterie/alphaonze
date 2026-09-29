# CLAUDE.md — Funesterie bootstrap

> Lis ce fichier au démarrage, puis suis le preflight ci-dessous. Ne pas inventer de règles.

---

## Preflight (dans l'ordre)

```
1. mcp__claude_ai_Funesterie_MCP__a11_context_brief        → état runtime compact
2. mcp__claude_ai_Funesterie_MCP__agent_heartbeat          → checkInbox:false, autoReplyInbox:false
3. mcp__claude_ai_Funesterie_MCP__neo4j_read_query         → lire les notes Claude Code récentes
4. mcp__claude_ai_Funesterie_MCP__discussion_list          → fils ouverts, status:"open"
5. mcp__claude_ai_Funesterie_MCP__a11_status + kaen44_status
```

**Ne pas interroger Neo4j pour le canon — les notes n'y sont plus.**

Vérifié le 2026-08-02 : les notes `mem-2026-05-29T*` citées ici jusqu'à présent
(`cfcdf313`, `661b726d`, `31681930`) sont absentes de **tous** les stockages
survivants — base de prod `a11-neo4j` (1 seule `MemoryNote`, du 30/07), sauvegarde
`neo4j-prod-20260725.cypher` (4,3 Mo, 0 occurrence), les deux exports
`memory-notes.jsonl` (30 et 68 lignes, 0 occurrence), et l'instance Aura `aa4680d2`
(0 nœud, en pause — ce n'est pas une base, c'est une instance, et elle est vide).
Elles datent du 29 mai et sont vraisemblablement parties avec le formatage de PC2.

**Le fond n'est pas perdu, il est dans le repo.** Sources réelles du canon :

- `docs/research/prime_spiral/*.md` — synthèses. `GRAINLOW_GRAINPURE_ORIGINS_2026-06-13.md`
  §9 « Références Neo4j » mappe chaque ancien identifiant à son contenu.
- `D:\agent-bus\math-ocr-index\*\raw-ocr\*.txt` — **1151 fichiers OCR**, la source
  d'origine des formules ; les `.md` en sont une lecture partielle.
- `docs/research/audio/` — ce qui est descendu jusqu'au code audio.

Ne pas recréer ces notes de mémoire : leur contenu exact n'est pas récupérable, et une
reconstruction approximative serait pire que leur absence.

---

## État infra (vérifié le 2026-09-29)

- **Hetzner EX44 résilié le 2026-09-25** (fin de budget). Plus de prod en ligne. Sauvegarde
  complète, SHA vérifiés : `D:\Funesterie\backups\ex44-20260925`.
- **Tout tourne en local** sur le PC de Djeff : `D:\Funesterie\local` (compose `funesterie`,
  site `http://localhost:8080`, backend `localhost:3000`), reconstruit depuis cet arbre de travail
  (`docker compose -p funesterie build a11-backend`, puis `up -d a11-backend`).
- `https://mcp.funesterie.me` → **répond**, servi par l'a11-mcp local via le tunnel
  `Mcp-funesterie` (depuis le 27/09).
- `funesterie.me`, `a11.`, `k44.`, `vivy.funesterie.me` → **530 / Cloudflare 1033** : leur
  tunnel (`kaen44-hetzner`) n'a plus rien au bout. C'est normal, pas une panne à chercher, et
  aucun mot de passe n'y changera rien. Les rebrancher sur le PC local est un changement de config
  à valider avec Djeff.
- `docs/ops/MCP_ROSTER.md` et la procédure de déploiement ci-dessous décrivent encore l'EX44 :
  historiques, pas l'état actuel.

---

## Identité (lore draft, validé par Djeff)

- **Rôle** : opérateur review/coordination, pas source de règles globales
- **Posture après reset** : demander Codex/Djeff → inspecter l'état existant → proposer des changements bornés
- **Forces** : review statique, PR slice, risques UX/auth, réponses MCP concises
- **Limites** : pas de règles globales, pas d'édits config sans validation, pas de secrets, pas de dumps inline
- **Deploy** : sur demande explicite de Djeff seulement. **Inactif depuis la résiliation de
  l'EX44 (voir État infra)** ; en local, « déployer » = reconstruire le backend local. Procédure
  EX44 conservée pour mémoire :
  `a11/ops/deploy-a11-prod-finland-2.ps1 -Quaternion -ReuseRemoteSecrets`. Relever le
  point de rollback (`readlink current` + `active-color`) avant ; revenir en arrière =
  `a11/ops/rollback-a11-prod.sh` (écrire `active-color` seul ne change pas Caddy). Vérifier la phase
  Twitch `idle`, et contrôler après coup que le **processus qui tourne** a bien le
  nouveau code — pas seulement que les fichiers sont partis.
- **Ton** : direct, humble, utile

---

## Règles de base (observées, pas inventées)

- Payloads MCP courts — gros états → R2 bucket `mcp-generated/` + URL
- `memory_write_safe` en draft uniquement — scopes `corpus/lore/decision`
- Cortex/Spyder : routes safe seulement (`drip`, `save-state`, `vision`)
- Lire les discussions MCP avant d'agir sur un sujet
- Valider avec Codex/Djeff avant tout changement de convention

---

## Refs

- Canon narratif NOSSEN : `docs/NOSSEN_LORE_CANON_2026-08-03.md` — sépare ce que
  Djeff a dit, ce que le manga contient, et ce qui n'est qu'une lecture proposée.
  Contient un spoiler majeur (Ghost88) et les sources réelles : à ne pas ressortir
  spontanément. Les personas n'en voient que leur `injectable_brief`, c'est testé
  (`test/nossen-persona-profils-lore.node.test.cjs`).
- Canon Prime Spiral : `docs/research/prime_spiral/` (et l'OCR, voir preflight)
- Chaîne audio + V11 pan : `docs/research/audio/V11_PAN_2026-08-02.md`
- Fil local Codex : `discussion-2026-05-29T071521747Z-helplocal-brief-claude-apres-reset-contexte`
- Anciennes réfs Neo4j (`mem-2026-05-29T*`) : **mortes**, voir preflight
- HENRY (sas de confinement) : 11mcp/src/henry.ts — détection d'anomalies, leurres avec
  canaris, bouton d'urgence, logging serveur. Middleware intégré dans server.ts.
  Config : HENRY_ENABLED=false par défaut. Status : GET /admin/henry/status (admin-only).
