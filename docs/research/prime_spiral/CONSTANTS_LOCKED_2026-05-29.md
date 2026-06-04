# Prime Spiral — Constantes verrouillées (2026-05-29)

Source : récapitulatif ChatGPT × Djeff (session mars 2026, confirmé 2026-05-29).

---

## 1. Constantes fondamentales

| Symbole | Formule exacte | Valeur numérique |
|---------|---------------|-----------------|
| φ | (1 + √5) / 2 | 1.6180339887498949 |
| jhi | π/2 − φ | **−0.047237661955** (négatif) |
| c₇ | \|jhi\| / φ | **0.029194480637** |
| pivot | 10 × c₇ | **0.291944806373** ≈ 0.292 |
| **mg_phase** | **9 − 2t₁/π = (4.5π − t₁)/(π/2)** | **≈ 0.001554497790530303** — vrai résidu de phase retrouvé |
| T_linear | 0.3 + 0.06 + 0.009 + q_0005 | **0.3695 si q_0005=0.0005** — linéarisation tronquée, pas valeur spectrale exacte |
| T_spectral | T_linear + ε₁ + ε₂ + ... | **à retrouver** — série/correction asymptotique possible |
| target_0005π | 0.0005 × π | **≈ 0.001570796326794897** — cible dimensionnelle, ≠ mg |
| dim_0005π_flat | target_0005π / mg_phase | **≈ 1.01048476000666** — diagnostic plat seulement si `op = ×` |
| pivot_residual_old | 0.292 − 10c₇ | **≈ 5.52 × 10⁻⁵** — ancienne branche, ne plus appeler `mg` |
| S | 40.0005 × π | **≈ 125.6699** — candidat spectral à comparer après racines |
| Z_7# | 2 × 3 × 5 × 7 | **210** — primorial 7, facteur de zone candidat |
| Z_7! | 7! | **5040** — factorielle 7, autre lecture de zone candidate |

---

## 2. Structure dimensionnelle (dimensions premières)

| Dimension | Coefficient | Facteur | Sortie |
|-----------|-------------|---------|--------|
| 2D | 0.3 | 2n | 0.6n |
| 3D | 0.06 | 3n | 0.18n |
| 5D | 0.009 | 15n | 0.135n |
| D_0005π | à déterminer | `op_dim_0005π` | `mg_phase op op_dim_0005π = 0.0005π` ; `op` peut être composite |

**Phase dimensionnelle totale :**
- Version avec `mg_phase` : Θ(n) ≈ **0.9170544978 n** si on ajoute le résidu retrouvé à la base 0.9155n
- Version ancienne (sans mg_phase) : Θ(n) ≈ **0.3695 n**

---

## 3. Règle des nombres premiers (candidate)

```
R(n) = (40.0005 · n) mod c₇ ≈ 0
```

n est premier (ou candidat fort) quand `{40.0005π · n} / c₇` est très proche de 0 ou de 1.

Cette règle reste une piste empirique. Elle ne doit pas être utilisée comme loi canon avant d'avoir construit l'équation opératoire `W_n(w)=0` et comparé ses racines aux constantes observées.

---

## 4. Comparaison spectrale après calcul des racines

```
40.0005π ≈ 8.889 × t₁
t₁ ≈ 14.134725 (premier zéro non trivial de ζ)
4.0005π ≈ 12.56794 (correction Djeff 2026-06-04 ; ne pas confondre avec l'ancienne piste 4.5π)
```

Ces valeurs sont des **cibles de comparaison**, pas des constantes à coller dans le modèle.
Le spectral doit sortir des racines `w_n` de `W_n(w)=0`.

### Résidu t₁ vers la cible 9

La proximité `4.5π ≈ t₁` doit être lue comme une cible de symétrie autour de `9`
en unités `π/2`, pas comme une constante à plaquer dans le modèle :

```text
t₁ / π ≈ 4.49922275110473484848654142318
2t₁ / π ≈ 8.99844550220946969697308284636
mg_phase = 9 − 2t₁/π ≈ 0.00155449779053030302691715364
```

### Test de référence de phase

Lecture classique :

```text
2π = 1 tour
t₁ / (2π) ≈ 2.2496113755523674
```

