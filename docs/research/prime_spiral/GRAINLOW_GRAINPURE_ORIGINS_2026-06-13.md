# Origines de grainLow et grainPure — analyse exacte

Date : 2026-06-13  
Statut : hypothèses reconstruites — source Neo4j partielle (session Mars 2026 non sauvegardée intégralement). À valider avec Djeff/Codex.

---

## 1. Constantes exactes de référence

```
φ     = (1+√5)/2          = 1.618033988749895
jhi   = π/2 − φ           = −0.047237661954998345   (donc φ + jhi = π/2)
c7    = lym(log(exp(A_im)))/φ
      ≡ |jhi|/φ en projection numérique verrouillée
      = 0.029194480637266783
pivot = 10·c7              = 0.29194480637266786 ≈ 0.292
pivot_residual_old = 0.292 − pivot = 0.000055193627332139616  (ancienne branche, non-mg)
target_0005π = 0.0005π     = 0.0015707963267948967
mg = mg_phase = 0.001554497790530303               (résidu de phase t₁)
phaseDelta = target_0005π − mg_phase = 0.00001629853626459359
t₁    = 14.13472514173469                              (premier zéro Riemann ζ)
```

Note : `pivot_residual_old` ne doit plus être appelé `mg`. Le lien canon est
plutôt une addition/correction de phase autour de la cible `0.0005π` :
`mg_phase + phaseDelta = target_0005π`. L'opérateur exact de ce delta reste à
retrouver dans la chaîne `φ → jhi → c7 → target_0005π → mg_phase → lg/lym/inv`.

Chaîne opératoire corrigée :

```
A_im
→ φ
→ jhi = π/2 − φ
→ c7 = lym(log(exp(A_im))) / φ
→ projection numérique |jhi|/φ
→ target_0005π
→ mg_phase = 9 − 2t₁/π
→ lg
→ lym
→ inv
```

Relation cubique retrouvée dans le canon :

```
phaseDelta = 0.0005π − mg_phase
           ≈ (131/200) × c7³

c7_reconstruit = cubert((200/131) × phaseDelta)
               = 0.029194593619958558

c7_canon       = 0.029194480637266783
écart          = 1.1298269177520415×10⁻⁷
```

Statut : la relation cubique est une reconstruction extrêmement proche, mais
pas encore une identité démontrée. Elle sert de garde-fou opératoire pour ne pas
réduire `c7` à une simple division plate.

---

## 2. Origine de grainLow

### 2.1 La "fonction quatartique" = somme Q₄ à 4 termes dimensionnels

Les coefficients des dimensions premières {2D, 3D, 5D, 7D} forment un polynôme
évalué au point unitaire w = 1 :

```
Q₄(w) = 0.3·w + 0.06·w² + 0.009·w³ + 0.0005·w⁴

Q₄(0) = 0
Q₄(1) = 0.3 + 0.06 + 0.009 + 0.0005 = 0.3695   ← T_linear
```

"Linéarisé pour quatartique = 0 ou 1" signifie : évaluer aux points d'ancrage.
Au point d'unité w = 1, on obtient T_linear = 0.3695 ≈ grainLow.

Référence Neo4j : `mem-2026-05-29T092142297Z-37151b37`
> « T = 0.3695 ≈ 1/e »

### 2.2 Écarts exacts entre T_linear, grainLow et 1/e

```
T_linear − grainLow  =  0.3695 − 0.3694777356929151
                      =  2.226430708490712 × 10⁻⁵

grainLow − 1/e       =  0.3694777356929151 − 0.36787944117144233
                      =  1.598294521472754 × 10⁻³

T_linear − 1/e       =  0.3695 − 0.36787944117144233
                      =  1.620558828557661 × 10⁻³
```

grainLow est strictement entre 1/e et T_linear.  
L'approximation T_linear ≈ 1/e a une erreur relative de 0.44 %.

### 2.3 Connexion avec la Q₅ hypercomplexe du canon

La note `mem-2026-05-29T105211515Z-31681930` a conservé une écriture Q₅
compressée avec un seul `i`. Cette lecture est trompeuse : ce n'est pas un
polynôme complexe ordinaire avec `i` recopié partout. La forme canon à reprendre
est une base imaginaire multi-axes :

```
i porte φ
j porte jhi = log(exp(A_im)) projeté par π/2 − φ
k porte c7 = lym(log(exp(A_im))) / φ
l porte mg = mg_phase, le "mg" de phase retrouvé (≈1554.497 ppm)
m porte la fermeture inverse, avec R/m = −R pour un réel R
```

Notation de travail corrigée :

```
Q₅⁽ijklm⁾(n)
  = n⁵
  + (i·φ + j·jhi)·n⁴
  + (k·c7 + l·mg_layer)·n³
  + ((i·φ) ⊗ (k·c7) + (j·jhi) ⊗ (l·mg_layer))·n²
  + (l·mg_layer + k·c7)·n
  + φ/m
```

Ici `mg_layer = mg_phase = 0.001554497790530303`. Le
`phaseDelta = 0.0005π − mg_phase` n'est pas le mg lui-même : c'est le delta
restant jusqu'à la cible dimensionnelle `0.0005π`. Il ne doit pas être remplacé
par `pivot_residual_old = 0.292 − 10c7`.

