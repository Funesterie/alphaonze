# MASK_RULES.md

## Principe

Le backend A11 ne traite plus un MASK comme un JSON minimal opportuniste.
La convention active est `mask-1`, avec des MASK canoniques par domaine,
produits par `wazaa-to-mask.cjs`, puis valides avant compilation.

Le point d'orchestration est `resolve-user-request.cjs`:

`analyzeSemanticIntent -> decideClarification -> textToWazaa -> wazaaToMask -> validateMaskUnified -> compileMaskUnified -> runtime`

## Intents supportes

La taxonomie canonique est:

- `image.generate`
- `web.image.search`
- `code.python.generate`
- `web.search`
- `chat.reply`

Normalisations legacy:

- `code.generate -> code.python.generate`
- `text.answer -> chat.reply`

Tout autre intent legacy doit etre converti ou rejete.

## Route unique de conversion

`wazaa-to-mask.cjs` est le point unique de conversion vers des MASK canoniques
par domaine.

Regles:

- un MASK sorti de ce module doit deja etre structure pour `mask-1`
- les wrappers legacy ne doivent pas inventer un schema parallele
- les routes `/api/chat`, `/api/llm/chat` et `/api/mask/*` deleguent toutes a ce
  meme chemin logique

## Validation et compilation unifiees

`validate-mask-unified.cjs` applique la bonne validation selon le domaine:

- image -> `validate-mask-image-generate.cjs`
- code -> `validate-mask.cjs`
- autres domaines -> verification stricte du schema canonique minimal attendu

`compile-mask-unified.cjs` applique la bonne compilation selon le domaine:

- image -> `compile-mask-to-sd.cjs`
- code -> `compile-mask-to-python.cjs`
- autres domaines -> passage au runtime adapte sans compilation legacy

## MASK canonique: `image.generate`

Exemple:

```json
{
  "version": "mask-1",
  "intent": "image.generate",
  "task": {
    "domain": "image",
    "action": "generate"
  },
  "compiler": {
    "target": "sd-payload",
    "version": "1.0"
  },
  "inputs": {
    "subject": ["orange cat in a rainy street"],
    "environment": [],
    "style": ["high quality", "detailed"],
    "composition": [],
    "lighting": [],
    "palette": []
  },
  "options": {
    "width": 768,
    "height": 768,
    "steps": 40,
    "guidance_scale": 8
  },
  "constraints": {
    "safe_mode": true,
    "no_text": true
  },
  "ambiguities": [],
  "raw": "genere une image de chat orange dans une rue sous la pluie"
}
```

Regles:

- `intent` doit etre `image.generate`
- `task.domain/action` doit etre `image/generate`
- `inputs.subject` doit etre un `array<string>` non vide
- `raw` doit etre un texte source non vide
- l'ambiguite avec `web.image.search` doit etre resolue par clarification avant
  runtime si la demande reste floue

## MASK canonique: `code.python.generate`

Exemple:

```json
{
  "version": "mask-1",
  "intent": "code.python.generate",
  "task": {
    "domain": "filesystem",
    "action": "sort_images"
  },
  "compiler": {
    "target": "python",
    "version": "1.0"
  },
  "inputs": {
    "path": ".",
    "extensions": ["png"]
  },
  "options": {
    "sort_by": "date",
    "recursive": false
  },
  "constraints": {
    "safe_mode": true,
    "no_delete": true
  }
}
```

Regles:

- `intent` doit etre `code.python.generate`
- `task.domain` et `task.action` sont obligatoires
- `compiler.target` et `compiler.version` sont obligatoires
- le resultat doit rester compilable en Python via `compile-mask-to-python.cjs`

## Domaines sans compilateur lourd

`web.image.search`, `web.search` et `chat.reply` restent des MASK canoniques
`mask-1`, mais ils ne passent pas par un compilateur historique type SD ou
Python.

Leur regle est:

- intent canonique obligatoire
- structure `mask-1` coherente avec le domaine
- execution via le runtime cible, sans pipeline parallele

## Compat legacy

Les modules suivants peuvent rester exposes pendant la migration:

- `llm-intent-to-mask.cjs`
- `detect-intent-fast.cjs`
- `text-to-mask-image-generate.cjs`

Mais ils doivent seulement wrapper le pipeline unifie.

## Invariants stricts

- plus aucun intent legacy ne doit etre emis en sortie
- toute requete utilisateur doit finir dans `resolve-user-request`
- `image-chat-runtime.cjs` est un runtime d'execution, pas un selecteur
- un input non conforme a `mask-1` doit etre corrige avant validation ou rejete
