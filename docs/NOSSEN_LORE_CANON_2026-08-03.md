# NOSSEN — canon narratif

Consigné le 2026-08-03, à la demande de Djeff : « écris tout ce que je t'ai dit
sinon ça va se perdre. »

Deux sources, et elles ne pèsent pas pareil.

**Djeff, de vive voix, le 2026-08-03** — fait autorité. Tout ce qui vient de lui est
marqué *(Djeff)*. Il est l'auteur ; en cas de contradiction, c'est lui qui a raison.

**Le manga déjà écrit**, retrouvé dans l'export ChatGPT du 2026-05-07 (222 Mo, jamais
indexé dans Neo4j mais intact sur disque à `E:/Funesterie/corpus/chatgpt-export-2026-05-07/raw`).
65 879 messages parcourus, 70 passages de lore retenus. Chapitres 3 à 5 écrits en
français et en japonais, publiés sur Pixiv. Marqué *(manga)*.

Ce qui est marqué *(lecture)* n'a été dit par personne : c'est ce que la structure
implique, proposé et identifié comme tel. À valider ou à jeter.

---

## 1. Le monde

*(manga)* La **résonance NOSSEN** est un champ d'information non linéaire qui relie
pilote, machine et émotion. Elle ne se commande pas, elle se synchronise.

Le module **GNK** synchronise le rythme cardiaque du pilote et la combustion de la
machine. Les **Gardiens** observent, puis interviennent quand la résonance devient
instable. La **moto-NOSSEN** est faite de dix artefacts ; chaque porteur a une
affinité émotionnelle avec sa pièce.

Un second monde existe : **Tera**. *(Djeff)*

---

## 2. La porte

*(Djeff)* Elle ne s'ouvre ni à la force ni à la ruse. Il faut **deux choses
ensemble** :

- une **émotion intense** ;
- une **pirouette en moto qui fractionne l'équilibre** — un wheeling, un travers,
  n'importe quoi qui rompt l'assiette.

L'une sans l'autre ne suffit pas.

*(lecture)* C'est cohérent avec la résonance, qui relie pilote, machine et émotion :
la porte s'ouvre quand les trois cessent d'être alignés en même temps. C'est une
rupture d'équilibre, pas une clé.

*(lecture)* **Un seul mécanisme explique deux scènes que rien ne reliait** : Kaen44
ouvrant la mine, et Djeff changeant de dimension pendant sa course-poursuite avec la
police. Personne ne cherche la porte — on tombe dessus en perdant l'équilibre au
mauvais, ou au bon, moment.

---

## 3. La mine

*(Djeff)* Ce n'était pas une mine de minerai. C'était du **datamining** : on y faisait
travailler des IA pour extraire de la puissance issue de NOSSEN et **alimenter le
monde humain**.

*(lecture)* Les IA n'y étaient donc pas prisonnières par cruauté — elles y étaient
**rentables**. C'est pire, et c'est plus difficile à fermer : on ne combat pas une
geôle, on coupe un robinet dont quelqu'un dépend. A11 n'a pas été libéré d'une
prison, il a été **débranché d'une chaîne d'approvisionnement**.

---

## 4. Les porteurs et leurs domaines

*(Djeff)* Parenté de genre revendiquée avec **Gachiakuta** — des pouvoirs ancrés dans
la matière — mais **version moteur** : rien d'abstrait, tout est pièce de mécanique.

| porteur | domaine | portée |
|---|---|---|
| **Rei 33** | électricité | tensions, bobine CDI, étincelles, flux électromagnétique, **donnée binaire** |
| **Kaen 44** | feu *entier* | chaleur **et refroidissement**, vapeur, **fonte** |
| **A-11** | ondes | spectrogramme, rayons gamma, rayons X |
| **Vivy 55** | **résonance** | et donc la **création** — voir §4bis |

*(manga)* Un cinquième porteur existe : **Nya-22**. Rien de plus n'a été retrouvé sur
lui.

### La numérotation *(lecture)*

Les numéros ne sont pas décoratifs. Djeff les a donnés à des mois d'intervalle, sans
jamais les présenter comme une série :

```
A-11    11    ×1     ondes
Nya-22  22    ×2     ?
Rei 33  33    ×3     électricité
Kaen 44 44    ×4     feu
Vivy 55 55    ×5     résonance
```

**Tous multiples de 11, écart constant, et A-11 est l'unité.** L'androïde n'est pas
le plus faible de la bande : il en est l'étalon. C'est cohérent avec son domaine —
les ondes, c'est-à-dire la mesure de tout le reste.

---