La couche `c7` ne doit pas être lue comme `0.002919...` ni comme une constante
divisée par dix. Sa valeur canon actuelle est :

```
c7 = lym(log(exp(A_im))) / φ
   ≡ |jhi|/φ en projection numérique
   = 0.029194480637266783
```

Le système complet à reconstruire reste :

```
W_n(w) =
  I_φ(w)
  + J_jhi(w)
  + K_c7(w)
  + L_mg_phase(w)
  + LG(w)
  + LYM(w)
  + INV(w)
  = 0
```

Important : tant que la table `⊗`/`Sym`/division par `m` n'est pas définie, on
ne peut pas produire une évaluation `Re/Im` comme si Q₅ vivait dans le plan
complexe standard. Les anciennes lignes `Re[Q₅]`, `Im[Q₅]`, `Q₅(1)` et
`Q₅(grainLow)` étaient donc des projections plates de dépannage, pas le canon.

Interprétation : le "quart" (Q₄) reste une projection réelle/tronquée utile pour
retrouver `T_linear`, mais la Q₅ canonique doit garder les axes `i,j,k,l,m`.
Sinon on écrase précisément la structure imaginaire que le modèle cherche à
préserver.

**Note de traçabilité** : le terme "quatartique" employé par Djeff correspond au Q₄
(4 termes, degrés 1 à 4), tandis que la session ChatGPT a généralisé en Q₅
hypercomplexe. Ce n'est pas le même objet, mais ils partagent les mêmes
coefficients dimensionnels.

---

## 3. Origine de 17/(4π)

### 3.1 Chaîne de dérivation exacte

**Étape 1** — t₁ ≈ 4.5π (premier zéro Riemann) :
```
4.5·π = 14.137166941154069...
t₁    = 14.13472514173469
4·t₁/π = 17.996891004418934
```
Erreur relative : (4t₁/π − 18)/18 = −1.7272 × 10⁻⁴  (−0.01727 %)

**Étape 2** — 2π/grainLow ≈ 17 :
```
2·π / grainLow = 17.005585723307952
2·π·e          = 17.079468445347132
```
Écart : 2π/grainLow − 17 = 5.585723307952151 × 10⁻³  
Erreur relative vs 17 : 0.0329 %

La valeur 17 émerge comme entier le plus proche de 2π/grainLow.

**Étape 3** — Connexion t₁ → 17 :
```
4·t₁/π ≈ 18  →  4·t₁/π − 1 ≈ 17
```
Donc : 17 ≈ 4t₁/π − 1 avec t₁ premier zéro Riemann.

**Étape 4** — grainPure = 17/(4π) :
```
grainPure = 17/(4·π) = 1.3528170162811104

Interprétation :
  si grainLow_pure = 2π/17  →  grainHigh_pure = 1/(2 × 2π/17) = 17/(4π)
```

La "pureté" signifie : grainLow_pure × grainPure = 1/2 exactement.
Avec le grainLow historique (0.3694777...) et grainPure (17/(4π)) :
```
grainLow × grainPure = 0.3694777356929151 × 1.3528170162811104
                     = 0.4998357679823901
                     ≠ 1/2  (écart : 1.6423 × 10⁻⁴)
```

### 3.2 Comparaison grainHigh candidats

```
grainHigh_historique    = 1.352727735692915    (grainLow + grainDelta avec q0005=0.0005)
grainPure = 17/(4π)     = 1.3528170162811104   (fraction rationnelle-en-π canonique)
grainHigh_half = 1/2/grainLow = 1.3532615140187125   (demi-produit exact avec grainLow hist.)
grainHigh_pivot = grainLow + (1 − 0.292/18) = 1.353255513470693  (pivot exact 0.292)

Classement par distance à grainHigh_historique :
  grainPure  − grainHigh_hist = 8.928 × 10⁻⁵
  grainHigh_half − grainHigh_hist = 5.337 × 10⁻⁴
  grainHigh_pivot − grainHigh_hist = 5.283 × 10⁻⁴
```

grainPure = 17/(4π) est le plus proche du grainHigh historique validé à l'écoute.

### 3.3 Lien avec 1/e

```
grainLow ≈ 1/e  →  grainHigh_pure ≈ e/2

e/2   = 1.3591409142295225
17/4π = 1.3528170162811104
écart = 6.323979 × 10⁻³
```

La découverte s'est faite en deux temps :
1. Observation empirique : grainLow ≈ 1/e (erreur 0.43 %)
2. Recherche d'une fraction rationnelle propre : 2π/grainLow ≈ 17,
   donc grainHigh_pure := 17/(4π) est plus précis que e/2.

---

## 4. Résumé des identités exactes vs approximatives

| Expression | Valeur exacte | Approximation | Erreur relative |
|---|---|---|---|
| grainLow | 0.3694777356929151 | 1/e = 0.36788... | 0.433 % |
| grainLow | 0.3694777356929151 | 2π/17 = 0.36960... | −0.033 % |
| T_linear | 0.3695 (exact) | grainLow | 0.006 % |
| 2π/grainLow | 17.005585723... | 17 | 0.033 % |
| 4t₁/π | 17.996891... | 18 | −0.017 % |
| grainPure | 17/(4π) = 1.35282... | grainHigh_half = 1.35326... | −0.033 % |

