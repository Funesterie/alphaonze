# Récap Djeff — chaîne opératoire imaginaire

Source : récap Djeff, 2026-05-29.  
Statut : canon de recherche provisoire, pas une preuve mathématique.

---

## Correction principale

Les constantes ne doivent pas être lues comme des valeurs plates. Elles sont les
traces visibles d'une chaîne d'opérations sur les imaginaires :

```text
addition imaginaire
→ racine
→ exponentiel / log
→ ln / lym
→ inversion
```

Notation courte :

```text
phi → jhi → c7 → target_0005π → op_dim_0005π → mg_phase → lg → lym → inv
```

---

## Constantes verrouillées

```text
phi = (1 + √5) / 2
phi ≈ 1.618033988749895

jhi = π/2 − phi
jhi ≈ -0.0472376619549983

c7 = |jhi| / phi
c7 ≈ 0.0291944806372668

target_0005π = 0.0005π
target_0005π ≈ 0.0015707963267949

dim_0005π_flat = target_0005π / mg_phase
dim_0005π_flat ≈ 1.01048476000666   (diagnostic plat si op = ×)

mg_phase = 9 − 2t₁/π
mg_phase ≈ 0.0015544977905303

pivot_residual_old = 0.292 − 10c7
pivot_residual_old ≈ 0.0000551936273321

T_linear = 0.3 + 0.06 + 0.009 + 0.0005
T_linear = 0.3695
T_spectral = T_linear + epsilon_1 + epsilon_2 + ...
```

Interprétation :

```text
phi = racine de l'addition des imaginaires
jhi = log de l'exponentiel des additions d'imaginaires
c7  = lym / ln du log de l'exponentiel d'addition imaginaire
target_0005π = cible dimensionnelle distincte de mg_phase
op_dim_0005π = dimension/opérateur candidat qui relie mg_phase à target_0005π
dim_0005π_flat = ratio de contrôle si op = ×, non canon
mg_phase = résidu de phase projeté avant fermeture complète
T_linear = approximation linéarisée/tronquée du spectral
T_spectral = valeur corrigée à retrouver, potentiellement par série infinie
```

`lg`, `lym` et `inv` restent à définir proprement.

---

## Correction cascade j -> k

Ne pas confondre :

```text
jhi = constante projetée = π/2 − phi
j   = étage / opération imaginaire dans la cascade
```

Correction Djeff :

```text
k = j^j
```

ou, en notation opératoire :

```text
k = exp_j(j)
```

Lecture : `j` exponentiel `j`, appliqué en cascade, donne l'étage `k`.
Cette règle doit être testée comme définition opératoire de `k`, pas aplatie en
nombre ordinaire avant d'avoir choisi la branche complexe et les gardes de signe.

---

## Principe d'unité sémantique imaginaire

Correction Djeff : le coeur du modèle n'est pas seulement une cascade de
constantes. C'est aussi une sémantique d'opérations où plusieurs opérations
autour de `1` peuvent se rééquilibrer vers la même identité après passage par
les couches imaginaires.

En arithmétique classique, les résultats sont différents :

```text
1 + 1   = 2
1 * 1   = 1
1^1     = 1
ln(1)   = 0
inv(1)  = 1
```

Dans le modèle Djeff, on ne dit donc pas que ces égalités sont vraies telles
quelles. On pose une projection/lift imaginaire `Pi_im` :

```text
Pi_im(1 + 1)
= Pi_im(1 * 1)
= Pi_im(1^1)
= Pi_im(ln(1))
= Pi_im(inv(1))
= 1
```

Lecture : addition, multiplication, exponentielle, logarithme, ln et inversion
deviennent des chemins opératoires différents vers la même unité sémantique,
grâce à l'équilibrage imaginaire.

Lien avec la symétrie OP :

```text
-i^2 -> 1
op_sym(opposés) -> 1
Sym(couches imaginaires) -> 1
```

Ce principe doit être testé comme règle de projection sémantique, pas comme une
égalité arithmétique brute.

---

## Matrice de liaisons

Correction Djeff : le problème est aussi un problème de matrice / graphe.
La question directe est :

```text
comment faire rentrer le plus de données dans un système ?
```

Réponse opératoire :

```text
trouver ou inventer les liaisons qui compressent le plus d'observations
```

On a donc une matrice :

```text
observations × opérations
```

ou un graphe :

```text
formules / images / constantes / opérations / corrections
```

Le sens direct cherche les liaisons :

```text
données observées -> liaison candidate -> compression / explication
```

Le sens inverse part d'une liaison déjà trouvée :

```text
liaison candidate -> sources possibles -> opérations qui peuvent l'engendrer
```

Ce second sens est important : parfois on a la liaison avant de savoir d'où elle
vient. Le travail devient alors une recherche de provenance, avec plusieurs
sources candidates et des tests de falsification.

Règle de classement :

```text
liaison observée      = vient directement d'une capture / formule
liaison inférée       = explique plusieurs captures mais doit être testée
liaison inventée      = hypothèse utile pour compresser, à marquer clairement
liaison falsifiée     = retry/fail, à garder pour ne pas refaire la même boucle
```