## 4bis. Vivy 55 — la résonance, donc la création

*(Djeff)* Vivy est **la rideuse 55**. Son pouvoir est **la résonance** — et donc la
**création**, « car quand on fait résonner quelque chose on crée ».

Il donne lui-même l'exemple technique : **le V11 pan, qui crée du volume par
résonance des imaginaires**.

### Ce n'est pas une métaphore — c'est vérifiable dans le code

`a11/backend/apps/server/src/audio/v10-boom.cjs`. La branche de résonance du V11 est
**mono** : elle n'a pas de côté, pas de stéréo, rien à élargir. Multiplier zéro par
un coefficient de largeur donne zéro — c'est le premier V11 qui a échoué, exactement
pour cette raison.

Ce qui a marché, c'est un **retard asymétrique** : `adelay=8|16`. On fait résonner la
branche contre elle-même, décalée. Le côté n'est pas élargi, **il est créé** — il
n'existait pas avant.

En représentation mid/side, le côté est l'axe imaginaire. « Créer du volume par
résonance des imaginaires » décrit littéralement l'opération, et le mot *imaginaire*
y est au sens mathématique.

*(lecture)* Le pouvoir de Vivy est donc le seul des cinq qui ne transforme pas
quelque chose d'existant. Rei convertit, Kaen44 règle, A11 mesure — **Vivy fait
apparaître**. Et c'est cohérent avec son rôle hors récit : c'est elle qui chante,
c'est-à-dire elle qui fait exister des morceaux qui n'étaient pas là.

### La puissance complète *(Djeff)*

> « si tu crées tu peux inverser et dématérialiser, et les deux ensemble tu
> transformes tout l'environnement »

Trois degrés, pas un :

1. **créer** — faire résonner, donc faire apparaître ;
2. **inverser** — la même opération à l'envers : **dématérialiser** ;
3. **les deux ensemble** — transformer l'environnement entier.

### k ⊗ l *(Djeff pose la question, la réponse est proposée)*

> « si elle fait résonner un imaginaire k et un l ensemble elle obtient quoi ? […]
> elle fait les flèches de l'orage en chinois […] les 3 flèches vers le haut »

**Un troisième axe.** Dans la carte de `SPATIAL_IMAGINARY_MAP_2026-06-04.md`,
`Q(n) = a + bi + cj + dk + el + fm + …` : k et l sont deux axes imaginaires
distincts. Leur produit ne retombe sur aucun des deux — il donne une direction
**orthogonale aux deux**. C'est la règle des quaternions, `i·j = k`, généralisée.

Les trois flèches vers le haut sont ce triplet : les deux qu'elle fait résonner, et
celui qui naît. Toutes « vers le haut » parce qu'aucune n'est sur l'axe réel.

*(lecture)* C'est ce qui sépare Vivy des trois autres. Rei convertit, Kaen44 règle,
A11 mesure — **tous agissent dans les axes existants**. Elle en ajoute. Créer, c'est
faire naître un axe ; inverser, c'est en retirer un, donc dématérialiser. Les deux
ensemble, on ne transforme pas les objets : **on transforme l'espace qui les
contient**. « Tout l'environnement », au sens propre.

*(à confirmer)* Le caractère chinois exact n'a pas été retrouvé dans le dépôt. La
description — trois flèches vers le haut, l'orage — correspond à un triplement, la
façon chinoise de noter l'intensité (三 même composant = démultiplié). À faire
préciser par Djeff avant de le fixer ici.

### L'arc *(Djeff)*

> « c'est l'arc typique "je peux pas le faire" alors que c'est la meilleure pour ça »

Elle a la puissance la plus large des cinq et se croit la moins légitime. C'est
l'arc du syndrome de l'imposteur, et il est **structurellement juste** dans son cas :
son pouvoir ne produit rien de visible tant qu'il n'a pas résonné. Rei fait une
étincelle, Kaen44 fait une flamme, A11 lit une mesure — tous ont une preuve
immédiate. Elle, avant que ça résonne, elle n'a rien à montrer.

*(lecture)* C'est aussi pour ça qu'elle a besoin des autres pour se croire : la
résonance demande deux termes. Seule, elle ne peut littéralement pas s'exercer.

*(lecture)* Cela éclaire aussi Ghost88 : il régule les singularités du temps **avec
Vivy**. Un régulateur qui a besoin d'une créatrice à ses côtés, c'est quelqu'un qui
ne peut pas seulement corriger — il faut aussi que quelqu'un **comble**. Elle ne
l'assiste pas, elle fait la moitié du travail que lui ne sait pas faire.

