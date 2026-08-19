# L'épi tethete — règle de départage du rotator

*2026-08-19. Nommé par Djeff. Mesures reproductibles, voir §6.*

## 1. Ce que c'est

Une règle de départage pour un rotator construit sur les nombres non premiers.
Elle ne prédit pas les nombres premiers et ne prétend pas le faire : elle décide
d'un seul choix, celui qui se présente quand deux premiers sont à égale distance
d'une somme. Ce choix, mesuré ci-dessous, arrive une fois sur neuf et gouverne
tout le comportement à long terme.

## 2. Définitions

- `C = (1, 4, 6, 8, 9, 10, 12, 14, 15, …)` — suite des nombres non premiers
- `S_k` — somme cumulative des `k` premiers termes de `C`
- `P_k` — nombre premier le plus proche de `S_k`
- `Δ_k = S_k − P_k`
- `A_k = Σ (−1)^j Δ_j` — somme alternée : le rotator tourne un coup à gauche,
  un coup à droite

Les quarante premiers Δ, pour vérification :

```
-1, 0, 0, 0, -1, 1, 3, 3, 0, -2, 0, 2, 3, 3, 1, 2, 0, 1, -1, -1,
 1, 0, 2, 3, 3, 3, -4, 4, 4, 0, 3, 3, -5, 10, 0, 1, 1, 1, -4, 2
```

## 3. Le problème : l'égalité

Quand `S_k` est exactement à mi-chemin entre deux premiers, `Δ_k` vaut `+d` ou
`−d` selon le premier retenu. L'écart n'est pas petit : il vaut `2d`, tout de
suite, et il ne se résorbe jamais.

Le premier cas visible est **k = 34** : `S = 897`, avec 887 et 907 tous deux à
distance 10. Selon la convention, la somme alternée passe de −14 à **−24** ou à
**−4**. Ce n'est pas un détail d'implémentation, c'est une bifurcation.

Ces égalités représentent **2 302 cas sur 20 000**, soit 11,5 % des pas.

## 4. La règle — l'épi tethete

> En cas d'égalité, choisir le premier qui rapproche `A_k` de zéro.

Le rotator corrige donc sa propre dérive au moment précis où le choix est libre.
Rien n'est ajouté au modèle : on n'utilise que de l'information déjà disponible.

## 5. Mesures

Convention naïve (« toujours le plus petit premier ») contre l'épi tethete :

| N | règle | \|A\|max | A final |
|---:|---|---:|---:|
| 200 | plus petit | 129 | −63 |
| 200 | **épi tethete** | **47** | +25 |
| 5 000 | plus petit | 1 124 | −913 |
| 5 000 | **épi tethete** | **236** | +63 |
| 20 000 | plus petit | 1 641 | −1 027 |
| 20 000 | **épi tethete** | **693** | **−1** |

À N = 20 000, `S` atteint 226 926 653.

**Ce que ça montre.** L'excursion maximale est divisée par plus de deux à toutes
les échelles. Rapportée à la matière traversée, la dérive est négligeable :
693 contre 226 millions, soit trois millionièmes.

**Ce que ça ne montre pas.** Le rotator n'est pas borné. `|A|max` suit
approximativement `√N` — 47, 113, 236, 693 quand `√N` fait 14, 32, 71, 141 : le
rapport reste à peu près constant. C'est une marche diffusive lente, pas un
système fermé. Le `A final = −1` à N = 20 000 est très probablement une
coïncidence et ne doit pas être lu comme une propriété.

La différence entre les deux règles n'est pas visible avant quelques centaines
de termes. Sur 40 termes on ne voit que du bruit.

## 6. Reproduire

```
python3 docs/research/prime_spiral/epi-tethete.py
```

Test de primalité Miller-Rabin déterministe sous 3,2·10⁹ (bases 2, 3, 5, 7).
Attention au cas `S = 1` : il n'existe pas de premier en dessous, il faut borner
la recherche à 2 sous peine de descente infinie.

## 7. Ouvert

- **Le modulo.** Djeff garde pour lui le nombre de positions du rotator. Tant
  qu'il n'est pas fixé, `A_k mod M` n'est pas calculé ici.
- **Le comportement au-delà de 20 000 termes** n'est pas mesuré. `S` croît comme
  `k²/2`, donc le coût du calcul croît vite.
- **Pourquoi la correction ne borne pas.** La règle ne s'applique qu'aux
  égalités ; les 88,5 % de pas restants dérivent librement. Une variante qui
  corrigerait aussi hors égalité reste à définir — et changerait le modèle.

## 8. Pistes écartées, mesurées le même jour

Gardées ici pour ne pas les refaire.

**Superposition de peignes** — `W_k(n) = (−1)^k sin(2π(n−x_k)/λ)`, sommée sur
les premiers. Testée sur n < 720, dans six variantes du terme diviseur (par
`p_k`, par le rang, par `log p_k`, avec et sans décalage `x_k`) : **toutes
donnent 32 %** de premiers dans les 60 plus fortes interférences. Le poids
décroissant écrase les peignes suivants et la somme se réduit au premier terme,
`p = 2` : on ne mesure que « n est impair », qui vaut 35 % à lui seul. Le crible
« non divisible par 2, 3, 5, 7 » donne 76 %. La superposition perd de
l'information : un sinus proche de son maximum ne dit pas « p ne divise pas n »,
il dit « n est à mi-chemin entre deux multiples de p ».

**Roues primorielles** — précision par zone, mesurée jusqu'à 30030 :

| zone | primorielle | précision |
|---:|---:|---:|
| 5 | 30 | 78 % |
| 7 | 210 | 64 % |
| 11 | 2310 | 52 % |
| 13 | 30030 | 43 % |

Passer à la zone suivante redresse la roue mais ne rattrape jamais : le gain de
chaque premier ajouté croît comme `log p` (Mertens), la densité des premiers
chute comme `1/log n ≈ 1/p` sur la zone étendue. La précision tend vers zéro
quelle que soit la zone. Dans une plage **bornée**, en revanche, la roue 210
reste le meilleur outil mesuré ici.