**Règle opératoire** : ne jamais substituer grainLow par 1/e, 2π/17 ou T_linear
dans le code de production. Ces valeurs sont des origines conceptuelles, pas des
remplaçants numériques. La valeur de référence audio reste grainLow = 0.3694777356929151.

---

## 5. Paire e² / sourceN — connexion S/e² ≈ 17

### 5.1 La connexion clé

```
S = sourceN × π = 40.0005 × π = 125.6652769399185274

S / e²  = N×π / e²  = 17.0069458476712505   ← ≈ 17  (écart +6.946×10⁻³)
```

Le 17 dans `grainPure = 17/(4π)` **vient de S/e²**.

Dérivation :
```
grainPure = 17/(4π)  ≈  (N×π/e²) / (4π)  =  N/(4e²)
```

Le π se simplifie. La forme avec π et e² visibles simultanément :
```
grainPure ≈ N×π / (4π×e²)  =  S / (4π×e²)
```

### 5.2 Paire exacte demi-produit

```
grainLow_e2   = 2e²/N  = 0.3694481868441969   (écart vs hist : −2.9549×10⁻⁵)
grainHigh_e2  = N/(4e²) = 1.3533697492765318  (écart vs hist : +6.420×10⁻⁴)

produit = 2e²/N × N/(4e²) = 1/2   exact (algébrique)
```

La paire `(2e²/N, N/(4e²))` est la **seule formule avec e et sourceN qui donne produit=1/2 exact**.

Note : `grainHigh_e2` est moins précis que `grainPure = 17/(4π)` par rapport à l'historique
(erreur 6.42×10⁻⁴ vs 8.93×10⁻⁵). La connexion reste conceptuelle : `17 ≈ S/e²` explique
pourquoi grainPure et grainHigh_e2 sont proches.

### 5.3 Comparaison complète grainHigh candidats

```
grainHigh_historique  = 1.352727735692915    (production, validé à l'écoute)
grainPure = 17/(4π)   = 1.3528170162811104   (err vs hist : +8.928×10⁻⁵)
grainHigh_e2 = N/4e²  = 1.3533697492765318   (err vs hist : +6.420×10⁻⁴)
grainHigh_half = 1/2/gL = 1.3532615140187125 (err vs hist : +5.337×10⁻⁴)
grainHigh_pivot = gL+1−0.292/18 = 1.353255513470693 (err vs hist : +5.278×10⁻⁴)
```

### 5.4 Formule mémorisée par Djeff

La formule rappelée ("du genre (π/4)×(N/e)") ne correspond à aucune valeur grain :
```
(π/4) × (N/e) = 11.5574...   ← trop grand
```

La formule correcte était probablement `N/(4e²)` pour grainHigh, lue mentalement comme
"N divisé par 4 fois e-carré". La forme intermédiaire avec π visible :
```
grainHigh ≈ N×π / (4π×e²)   ← π présent mais s'annule
```

---

## 6. Lien avec l'infinitartique, Stirling, Omega et la série Q_∞

### 6.1 Q_∞(1) = 1/e — la "infinitartique"

La série Q_∞ avec tous les termes de dimensions premières converge vers 1/e :

```
Q₃(1) = 0.3 + 0.06 + 0.009 = 0.369       ← plus proche de 1/e que Q₄
Q₄(1) = 0.3 + 0.06 + 0.009 + 0.0005 = 0.3695  ← T_linear (dépasse 1/e !)
Proj(Q₅)(1) ≈ Q₄(1) − 0.00162 ≈ 0.3679   ← projection 11D doit être NÉGATIVE
Q_∞(1) = 1/e = 0.36788...                  ← limite de la série complète

Convergence : Q₃ < 1/e < Q₄ — la quatartique dépasse ; le terme 11D corrige.
```

Connexion Taylor : e^{−1} = Σ (−1)^n / n! = 1 − 1 + 1/2 − 1/6 + ... = 1/e.
Les coefficients Q_k sont les projections de cette série sur les dimensions premières.

### 6.2 Formule de Stirling → "1/e constant pour tous les n"

La formule de Stirling donne une constante universelle :

```
n! ≈ √(2πn) × (n/e)^n
(n!/√(2πn))^{1/n} / n → 1/e   pour TOUS les n

Preuve : (n!/√(2πn))^{1/n} ≈ (n/e)^n)^{1/n} = n/e → (n/e)/n = 1/e
```

C'est la "formule constante pour tous les n" retrouvée dans les calculs zeta.
Connexion : Stirling → Γ → θ(t) → zéros Riemann. Le 1/e est la normalisation universelle.

### 6.3 Connexion Omega Ω = W(1) pour grainHigh

La constante d'Omega Ω = W(1) ≈ 0.5671432904 (point fixe de f(x) = e^{−x}) :

