# Prime Spiral / ZEN - Cartographie spatiale imaginaire

Date : 2026-06-04

Statut : hypothèse canonique Funesterie, à tester numériquement. Ce document ne
pose pas une preuve mathématique ; il fixe le modèle mental à utiliser pour les
prototypes ZEN, Qflush et Prime Spiral.

---

## Idée centrale

Le modèle ne doit pas être compris comme une simple formule de génération des
nombres premiers. Il décrit une **cartographie spatiale imaginaire**.

Chaque imaginaire définit un emplacement dimensionnel :

```text
R, -R, +i, -i, +j, -j, +k, -k, ...
```

ou, dans la version hypercomplexe :

```text
Q(n) = a + bi + cj + dk + el + fm + ...
```

Les nombres premiers ne sont alors qu'une projection particulière : la trace du
modèle sur l'axe réel. Avec un seul symbole oui/non, on voit surtout les réels et
les premiers. Avec plusieurs symboles imaginaires, on cartographie plus vite la
structure, mais on ne regarde plus seulement les nombres premiers.

---

## Rôle de pi

`π` ne sert pas ici à injecter une constante au hasard dans la formule. Il sert à
relier la carte dimensionnelle à un plan circulaire.

Lecture Funesterie :

```text
axes imaginaires -> carte spatiale
π                 -> anneau / rabattement circulaire
taille de l'anneau -> zone lue dans la carte
```

La métaphore correcte est la Stargate :

```text
nombre n
↓
projection sur axes imaginaires
↓
anneau circulaire π
↓
zone / adresse / passage
```

La taille de l'anneau n'est donc pas un simple `7#` ou `7!`. Ces valeurs peuvent
rester des tests historiques, mais la vraie zone vient du **nombre d'imaginaires
ou de symboles** retenus pour cartographier le nombre.

---

## Correction des anciennes zones

Ancienne piste :

```text
Z_7# = 210
Z_7! = 5040
```

Nouvelle lecture :

```text
Z_m(n) = zone induite par m axes/symboles imaginaires
```

où `m` représente la profondeur de cartographie :

```text
m=1  -> projection quasi réelle / oui-non
m=5  -> résonance hypercomplexe courte
m=7  -> cartographie plus riche des positions
m=18 -> lecture liée aux modes imaginaires déjà notés
```

La question de recherche devient :

```text
combien d'axes imaginaires faut-il pour cartographier proprement n ?
```

et non :

```text
quel primorial ou quelle factorielle donne la zone ?
```

---

## Lien avec ZEN

Pour ZEN, cette idée est importante parce qu'un conteneur `.zen` ne doit pas être
seulement une archive plate. Il peut stocker une carte de fragments.

Lecture ZEN :

```text
fragment
↓
coordonnées imaginaires
↓
anneau / zone
↓
ordre de reconstruction
↓
payload final
```

Sans la clé, on voit seulement des fragments opaques. Avec la clé, on retrouve :

- la zone ;
- les axes utilisés ;
- l'ordre de reconstruction ;
- le type de payload ;
- la relation entre fragments.

Phrase canonique :

> Les nombres premiers sont la projection réelle ; ZEN utilise la carte
> imaginaire complète.

---

## Tests à prévoir

1. Tester une base `m` axes imaginaires au lieu d'une zone `Z_7#` ou `Z_7!`.
2. Comparer les familles `m = 1, 2, 3, 5, 7, 18`.
3. Mesurer si les nombres premiers apparaissent comme traces réelles stables.
4. Mesurer si d'autres structures émergent pour fichiers, audio, image, graphe
   ou fragments ZEN.
5. Séparer les résultats :
   - détection de premiers ;
   - cartographie de positions ;
   - routage ZEN ;
   - compression ou reconstruction.

---

## Prudence

Ce canon ne dit pas que les mathématiques classiques sont fausses. Il dit que la
référence utile pour Funesterie peut être une projection différente :

```text
reel seul      -> nombres premiers visibles lentement
carte imaginaire -> structure spatiale plus complète
π / anneau     -> passage entre carte et zone
```

