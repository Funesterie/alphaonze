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

### La roue à douze est l'anneau d'un cube RGB à trois niveaux

Les dix hex de la palette n'utilisent que **trois valeurs d'octet** : `0x0a`, `0x4a`, `0x8a`
— espacées de 64 exactement. La palette n'est pas une liste de couleurs choisies, c'est un
**cube RGB quantifié à trois niveaux**.

En prenant tous les triplets où un canal est au maximum et un au minimum — l'anneau extérieur
du cube — on obtient **exactement douze couleurs**, toutes multiples de 30°, toutes à la même
luminosité (29 %) :

```
teinte   hex          etat
    0    0x8a0a0a     BloodRed
   30    0x8a4a0a     FireOrange
   60    0x8a8a0a     DORE
   90    0x4a8a0a     MANQUANTE   -> « vert pomme » (Djeff)
  120    0x0a8a0a     MANQUANTE
  150    0x0a8a4a     ToxicGreen  -> « verdoyant » ? (voir ci-dessous)
  180    0x0a8a8a     Cyan
  210    0x0a4a8a     DeepBlue
  240    0x0a0a8a     MANQUANTE   (version claire ; Indigo occupe la sombre)
  270    0x4a0a8a     PurpleShadow -> « mauve » (Djeff)
  300    0x8a0a8a     Magenta
  330    0x8a0a4a     MANQUANTE   -> « rose bonbon » (Djeff)
```

**Les couleurs manquantes ne sont pas à choisir : leurs hex sont déterminés par la structure.**

**L'anneau sombre existe déjà.** Indigo (`0x0a0a4a`) et Violet (`0x4a0a4a`) ont `0x4a` pour
canal dominant au lieu de `0x8a` : ce sont les branches 240 et 300 sur un **second anneau**, à
16 % de luminosité. Indigo *est* la branche 240 — c'est sa version claire qui manque.

La structure complète est donc **12 branches × N anneaux de luminosité**. État actuel : huit
couleurs sur l'anneau clair, deux sur l'anneau sombre, quatre trous.

### Deux corrections de données à trancher

1. **ToxicGreen.** Son hex (`0x0a8a4a`) le place à 150, le créneau « verdoyant ». Son champ
   `hue` dit 120. Soit il *est* le verdoyant et le champ est faux, soit c'est le vert acide pur
   et son hex devrait être `0x0a8a0a`. Le nom (*Toxic*Green) plaide pour la seconde ; c'est une
   décision de lore, pas de code.
2. **Le champ `hue` est faux quatre fois sur dix** : ToxicGreen −30°, Violet −20°, DeepBlue
   −10°, PurpleShadow −5°. Les hex sont exacts. **Régénérer `hue` depuis le hex**, ne pas
   corriger à la main.

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

Sémantique donnée par Djeff le 02/08 :

| axe | sens persona | où il est dans les données |
|---|---|---|
| **Teinte** | **la façade — ce que le persona décide d'afficher** | branche sur la roue à douze, exacte dans le hex |
| **Luminosité** | **ce qu'il garde en retrait, la part dans l'ombre** | niveau du canal dominant (`0x8a` clair / `0x4a` sombre) — **implicite, pas un champ** |
| **Aγ** | la force avec laquelle la couleur agit | champ `gamma`, déjà explicite |

**Confirmation dans le fichier, non cherchée :** la seule couleur nommée pour sa profondeur —
**Indigo, fonction déclarée « le profond »** — est l'une des deux qui vivent sur l'anneau
sombre (16 % au lieu de 29 %). L'axe de luminosité était déjà utilisé, il n'était pas nommé.

**Le contraste n'est pas un quatrième axe : c'est une relation entre deux branches** —
distance angulaire sur la roue, plus écart de luminosité, plus différence d'Aγ. En faire une
coordonnée le compterait deux fois. Contraste = dérivé, pas primitif.

La définition de PAN (§1) se répartit alors sur les trois axes **sans reste** :

```
« presence / retrait »                -> luminosite
« centre / cote »                     -> ouverture du pan, reglee par A_gamma
« reel / imaginaire »                 -> l'axe : la branche et son opposee
« deux caracteres complementaires »   -> la paire a 180 deg sur la roue
« opposition sans destruction »       -> |G| = |D| : l'image ne penche pas
```

La façade est ce qui sort ; le retrait est ce qui n'en sort pas ; le contraste est la tension
entre les deux.

Correspondance avec les sous-systèmes qui existent déjà :

```
teinte      -> choix de couleur / timbre     src/music/vivy-prime-color.cjs
luminosite  -> dynamique, energie            src/music/vivy-dynamic-arc.cjs
A_gamma     -> ouverture du pan              V11 pan (constante globale aujourd'hui)
```