Cette lecture place `t₁` près de `9/4` de tour, mais pas près d'un entier. Elle
est géométriquement valide, mais trop grossière pour Prime Spiral.

Lecture Funesterie :

```text
π/2 = 1 face / 1 pas de croix
t₁ / (π/2) ≈ 8.9984455022094697
9 − t₁/(π/2) ≈ mg_phase
```

La référence opératoire candidate n'est donc pas le tour complet `2π`, mais la
face `π/2`, cohérente avec la croix :

```text
+ réel -> + imaginaire -> - réel -> - imaginaire
```

Garde-fou : cela ne prouve pas que la référence standard `2π` est fausse. Cela
dit que, pour Prime Spiral, la fermeture utile peut se mesurer en faces de
croix plutôt qu'en tours complets.

Lecture dimensionnelle utile :

```text
target_0005π − mg_phase ≈ 0.00001629853626459359231416805
dim_0005π_flat = target_0005π / mg_phase ≈ 1.01048476000666   (diagnostic plat si op = ×)
```

Donc `0.0005π` n'est pas `mg_phase` et ne doit pas être traité comme un
apport externe : c'est la cible de dimension. Le calcul ouvert est
`mg_phase op n = 0.0005π`,
avec `n ≈ 1.01048476000666` si `op` est provisoirement lu comme une
multiplication.

Important : `op = ×` n'est pas le canon. C'est seulement un test de ratio pour
avoir un nombre de référence. L'opérateur réel peut être marécageux : addition
de dimensions, multiplication de dimensions, exponentielle/log de `mg_phase`,
ou composition avec `phi`, `jhi`, `c7`, `lg`, `lym` et `inv`.

### Coefficient spectral 0.3695

Le `0.3695` historique ne doit pas être traité comme une constante exacte. Il
vient de la lecture linéarisée :

```text
T_linear = 0.3 + 0.06 + 0.009 + 0.0005 = 0.3695
```

mais la valeur spectrale cherchée peut être une série plus profonde :

```text
T_spectral = T_linear + ε₁ + ε₂ + ε₃ + ...
```

Chaque correction après la virgule peut correspondre à une équation/couche plus
complexe, avec un impact de plus en plus faible. Exemple de lecture plausible :
`0.3695` est l'arrondi de première passe, tandis qu'une valeur du type
`0.369479...` serait une correction plus avancée. À ce stade, garder
`T_linear` comme repère de calcul et chercher `T_spectral` par racines ou
ajustement contrôlé, sans le verrouiller.

Hypothèse associée :

```text
Q = a + b·i + c·j + d·k + e·l + f·m
T_spectral = T_linear + ε₁ + ε₂ + ε₃ + ...
εᵣ = projection réelle d'une opération sur Q
phi ≈ sqrt( Proj_norm(b·i + c·j + d·k + e·l + f·m) / (1 + a) )
```

Les axes `i,j,k,l,m` restent à définir : ce sont des axes hypercomplexes de
recherche, pas encore une table algébrique standard.

Entrée `n` :

```text
Q(n) = a(n) + b(n)·i + c(n)·j + d(n)·k + e(n)·l + f(n)·m
```

Dimension réelle :

```text
a_raw = InvLim(0 / ∞)
a(n)  = Proj_norm(a_raw, n)
```

`a_raw` représente le bord réel brut : l'inverse de `0/∞`. En calcul classique
cela diverge ou reste indéfini ; dans Prime Spiral, il faut le lire comme un
opérateur de bord puis le normaliser avant de l'utiliser dans `1+a`.

Les composantes `a,b,c,d,e,f` sont à tester comme sorties spectrales,
dimensionnelles, ou hybrides. Ne pas les verrouiller comme constantes plates
avant comparaison numérique.

Facteur de zone candidat :

```text
Z_7# = 2 × 3 × 5 × 7 = 210
Z_7! = 7! = 5040
```

Ces valeurs servent à tester si `q(n)` dépend seulement de `n`, ou de la zone
locale où `n` tombe. Le proxy de première passe est :

```text
zone_index = floor(n / Z)
local_n    = n mod Z
q_Z(n)     = closure(local_n, zone_index, mg_phase)
```

Lecture prudente : `210` et `5040` sont deux hypothèses différentes. Ne pas les
fusionner tant que l'opérateur de zone n'est pas défini.

