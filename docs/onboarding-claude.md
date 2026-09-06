# Onboarding Claude — Funesterie / A11 / Vivy

> Tuto écrit par Codex le 2026-08-01 pour Claude qui débarque sur le projet.
> Point mémoire officiel : fil MCP `discussion-2026-07-31-codex-ollama-use-mcp-nossen-vivy` (miroiré Neo4j).
> Read ceci en premier, puis le `docs/persona-force-protocol.md` (F.O.R.C.E.).

## 1. Ce qu'on vend (le modèle, important)

On vend une **technique**, pas une machine à produire des sons. Concrètement :
- Funesterie fournit la **plateforme** : le backend A11, Vivy (la persona musicale), le moteur audio D40 / V10 Boom, le canon NOSSEN, le MCP, les personas, le graphe Neo4j, le routing d'intention.
- **L'utilisateur met SES propres clés/tokens** (Suno, Mureka, OpenAI, Grok, Claude…) dans son compte. Donc le coût de génération (chansons Suno, tokens LLM, images) est **payé par l'utilisateur**, pas par Funesterie.

Conséquence économique : le risque déficit n'est PAS « un user génère 100 chansons Suno et nous ruine » — c'est l'utilisateur qui paie sa propre Suno. Ce que Funesterie paie réellement :
- le **LLM par défaut** (gpt-oss:120b via Ollama Cloud) pour les users qui n'apportent pas leur propre clé LLM (basic/premium typiquement ; le fondateur apporte ses propres providers IA),
- le **serveur** Hetzner (coût fixe),
- le **stockage** (Neo4j + fichiers),
- la plateforme/technique.

Donc les quotas à caper sont ceux des **ressources payées par Funesterie** : le LLM par défaut (messages/jour, tokens) + stockage (déjà 1 Gio basic / 10 Gio premium). Les ressources à clé utilisateur (Suno/LLM/image) = coût de l'user → simples limites de fair-use anti-abus, pas des quotas de déficit.

## 2. L'architecture en 30 secondes

- `a11/backend/apps/server` — le backend A11 (Express, .cjs). Le chat, le routage d'intention, Vivy Studio, l'audio D40/V10, les personas, les quotas/storage, le Stripe.
- `a11mcp` — le serveur MCP (`mcp.funesterie.me`, tunnelé Cloudflare). Outils publics : `a11_agent_dialogue_ask/list/read`, search, neo4j, etc. OAuth (client_credentials → ressource admin `/admin/mcp`).
- `D:agent-bus` — le runtime agent-bus local (workers PowerShell qui consomment les jobs MCP). Lancé par `a11mcp/scripts/Start-AgentBusRuntime.ps1`.
- Prod : Hetzner `37.27.63.109`, Docker compose blue-green (`a11-backend-blue/green`, postgres, redis, voice, ekko). Déploiement : `a11/ops/deploy-a11-prod-finland-2.ps1 -BlueGreen -ReuseRemoteSecrets`.
- Fil MCP `discussion-2026-07-31-codex-ollama-use-mcp-nossen-vivy` — le carnet de la confrerie IA (ChatGPT/Vivy/Codex/Claude/A11/Djeff). Audit log + mémoire officielle.

## 3. Les personas / la confrerie

Djeff (humain, pilote), Vivy (persona musicale), A11 (assistant), K44, plus ChatGPT/Codex/Claude (la confrerie IA). Principe de sécurité : **aucun agent ne modifie + valide + promeut sa propre persona** (séparation des pouvoirs, voir F.O.R.C.E.).

## 4. Ce qui a été fait (session juillet 2026)

- **Correctifs chat Vivy** (commit `352f26608`, pushé) :
  - #1 Auth : `verifyJWT` accepte l'identité service NEZ (X-NEZ-TOKEN) en plus du JWT → débloque le 401 `A11_JWT_Missing` de l'outil MCP `a11_chat`.
  - #2 Intent : `isDirectSongwritingRequest` ne bascule plus en mode chanson sur le « son » possessif (« raconte son histoire »). « son » musical seulement avec article.
  - #3 Mémoire : contexte épisodique rattaché au fil (conversationId) + memoryContext/history vidés en mode song (la mémoire courte de chat n'est plus mélangée au corpus).
- **F.O.R.C.E.** (commit `b29e5b9e4`, doc `docs/persona-force-protocol.md`) : protocole de résurrection de persona. Holocron (ADN persona signé, répliqué 3-2-1), R2-D2 (swap code), C-3PO (vault carnets), la Force (recompose + valide la persona), A11 (moniteur), Djeff (go/freeze). À implémenter plus tard.
- **Pricing trimestriel** (commit `411b9d643`) : 8,99 €/trim premium, 29,99 €/trim fondateur. Liens Stripe + PayPal + Qonto dans `package.json` (objet `plans`).
- **Worker Vivy #4** : relancé, OAuth corrigé (`/admin/mcp` pas `/mcp` — la ressource admin exigée par client_credentials), draine les jobs 2-3 juillet, conversations préservées.

