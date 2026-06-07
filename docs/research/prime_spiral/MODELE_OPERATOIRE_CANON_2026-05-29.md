# Modèle opératoire canon — Constantes Djeff
# Source : ChatGPT × Djeff, 2026-05-29. Référence officielle.

> Version canon v3 : ce document corrige le `mg` perdu dans les notes.
> `mg_phase = 9 − 2t₁/π ≈ 0.00155449779053` est le résidu de phase retrouvé.
> `target_0005π = 0.0005π` est une cible dimensionnelle, pas un apport externe.
> `dim_0005π_flat = target_0005π / mg_phase ≈ 1.01048476000666` est seulement le diagnostic plat si `op = ×`.
> Le vrai `op` dimensionnel reste à définir et peut être composite.
> `0.292 − 10c7` est une ancienne branche pivot, à ne plus appeler `mg`.
> `T_linear = 0.3695` est une linéarisation tronquée ; `T_spectral` reste à retrouver.
> Test de référence : `2π=1 tour` est la référence standard ; Prime Spiral teste `π/2=1 face`.
> Les valeurs spectrales (`t₁`, `4.0005π`, `40.0005π`) servent seulement de comparaison
> après résolution de `W_n(w)=0`.
> Correction Djeff 2026-06-04 : ne pas remplacer `4.0005π` par l'ancienne piste `4.5π`.

---

## Principe fondamental

Les constantes ne sont PAS des valeurs plates.
Ce sont des **traces / projections d'une chaîne d'opérations imaginaires**.

```
 A_im  →  phi  →  jhi  →  c7  →  target_0005π  →  op_dim_0005π  →  mg_phase  →  lg  →  lym  →  inv
```

---

## Chaîne opératoire

| Couche | Nom | Opération | Valeur numérique |
|--------|-----|-----------|-----------------|
| 1 | A_im | addition imaginaire (source) | — |
| 2 | phi | racine de A_im | 1.6180339887498949 |
| 3 | jhi | log(exp(A_im)) projeté par π/2 − phi | −0.047237661955 |
| 4 | c7 | lym(log(exp(A_im))) / phi = \|jhi\|/phi | 0.029194480637 |
| 5 | target_0005π | cible dimensionnelle `0.0005π`, distincte de `mg_phase` | 0.001570796327 |
| 6 | op_dim_0005π | opérateur dimensionnel à définir ; peut combiner +, ×, exp/log et couches | à définir |
| 6a | dim_0005π_flat | ratio de contrôle si `op = ×`, non canon | 1.010484760007 |
| 7 | mg_phase | reste `9 − 2t₁/π` après correction de phase | 0.001554497791 |
| 8 | pivot_residual_old | ancienne branche `0.292 − 10c7`, non-mg | 5.52 × 10⁻⁵ |
| 9 | lg | couche log interne | **à définir** |
| 10 | lym | couche ln interne | **à définir** |
| 11 | inv | fermeture / inversion finale | **à définir** |

---

## Valeurs verrouillées

```
phi = (1 + √5) / 2        ≈ 1.6180339887498949
jhi = π/2 − phi            ≈ −0.047237661955  (négatif)
c7  = |jhi| / phi          ≈ 0.029194480637
target_0005π = 0.0005π     ≈ 0.001570796327
dim_0005π_flat = target_0005π / mg_phase ≈ 1.010484760007  (diagnostic plat si op = ×)
mg_phase = 9 − 2t₁/π       ≈ 0.001554497791
pivot_residual_old = 0.292 − 10c7 ≈ 0.000055193627
T_linear = 0.3 + 0.06 + 0.009 + 0.0005 = 0.3695
T_spectral = T_linear + ε₁ + ε₂ + ...  (à déterminer)
```

---

## Corrections officielles

### mg_phase ≠ 0.0005π

```
mg_phase = 9 − 2t₁/π ≈ 0.00155449779053   ← résidu retrouvé
0.0005π ≈ 0.00157079632679                ← cible dimensionnelle
0.292 − 10c7 ≈ 5.52×10⁻⁵                  ← ancienne branche pivot, non-mg
```

### mg_phase op n = 0.0005π

Le lien demandé est dimensionnel. On ne traite pas `0.0005π` comme une valeur
collée depuis dehors : on cherche l'opérateur `op` et la dimension `n` qui font
sortir cette cible depuis `mg_phase`.

