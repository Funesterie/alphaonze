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
| **mg** | **0.292 − 10c₇** | **≈ 5.52 × 10⁻⁵** — micro-gap pré-inversion |
| T | 0.3 + 0.06 + 0.009 + seed | **0.3695 si seed=0.0005** — valeur tronquée |
| inj_5π | 0.0005 × π | **≈ 0.001571** — graine/injection distincte, ≠ mg |
| S | 40.0005 × π | **≈ 125.6699** — candidat spectral à comparer après racines |

---

## 2. Structure dimensionnelle (dimensions premières)

| Dimension | Coefficient | Facteur | Injection |
|-----------|-------------|---------|-----------|
| 2D | 0.3 | 2n | 0.6n |
| 3D | 0.06 | 3n | 0.18n |
| 5D | 0.009 | 15n | 0.135n |
| 5D' (inj_5π) | 0.0001 | 5n | 0.0005n (= inj_5π·n, ≠ mg) |

**Phase injectée totale :**
- Version avec mg : Θ(n) ≈ **0.9155 n**
- Version ancienne (sans mg) : Θ(n) ≈ **0.3695 n**

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
4.5π ≈ 14.13717 ≈ t₁
```

Ces valeurs sont des **cibles de comparaison**, pas des constantes à coller dans le modèle.
Le spectral doit sortir des racines `w_n` de `W_n(w)=0`.

---

## 5. Formules testées pour t_n (sans racine carrée ni log)

| Version | Formule |
|---------|---------|
| Linéaire actuelle | t_n ≈ 14.13717 × n |
| Moyenne demandée | t_n ≈ 14.0516 × n |
| Avec j négatif | t_n ≈ 14.0044 × n |

---

## 6. Points clés

- **1/e** émerge naturellement comme régulateur/dissipateur (T = 0.3695 ≈ 1/e)
- **Pivot 0.292** = zone de résonance stable (10 c₇)
- **jhi négatif** = correction de phase / direction impaire
- **mg = 0.292 − 10c₇ ≈ 5.52×10⁻⁵** = micro-gap projeté avant fermeture
- **inj_5π = 0.0005π** = graine/injection distincte, pas `mg`
- **inv** = fermeture / inversion finale, encore à définir
- **18 modes imaginaires** (version avec π/9)
- **Symétrie 2-3-5** + correction 5

---

## 7. Interprétation globale

Architecture spectrale discrète :
- Nombres premiers = résonances stables (R(n) ≈ 0 mod c₇)
- Zéros de ζ = fréquences propres du système
- Cycle 40.0005π = candidat de comparaison avec le mode fondamental t₁ après calcul des racines
- 1/e = dissipation qui maintient la stabilité sur la ligne critique

---

## Statut

- Constantes φ, jhi, c₇ : **verrouillées**
- mg = 0.292 − 10c₇ : **verrouillé**
- inj_5π = 0.0005π : **distinct de mg**
- T, S : **candidats utiles, non fermeture finale**
- Test C1 (maxima locaux → premiers) : **échoué** — courbe audio uniquement
- OP algebra (op_sym, Sym) : **codé en mode recherche** — table exportable,
  `op` custom encore à définir avant production/preuve
- t_n formule : **expérimental** — ne pas publier comme preuve Riemann
