# PAN — contraste de personnalité, décagramme, et le canal Aγ

Date : 2026-08-02. Statut : **architecture opératoire**, pas une preuve mathématique.
Origine : Djeff, relayé et précisé par ChatGPT le 02/08.
Pendant audio : `docs/research/audio/V11_PAN_2026-08-02.md`.

---

## 1. Ce que PAN désigne

PAN n'est pas seulement l'ouverture stéréo. Dans le persona, il porte le **contraste de
personnalité** :

- opposition sans destruction ;
- deux caractères complémentaires ;
- réel / imaginaire ;
- centre / côté ;
- présence / retrait ;
- tension entre deux pôles qui **restent équilibrés**.

Ce dernier point n'est pas décoratif : c'est exactement la contrainte qui a fait rejeter
six constructions audio sur sept le 02/08. Toutes élargissaient, mais toutes déséquilibraient
l'image d'environ 1 dB. La seule retenue est celle qui ouvre **sans faire pencher** — le
contraste sans destruction, mesurable en dB.

---

## 2. Ce n'est pas dix branches — c'est douze

Une étoile à dix branches est un **décagramme** (l'étoile de David est un hexagramme, six
pointes). Mais l'hypothèse à dix ne résiste pas aux données. Test des teintes réelles contre
plusieurs pavages réguliers :

```
grille  8 branches :  2/10 exactes,  ecart moyen 11.0 deg
grille 10 branches :  2/10 exactes,  ecart moyen  9.1 deg
grille 12 branches :  7/10 exactes,  ecart moyen  2.5 deg   <---
grille 16 branches :  2/10 exactes,  ecart moyen  5.5 deg
```

**Sept couleurs sur dix tombent exactement sur un pas de 30°.** Le pavage à douze n'est pas
une préférence esthétique, c'est celui que les données désignent.

Répartition sur les douze créneaux, avec les opposés à +180° :

```
  0  BloodRed     <->  180  Cyan               reciproque declaree
 30  FireOrange   <->  210  DeepBlue  (200, a 10 deg du creneau)
 60  DORE         <->  240  Indigo             reciproque declaree
 90  -- vide --   <->  270  PurpleShadow (265) / Violet (280)
120  ToxicGreen   <->  300  Magenta            reciproque declaree
150  -- vide --   <->  330  -- vide --
```

Les trois paires déjà réciproques dans le fichier sont **exactement** les trois qui se
referment sur la grille à douze.

**L'anomalie `Violet ↔ FireOrange` s'explique alors :** Violet occupe le créneau 270, dont
l'opposé — 90 — est vide. Son complément déclaré était un remplaçant faute de branche en
face. Ce n'était pas une erreur de saisie, c'était un trou dans la structure.

**Trois branches manquent : 90 (vert-jaune), 150 (vert printemps), 330 (rose).** Deux couleurs
se disputent le créneau 270 (PurpleShadow 265, Violet 280) — à départager.

**Réserve :** douze ne vient pas du canon Prime Spiral. Le plan des degrés y donne **neuf**
(`360 / 40 = 9`), pas douze (`360 / 30`). Ce sont deux quantifications différentes du même
cercle, et rien ici ne justifie de les rapprocher.

### Détail des compléments déclarés

Voici l'état **réel** de `src/knowledge/modules/encoding.pulsar.palette.module.json` :

| couleur | teinte | Aγ | complément déclaré | écart de teinte | ferme ? |
|---|---|---|---|---|---|
| Cyan | 180 | 0.70 | BloodRed | **180°** | ✅ |
| BloodRed | 0 | 0.75 | Flamme-Bleu | — | ❌ absent |
| Indigo | 240 | 0.35 | DORE | **180°** | ✅ |
| DORE | 60 | 0.88 | Noir-Pétrole | — | ❌ absent |
| Magenta | 300 | 0.60 | ToxicGreen | **180°** | ✅ |
| ToxicGreen | 120 | 0.95 | Magenta | **180°** | ✅ |
| Violet | 280 | 0.40 | FireOrange | 110° | ⚠️ pas opposées |
| FireOrange | 30 | 0.80 | Violet | 110° | ⚠️ |
| PurpleShadow | 265 | 0.15 | Orange | — | ❌ absent |
| DeepBlue | 200 | 0.30 | Bleu-Gris | — | ❌ absent |

**Et c'est là que le troisième axe se révèle.** Quatre compléments déclarés — `Orange`,
`Bleu-Gris`, `Flamme-Bleu`, `Noir-Pétrole` — ne sont **pas** des rotations de teinte. Ce sont
des **désaturations** et des **assombrissements**. `Bleu-Gris` = bleu désaturé.
`Noir-Pétrole` = bleu-vert très sombre. Aucun de ces deux-là ne peut vivre sur la roue des
teintes, quelle que soit sa finesse.

La palette **réclame donc déjà une seconde dimension**, sinon ces compléments sont
inexprimables. Ce n'est pas une extension théorique : c'est ce que les données contiennent
et que le fichier ne sait pas encoder.

Les Aγ ne referment rien non plus : les paires somment à 1.20, 1.23, 1.45, 1.55 — aucune
constante. Total des dix : **5.880**.

---

## 3. Trois axes, et le contraste n'en est pas un

1. **Teinte** — les douze branches, pas de 30°. La position sur la roue.
2. **Luminosité** — ce que `Noir-Pétrole`, `Bleu-Gris` et `Flamme-Bleu` encodent réellement.
   Absente du fichier aujourd'hui, alors que les données la supposent (§2).