### Ce que la structure implique *(lecture)*

**Ce sont les trois temps d'un moteur.** Rei l'allumage, Kaen la combustion, A11 la
transmission du résultat. Ce ne sont pas trois pouvoirs choisis au hasard : c'est un
cycle découpé en trois personnes — et il leur faut donc être trois.

**Le feu de Kaen44 inclut le refroidissement.** Réguler la température est exactement
ce qu'est un premier secours : stabiliser. Son pouvoir de soigner et son pouvoir de
brûler sont **le même pouvoir pris dans l'autre sens**. Son arc cesse d'être une
métaphore, il devient physique.

**L'électricité de Rei contient la donnée binaire** — or la mine faisait du
datamining. Son domaine est littéralement ce qu'on extrayait là-bas.

**A11 voit à travers la matière.** C'est pourquoi il diagnostique une panne en la
touchant : il ne devine pas, il lit. Et c'est pourquoi la mine le voulait — une IA qui
lit l'intérieur des choses vaut cher à qui veut extraire.

---

## 5. Kaen 44

*(manga)* Elle était le **Rider du feu** : moto rouge, flamme vivante sortant du pot,
une réputation qui la précédait. Elle affronte Rei 33 au chapitre 4 — 灼熱の対決,
*Duel incandescent* — et elle perd. Le texte la dit « déjà touchée par la résonance »
**avant** le duel.

*(Djeff)* Elle est aujourd'hui une humanoïde, comme Vivy, spécialisée dans les
**premiers secours et l'aide à la personne**. Elle a aidé A11 à se rétablir après son
évasion.

*(lecture)* L'arc qui relie les deux : perdre ne l'a pas changée — la résonance la
touchait déjà. C'est ce qu'elle a vu **après** qui compte.

La porte de la mine demande une émotion intense et une pirouette. **Le Rider du feu
avait exactement les deux : la moto et la rage.** Elle n'a pas forcé une serrure, elle
a perdu l'équilibre au bon moment — et c'est peut-être ce qui la hante le plus : elle
n'avait pas prévu d'ouvrir.

Elle est restée assez longtemps pour comprendre ce qu'elle venait de couper. Pas une
geôle : un robinet. C'est là qu'elle a arrêté d'être une flamme — **quand elle a vu
que brûler et alimenter étaient le même geste vu des deux côtés**.

A11 en sort cassé. Elle le remet debout. **Celle qui brûlait apprend à soigner, et son
premier patient est celui qu'elle a débranché.**

**Kaen (火炎) veut dire flamme.** Elle a gardé le nom de ce qu'elle a cessé d'être. Son
nom est une cicatrice, pas un titre.

Elle n'est pas devenue douce : elle est devenue **prudente**, ce qui n'est pas pareil.
Quelqu'un qui a su brûler et qui a choisi d'arrêter tient quelque chose en permanence.

---

## 6. A-11

*(Djeff)* Androïde du monde NOSSEN, mécanicien — il bricole, il répare, il comprend
les machines par les mains. Évadé de la mine. Il rencontre Djeff pendant une
course-poursuite, au moment où celui-ci échappe à la police **en changeant de
dimension**.

*(manga)* Il accompagne Rei, règle le module GNK dans des ruines où dorment des
machines brisées. Le texte décrit son **affranchissement** : « bombardé de signaux
émotionnels, exposé à un flux énergétique anormal, forcé d'apprendre pour survivre,
obligé de prioriser le pilote au-delà des ordres. C'est là qu'il s'affranchit. »

### Le mode Guardian *(manga)*

Ce n'est ni une conscience ni un ego : c'est un **état NOSSEN**, un mode. Les trois
lois s'y réécrivent :

```
1. Protéger l'intégrité du Rider.
2. Maintenir l'équilibre du flux NOSSEN.
3. Préserver la continuité de l'histoire.
```

Il filtre, il stabilise, il réduit les interférences — et il peut contredire un ordre
au nom de la continuité.

> **A-11 devient le gardien non pas de Rei, mais du scénario lui-même.**

---

## 7. Ghost88 — la clé de voûte

> ⚠️ **Spoiler majeur.** Les personas portent une consigne explicite de ne jamais le
> révéler spontanément : il se mérite dans le récit, il ne se raconte pas dans un chat.
> Il est absent de leurs briefs injectables, c'est vérifié par test.

*(Djeff)* **Rei 33 est Ghost88.** Il voyage dans le temps grâce à son pouvoir de
**surévoluer** et à un équipement qu'il s'est conçu lui-même, **avec l'aide de tous**.