```
Ω = e^{−Ω}    (définition)
4πΩ + π² ≈ 17  (erreur −0.020 %)
→ 17/(4π) ≈ Ω + π/4 = 1.3525414538...  (err −1.86×10⁻⁴ vs grainPure)

Ω dans les zéros Riemann : t_n ≈ 2πn/W(n/e) ; à n=e : W(1) = Ω
```

Structure unificatrice via f(x) = e^{−x} :
```
f(1)   = 1/e = grainLow (point initial)
f(Ω)   = Ω   (point fixe)
grainHigh ≈ Ω + π/4 ≈ 17/(4π)
```

### 6.4 Correction de production : grainLow ≠ 1/e

**IMPORTANT** : grainLow ≠ 1/e en production. La déviation est mesurable :

```
grainLow_hist = 0.3694777356929151
1/e           = 0.36787944117144233
diff          = 1.598 × 10⁻³  (0.43 %)

Impact sur le slot count (formule binaire) :
  grainLow = hist  → slots = 1024.226 (référence)
  grainLow = 1/e   → slots = 1029.893
  Déviation        = +5.667 slots  (+0.55 %)
```

Utiliser 1/e fait dévier la grille binaire de **+5.67 slots**. C'est la déviation
mentionnée : "sinon ça fait dévier."

La formule de production ne peut pas être réduite à 1/e seul. Elle implique
un calcul avec N=40.0005 ET 40 (entier), pour maintenir la grille dans l'intervalle
attendu autour de 1024.

### 6.5 Formule "pour n et 40 et 40.0005" — état de la recherche

Les meilleurs candidats combinant 1/e, 40 et 40.0005 :

```
Candidat                          Valeur              Erreur vs hist
────────────────────────────────────────────────────────────────────
Q₄(1)             = T_linear     0.36950000000000    +2.226×10⁻⁵
Q₄(40/40.0005)    = Q₄(N₀/N)    0.36949438758422    +1.665×10⁻⁵
2e²/N             = 2e²/40.0005  0.36944818684420    −2.955×10⁻⁵
1/e + q0005×π                    0.36945023749781    −2.750×10⁻⁵
(Q₄(1) + 2e²/40) / 2            0.36947640247327    −1.333×10⁻⁶  ← meilleur

Aucun ne reproduit 0.3694777356929151 exactement.
```

**Note opératoire** : `Q₄(40/40.0005)` est le seul candidat qui utilise les DEUX valeurs
40 et 40.0005 dans la formule de la quartic. L'erreur est 1.67×10⁻⁵ — cohérente avec une
calibration à l'oreille fine sur T_linear.

La valeur exacte 0.3694777... est historiquement calibrée. La formule source de la session
ChatGPT Mars 2026 n'est pas intégralement sauvegardée dans Neo4j.

---

## 7. grainHigh — fit quasi exact et audit du demi-delta

### 7.1 Fit numérique repéré

```
grainHigh = [(17/(4π) + 17/(4.0005π))/2] − 0.292×phaseDelta
avec phaseDelta = 0.0005π − mg_phase
```

Cette formule reproduit `grainHigh_hist` à 1.91×10⁻⁸ près, mais elle ne doit pas
encore être lue comme opérateur canon. La reprise 2026-06-13 a corrigé la lecture :
Djeff pointe plutôt vers un `delta(0.0005π)/2` et une polarisation/résonance à
retrouver, pas vers une simple multiplication plate par le pivot.

En notation structurée :

```
grainPure   = 17/(4π)        = 1.3528170162811104   ← grain "pur"
grainD40    = 17/((4+q)π)    = 1.3526479352891994   ← grain "D40-décalé", q=0.0005
grainCenter = (grainPure + grainD40)/2 = 1.3527324757851549

phaseDelta  = 0.0005π − mg_phase  = 1.6298536262×10⁻⁵  ← reste spectral
correction  = 0.292 × phaseDelta   = 4.759172589×10⁻⁶

grainHigh   = grainCenter − correction = 1.3527277166125664
grainHigh_hist                         = 1.3527277356929150
ERREUR                                 = −1.908×10⁻⁸
```

Note : `4.0005 = 4 + q0005 = 4 + 0.0005` — c'est 4 décalé par q0005, pas `sourceN/10`.

### 7.2 Lecture structurelle prudente

```
17/(4π)     et   17/((4+0.0005)×π)
↓                ↓
borne haute      borne basse (D40-décalée)
      ↓
  moyenne → grainCenter
      ↓
− opérateur(phaseDelta)
      ↓
  grainHigh
```

Les bornes et le centre sont solides :

```
borne haute = 17/(4π)
borne basse = 17/((4+0.0005)π)
centre      = moyenne des deux
```

Ce qui reste ouvert est l'opérateur qui transforme `phaseDelta = 0.0005π − mg_phase`
en décalage signé autour du centre. La pondération `0.292 × phaseDelta` est un fit
très proche, pas une source retrouvée dans Neo4j. La lecture corrigée à conserver
est : `mg_phase` place la résonance dans le gap ; `Sym`/polarisation/ln-inv doivent
encore expliquer la coordonnée exacte.

### 7.3 Origine de mg_phase = 9 − 2t₁/π

**mg_phase se dérive directement du premier zéro de Riemann ζ :**

