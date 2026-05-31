# Modèle opératoire canon — Constantes Djeff
# Source : ChatGPT × Djeff, 2026-05-29. Référence officielle.

> Version canon v2 : ce document verrouille la correction `mg ≠ 0.0005π`.
> `mg` est un micro-gap pré-inversion ; la fermeture complète est `inv`.
> Les valeurs spectrales (`t₁`, `4.5π`, `40.0005π`) servent seulement de comparaison
> après résolution de `W_n(w)=0`.

---

## Principe fondamental

Les constantes ne sont PAS des valeurs plates.
Ce sont des **traces / projections d'une chaîne d'opérations imaginaires**.

```
A_im  →  phi  →  jhi  →  c7  →  mg  →  lg  →  lym  →  inv
```

---

## Chaîne opératoire

| Couche | Nom | Opération | Valeur numérique |
|--------|-----|-----------|-----------------|
| 1 | A_im | addition imaginaire (source) | — |
| 2 | phi | racine de A_im | 1.6180339887498949 |
| 3 | jhi | log(exp(A_im)) projeté par π/2 − phi | −0.047237661955 |
| 4 | c7 | lym(log(exp(A_im))) / phi = \|jhi\|/phi | 0.029194480637 |
| 5 | mg | inv(lym(log(exp(A_im)))) projeté sur pivot | 5.52 × 10⁻⁵ |
| 6 | lg | couche log interne | **à définir** |
| 7 | lym | couche ln interne | **à définir** |
| 8 | inv | fermeture / inversion finale | **à définir** |

---

## Valeurs verrouillées

```
phi = (1 + √5) / 2        ≈ 1.6180339887498949
jhi = π/2 − phi            ≈ −0.047237661955  (négatif)
c7  = |jhi| / phi          ≈ 0.029194480637
mg  = 0.292 − 10c7         ≈ 0.000055193627  ≈ 5.52×10⁻⁵
```

---

## Corrections officielles

### mg ≠ 0.0005π

```
mg = 0.292 − 10c7 ≈ 5.52×10⁻⁵   ← CORRECT
0.0005π ≈ 0.001571              ← renommé inj_5π (≠ mg)
```

### mg ≠ fermeture finale

```
mg = trace visible du passage vers l'inversion
   = micro-gap projeté avant fermeture complète
inv = fermeture réelle finale  (valeur à définir)
```

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

| Candidat | Facteur | Injection | Argument |
|----------|---------|-----------|----------|
| 7D_struct | 35n | 0.0035n | 5×7 — structure prime |
| 7D_riemann | 45n | 0.0045n | comparaison externe à tester après racines |
| inj_5π | 5n | 0.0005n | micro-injection, ≠ vraie 7D |

**À tester** — M35 (Θ=0.9185n) vs M45 (Θ=0.9195n).

---

## Dimensions opératoires récursives

```
D1  = source
D2  = phi op D1
D3  = jhi op D2
D4  = c7  op D3
D5  = mg  op D4
D7  = lg
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
W_n(w) = I_phi(w) + J_jhi(w) + K_c7(w) + L_mg(w)
       + LG(w) + LYM(w) + INV(w) = 0

I_phi : couche racine / addition imaginaire
J_jhi : couche exponentiel-log
K_c7  : couche ln/log/exp
L_mg  : micro-gap projeté
LG    : log interne
LYM   : ln interne
INV   : inversion finale
```

Les racines w_n de cette équation sont les **modes spectraux internes**.
Le spectral (t₁, 4.5π, etc.) doit sortir de ces racines — pas être ajouté depuis l'extérieur.

---

## Fonction polynomiale candidate

```
Q₆(w) = 0.3w⁶ + 0.06w⁵ + 0.009w⁴ + seed·w³ + mg·w² + correction·w
```

avec seed = 0.0005 (≠ mg).

---

## Règles pour les agents

### Ne pas faire

```
✗ Confondre mg avec 0.0005π
✗ Dire que mg est la fermeture finale
✗ Plaquer t₁ ou 4.5π avant d'avoir calculé W_n(w)=0
✗ Réduire D7/D9/D11 à des multiplications simples
✗ Traiter phi, jhi, c7, mg comme des nombres plats
```

### Faire

```
✓ Lire les constantes comme des traces d'opérations
✓ Garder : phi, jhi, c7, mg, lg, lym, inv
✓ Construire W_n(w)=0 avec ces couches
✓ Calculer les racines w_n
✓ Comparer ensuite aux constantes connues
```

---

## Résumé en 5 lignes

```
phi, jhi, c7, mg = traces d'une chaîne d'opérations imaginaires.
mg = 0.292 − 10c7 ≈ 5.52e-5 = micro-gap, pas fermeture.
Fermeture = inv (valeur à définir).
Spectral sort des racines de W_n(w)=0, pas de t₁ ajouté à la main.
Chaîne : A_im → phi → jhi → c7 → mg → lg → lym → inv
```