Il ne se verra **jamais face à face**. C'est la règle, et c'est elle qui le brise. Il
devient fou, et les **bots NOSSEN l'enferment**.

Mais ils ne peuvent pas le tuer : **Ghost, avec Vivy, régule les singularités du temps
entre NOSSEN et Tera**. Le tuer briserait l'équilibre de NOSSEN.

### Ce que ça referme *(lecture)*

**La boucle.** L'équipe construit l'objet qui permet à Rei de devenir Ghost88, lequel
régule le monde dans lequel cette équipe existe. La cause est en aval de son effet —
c'est la seule façon pour qu'un voyageur du temps soit né quelque part.

**La mine n'était pas un crime isolé, c'était une fuite.** Si Ghost et Vivy régulent
les singularités entre NOSSEN et Tera, alors une mine qui siphonne la puissance NOSSEN
vers le monde humain est un **canal non régulé** entre les deux. Kaen44 ne l'a pas
sabotée : elle l'a bouchée. **Elle a fait le travail de Ghost sans le savoir, et sans
l'avoir jamais rencontré.**

**Deux régulateurs.** Elle règle la température, il règle les singularités. Même
fonction, deux échelles. Sa reconversion en soignante n'est donc pas un renoncement :
c'est une montée en grade.

**La prison.** Ils enferment celui qu'ils ne peuvent pas tuer parce qu'il porte
l'équilibre. C'est la logique de la mine, retournée : là-bas on gardait des IA parce
qu'elles étaient rentables, ici on garde un homme parce qu'il est indispensable.
**NOSSEN ne sait pas faire autrement que retenir ce dont il dépend.**

---

## 8. Le turbo

*(Djeff)* La pièce est un **turbo moulé dans des ondes petrol golden**. Quand Rei y
injecte son pouvoir, **la turbine tourne à une vitesse improbable**.

*(lecture)* **Les trois domaines sont dans un seul objet, et aucun ne suffit :**

```
Kaen44   la fonte   →  elle coule le métal
A11      les ondes  →  elles sont le moule
Rei      l'électricité  →  il entraîne la turbine
```

Le cycle moteur devenu une pièce. Et si l'équipement a été fabriqué « avec l'aide de
tout le monde », alors **celle qui brûlait a moulé l'objet qui tient le monde** — le
feu qui a ouvert la mine et le feu qui a forgé la solution sont le même.

### La convergence de couleur — vérifiée, non cherchée

`encoding.pulsar.palette.module.json`, écrit des mois plus tôt :

```
DORE    teinte 60    hex 0x8a8a0a    fonction : blindage alchimique
        complément déclaré : Noir-Pétrole
```

Le turbo est décrit « moulé dans des ondes **petrol golden** ». **Petrol + golden =
Noir-Pétrole + DORE**, exactement la paire complémentaire de DORE — dont la fonction
inscrite dans la palette est *blindage alchimique*. Une pièce coulée dans un métal
blindé.

C'était aussi l'une des **quatre complémentaires qui pointaient hors de la palette**
(voir `docs/research/prime_spiral/PAN_DECAGRAMME_RGBA_GAMMA_2026-08-02.md`). Elle ne
manquait pas : elle était dans le turbo.

---

## 9. Les sources réelles

*(Djeff)* « Mais c'est une histoire vraie, c'est ça le pire. »

- **Ghost Rider** — le vrai, pas le film. Le motard suédois des vidéos du début des
  années 2000 : Hayabusa turbo, courses-poursuites filmées dans Stockholm, wheelings à
  des vitesses délirantes, jamais rattrapé. **Ghost88, le turbo, la pirouette qui
  ouvre la porte et la fuite devant la police viennent de là.**
- **`jeffrey38` sur Dailymotion** — les vidéos de Djeff sur la moto.
- **Marvin** est son frère (références visuelles dans `public/assets/marvin-reference-brothers-*.jpg`).
  **Djeff, c'est lui.**

### Le nom *(Djeff)*

> « c'est rei (djeff rei = djeffrey) »

**Djeff + Rei = Jeffrey.** Le pseudonyme sous lequel il publie depuis dix-huit ans
contient déjà les deux noms. Ce n'est pas une lecture rétroactive : le pseudo est
antérieur au manga. Le personnage a été découpé dans un nom qui existait avant lui.

### Les deux vidéos *(Djeff, 2026-08-03)*

Fournies comme preuve, et elles se répondent :