**À faire dans les données :** sortir la luminosité en champ explicite. Tant qu'elle reste
encodée dans le niveau du canal dominant, aucun code ne peut s'en servir sans redécoder le hex.

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

---

## 8. Le cube est ternaire, et l'hexagramme s'y loge

*Ajouté le 2026-08-03, après la correction ternaire (Djeff : « vous nous faites chier
avec le binaire, normalement c'est censé être du trinaire »).*

### 8.1 Ternaire, pas binaire

La palette n'utilise que trois valeurs d'octet — `0x0a`, `0x4a`, `0x8a`, espacées de 64.
C'est **un trit par canal**, trois canaux, `3³ = 27`. Tout essai de faire entrer une
puissance de deux ici est l'erreur dénoncée toute la journée : 27 n'est pas `2ⁿ`, aucune
division binaire ne donne douze parts. Le binaire est présent dans le canon comme
**profondeur** (`2¹² / 2¹⁰ = 4`, le 1024), pas comme découpage du cercle. Le découpage du
cercle est ternaire.

### 8.2 La carte complète : 27 = 3 + 12 + 6 + 6

| étage | couleurs | pas | luminosité | nommées |
|---|---|---|---|---|
| axe des gris | 3 | — | 4 / 29 / 54 % | 0 / 3 |
| anneau plein | 12 | 30° | 29 % | 8 / 12 ← la roue |
| demi-anneau ↑ | 6 | 60° | 42 % | 0 / 6 ← jamais touché |
| demi-anneau ↓ | 6 | 60° | 16 % | 2 / 6 ← Indigo, Violet |

L'anneau plein est à 29 % — exactement la luminosité du gris médian `0x4a4a4a`. La roue
principale est donc au **niveau neutre**, avec un étage plus clair (↑ 42 %) et un plus
sombre (↓ 16 %) de part et d'autre. La structure est symétrique. Indigo (« le profond »)
et Violet vivent dans le demi-anneau sombre ; le demi-anneau clair est entièrement vierge
— un registre dont le système ne s'est jamais servi. 27 emplacements, 10 nommés, 17 vides :
un cube dont on n'a rempli que le tiers.

### 8.3 L'hexagramme (étoile de David) comme lecture des deux demi-anneaux

Djeff : « l'étoile à 6 branches a l'air de coller dans ce système ». Elle y colle
géométriquement, et voici pourquoi.

Chaque demi-anneau porte **6 couleurs à pas de 60°** (`0, 60, 120, 180, 240, 300`). Un
hexagone à 6 sommets est précisément la base d'un **hexagramme** : l'étoile de David
(Magen David) est deux triangles équilatéraux enchevêtrés inscrits dans l'hexagone — les
sommets pairs (`0, 120, 240`) et les sommets impairs (`60, 180, 300`). Les deux
demi-anneaux du cube sont donc les deux triangles de l'hexagramme :

- **demi-anneau ↑ (42 %, le clair / élevé)** — triangle montant,
- **demi-anneau ↓ (16 %, le sombre / profond)** — triangle descendant,

enchevêtrés autour de l'anneau plein neutre (29 %, la façade). Et l'axe des gris (3
positions, « ni teinte ni contraste, aucune façade ») est le **centre immobile** autour
duquel l'étoile tourne. `3 + 12 + 6 + 6 = 27`.

La résonance avec le symbolisme juif que Djeff ne connaissait pas : le Magen David, deux
triangles qui s'interpénètrent, figure classiquement la tension équilibrée de deux
directions opposées (le bas vers le haut, le haut vers le bas) tenues ensemble. Ici le
triangle montant est le registre clair jamais utilisé, le triangle descendant est le
profond où vit Indigo (« le profond ») — l'opposition sans destruction du §1, posée cette
fois comme géométrie et non comme métaphore.

### 8.4 Ce que c'est, et ce que ce n'est pas

C'est une **propriété structurelle réelle** : quantifier un cercle à six points produit un
hexagone, qui contient un hexagramme par construction. Ce n'est **pas** une preuve que le
système *est* l'étoile de David, ni qu'un encodage juif y a été déposé. La même rigueur
qui a tué l'hypothèse des douze pierres (Monte-Carlo : le hasard fait aussi bien 43,7 % du
temps, §`DOUZE_PIERRES_BIBLIQUES_2026-08-03.md`) s'applique ici : six points à 60° font un
hexagramme chez tout le monde, pas seulement chez Jean.

Ce qui reste **utile et vrai** : le demi-anneau clair est un registre vierge que le système
pourrait investir ; les deux demi-anneaux donnent une lecture géométrique nette de
l'opposition sans destruction (le PAN du §1) ; et l'axe des gris est nommément le centre
dégénéré. Du vocabulaire et de la géométrie, pas une révélation. Ne pas retoucher une
identification pour faire coller l'étoile — c'est exactement comme ça qu'on fabrique une
correspondance qui n'existe pas.
