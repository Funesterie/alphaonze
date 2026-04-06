# INTENT_PIPELINE.md

## Objectif

Le backend A11 utilise maintenant un seul pipeline d'intention de reference.

La source de verite des intents est limitee a:

- `image.generate`
- `web.image.search`
- `code.python.generate`
- `web.search`
- `chat.reply`

Les aliases legacy restent acceptes uniquement pour migration, puis sont
normalises vers cette taxonomie canonique.

## Pipeline canonique

Le chemin unique est:

`entree utilisateur -> SCREAM -> WAZAA -> resolve-user-request -> wazaa-to-mask -> validate-mask-unified -> compile-mask-unified -> runtime`

Concretement, `resolve-user-request.cjs` orchestre:

`analyzeSemanticIntent -> decideClarification -> textToWazaa -> wazaaToMask -> validateMaskUnified -> compileMaskUnified -> runtime dispatch`

## Modules canoniques

Les briques de reference sont:

- `src/resolve-user-request.cjs`
- `src/mask/semantic/semantic-utils.cjs`
- `src/mask/semantic/score-semantic-intents.cjs`
- `src/mask/semantic/decide-clarification.cjs`
- `src/mask/text-to-wazaa.cjs`
- `src/mask/wazaa-to-mask.cjs`
- `src/mask/validate-mask-unified.cjs`
- `src/mask/compile-mask-unified.cjs`

`wazaa-to-mask.cjs` est le point unique de conversion vers des MASK
`mask-1` canoniques par domaine.

## Dispatch par domaine

### `image.generate`

Chemin canonique:

`SCREAM -> WAZAA -> wazaa-to-mask -> validate-mask-image-generate -> compile-mask-to-sd -> image runtime`

Notes:

- l'ambiguite `image.generate` vs `web.image.search` doit produire une
  clarification explicite
- `image-chat-runtime.cjs` execute le flux image, mais ne choisit plus le
  pipeline

### `code.python.generate`

Chemin canonique:

`SCREAM -> WAZAA -> wazaa-to-mask -> validate-mask-code-python-generate -> compile-mask-to-python -> code runtime`

Notes:

- `code.generate` est normalise vers `code.python.generate`
- le MASK compile toujours vers du Python executable

### `web.image.search`

Chemin canonique:

`SCREAM -> WAZAA -> wazaa-to-mask -> validate-mask-unified -> compile-mask-unified -> web image runtime`

Ce domaine reste un runtime de recherche, pas un generateur d'image.

### `web.search`

Chemin canonique:

`SCREAM -> WAZAA -> wazaa-to-mask -> validate-mask-unified -> compile-mask-unified -> web runtime`

### `chat.reply`

Chemin canonique:

`SCREAM -> WAZAA -> wazaa-to-mask -> validate-mask-unified -> compile-mask-unified -> chat runtime`

`text.answer` est normalise vers `chat.reply`.

## Routes qui deleguent au routeur unique

Les points d'entree backend deleguent au meme orchestrateur:

- `/api/chat`
- `/api/llm/chat`
- `/api/mask/*`

L'objectif est qu'aucune requete utilisateur ne bypass `resolve-user-request`.

## Compatibilite de migration

Les anciens modules sont conserves uniquement comme wrappers:

- `src/chat/intent-router.cjs`
- `src/detect-intent-fast.cjs`
- `src/llm-intent-to-mask.cjs`
- `src/mask/text-to-mask-image-generate.cjs`

Regle:

- ils ne doivent plus emettre d'intent legacy
- ils ne doivent plus porter un pipeline parallele
- ils doivent finir par passer par `resolve-user-request`

## Invariants d'architecture

- un seul routeur choisit le domaine et la clarification
- `wazaa-to-mask.cjs` est la seule conversion texte/WAZAA -> MASK canonique
- un MASK n'est jamais traite comme un simple JSON minimal hors schema
- la validation stricte precede toujours la compilation
- le runtime execute, mais ne choisit pas la strategie de routage