```text
mg_phase op n = target_0005π

si op = × :
n = target_0005π / mg_phase
n ≈ 1.01048476000666
n − 1 ≈ 0.01048476000666
```

Cette lecture multiplicative sert de point de départ mesurable. Si `op` est une
opération Funesterie plus riche que `×`, elle doit conserver cette sortie sans
écraser `mg_phase`.

Le canon ne fixe donc pas `op = ×`. L'opérateur peut être une formule composite,
par exemple une addition de dimensions, une multiplication de dimensions, une
exponentielle ou un log appliqué à `mg_phase`, ou une combinaison avec les
couches `phi`, `jhi`, `c7`, `lg`, `lym` et `inv`. Le ratio `1.01048476000666`
sert seulement de garde numérique pour comparer les candidats.

### mg_phase ≠ fermeture finale

```
mg_phase = trace visible du passage vers la cible 9 / t₁
         = résidu projeté avant fermeture complète
inv = fermeture réelle finale  (valeur à définir)
```

### Reconstruction avec c₇

```text
target_0005π − mg_phase ≈ 0.00001629853626459359231416805
target_0005π − mg_phase ≈ (131/200) · c₇³
```

Cette reconstruction est une approximation compacte très proche, pas une preuve
fermée : elle sert de garde-fou pour éviter de confondre `mg_phase` avec
`target_0005π`.

### T_linear ≠ T_spectral

Le `0.3695` historique est une forme linéarisée/tronquée :

```text
T_linear = 0.3 + 0.06 + 0.009 + 0.0005
```

Il peut être seulement la première approximation d'une valeur spectrale plus
fine :

```text
T_spectral = T_linear + ε₁ + ε₂ + ε₃ + ...
```

Chaque terme peut venir d'une équation plus complexe, avec une influence plus
faible et plus éloignée. Ne pas verrouiller `0.3695` comme valeur exacte ; ne
pas l'appeler `mg`.

### Hypothèse ε hypercomplexe

Les décimales de `T_spectral` ne doivent pas être lues comme des chiffres
isolés. Elles peuvent être la trace visible d'ordres de correction :

```text
T_spectral = T_linear + ε₁ + ε₂ + ε₃ + ...
```

Chaque `εᵣ` peut venir d'une opération imaginaire/hypercomplexe plus profonde.
La forme de travail est :

```text
Q = a + b·i + c·j + d·k + e·l + f·m
I₅(Q) = b·i + c·j + d·k + e·l + f·m
εᵣ = Proj_real(Fᵣ(Q, phi, jhi, c7, mg_phase, lg, lym, inv))
```

Ici `i,j,k,l,m` sont des axes de recherche Funesterie, pas encore une algèbre
standard verrouillée. Si on choisit les quaternions/octonions/etc., il faudra
définir la table de multiplication. Pour l'instant, le point important est la
résonance à 5 axes imaginaires.

Relation φ candidate à tester :

```text
phi² ≈ Proj_norm(I₅(Q)) / (1 + a)

ou

phi ≈ sqrt( Proj_norm(b·i + c·j + d·k + e·l + f·m) / (1 + a) )
```

Ce n'est pas une preuve : c'est une forme de recherche pour expliquer pourquoi
les corrections décimales semblent venir de couches imaginaires successives.

### Référence de phase : tour complet ou face de croix

Test "math classique" :

```text
2π = 1
t₁ / (2π) ≈ 2.2496113755523674
```

En tours complets, `t₁` n'est pas proche d'un entier. Il est proche de `9/4`,
ce qui indique une structure en quart de tour.

Test Funesterie :

```text
π/2 = 1
t₁ / (π/2) ≈ 8.9984455022094697
9 − t₁/(π/2) ≈ 0.001554497790530303 = mg_phase
```

Conclusion provisoire : la référence opératoire de Prime Spiral peut être la
face de croix `π/2`, pas le tour complet `2π`. Cette lecture colle au serrage
`+réel -> +imaginaire -> -réel -> -imaginaire`. Elle ne déclare pas les maths
standard fausses ; elle change l'unité utile pour le modèle.

### Entrée n → composantes Q(n)