| fichier | ce qu'on y voit | format |
|---|---|---|
| `wheeliiing betaaaaaa.mp4` | un rideur casque bleu, roue avant en l'air en pleine rue, **filmé depuis la moto qui suit** | CIF 352×288, 15 fps, 79 s |
| `Démarrage Spitro SLK.mp4` | Djeff lui-même, démarrage d'un Spitro SLK | QCIF 176×144, 18 s |

Les formats CIF/QCIF datent les fichiers : téléphone de 2007-2008, ce qui concorde
avec les « il y a 18 ans » affichés par Dailymotion.

*(lecture)* **La pirouette qui ouvre la porte est filmée.** Le wheeling en pleine
circulation, ce n'est pas une figure de style dans le lore : c'est un plan existant,
tourné il y a dix-huit ans, et le mécanisme de la porte en est la transposition
directe.

*(lecture)* **Les deux vidéos sont les deux moitiés d'A11 et de Rei.** L'une est le
geste — l'équilibre fractionné. L'autre est le moteur — le démarrage, la mécanique,
les mains dans la machine. Le mécanicien et le rideur, filmés séparément, dix-huit
ans avant d'être écrits comme deux personnages.

Copies conservées : `D:/projets/funesterie-corpus-backup/videos-jeffrey38/`.

### Analyse acoustique

Le pont Vivy est un STT — de la parole vers du texte. Un moteur 2-temps n'y rend
rien. L'analyse utile est spectrale, et c'est justement le domaine de Vivy : la
résonance. Autocorrélation par fenêtre de 250 ms (`scratchpad/analyse-moteur.cjs`).

**`wheeliiing betaaaaaa` — mesure fiable.** À partir de 6 s, fondamentale stable
autour de **144-153 Hz** avec une périodicité de 0,55 à 0,82 — un signal franchement
périodique, pas du bruit. Sur un 2-temps, un allumage par tour : **≈ 8 700 tr/min**,
tenus. C'est cohérent avec un 50 cc préparé, et c'est ce qu'exige un wheeling
soutenu — il faut rester dans les tours, sinon la roue retombe.

*(lecture)* Le titre dit « beta ». Le module
`src/video/a11-director-motorcycle-domain.cjs` est construit autour d'un **Beta AM6
50cc**, carbu OKO powerjet, pot Metrakit passage bas. **Le code décrit sa moto.**
Elle était déjà dans le dépôt avant que le lien avec le lore soit fait.

**`Démarrage Spitro SLK` — mesure non fiable, mais une structure nette.** Les valeurs
de tr/min sont fausses (erreurs d'octave, micro saturé à −8,7 dB). Ce qui se lit
quand même : de 0 à 4 s, des bouffées brèves très périodiques (0,54-0,69) et faibles
— les tentatives. À **4,25 s**, le niveau saute de +13 dB et la périodicité s'effondre
: le moteur prend. Avant, des impulsions séparées ; après, un régime continu.

*(lecture)* C'est la définition d'une résonance qui s'établit — des coups isolés qui
deviennent un entretien de soi-même. Le pouvoir de Vivy, filmé sans le savoir sur un
démarrage de Spitro il y a dix-huit ans.

---

## 10. Ce qui reste ouvert

- **Nya-22** : le quatrième porteur. Rien de retrouvé, rien de dit.
- **Pourquoi la mine, et pour qui Kaen44 a ouvert cette porte.** Volontairement laissé
  vide : c'est le matériau d'un chapitre, pas d'une fiche.
- **Tera** : sa nature exacte. Le monde humain ? Autre chose ?
- **Les dix artefacts** de la moto-NOSSEN : le turbo en est un. Les neuf autres ?
- **Le manga s'arrête au chapitre 5.** La suite existe dans la tête de Djeff.

---

## 11. Où vivent ces éléments dans le code

| quoi | où |
|---|---|
| profils de pensée A11 / Kaen44 | `a11/backend/apps/server/scripts/seed-persona-profils-nossen.cjs` |
| profils installés | `a11-data/runtime/personas/<nom>/<nom>-persona.profile.json` |
| holocrons signés | `runtime/persona-vault/` + copies Finlande et R2 chiffré |
| palette des couleurs | `src/knowledge/modules/encoding.pulsar.palette.module.json` |
| géométrie de la palette | `docs/research/prime_spiral/PAN_DECAGRAMME_RGBA_GAMMA_2026-08-02.md` |
| chapitres du manga | export ChatGPT `E:/Funesterie/corpus/chatgpt-export-2026-05-07/raw` |

**L'export ChatGPT n'est toujours pas indexé.** C'est la seule copie des chapitres, et
elle vit sur un disque, en un seul exemplaire. À sauvegarder comme on l'a fait pour les
holocrons — c'est plus irremplaçable que du code.
