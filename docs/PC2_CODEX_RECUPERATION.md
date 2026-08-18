# PC2 — récupération du Codex antérieur

> Fiche portable. Elle suit le dépôt, donc elle est lisible depuis PC2.
> Écrite le 18/08/2026, à la demande de Djeff.

## Pourquoi cette fiche existe

PC2 tourne avec une **version de Codex antérieure à sa fusion avec ChatGPT**.
Cette machine garde donc un état local que rien n'a jamais inspecté.

Quand `CLAUDE.md` a conclu, le 2 août 2026, que les notes `mem-2026-05-29T*`
étaient définitivement perdues, **quatre** stockages avaient été vérifiés :

- la base de production `a11-neo4j`
- la sauvegarde `neo4j-prod-20260725.cypher`
- les deux exports `memory-notes.jsonl`
- l'instance Aura `aa4680d2`

L'historique local de Codex n'en faisait pas partie. Ce n'est donc pas une piste
épuisée : c'est une piste jamais ouverte.

**Ne pas espérer les `MemoryNote` elles-mêmes** — elles vivaient dans Neo4j, pas
sur le disque. Ce qu'on peut espérer, ce sont les *conversations qui les ont
produites*. Ce n'est pas la même chose, et c'est déjà beaucoup : une trace
d'origine n'est pas une reconstruction approximative, qui elle est explicitement
déconseillée par le canon.

## Où chercher, dans cet ordre

| Emplacement | Ce qu'on y cherche |
|---|---|
| `~/.codex/sessions/` | sessions datées de mai 2026 |
| `~/.codex/history` | historique de commandes et d'échanges |
| `D:\agent-bus\` | état des agents — **hors** `math-ocr-index`, déjà connu et déjà exploité |

`D:\agent-bus` est la valeur par défaut de `AGENT_STATE_DIR`, lue dans
`a11mcp/scripts/codex-session-preflight.cjs`.

Filtrer sur mai 2026. Tout `.jsonl` ou `.md` de cette période mérite un regard.

## Règles de manipulation

**Ne jamais ouvrir, copier ni transmettre `~/.codex/auth.json`.** C'est
l'authentification du CLI Codex. Le préflight de Djeff le dit déjà pour tout le
reste : *« Never paste raw secrets, tokens, passwords, license keys, private keys,
or long credential blobs. »*

Demander **l'arborescence datée avant le contenu**. On regarde ce qui existe et
de quand ça date, on décide ensuite ce qui vaut la peine d'être lu. Ça évite de
déplacer des mégaoctets pour rien, et ça évite surtout de faire circuler des
choses qu'on n'a pas besoin de faire circuler.

## Ce qu'on fait de ce qu'on trouve

Rien automatiquement. Le canon est clair : une reconstruction approximative des
notes de mai serait pire que leur absence. Si des traces sortent, elles se lisent
et se discutent avant d'être versées où que ce soit — surtout pas dans un graphe
de production qui compte aujourd'hui 8 549 nœuds et 22 452 relations.