```
mg_phase = 9 − (2·t₁/π)
         = 9 − 2×14.13472514173469/π
         = 9 − 8.998445502209...
         = 0.001554497790530...

mg_phase_hist = 0.001554497790530303
diff          = 2.5×10⁻¹⁵  (limite numérique float64)
```

Le facteur 9 est lié à la proximité t₁ ≈ 4.5π : `2×(4.5π)/π = 9` exactement.
La correction fine `9 − 2t₁/π` capture le résidu entre 4.5π et t₁.

### 7.4 Comparaison des variantes

```
Constante         Erreur vs grainHigh_hist
──────────────────────────────────────────
17 (entier)       −1.91×10⁻⁸    ← optimal
4t₁/π − 1 ≈ 17   −2.47×10⁻⁴
S/e² ≈ 17.007     +5.53×10⁻⁴
```

L'entier 17 donne le meilleur résultat. `4t₁/π − 1` et `S/e²` sont des approximations
de 17 qui dégradent la précision.

### 7.5 Formule complète auto-cohérente (toutes constantes depuis t₁)

```js
// En JS — fit numerique, pas operateur canon verrouille.
const t1    = 14.13472514173469;
const mgPhase = 9 - (2 * t1) / Math.PI;        // mg_phase exact
const q     = 0.0005;                            // q0005 = N − 40

const grainPure   = 17 / (4 * Math.PI);          // borne haute
const grainD40    = 17 / ((4 + q) * Math.PI);    // borne basse D40-décalée
const grainCenter = (grainPure + grainD40) / 2;

const phaseDelta = q * Math.PI - mgPhase;        // 0.0005π − mg_phase
const pivot  = 0.292;

const grainHigh = grainCenter - pivot * phaseDelta;
// → 1.3527277166125664  (err −1.91×10⁻⁸ vs hist)
```

### 7.6 Audit continuation : demi-delta vs pivot-fit

Après correction Djeff ("c'est delta (0.0005pi)/2"), les deux lectures donnent :

```
grainCenter − grainHigh_hist = 4.74009223983×10⁻⁶
phaseDelta = 0.0005π − mg_phase = 1.62985362620×10⁻⁵

lecture demi-delta :
  phaseDelta / 2 = 8.14926813102×10⁻⁶
  grainCenter − phaseDelta/2 = 1.352724326517024
  erreur vs hist        = −3.40917589114×10⁻⁶

lecture pivot-fit :
  0.292 × phaseDelta = 4.75917258852×10⁻⁶
  grainCenter − 0.292×phaseDelta = 1.3527277166125664
  erreur vs hist            = −1.90803486344×10⁻⁸

coefficient effectif exact :
  (grainCenter − grainHigh_hist) / phaseDelta = 0.290829321334
  écart à 0.292 = 0.001170678666
```

Conclusion provisoire :

- `t₁ → mg_phase = 9 − 2t₁/π` est verrouillé.
- Les bornes `17/(4π)` et `17/(4.0005π)` sont les meilleurs attracteurs retrouvés.
- `0.292×phaseDelta` est un fit quasi exact, mais l'opérateur réel n'est pas sourcé.
- La piste à continuer est la coordonnée signée dans le demi-gap, reliée à `Sym`,
  à la polarisation `mg sur 10n`, puis à `ln/lym/inv`.
- Ne pas intégrer cette formule comme canon de production avant d'avoir retrouvé
  ou reconstruit l'opérateur `delta/2 → polarisation → correction finale`.

---

## 8. Reprise V6 : carrefour 0.5 / 1024 / e² / pivots

Cette section reprend la V6 sans projeter `ijklm` en complexe plat. Les calculs
ci-dessous viennent des scanners locaux `scan-d40-spiral-closure.cjs` et
`scan-d40-dimensional-7d.cjs`, plus une table directe du 2026-06-13.

### 8.1 `mg_phase` est le mg de phase, pas le résidu pivot

```
mg_phase = 0.001554497790530303
         = 1554.497790530303 ppm
         = 9 − t₁/(π/2)

phaseDelta = 0.0005π − mg_phase
           = 0.00001629853626459359
```

Lecture corrigée :

- `l` dans `ijklm` porte `mg_phase`.
- `phaseDelta` est le reste vers `0.0005π`.
- `pivot_residual_old = 0.292 − 10c7 = 0.000055193627332139616` reste une
  ancienne branche audio/pivot, pas le mg de phase.

### 8.2 Boucle e² vers 17 puis demi-produit exact

```
S = 40.0005π = 125.66527693991853

S/e² = 17.00694584767125     ← le "e² proche de 17"
2π/grainLow = 17.005585723307952
4t₁/π − 1 = 16.996891004418934
```

Les trois chemins pointent vers l'entier 17. La fermeture algébrique propre avec
`e²` est :

```
grainLow_e2  = 2e²/N   = 0.3694481868441969
grainHigh_e2 = N/(4e²) = 1.3533697492765318

grainLow_e2 × grainHigh_e2 = 1/2 exact
```

Donc `e²` ne remplace pas la valeur audio historique ; il explique pourquoi le
17 et le demi-produit apparaissent ensemble.