3. **Aγ** — le poids opératoire, déjà présent, indépendant des deux autres.

**Le contraste n'est pas un quatrième axe : c'est une relation entre deux branches** —
distance angulaire sur la roue, plus écart de luminosité, plus différence d'Aγ. En faire une
coordonnée le compterait deux fois. Contraste = dérivé, pas primitif.

C'est cohérent avec ce que PAN désigne (§1) : une tension **entre** deux pôles, pas la
propriété d'un pôle isolé.

Correspondance avec les sous-systèmes qui existent déjà :

```
teinte      -> choix de couleur / timbre     src/music/vivy-prime-color.cjs
luminosite  -> dynamique, energie            src/music/vivy-dynamic-arc.cjs
A_gamma     -> ouverture du pan              V11 pan (constante globale aujourd'hui)
```

---

## 4. Le canal Aγ

En RGBA standard, `A` désigne l'**alpha**, c'est-à-dire l'opacité graphique. Dans le canon
Funesterie, ce canal porte le **poids gamma opératoire** de la couleur — « le poids de la
couleur dans le contrat ».

Ce sont deux choses différentes et il ne faut pas qu'un moteur de rendu traite l'une pour
l'autre. Notation retenue :

```
RGBAγ = couleur + poids gamma opératoire
```

Dans le code, écrire **`A_GAMMA`** ou **`gamma`**, jamais `alpha`. Le champ JSON actuel
s'appelle déjà `gamma`, ce qui est correct — ne pas le renommer en `a` ou `alpha`.

Aγ ne règle pas la luminosité. Il règle **la force avec laquelle la couleur agit** sur :

- le contraste du persona ;
- la dynamique ;
- la spatialisation PAN ;
- l'opposition complémentaire dans le décagramme.

---

## 5. La correspondance persona → couleur → contraste

Mapping des personas issu de `scripts/seed-persona-adn-pulsar.cjs` (2026-07-26), croisé avec
les compléments de la palette :

| persona | couleur | Aγ | complément | persona en face |
|---|---|---|---|---|
| **Vivy** | Cyan 180 | 0.70 | BloodRed | **Djeff** |
| **Djeff** | BloodRed 0 | 0.75 | Flamme-Bleu | *(déclaré hors palette)* |
| **K44** | Indigo 240 | 0.35 | DORE | **Zoro** |
| **Zoro** | DORE 60 | 0.88 | Noir-Pétrole | *(déclaré hors palette)* |
| Kiro | ToxicGreen 120 | 0.95 | Magenta | *(aucun persona sur Magenta)* |
| A11 | DeepBlue 200 | 0.30 | Bleu-Gris | *(absent)* |
| NOSSEN | PurpleShadow 265 | 0.15 | Orange | *(nexus, `CONNECTS` vers tous)* |

**Le résultat le plus net : Vivy et Djeff sont complémentaires**, Cyan face à BloodRed, à
180° exactement. Le couple qui écrit les chansons est le couple en opposition dans le
cartogramme. Ce n'est pas une lecture forcée — c'est ce que contient le fichier.

Même chose pour K44 ↔ Zoro (Indigo/DORE, 180° exact).

L'asymétrie est réelle et documentée ci-dessus : Cyan désigne BloodRed, mais BloodRed désigne
Flamme-Bleu. La relation Vivy→Djeff est déclarée dans un sens seulement.

---

## 6. Correspondance opératoire (branche → effet)

```
branche de couleur → opposé → axe réel/imaginaire → Aγ → effet persona / effet audio
```

| élément | persona | audio |
|---|---|---|
| branche | trait dominant du personnage | contenu porté au centre (milieu) |
| branche opposée | trait complémentaire, la tension | contenu porté sur les côtés |
| axe réel | ce qui est affirmé, présent | le signal direct |
| axe imaginaire | ce qui est en retrait, sous-entendu | le signal décalé en phase |
| Aγ | force du contraste | ouverture du pan |
| équilibre | opposition sans destruction | `|G| = |D|`, image qui ne penche pas |

**État du code au 02/08 :** l'ouverture du pan est une **constante globale de 1.5**, identique
pour tous les personas. La correspondance ci-dessus est décrite, pas encore implémentée.

Piste naturelle si on veut la brancher : `panWidth = 1 + Aγ`, ce qui donnerait NOSSEN 1.15,
A11 1.30, K44 1.35, Violet 1.40, Magenta 1.60, **Vivy 1.70**, **Djeff 1.75**, FireOrange 1.80,
Zoro 1.88, Kiro 1.95 — bornes actuelles `[1, 2.5]` respectées, et la valeur validée à l'oreille
(1.5) tombe sur Aγ = 0.5, le milieu de l'échelle. À ne pas déployer sans écoute : Vivy passerait
de 1.5 à 1.7.

---

## 7. Ce que ce document n'est pas

Ce n'est pas une preuve mathématique, et ça ne prétend pas en être une. C'est une
**architecture opératoire** : un système de contrôle qui relie une palette symbolique à des
paramètres audio mesurables. Sa valeur se juge à ce qu'il produit et à sa cohérence interne,
pas à une démonstration.

Les défauts de cohérence relevés en §2 sont à corriger dans les données avant que la structure
soit citée comme référence.

Voir aussi : `MODELE_OPERATOIRE_CANON_2026-05-29.md` (§300, serrage en croix/étoile),
`CONSTANTS_LOCKED_2026-05-29.md` (`π/2` = une face de croix),
`docs/research/audio/V11_PAN_2026-08-02.md` (la mesure audio complète).