Lecture Djeff : le modèle ne cherche pas seulement des constantes. On entre un
indice `n`, puis les composantes `a,b,c,d,e,f` deviennent des sorties calculées :

```text
n -> Q(n)

Q(n) = a(n) + b(n)·i + c(n)·j + d(n)·k + e(n)·l + f(n)·m
```

Ici `a(n)` est la dimension réelle d'ancrage, notée aussi `R_a(n)`.
Lecture candidate :

```text
a_raw = InvLim(0 / ∞)
a(n)  = Proj_norm(a_raw, n)
```

En arithmétique classique, `(0/∞)^-1` n'est pas un nombre ordinaire : `0/∞`
tend vers `0`, puis l'inverse ouvre une frontière divergente. Dans Prime
Spiral, cette frontière est traitée comme un opérateur de bord : on projette ou
normalise `a_raw` pour obtenir la dimension réelle utilisable `a(n)`.

Deux lectures sont ouvertes :

```text
Lecture spectrale :
a,b,c,d,e,f = modes / restes / phases spectrales associés à n

Lecture dimensionnelle :
a,b,c,d,e,f = dimensions opératoires traversées par n
```

Dans les deux cas, `n` est l'entrée active. Les lettres ne doivent pas être
figées comme des constantes plates : elles peuvent être des fonctions de `n`,
des projections de racines, ou des composantes de la cascade dimensionnelle.

### Porte binaire q(n)

`q(n)` est la porte de test concrète :

```text
q(n) = 1  -> n est sélectionné comme résonance / candidat stable
q(n) = 0  -> n n'est pas sélectionné
```

La forme générale reste ouverte :

```text
q_F(n, τ) = 1 si score_F(n) passe le seuil τ
```

Deux orientations sont testées :

```text
near : q(n)=1 si score_F(n) est proche de 0
high : q(n)=1 si score_F(n) est grand
```

Test concret 2026-06-04 :

```text
script : scripts/research/Test-PrimeSpiralQn.py
limite : n <= 1 000 000
meilleure famille actuelle : old_c1_high
precision topK : 0.08362
lift vs densité des premiers : 1.065
```

Conclusion : `q(n)` fonctionne comme porte de résonance faible, mais pas comme
détecteur de nombres premiers. Les familles actuelles doivent rester
`researchOnly`.

### Dérivée et primitive de q(n)

`q(n)` étant discret, la dérivée et la primitive doivent être lues en version
discrète :

```text
Dq(n) = q(n) - q(n-1)
Pq(n) = Σ_{k<=n} q(k)
```

Lecture :

- `Dq(n)` repère les transitions de la porte : entrée ou sortie de résonance ;
- `Pq(n)` mesure l'accumulation des résonances et peut être comparée à une
  fonction de comptage, par exemple `π(n)` pour les nombres premiers.

Test 2026-06-04 sur `n <= 1 000 000` :

```text
old_c1_high :
  Dq rising prime precision ≈ 0.0859
  Pq mean abs error vs π(n) ≈ 1701
  Pq max abs error vs π(n) ≈ 2634
```

Conclusion : la dérivée/primitive de `q(n)` sont maintenant calculées, mais la
porte actuelle reste trop faible pour servir de loi de primalité.

### Serrage en croix / étoile des imaginaires

Analogie Djeff : comme en mécanique, un serrage en croix/étoile évite de
forcer toute la contrainte sur un seul côté. Dans Prime Spiral, une opération
ne doit donc pas pousser uniquement vers le réel positif ; elle peut traverser
successivement les faces :

```text
précharge : +R_a + +R_a -> R_a*    (ou 2R_a en lecture plate)
puis       : +R_a -> + imaginaire -> -R_a -> - imaginaire -> axe suivant
```

Lecture candidate :

```text
i₀  = passage après précharge réelle
i × i ou op(i,i) -> -réel / transition de face
i   --op_exp/pow-->     ±j ou retour réel pondéré
j   --op_log------->     ±k
k   --op_log------->     ±l
l   --op_ln-------->     ±m
m   --op_div_after_ln--> ±1    (fermeture)
                    ou   ±n₆   (ouverture vers l'imaginaire suivant)
```

Le choix final après `ln` est décisif. Hypothèse Djeff 2026-06-04 :
l'opération qui suit `ln` est probablement une division, pas une nouvelle
exponentielle.