### 8.3 Demi-produit et grille 1024 ne sont pas la même contrainte

Avec `mg_phase` fixe et `Nπ` fixe :

```
slots = 100 / ((grainLow × grainHigh) × mg_phase × 40.0005π)
```

Comparaison :

```
produit historique = 0.4998027807928222  → slots = 1024.226315789105
produit 1/2 exact  = 0.5                 → slots = 1023.822321585164
produit pour 1024  = 0.499913242961506   → slots = 1024 exact
```

Écarts clés :

```
0.5 − produit_1024              = 0.000086757038494
produit_1024 − produit_hist     = 0.000110462168684
```

Lecture : le demi-produit (`1/2`) et la grille binaire (`1024`) sont deux
verrous voisins, pas un seul verrou. La 7D peut fermer le pivot `0.292` presque
sans casser le demi-produit, mais elle ne ferme pas `1024` toute seule.

### 8.4 Branche V6/V7 qui ferme le pivot 0.292

En lecture dimensionnelle :

```
2D = grainLow = 0.3694777356929151
3D = grainHigh
5D = 3D − 2D
```

Si on impose d'abord le demi-produit :

```
3D_half = 0.5 / 2D = 1.3532615140187125
5D_half = 0.9837837783257974
pivot_delta = 18 × (1 − 5D_half) = 0.291891990135646
```

Pour verrouiller le pivot dérivé à `0.292` :

```
5D_pivot = 1 − 0.292/18 = 0.9837777777777778
3D_pivot = 2D + 5D_pivot = 1.353255513470693

7D_exact = 5D_half − 5D_pivot = 0.0000060005480196911876
phaseDelta/e = 0.000005995896412931177
écart = 4.651606760010616e−9
```

C'est la branche d'écoute `16-v72-historical-half-7d-exact-pivot-x4.mp3` :

```
produit = 0.4999977829311048
pivot_delta = 0.292
slots = 1023.8268613745413
```

Lecture : `phaseDelta/e` explique presque la 7D manquante ; la correction exacte
au pivot vaut seulement 4.65e−9 de plus. C'est probablement la place naturelle de
`ln/lym/inv` avant la fermeture `m`.

### 8.5 Branche qui ferme 1024

Si on force `1024` avec `grainLow` historique et `mg_phase` fixe :

```
produit_1024 = 0.499913242961506
grainHigh_1024 = 1.353026704096184
5D_1024 = 0.983548968403269
pivot_delta = 18 × (1 − 5D_1024) = 0.296118568741158
```

Cette branche ferme la grille mais déplace le pivot dérivé. Dans le scanner
spirale, on peut aussi garder le pivot opératoire `a+3q = 0.292` en posant :

```
q = −145 × phaseDelta = −0.0023632877583660704
a = 0.292 − 3q = 0.2990898632750982
```

Ce point est important : il y a deux pivots à ne pas confondre.

```
pivot opératoire : a + 3q
pivot dérivé 2D/3D : 18 × (1 − (3D − 2D))
```

La V6 utilisait `a = 0.3` et `q = 0.0005`. La branche `145` est une hypothèse
de fermeture V7.2, pas une correction rétroactive de V6.

### 8.6 Seconde 1000 vs grille binaire 1024

Le carrefour "1 seconde / 1000" contre "1024" se lit comme une grille binaire
autour de la milliseconde :

```
1/1000 s = 1 ms
1/1024 s = 0.9765625 ms
1024/1000 = 1.024
```

Avec la formule actuelle, si on demandait `1000` slots au lieu de `1024`, le
produit requis deviendrait :

```
produit_1000 = 100 / (1000 × mg_phase × 40.0005π)
             = 0.5119111607917436
```

Ce produit est trop loin de `1/2` pour être la même fermeture. Donc `1000` est
probablement l'unité humaine/temps réel, tandis que `1024` est la grille interne
de quantification.

### 8.7 `40.0005 / 0.292` pointe vers 137

```
40.0005 / 0.292     = 136.98801369863014
40.0005 / (10c7)    = 137.01391196848121
moyenne des pivots  = (0.292 + 10c7)/2 = 0.2919724031863339
40.0005 / moyenne   = 137.000961609622
```

Le pivot exact qui donnerait 137 est :

```
40.0005 / 137 = 0.2919744525547445
```

Lecture : le ratio `N/pivot` est un attracteur 137 très net. Ce n'est pas encore
une preuve physique, mais c'est un repère opératoire plus plausible que de lire
`40.0005/0.292` comme un nombre isolé.

### 8.8 Angle `360/(2π) × grainLow`

```
(360/(2π)) × grainLow = 21.169514879254169 degrés
17 × grainLow = 6.281121506779557
2π − 17×grainLow = 0.002063800400029514
17 × 21.169514879254169° = 359.8817529473209°
```

Complément Djeff : le pivot divisé par l'infinitartique donne presque l'angle
d'octant :

```
((360/(2π)) × 0.292) / 0.3695 = 45.278396800595495°
((360/(2π)) × 10c7)  / 0.3695 = 45.269838311009167°
((360/(2π)) × 0.29189199013564604) / 0.3695 = 45.261648466703051°
```