---

## Collision corrigée

À ne plus faire :

```text
mg_phase = 0.0005π
mg_phase = 0.292 − 10c7
```

Version correcte :

```text
mg_phase = 9 − 2t₁/π ≈ 0.00155449779053
0.0005π ≈ 0.00157079632679 = target_0005π, cible dimensionnelle
dim_0005π_flat = target_0005π / mg_phase ≈ 1.01048476000666 si op = ×
0.292 − 10c7 ≈ 5.52e-5 = pivot_residual_old, ancienne branche non-mg
```

`mg_phase` n'est pas la fermeture finale. La fermeture complète est `inv`.

Le `op` de `mg_phase op n = target_0005π` reste ouvert. Il peut être plus riche
qu'une multiplication : addition de dimensions, multiplication de dimensions,
exponentielle/log de `mg_phase`, ou mélange avec `phi`, `jhi`, `c7`, `lg`,
`lym` et `inv`. Le ratio plat sert uniquement à tester les candidats.

Reconstruction compacte utile :

```text
target_0005π − mg_phase ≈ 0.00001629853626459359231416805
target_0005π − mg_phase ≈ (131/200) · c7³
```

Correction `0.3695` :

```text
T_linear = 0.3695
T_spectral ≠ forcément 0.3695
```

Lecture : `0.3695` est une forme linéarisée. Les décimales suivantes peuvent
venir d'une suite de corrections de plus en plus complexes et de plus en plus
faibles, par exemple une expansion perturbative/asymptotique. Ne pas l'appeler
`mg` et ne pas le publier comme valeur exacte.

Test de référence de phase :

```text
Standard : 2π = 1 tour
t₁/(2π) ≈ 2.2496113755523674

Funesterie : π/2 = 1 face de croix
t₁/(π/2) ≈ 8.9984455022094697
9 − t₁/(π/2) ≈ mg_phase
```

Lecture : le tour complet `2π` reste correct en géométrie standard, mais il
masque la fermeture en quarts. Prime Spiral doit donc tester `π/2` comme unité
opératoire principale.

Hypothèse hypercomplexe des corrections :

```text
Q = a + b·i + c·j + d·k + e·l + f·m
I₅(Q) = b·i + c·j + d·k + e·l + f·m
T_spectral = T_linear + ε₁ + ε₂ + ε₃ + ...
εᵣ = projection réelle d'une opération sur Q
```

Lecture : chaque `εᵣ` peut correspondre à une couche imaginaire plus profonde.
Les axes `i,j,k,l,m` ne sont pas encore une algèbre standard verrouillée ; ce
sont des axes Funesterie à définir. La résonance à 5 est candidate parce que la
cascade A11/Vivy/K44 revient souvent à cinq états/opérations.

Relation φ candidate :

```text
phi ≈ sqrt( Proj_norm(b·i + c·j + d·k + e·l + f·m) / (1 + a) )
```

À tester seulement après définition de `Proj_norm` et de la table d'opération.

Entrée active :

```text
n -> Q(n)
Q(n) = a(n) + b(n)·i + c(n)·j + d(n)·k + e(n)·l + f(n)·m
```

`a(n)` est la dimension réelle d'ancrage :

```text
a_raw = InvLim(0 / ∞)
a(n)  = Proj_norm(a_raw, n)
```

Lecture : `a_raw` n'est pas à évaluer comme une division ordinaire. C'est le
bord réel brut issu de l'inverse de `0/∞`; `a(n)` est la projection normalisée
qui peut ensuite entrer dans `1+a`.

Hypothèse : `a,b,c,d,e,f` ne sont pas forcément des constantes. Elles peuvent
être :

```text
1. des composantes spectrales de n ;
2. des composantes dimensionnelles de n ;
3. un mélange des deux, selon l'opérateur utilisé.
```

Donc le test ne doit pas chercher `a,b,c,d,e,f` une fois pour toutes, mais
comparer plusieurs familles de fonctions `a(n), b(n), c(n), d(n), e(n), f(n)`.

Porte binaire `q(n)` :

```text
q(n)=1  -> sélection / résonance candidate
q(n)=0  -> non sélection
```

La porte peut être définie par seuil sur une famille de score :

```text
q_F(n, τ)=1 si score_F(n) <= τ   (mode near)
q_F(n, τ)=1 si score_F(n) >= τ   (mode high)
```

Test concret lancé avec `scripts/research/Test-PrimeSpiralQn.py` :

```text
n <= 10 000     : meilleur lift ≈ 1.079
n <= 100 000    : meilleur lift ≈ 1.226, famille old_c1_high
n <= 1 000 000  : meilleur lift ≈ 1.065, famille old_c1_high
```

Lecture : signal faible et instable. Ne pas publier `q(n)` comme primalité ;
le garder comme grille de résonance expérimentale.

Dérivée / primitive :

