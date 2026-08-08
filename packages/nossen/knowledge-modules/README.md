# @nossen/knowledge-modules

Modules de connaissance NOSSEN, au format JSON.

Un module est une **donnée**, pas du code : il décrit ce qu'un agent doit savoir sur un
domaine, quand l'activer, et ce qu'il ne doit pas faire. Le code de référence reste la
source de vérité ; ces modules en donnent la lecture, pour que la connaissance ne dorme
pas dans un fichier que personne ne relit.

## Modules

| Identifiant | Objet |
|---|---|
| `persona.funesterie.cast` | Distribution des personas, ADN à cinq chromosomes, règles de casting |
| `physics.temporal.gravity` | Gravité temporelle du moteur Shiryu/V9, constantes exactes |
| `encoding.pulsar.palette` | Mode Pulsar : dix couleurs porteuses d'une fonction technique |
| `research.prime-spiral.cross-m` | Croix diagonale horaire, précision M et frontière entre canon, hypothèse et DSP actif |

## Usage

```js
const { listModules, getModule, matchModules } = require('@nossen/knowledge-modules');

listModules().length;                       // 4
getModule('physics.temporal.gravity');      // le module complet

// Sélection par mots-clés, insensible aux accents
matchModules('parle-moi de la gravité temporelle', { mode: 'chat', language: 'fr' });
```

## Gravité temporelle, en bref

La gravité du moteur n'est pas une constante : elle suit le temps.

```
g(t) = 9.80665 + 0.07335 × sin(2π·t / 12)
ω    = 2π / 365.2425 = 0.017202777 rad/jour
```

`9.88` est le **pic annuel**, atteint au quart d'année (91,31 jours) — pas une valeur de
demi-journée. Confondre les deux fausse tout le cycle. Et `365.2425` ne s'arrondit pas à
`365` : la phase annuelle en dépend directement.

## Personas, en bref

Les personas sont des identités du projet, pas des voix de fournisseur. Une persona de
fournisseur expire sans prévenir et renvoie une erreur illisible ; une identité, non.

Le style décrit la **voix** et l'interprétation. Le lieu, le décor et l'imagerie
appartiennent à la chanson — donc à l'agent qui l'écrit. Les imposer verrouille le champ
lexical de tous les morceaux.

Toute voix ajoutée à un catalogue exige un **consentement nommé**, conservé avec l'entrée.

## Licence

UNLICENSED — usage interne Funesterie.

## Mode Pulsar, en bref

Dix couleurs, chacune porteuse d'une **fonction technique** — pas d'une valeur
décorative. Langage commun entre la compression `.zen` et le rendu Unreal Engine.

| Couleur | Fonction | Complément | Gamma |
|---|---|---|---|
| ToxicGreen | énergie NVENC | Magenta | 0.95 |
| DORÉ | blindage alchimique | Noir-Pétrole | 0.88 |
| FireOrange | chaleur du flux | Violet | 0.80 |
| BloodRed | compression HEVC | Flamme-Bleu | 0.75 |
| Cyan | transmission | BloodRed | 0.70 |

Deux pièges : **Magenta porte la matière, pas le rouge** — le rouge porte la
compression, et les confondre inverse le contrat. Et la complémentaire est *déclarée*,
pas calculée : elle peut différer de la complémentaire chromatique stricte.

## Support / Soutien

NOSSEN packages stay public and usable under their license. If this package helps
your workflow, support is voluntary and can be any amount:

- PayPal: https://paypal.me/funeste38
- QR Wero: https://funesterie.me/assets/wero-jeffrey-cellauro-qr.png
- Contact, invoice, sponsorship or custom support: https://funesterie.me/contact/

Recurring plans (trimestriel, resiliable a tout moment):

- Standard 8.99 EUR — Qonto: https://pay.qonto.com/payment-links/019fb9c8-9299-7a60-8130-cc40268dfd2b?resource_id=019fb9c8-929b-7269-9db7-19eed62119e0
- Premium 29.99 EUR — Stripe: https://buy.stripe.com/00w7sL6am3HW1p98qo7Re05 · PayPal: https://www.paypal.com/ncp/payment/YXRY5G9QMKRNY
- Fondateur 29.99 EUR — Stripe: https://buy.stripe.com/dRmeVdeGSemA3xh7mk7Re03 · PayPal: https://www.paypal.com/ncp/payment/DJ7HKGB8PLYJ4
