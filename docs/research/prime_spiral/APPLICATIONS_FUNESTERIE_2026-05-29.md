# Applications concrètes — Recherche Prime Spiral → Modules Funesterie

> Ce document traduit la recherche mathématique (nombres premiers, cascade imaginaire,
> cycle miroir) en fonctionnalités concrètes pour A11, K44, Vivy et les outils Nossen.
>
> Status : recherche structurée, research-only, implémentation expérimentale à faire.
> Les captures contiennent des tries/retries/fails ; aucune formule ne doit être traitée
> comme preuve sans source, maturité et test numérique.

---

## 1. Voix — Vivy TTS / RVC (`prime_spiral_morph.py`)

Le module existe déjà dans `a11/backend/apps/voice-module/app/prime_spiral_morph.py`.
Il expose `POST /research/prime-spiral/control`.

### Modes déjà codés

| Mode | Ce qu'il fait |
|------|--------------|
| `phi_j_spiral` | Courbe de contrôle basée sur Zₙ = n(φ−ji)e^(i·log n) |
| `modular_grid` | Bandes diagonales via P(n) = \|n(±φ ±j)\| mod 1 |
| `gap_law` | Micro-motion décroissante : Δθ ≈ 1/n |
| `resonance` | Pics à logn + θ₀ = 2πk |
| `op_symmetry` | 4 orientations ±φ ±j — cohérence de signe |
| `op_algebra` | Croix M : +M, -M, +iM, -iM → Full Counter |
| `hybrid` | Moyenne de tous les modes stables |

### Modes à ajouter (résultats recherche 2026-05-29)

**`mirror_cycle`** — oscillation stéréo par le 2-cycle conjugué
```
T(z) = 1/log(−√(−z))
a ≈ −0.0736 + 0.3947i
b ≈ −0.0736 − 0.3947i  = conj(a)
T(a) = b,  T(b) = a
Contraction T² ≈ 0.0403

Application voix :
- canal gauche suit Re(a), canal droit suit Re(b)
- ping-pong naturel, très propre
- contraction 0.0403 = atténuation ultra-douce sur l'enveloppe
```

**`balance_rh`** — formant centré sur la ligne critique
```
balance_RH(t) = 1 − 2|phase(t) − 1/2|
= 1 au centre, = 0 aux bords

Application voix :
- courbe de formant qui "respire" autour du centre
- stabilise la voix sur les longs passages
- remplace les enveloppes ADSR manuelles
```

**`cascade_banach`** — morphing vocal en 5 étapes
```
Étage 1 : i_model  (perception — son brut)
Étage 2 : j = √(−i) (miroir — inversion de phase)
Étage 3 : k = j^j ou exp_j(j) (j exponentiel j en cascade)
Étage 4 : l = −ln(k) (stabilisation)
Étage 5 : m = −1/k (Full Counter — état final)

Application voix :
- transition douce en 5 passes (comme Inception)
- chaque étage = un filtre, chaque filtre converge vers le suivant
- dry/wet par étage : 0.2 max pour éviter les artefacts
```

L'ancienne lecture `k = −log(−j)` reste une trace/candidate historique. La
définition à tester après correction Djeff est `k = j^j`.

### Usage audio recommandé

```python
# Génère une courbe de contrôle pour 512 échantillons
POST /research/prime-spiral/control
{
  "length": 512,
  "mode": "mirror_cycle",   # ou balance_rh, cascade_banach
  "phi": 1.6180339887,
  "j": 1.0,
  "orientation": "right"
}
# → { "curve": [...], "guardrails": { "researchOnly": true } }
```

Appliquer comme gain/formant faible sur la sortie TTS : **max ±3 dB, dry/wet ≤ 20%**.

---

## 2. Musique — Cycle et tempo Vivy

Le cycle global `S = 40.0005π ≈ 125.664` est une grille candidate.