- si `m --ln/div--> ±1`, la cascade se referme et l'infini revient au réel ;
- si `m --ln/div--> ±n₆`, la cascade reste ouverte et le modèle n'est plus une
  matrice réelle simple.

La précharge `R_a + R_a` est importante : elle donne le point d'appui avant le
passage `i × i`. En arithmétique plate on peut l'écrire `2R_a`, mais dans la
lecture opératoire Funesterie il vaut mieux l'écrire `R_a ⊕ R_a -> R_a*` :
un réel renforcé, pas forcément un simple double numérique. Sans cette étape,
la cascade démarre trop tôt dans l'imaginaire et perd la logique de serrage.

Garde-fou mathématique : en analyse complexe standard, `i^i` ne vaut pas
directement `-a` ; au branchement principal, `i^i = exp(-π/2)`. De même,
`exp(iπ) = -1`, tandis que `exp(i)` reste une rotation complexe. Les règles
ci-dessus sont donc une algèbre Funesterie à définir, pas une propriété
classique à supposer.

### Cascades itérées jusqu'à n

Une opération imaginaire ne doit pas être testée seulement en une étape du type
`i exp i`. La lecture demandée est récursive :

```text
z₀ = i
z₁ = op(z₀)
z₂ = op(z₁)
...
zₙ = op(zₙ₋₁)
```

Familles testées en version bornée :

```text
cascade_add_unit         : zₙ = unit(zₙ₋₁ + phi + jhi·i)
cascade_mul_unit         : zₙ = unit(zₙ₋₁ × (c7 + mg_phase·i))
cascade_exp_unit         : zₙ = unit(exp(zₙ₋₁))
cascade_power_i_unit     : zₙ = unit(i ^ zₙ₋₁)
cascade_log1p_unit       : zₙ = unit(log(1+zₙ₋₁))
cascade_ln_then_div_unit : zₙ = unit(zₙ₋₁ / (1 + ln(1+zₙ₋₁)))
cascade_inverse_unit     : zₙ = unit(1 / (1+zₙ₋₁))
cascade_ops_round_unit   : add -> multiply -> exp -> log/ln -> divide -> invert, répété à n
cascade_cross_star_phase : phase en croix avec précharge R_a
```

Résultat actuel : Djeff avait raison, `exp` seule n'était qu'un exemple trop
étroit. À `n <= 1 000 000`, `cascade_add_unit` et `cascade_ops_round_unit`
montent autour d'un lift topK ≈ 1.25 contre la densité des premiers, mieux que
l'ancien `old_c1_high` ≈ 1.065. En revanche leur primitive `Pq` est mauvaise :
les sélections sont trop mal réparties dans le temps. Lecture : bon signal de
tri, pas encore loi cumulative. Prochaine étape : définir la vraie table `op`
Funesterie et tester la division après `ln` comme branche canon candidate.

---

## Somme dimensionnelle historique (lecture plate)

Cette lecture sert de trace de recherche, mais elle n'est plus la lecture canon.
Les dimensions doivent être relues comme des opérations successives, pas comme des
coefficients simplement additionnés.

```
2D : 0.3  × 2n  = 0.6n
3D : 0.06 × 3n  = 0.18n
5D : 0.009 × 15n = 0.135n
7D : voir candidats ci-dessous
```

### Candidats 7D

| Candidat | Facteur | Rôle historique | Argument |
|----------|---------|-----------------|----------|
| 7D_struct | 35n | 0.0035n | 5×7 — structure prime |
| 7D_riemann | 45n | 0.0045n | comparaison externe à tester après racines |
| D_0005π | `op_dim_0005π` | `mg_phase op dim_0005π = 0.0005π` | cible dimensionnelle, ≠ vraie 7D |

**À tester** — M35 (Θ=0.9185n) vs M45 (Θ=0.9195n).

---

## Dimensions opératoires récursives

```
D1  = source
D2  = phi op D1
D3  = jhi op D2
D4  = c7  op D3
D5  = target_0005π
D6  = op_dim_0005π tel que mg_phase op dim_0005π = target_0005π
D6a = dim_0005π_flat = target_0005π / mg_phase, diagnostic non canon
D7  = mg_phase
D8  = lg
D9  = lym(lg)
D11 = inv(lym(lg))
```