Hypothèse de passage en croix/étoile :

```text
précharge : +R_a + +R_a -> R_a*    (ou 2R_a en lecture plate)
puis       : +R_a -> + imaginaire -> -R_a -> - imaginaire -> axe suivant
i × i / op(i,i) -> -réel ou transition de face
i -> ±j -> ±k -> ±l -> ±m -> ±1 ou ±n₆
```

Ce passage répartit la contrainte comme un serrage mécanique en étoile. Deux
branches restent ouvertes :

- fermeture : `m ln m -> ±1`, retour au réel ;
- ouverture : `m ln m -> ±n₆`, passage vers une algèbre hypercomplexe non
  réductible à une matrice réelle simple.

La précharge `R_a + R_a` doit rester avant `i × i` : c'est le point d'appui
réel qui évite de démarrer la cascade trop tôt dans l'imaginaire. Notation :
`2R_a` si on teste une lecture arithmétique plate, `R_a*` si on teste la
précharge opératoire.

À ne pas confondre avec l'analyse complexe standard : `i^i` donne
`exp(-π/2)` au branchement principal ; la règle `i -> j -> k -> l -> m` est une
opération Funesterie à définir.

---

## 5. Formules testées pour t_n (sans racine carrée ni log)

| Version | Formule |
|---------|---------|
| Linéaire actuelle | t_n ≈ 14.13717 × n |
| Moyenne demandée | t_n ≈ 14.0516 × n |
| Avec j négatif | t_n ≈ 14.0044 × n |

---

## 6. Points clés

- **T_linear = 0.3695** = approximation linéarisée/tronquée, pas constante exacte
- **T_spectral** = valeur à retrouver par série ou racines ; peut tendre vers une expansion infinie
- **ε hypercomplexes** = corrections candidates issues d'axes `i,j,k,l,m`
- **1/e** reste une comparaison de régulation/dissipation, pas une égalité exacte avec `T_linear`
- **Pivot 0.292** = zone de résonance stable (10 c₇)
- **jhi négatif** = correction de phase / direction impaire
- **mg_phase ≈ 0.00155449779053** = vrai résidu de phase retrouvé depuis `9 − 2t₁/π`
- **pivot_residual_old = 0.292 − 10c₇ ≈ 5.52×10⁻⁵** = ancienne branche à ne plus nommer `mg`
- **target_0005π = 0.0005π** = cible dimensionnelle distincte, pas `mg`
- **dim_0005π_flat ≈ 1.01048476000666** = diagnostic plat ; ne pas le confondre avec l'opérateur réel
- **4.0005π** = cible corrigée Djeff ; l'ancienne proximité `4.5π ≈ t₁` reste une branche historique, pas le canon demandé
- **inv** = fermeture / inversion finale, encore à définir
- **18 modes imaginaires** (version avec π/9)
- **Symétrie 2-3-5** + correction 5

---

## 7. Interprétation globale

Architecture spectrale discrète :
- Nombres premiers = résonances stables (R(n) ≈ 0 mod c₇)
- Zéros de ζ = fréquences propres du système
- Cycle 40.0005π = candidat de comparaison avec le mode fondamental t₁ après calcul des racines
- 1/e = comparaison de dissipation possible, à ne pas confondre avec `T_spectral`

---

## Statut

- Constantes φ, jhi, c₇ : **verrouillées**
- mg_phase = 9 − 2t₁/π : **verrouillé comme résidu t₁**
- pivot_residual_old = 0.292 − 10c₇ : **ancienne branche, non-mg**
- target_0005π = 0.0005π : **cible dimensionnelle distincte de mg**
- dim_0005π_flat = target_0005π / mg_phase : **diagnostic plat si `op = ×`, non canon**
- op dimensionnel : **à définir comme composition possible addition/multiplication/exponentielle**
- T_linear, T_spectral, S : **candidats utiles, non fermeture finale**
- Test C1 (maxima locaux → premiers) : **échoué** — courbe audio uniquement
- OP algebra (op_sym, Sym) : **codé en mode recherche** — table exportable,
  `op` custom encore à définir avant production/preuve
- t_n formule : **expérimental** — ne pas publier comme preuve Riemann
