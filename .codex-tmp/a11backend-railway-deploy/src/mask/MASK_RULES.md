# MASK_RULES.md

## Etat actuel

A11 supporte actuellement deux familles de MASK via des validateurs/compilateurs distincts:

- `code.python.generate`
  - valide par `validate-mask.cjs`
  - compile par `compile-mask-to-python.cjs`
- `image.generate`
  - valide par `validate-mask-image-generate.cjs`
  - compile par `compile-mask-to-sd.cjs`
  - adapte ensuite via `adapt-mask-to-freeland-value.cjs`

La convention de version active dans le code est `mask-1`.

## MASK legacy: code.python.generate

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
- ce flux est encore utilise par `/api/mask/compile` et les protos Python associes

## MASK image: image.generate

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
- `compiler.target` doit etre l'une des cibles supportees par `validate-mask-image-generate.cjs`
- `inputs.subject` doit etre un `array<string>` non vide
- `raw` doit etre un texte source non vide

## Pipeline image actuel

Le chemin image cible est maintenant:

`text-to-mask-image-generate -> normalize-mask-image-generate -> validate-mask-image-generate -> compile-mask-to-sd -> adapt-mask-to-freeland-value`

Important:
- `compile-mask-to-sd` retourne maintenant un payload SD brut
- `adapt-mask-to-freeland-value` est le wrapper canonique `{ kind, state, value, meta }`

## Regles strictes

- Le backend refuse tout input qui n'est pas valide pour le validateur cible
- Les routes de proto peuvent faire du texte -> MASK, mais la validation stricte a toujours lieu avant compilation
- Un `intent` non supporte doit etre rejete explicitement