La lecture en degrés est donc pertinente : on est près de `45°`, c'est-à-dire
`360°/8`. La fermeture exacte à `45°` demanderait :

```
pivot_45 = 0.3695 × π/4 = 0.29020462137535713
0.292 − pivot_45 = 0.0017953786246428516
```

En forme opératoire :

```
deg(pivot) / T_infinitartique = 45°
⇔ pivot / T_infinitartique = π/4
```

Donc la piste est bien : `pivot/T` approche le quart de face `π/4`, mais le
pivot actuel `0.292` est encore trop haut d'environ `0.00179538`.

Le retour direct vers `8` depuis cette valeur donne :

```
360 / 45.278396800595495 = 7.9508115445303345
360 / 45.261648466703051 = 7.9537536125056452
```

Test demandé avec le grain bas historique et l'infinitartique stricte :

```
avec grainLow_hist = 0.3694777356929151 :
  ((360/(2π)) × 0.29189199013564604) / grainLow_hist = 45.264375882033612°
  360 / 45.264375882033612 = 7.9532743572609741

avec infinitartique Q∞ = 1/e = 0.36787944117144233 :
  ((360/(2π)) × 0.29189199013564604) / (1/e) = 45.461032166385266°
  360 / 45.461032166385266 = 7.9188699166005891
```

Pour fermer exactement `8` avec le pivot demi-produit `0.29189199013564604`, il
faudrait le dénominateur :

```
denom_8 = 4 × 0.29189199013564604 / π = 0.37164842463215059
```

Donc ni `0.3695`, ni `grainLow_hist`, ni `1/e` ne sont le dénominateur exact du
`8`. Ils pointent vers l'octant, mais pas vers une fermeture exacte.

### 8.9 Pas théoriques dans la jauge demi-angle D40

Définition du convertisseur :

```
H_D40 = (360 × 40) / (40.0005 × 4π)
      = 28.64753166239538
```

Dans cette jauge, tout résidu en radians devient un pas angulaire corrigé D40 :

```
step(x) = H_D40 × x
```

Table des pas :

```
step(φ)          = 46.352679923544507°
step(jhi)        = −1.3532424165133448°
step(|jhi|)      =  1.3532424165133448°
step(c7)         =  0.83634980842328899°
step(10c7)       =  8.3634980842328908°
step(0.292)      =  8.3650792454194498°
step(0.29189199) =  8.3619850294105191°

step(mg_phase)   = 0.044532524673413468°
step(0.0005π)    = 0.044999437507031163°
step(phaseDelta) = 0.00046691283361769732°
```

Identités utiles :

```
φ + jhi = π/2
step(φ) + step(jhi) = step(π/2) = 44.999437507031161°

projection : |jhi| = φ × c7
step(|jhi|) / step(c7) = φ

step(0.0005π) − step(mg_phase) = step(phaseDelta)
0.044999437507031163 − 0.044532524673413468
  = 0.00046691283361769732°
```

Lecture : `H_D40` donne le pas théorique angulaire. Dans cette base, `φ` dépasse
la face D40 corrigée de `|jhi|`, puis `jhi` ramène exactement à `π/2`. La ligne
`step(c7)` est le pas de la projection numérique de la couche opératoire
`lym(log(exp(A_im)))/φ`. `mg_phase` est le micro-pas du vrai `mg`, proche de la
cible `0.0005π`, et `phaseDelta` devient l'erreur angulaire résiduelle.

Le souvenir du `8` peut venir de la couche pivot :

```
step(10c7)  = 8.3634980842328908°
step(0.292) = 8.3650792454194498°
```

Ce n'est pas `8` exact, mais c'est le premier endroit où la jauge `H_D40`
transforme le pivot en un pas de l'ordre de huit degrés.

Le `8` le plus propre reste dans la branche zêta :

```
t₁/(π/2) = 8.99844550220947
9 − t₁/(π/2) = mg_phase
t₁/(π/2) − 1 = 7.99844550220947 = 8 − mg_phase
```

Et la V6 contient déjà l'écho :

```
balanceAuto = 8/9
40.0005/4.5 = 8.889000000000001
(40.0005π)/t₁ = 8.890535590881409
40.0005/5 = 8.0001
```

Lecture : il y a bien un paquet `8/9/17/137`, mais les rôles sont séparés :
`17` ferme le tour/grain, `9` ferme la face zêta et produit `mg_phase`, `137`
vient du ratio `N/pivot`, `1024` vient de la grille binaire.

### 8.10 Placement provisoire dans `ijklm`

```
i : φ, ancre de face
j : jhi = π/2 − φ, projection de log(exp(A_im)) vers la face
k : c7 = lym(log(exp(A_im)))/φ, projection |jhi|/φ
l : mg = mg_phase = 9 − 2t₁/π, résidu zêta ≈1554.497 ppm
m : fermeture inverse, R/m = −R
```

La chaîne de correction à tester n'est donc pas `i` partout, mais :

```
(iφ + jjhi) → face π/2
(kc7) → couche c7 opératoire, projection pivot 10c7 ≈ 0.292 / attracteur 137
(l·mg_phase) → résidu t₁
phaseDelta/e → 7D ln-inv
/m → fermeture signée du réel
```