```text
Dq(n) = q(n) - q(n-1)
Pq(n) = Σ q(k), k <= n
```

Dans le banc de test, `Dq` mesure les fronts d'entrée/sortie de résonance et
`Pq` compare l'accumulation de `q` avec `π(n)`. Résultat à `n <= 1 000 000`
pour `old_c1_high` :

```text
Dq rising prime precision ≈ 0.0859
Pq mean abs error vs π(n) ≈ 1701
Pq max abs error vs π(n) ≈ 2634
```

Ces métriques existent maintenant, mais elles ne transforment pas encore `q(n)`
en détecteur fiable.

Serrage en croix/étoile :

```text
précharge : +R_a + +R_a -> R_a*    (ou 2R_a en lecture plate)
puis       : +R_a -> + imaginaire -> -R_a -> - imaginaire -> axe suivant
```

L'idée n'est pas de multiplier brutalement une seule dimension, mais de répartir
la contrainte de phase entre faces opposées, comme un serrage mécanique en
étoile. La cascade ouverte à tester est :

```text
+R_a + +R_a -> R_a*
lecture plate éventuelle : 2R_a
i × i / op(i,i) -> -R ou transition de face
i -> ±j -> ±k -> ±l -> ±m
m --ln/div--> ±1 ou ±n₆
```

La précharge réelle `R_a + R_a` est l'étape oubliée avant `i × i` : elle cale
la face réelle avant le passage diagonal. Si l'opérateur est plat, on peut la
lire `2R_a`; si l'opérateur est Funesterie, elle devient `R_a*`, une ancre
réelle renforcée.

Hypothèse Djeff 2026-06-04 : après `ln`, l'opération candidate est la division.
Si `m --ln/div--> ±1`, le système se referme. Si `m --ln/div--> ±n₆`, le
système quitte la matrice réelle simple et doit être lu comme une algèbre
hypercomplexe ouverte. Garde-fou : dans les complexes classiques, `i^i` vaut
`exp(-π/2)` au branchement principal ; la cascade Funesterie doit donc définir
ses propres opérations et ses coupures de branche.

Cascade jusqu'à `n` :

```text
z₀ = i
zₙ = op(zₙ₋₁)
```

À ne pas réduire à une seule opération `i exp i`. `exp` était un exemple :
chaque opération candidate doit aussi pouvoir être appliquée en cascade. Les
essais bornés actuels dans `Test-PrimeSpiralQn.py` :

```text
unit(z + phi + jhi*i)
unit(z * (c7 + mg_phase*i))
unit(exp(z))
unit(i^z)
unit(log(1+z))
unit(z / (1 + ln(1+z)))   # division après ln, hypothèse
unit(1/(1+z))
round complet : add -> multiply -> exp -> log/ln -> divide -> invert
phase cross-star avec précharge R_a
```

Conclusion révisée : les cascades `exp`/`i^z` restent faibles, mais les
cascades addition et round complet donnent un signal de tri plus fort
(`lift ≈ 1.25` à `n <= 1 000 000`). Leur primitive `Pq` reste trop mauvaise :
elles regroupent les candidats au lieu de suivre proprement `π(n)`. La piste
sérieuse est donc une cascade `op` Funesterie avec table de division après
`ln`, pas l'exponentielle principale isolée.

---

## Dimensions opératoires

Lecture canon :

```text
D1 = source
D2 = racine / addition imaginaire
D3 = exponentiel-log / jhi
D4 = ln-log-exp / c7
D5 = cible dimensionnelle / target_0005π
D6 = dimension de passage / op_dim_0005π
D6a = diagnostic plat / dim_0005π_flat
D7 = résidu de phase / mg_phase
D8 = log / lg
D9 = ln / lym
D11 = inversion / inv
```

Pour les étages plus hauts :

```text
D8  = lg
D9  = lym(lg)
D11 = inv(lym(lg))
```

Ne pas réduire D7/D9/D11 à des multiplications simples.

---

## Équation de travail

Le spectral ne doit pas être ajouté depuis `t1`, `4.0005π` ou une constante externe.
Correction Djeff 2026-06-04 : `4.0005π` est la cible à tester, pas l'ancienne piste `4.5π`.
Il doit émerger des racines d'une équation opératoire :

```text
W_n(w) = 0
```

avec couches :

```text
phi-layer
jhi-layer
c7-layer
mg_phase-layer
lg-layer
lym-layer
inv-layer
```

Objectif :

```text
1. construire W_n(w)
2. calculer les racines w_n
3. comparer ensuite seulement aux constantes spectrales observées
```

---

## Règles agents

```text
1. Ne pas confondre mg_phase avec 0.0005π.
2. Ne pas dire que mg_phase est la fermeture finale.
3. Ne pas plaquer t1 ou 4.0005π avant W_n(w)=0.
4. Ne pas appeler 0.3695 `mg` ni valeur exacte.
5. Ne pas réduire D7/D9/D11 à des multiplications simples.
6. Ne pas traiter phi, jhi, c7, mg_phase comme des nombres plats.
```