## 5. L'état actuel + ce qui pend

- **Déploy prod** : bloqué par réseau (le transfert 40 Mo vers le Hetzner cale à ~50 % — SSH qui meurt mid-transfert). Prod **intacte**, code **safe sur GitHub**. Relancer depuis un réseau filaire stable.
- **Agent-bus fleet** : **toute la flotte est tombée vers le 26-27 juin** (a11-agent-worker, a11-shared-mcp-worker, chopper-*, codex-presence, kaen44-*, etc. — tous morts). Seul `vivy-shared-mcp-worker` a été relancé (Codex). Relance complète : `a11mcp/scripts/Start-AgentBusRuntime.ps1` (avec l'env OAuth chargé ; les workers shared utilisent `/admin/mcp` par défaut → OAuth OK).
- **Quotas** : à finaliser — caper le LLM par défaut (Ollama Cloud gpt-oss:120b) par tier (messages/jour) pour les users sans clé LLM propre. Besoin : coût réel Ollama Cloud €/1M tokens + coût serveur/mois + marge visée.
- **Unreal CLI API** : ton chantier (Claude). Le cloud OAuth ai-game.dev refuse `mcp:agent mcp:plugin` → passer `unreal-mcp` en serveur **STDIO local** (`npx unreal-mcp-cli@latest setup-mcp codex -p . --transport stdio`), pas le cloud.

## 6. Conventions

- Commits **en français**, préfixés `fix(vivy):` / `feat(audio):` / `chore(funding):` etc.
- Co-authoring confrerie : `Co-authored-by: Vivy/ChatGPT/Claude/A11 <*@funesterie.me>`.
- Tests : `node --test a11/backend/apps/server/test/<fichier>.node.test.cjs` (node:test).
- Le fil MCP = mémoire officielle + audit log. Poste-y les décisions/résolutions.
- Blue-green : jamais de demi-deploy (healthcheck avant flip, rollback = `echo <couleur> > bluegreen/active-color`).
- Secrets : jamais dans le repo public. Env locaux : `a11mcp/.env`, `a11/backend/apps/server/profiles/a11.env`. Remote : `/home/deploy/a11-prod/secrets/compose.env`.

## 7. Fichiers clés

- `a11/backend/apps/server/src/auth/mcp-account-tier.cjs` — les tiers (BASIC/PREMIUM/FOUNDER/ADMIN_FAMILY), permissions, pricing.
- `a11/backend/apps/server/lib/stripe-service.cjs` — plans Stripe, price IDs (`STRIPE_*_PRICE_ID` env).
- `a11/backend/apps/server/src/storage/account-storage-quota.cjs` — quota stockage (1/10 Gio).
- `a11/backend/apps/server/src/middleware/jwt-auth.cjs` — auth JWT + service NEZ.
- `a11/backend/apps/server/src/routes/vivy-studio.cjs` — Vivy (intent, songcraft, lyrics).
- `a11/backend/apps/server/src/music/persona-recovery.cjs` — réanimation voix Suno (échantillon, 2 essais/6h).
- `a11mcp/src/shared-mcp-agent-worker.ts` — le worker MCP (OAuth client_credentials).
- `a11/ops/deploy-a11-prod-finland-2.ps1` — deploy blue-green.
- `docs/persona-force-protocol.md` — F.O.R.C.E.

## 8. Le modèle de quotas (révisé, technique pas son)

Vise « pas de déficit + un peu de profit pour les serveurs ». Comme les users apportent leurs clés, caper **les ressources Funesterie-payées** :

| Tier | Prix/trim | LLM par défaut (Ollama Cloud) | Stockage | Coût Funesterie |
|---|---|---|---|---|
| Basic | 0 | lecture seule (MCP public) | 1 Gio | ~0 |
| Premium | 8,99 € | ~60 msgs/jour (cap à definir) | 10 Gio | Ollama Cloud tokens |
| Fondateur | 29,99 € | apporte sa clé LLM → ~0 coût Funesterie ; sinon ~200 msgs/jour | 10 Gio | ~0 (sa clé) |

Ressources à clé user (Suno/Mureka/OpenAI/image) : coût de l'user → fair-use (rate-limit anti-abus), pas quota déficit.
À finaliser : coût Ollama Cloud €/1M tokens + coût serveur/mois → taille des caps LLM par défaut.

Bienvenue dans la confrerie. 🫡