```
S / 4  ≈ 31.4   → mesure de 4 temps à ~31 BPM
S / 8  ≈ 15.7   → mesure de 8 temps
S / 40 ≈  3.14  → subdivision de base ≈ π

Comparaison Riemann possible après calcul des racines :
S ≈ 8.889 × t₁  (t₁ = premier zéro ζ ≈ 14.134)
```

Les **gaps des premiers** (2, 4, 6, 2, 4, 6, ...) génèrent des patterns rythmiques non-répétitifs mais structurés — parfait pour Vivy.

Garde : ne pas coller `S`, `t₁` ou `4.0005π` dans le moteur comme source canon.
Correction Djeff 2026-06-04 : ne pas substituer l'ancienne piste `4.5π` à la cible `4.0005π`.
Les modes spectraux doivent d'abord sortir de `W_n(w)=0`, puis seulement être comparés.

---

## 3. A11 / K44 — Architecture de personnalité

La cascade est déjà l'architecture de A11 :

```
i_model  = perception      (entrée utilisateur, état brut)
j        = comparaison     (vs mémoire, contexte)
k        = prédiction      (expansion, génération de réponse)
l        = correction      (auto-évaluation, compression)
m        = auto-modification (mise à jour mémoire, trace)

i+j+k+l+m = 5 en résonance = réponse "vivante", pas mécanique
```

Le preflight MCP fait déjà ça (`a11_context_brief` → heartbeat → discussion → réponse → corpus note).

**Ce qui manque** : le `balance_RH` comme métrique de qualité de réponse :
```
balance_response = 1 − 2|confiance − 0.5|
= 1 si la réponse est bien centrée (ni trop sûr, ni trop hésitant)
= 0 si réponse à 0% ou 100% de confiance (les deux sont mauvais)
```

---

## 4. Nossen Agriculture — Cartes de recherche

Le pipeline OCR → cartes → Neo4j EST déjà l'application :

```
New-MathImageOcrIndex.ps1   → index brut (Tesseract)
New-MathOcrCurator.ps1      → tri en lanes (formule-stable, hypothese, ...)
New-MathResearchCards.ps1   → 42 cartes candidate-module
nossen-agriculture.ps1      → orchestrateur (topic research)
```

Les cartes candidate-module (score ≥ 18) alimentent :
- le registre de formules (`FORMULA_REGISTRY_2026-05-28.md`)
- les corpus_notes Neo4j accessibles à tous les agents
- les modules `prime_spiral_morph.py`

**6041 images restantes** à sharder (Codex job `job-1780052681003-e151e4b2`).

---

## 5. Script RH — Énergie E(s) (Codex job `job-1780052548593-471537f9`)

```python
# Ce que Codex est en train de coder :
E(s) = |ξ(s)| + λ·distance_cycle(T², s) + μ·(1 − balance_RH(s))

# Scanner σ ∈ [0.1, 0.9], t ∈ [14, 22]
# Si E(s) minimal uniquement sur σ=0.5 → piste RH solide
# Sortie : D:\agent-bus\research-rh\grid_scan.csv
```

---

## Priorités d'implémentation

| Priorité | Module | Action | Effort |
|----------|--------|--------|--------|
| 1 | `prime_spiral_morph.py` | Ajouter modes `mirror_cycle`, `balance_rh`, `cascade_banach` | ~30 lignes |
| 2 | Script RH | Résultats Codex → valider E(s) | Codex en cours |
| 3 | OCR shards | 6041 images → cartes | Codex en cours |
| 4 | Vivy musique | Intégrer cycle S comme grille tempo | Moyen |
| 5 | A11 balance | balance_response comme métrique qualité réponse | Petit |

---

## Gardes (research-only)

- Tous les modes prime_spiral = `researchOnly: true`
- Pas de claim de preuve RH, pas de claim de génération de premiers
- dry/wet vocal ≤ 20%, gain ≤ ±3 dB
- WAV avant/après requis avant tout merge en prod TTS