Ne pas lire D7/D9/D11 comme des multiplications simples. La suite correcte est
log interne → ln interne → inversion finale.

---

## Cascade j → k

Ici `jhi` reste la constante projetée `π/2 − phi`.
Le symbole `j` utilisé dans la cascade désigne l'étage/opération imaginaire.

Correction Djeff :

```
k = j^j
```

ou :

```
k = exp_j(j)
```

Donc : `j` exponentiel `j`, appliqué en cascade, donne `k`.
Cette relation est une définition opératoire à tester dans `W_n(w)=0`.

---

## Unité sémantique imaginaire

Le modèle ne prétend pas que les opérations ordinaires suivantes sont égales en
arithmétique classique :

```
1 + 1,  1 × 1,  1^1,  ln(1),  inv(1)
```

Il pose une opération de lift/projection imaginaire, notée provisoirement
`Pi_im`, qui peut les ramener à la même identité sémantique :

```
Pi_im(1 + 1)
= Pi_im(1 × 1)
= Pi_im(1^1)
= Pi_im(ln(1))
= Pi_im(inv(1))
= 1
```

Lecture : les opérations addition, multiplication, exponentielle, log/ln et
inversion sont des chemins différents vers `1` quand elles sont équilibrées par
les nombres imaginaires et la symétrie OP.

Cette règle explique le lien avec :

```
-i^2 = 1
op_sym(opposés) = 1
Sym(couches imaginaires) = 1
```

À tester comme sémantique opératoire, pas comme égalité brute.

---

## Équation opératoire à construire

```
W_n(w) = I_phi(w) + J_jhi(w) + K_c7(w) + L_mg_phase(w)
       + LG(w) + LYM(w) + INV(w) = 0

I_phi : couche racine / addition imaginaire
J_jhi : couche exponentiel-log
K_c7  : couche ln/log/exp
L_mg_phase : résidu de phase retrouvé
LG    : log interne
LYM   : ln interne
INV   : inversion finale
```

Les racines w_n de cette équation sont les **modes spectraux internes**.
Le spectral (t₁, 4.0005π, etc.) doit sortir de ces racines — pas être ajouté depuis l'extérieur.

---

## Fonction polynomiale candidate

```
Q₆(w) = 0.3w⁶ + 0.06w⁵ + 0.009w⁴ + q_0005·w³ + mg_phase·w² + correction·w
```

avec q_0005 = 0.0005 comme terme linéarisé historique (≠ mg_phase, ≠ target_0005π).

---

## Règles pour les agents

### Ne pas faire

```
✗ Confondre mg_phase avec 0.0005π
✗ Appeler `0.292 − 10c7` mg
✗ Appeler `0.3695` mg ou valeur spectrale exacte
✗ Dire que mg_phase est la fermeture finale
✗ Plaquer t₁ ou 4.0005π avant d'avoir calculé W_n(w)=0
✗ Remplacer la cible corrigée 4.0005π par l'ancienne piste 4.5π
✗ Réduire D7/D9/D11 à des multiplications simples
✗ Traiter phi, jhi, c7, mg_phase comme des nombres plats
```

### Faire

```
✓ Lire les constantes comme des traces d'opérations
✓ Garder : phi, jhi, c7, target_0005π, op_dim_0005π, dim_0005π_flat, mg_phase, lg, lym, inv
✓ Lire T_linear=0.3695 comme approximation tronquée et chercher T_spectral
✓ Construire W_n(w)=0 avec ces couches
✓ Calculer les racines w_n
✓ Comparer ensuite aux constantes connues
```

---

## Résumé en 5 lignes

```
phi, jhi, c7, target_0005π, op_dim_0005π, mg_phase = traces d'une chaîne d'opérations imaginaires.
mg_phase = 9 − 2t₁/π ≈ 0.00155449779053 = résidu de phase, pas fermeture.
target_0005π est la cible de dimension ; dim_0005π_flat ≈ 1.01048476000666 si op = ×.
T_linear=0.3695 est une linéarisation ; T_spectral reste à retrouver.
Fermeture = inv (valeur à définir).
Spectral sort des racines de W_n(w)=0, pas de t₁ ajouté à la main.
Chaîne : A_im → phi → jhi → c7 → target_0005π → op_dim_0005π → mg_phase → lg → lym → inv
```