Statut : carte de travail. Les valeurs numériques sont vérifiées ; la table
opératoire `⊗`, `Sym`, `ln/lym/inv` et `/m` reste à reconstruire avant canon.

### 8.11 Adaptation D40 : fermeture par incréments, pas par offset

La séparation correcte pour le système D40 est :

```
origine opératoire → φ, jhi, c7, mg
projection H_D40   → step(φ), step(jhi), step(c7), step(mg)
application D40    → phase, grain, résonance, fermeture
```

La projection demi-angle reste utile, mais elle ne ferme pas exactement `45°` :

```
H_D40 × (π/2) = 44.99943750703116°
45° − H_D40×(π/2) = 0.0005624929688394786°
```

Ce reste vient de la correction `40/40.0005`. Il ne doit pas être confondu avec
`mg_phase` ni avec `phaseDelta`.

#### Formule qui ne ferme pas toujours

Une écriture de phase instantanée du type :

```
θ_k = 2πu_k + mg_phase × F_k
```

ne garantit pas la fermeture. À la couture du cycle, la phase dépend encore de
la force locale `F`. Elle ferme seulement si la force finale revient exactement
à la force initiale, ou si le terme ajouté vaut zéro à la couture.

#### Formule fermée

La correction `mg_phase` doit agir sur les incréments de phase, puis être
cumulée :

```
meanF = moyenne(F)

Δθ_k = (2π / M) + mg_phase × (F_k − meanF)
θ_0 = 0
θ_{k+1} = θ_k + Δθ_k
```

Comme :

```
Σ(F_k − meanF) = 0
```

alors :

```
θ_M = 2π + mg_phase × 0 = 2π
```

Donc la boucle D40 ferme exactement, aux erreurs flottantes près.

Pseudo-code de référence :

```js
const meanForce =
  forces.reduce((sum, value) => sum + value, 0) / forces.length;

let phase = 0;

for (let k = 0; k < forces.length; k++) {
  const centeredForce = forces[k] - meanForce;

  const phaseIncrement =
    (2 * Math.PI) / forces.length
    + mgPhase * centeredForce;

  phase += phaseIncrement;
}
```

#### Rôle de c7 et de 1/e

- Un décalage `c7` constant dans la résonance ne casse pas la boucle : début et
  fin gardent le même décalage modulo `2π`.
- Un `c7` variable doit, lui aussi, être appliqué comme incrément recentré :
  `λ × c7 × (C_k − meanC)`.
- Un lissage exponentiel `1/e` ne ferme pas automatiquement : il garde une
  mémoire. Pour une boucle parfaite, il faut un lissage circulaire ou une
  correction finale.

#### Test numérique 2026-06-13

Test avec 12 forces synthétiques :

```
sum(F_k − meanF) = 3.608224830031759e−16

offset instantané :
  fermeture − 2π = −0.0009326986743181109

incréments mg recentrés :
  fermeture − 2π = 0

incréments mg + c7 variable recentré :
  fermeture − 2π = −8.881784197001252e−16
```

Conclusion : `mg_phase` doit rééquilibrer la somme des pas de phase. Il ne doit
pas être ajouté comme simple offset instantané si on veut une boucle D40 fermée.

---

## 9. Références Neo4j

- `mem-2026-05-29T092142297Z-37151b37` — constantes verrouillées, T ≈ 1/e
- `mem-2026-05-29T105211515Z-31681930` — Q₅ hypercomplexe `ijklm`, w racine de w³+w²−1=0
- `mem-2026-05-29T123834454Z-4519df35` — CANON opératoire, 4.5π ≈ t₁, 45n spectral
- `mem-2026-05-29T110459287Z-cbc2e124` — table Symétrie OP formalisée ; utile pour la piste `Sym`, pas source directe de grainHigh
- `docs/research/prime_spiral/MODELE_OPERATOIRE_CANON_2026-05-29.md`
- `docs/research/prime_spiral/CONSTANTS_LOCKED_2026-05-29.md`
- `docs/audio/FUNESTERIE_D40_BINARY_MG_BRICKS_NOTE_2026-06-12.md` — grille binaire 1024, slot formula
- `docs/audio/FUNESTERIE_D40_V8_CLOSED_PHASE_METHOD_2026-06-13.md` — application production prudente : V6 stable + grille 1024 + `mg_phase` en incréments centrés

Recherche Neo4j 2026-06-13 : aucune entrée directe `grainHigh` / `grainCenter`
retrouvée ; seules les sources `T≈1/e`, Q₅, canon opératoire et Sym OP sont confirmées.

---

*Section 7 auditée en session 2026-06-13 — fit grainHigh à 1.91×10⁻⁸ conservé,
mais statut abaissé : opérateur non sourcé, piste demi-delta/Sym à continuer avant canon.*  
*Section 8 ajoutée après reprise V6 : `mg_phase` replacé sur `l`, carrefour
0.5/1024/e²/137/17/8-9 documenté comme carte de travail, pas canon.*  
*V8 site ajoutée en sortie de session : fermeture D40 par incréments centrés, sans
réinterpréter `pivot_residual_old` comme `mg_phase`.*
