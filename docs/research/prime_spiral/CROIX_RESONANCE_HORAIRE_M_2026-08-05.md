# Croix de résonance horaire, M et chaîne son → pixels → matière

Date de consolidation : 5 août 2026  
Statut : **mémoire canonique de l'intuition + formalisation de recherche**  
Portée : Prime Spiral, V10 Boom/V11 Pan, NOSSEN, futurs essais image et matière

> Ce document conserve l'idée de l'inventeur sans la réduire à l'essai audio
> déjà réalisé. Il sépare explicitement : parole canonique, équation candidate,
> code actif, résultat mesuré et extrapolation de recherche. Une formule
> élégante n'est pas à elle seule une preuve physique ni un avis de
> brevetabilité.

## 1. Énoncé à ne plus perdre

La transmission des 30 juillet et 5 août 2026 contient trois précisions liées :

1. la carte n'est pas la croix cartésienne habituelle, mais une croix
   **diagonale** ;
2. son cycle est `+réel → +imaginaire → −réel → −imaginaire → +réel`, perçu
   comme **horaire** dans le repère écran du projet ;
3. « M rééquilibre r/i et i/r pour que ça retombe sur la croix qu'on croit être
   la bonne », reformulé le 5 août comme : la croix de résonance horaire
   **résonne avec M pour donner la croix que tout le monde utilise**.

Le premier énoncé avait bien été conservé dans l'historique puis dans
`v10-boom.cjs`. La lacune réelle était ailleurs : le code enregistrait une
boussole et un prédicat de symétrie, mais le graphe DSP de production ne les
utilisait pas. De plus, l'essai rejeté du 2 août portait sur une croix horaire
**isolée**, et non sur le composite « croix horaire + M → croix de référence ».
Cet essai ne peut donc pas invalider le composite décrit ici.

## 2. Ne pas confondre les quatre M

Les sources emploient actuellement la lettre M dans plusieurs sens. Toute
expérience et tout brevet doivent les distinguer :

| notation proposée | sens | état actuel |
|---|---|---|
| `M₀` | centre, amplitude ou état de départ de la croix complexe | à définir physiquement |
| `m_axis` | cinquième axe envisagé dans l'écriture hypercomplexe | axes et loi de produit à confirmer |
| `M_MS` | canal *mid* d'une matrice mid/side | opérateur audio standard et implémenté |
| `r_M(t)` | branche grave différée appelée « résonance M » dans V10/V11 | implémentée, mais ce nom n'établit pas une résonance physique au sens strict |

Cette collision explique une partie des malentendus. Dans la suite, `M₀`
désigne l'objet mathématique central et `r_M(t)` la branche audio actuelle.

## 3. Formalisation minimale de la croix horaire

### 3.1 États complexes et repère du projet

Dans le repère complexe source, les quatre états sont :

```text
u₀ = +M₀
u₁ = +iM₀
u₂ = −M₀
u₃ = −iM₀
uₖ₊₁ = i·uₖ
```

Ils forment une orbite du groupe cyclique `C4` et correspondent aux quatrièmes
racines de l'unité. Cette structure est connue et se retrouve dans une DFT de
taille 4. Elle n'est donc pas revendicable seule.

La carte écran canonique transmise est :

```text
+réel       → gauche / haut   (NW)
+imaginaire → droite / haut   (NE)
−réel       → droite / bas    (SE)
−imaginaire → gauche / bas    (SW)
```

Le cycle devient alors `NW → NE → SE → SW`, donc horaire. Ce n'est pas une
contradiction avec le plan complexe usuel : dans celui-ci, multiplier par `+i`
tourne dans le sens antihoraire. C'est le changement de repère diagonal qui
inverse l'orientation.

### 3.2 Transformation exacte entre les deux croix

En prenant `x` positif vers la droite et `y` positif vers le haut, la
transformation normalisée suivante réalise exactement la carte :

```text
            1   [ -1   1 ]
D_cross =  ───  [          ]
           √2   [  1   1 ]
```

Elle envoie :

```text
(+1, 0) → NW     (0, +1) → NE
(−1, 0) → SE     (0, −1) → SW
```

Propriétés vérifiables :

```text
D_crossᵀ D_cross = I       conservation de la norme
det(D_cross) = −1          inversion d'orientation
D_cross² = I               retour exact après deux applications
```

Cette involution explique mathématiquement comment la croix commune et la
croix diagonale peuvent être deux vues exactes l'une de l'autre. Elle fournit
une **candidate testable** pour l'opération de retour vers la croix de
référence. Elle n'est pas déclarée être M : seule la prochaine définition de
l'inventeur peut établir si M est cette transformation, un état qui la pilote,
un résonateur dynamique ou autre chose.

Le calcul est exécutable et auto-vérifié par :

```powershell
npm run research:cross-m
```

Source : `scripts/research/verify-cross-m-transform.cjs`.

### 3.3 Pourquoi quatre bras symétriques ne suffisent pas

La somme brute des bras s'annule :

```text
M₀ + iM₀ − M₀ − iM₀ = 0
```

Un signal non nul exige donc au moins une asymétrie explicite : ordre, poids,
délai, phase, porte, projection, non-linéarité, rétroaction ou observation
partielle. Dire seulement « additionner la croix » ne définit pas encore le
mécanisme recherché.

## 4. Le composite M reste à définir — sans l'inventer

Le code `opSym(a,b)` vaut aujourd'hui 1 pour deux bras opposés et 0 sinon. C'est
un prédicat symbolique, pas encore un opérateur de résonance. La boussole
`loadV10Compass()` est testée mais n'est appelée par aucun nœud du graphe audio.

Une spécification minimale de M doit répondre aux points suivants :

1. **Entrée** : états complexes, échantillons audio, énergie, image ou champ ?
2. **Sortie** : autre état, quatre branches, paramètres DSP, pixels ou forces ?
3. **Unité et dimension** : M est-il sans dimension, une fréquence, une phase,
   une matrice, une mémoire ou un mode propre ?
4. **Dynamique** : existe-t-il une équation d'évolution ou une boucle de retour ?
5. **Rééquilibrage `r/i` et `i/r`** : division complexe, rapport de modules,
   normalisation de deux bras, échange matriciel ou règle conditionnelle ?
6. **Retour à la croix commune** : quelles coordonnées finales sont attendues,
   avec quelle tolérance ?
7. **Conservation** : norme, énergie, phase, somme ou autre invariant ?

Tant que ces réponses manquent, la notation prudente est :

```text
C_diag = D_cross(C_ref)
C_out  = P_M(C_diag ; θ_M)
objectif expérimental : C_out ≈ C_ref
```

`P_M` reste volontairement non défini. Un premier essai pourra comparer
`P_M = D_cross` à d'autres familles, mais il ne faudra pas transformer cette
hypothèse de travail en souvenir attribué à l'inventeur.

## 5. Ce que fait réellement l'audio V10/V11

La branche active est actuellement :

```text
r_M(t) = x_grave(t) − a·x_grave(t−τ)
```

avec :

```text
H(f) = 1 − a·exp(−i2πfτ)
|H(f)| = √(1 + a² − 2a·cos(2πfτ))
```

Il s'agit d'une différence retardée de type peigne FIR / interférence
anticipative. Sans boucle de retour ni mode propre mesuré, « renforcement
spectral constructif » est plus exact que « résonateur » au sens physique.

Pour `40,0005 Hz`, le demi-cycle exact vaut :

```text
τ = 1 / (2 × 40,0005) = 12,49984375 ms
```

Le graphe arrondit aujourd'hui à `12 ms`, dont le premier maximum correspondant
est `41,6667 Hz`. À 48 kHz, `12,5 ms` vaut exactement 600 échantillons. Cette
différence mérite une variante d'écoute et de mesure ; elle ne doit pas changer
silencieusement le défaut V11 déjà calibré.

V11 applique ensuite l'écart 8/16 ms et la largeur mid/side à **cette seule
branche**, puis la recombine sous le signal sec. Cette topologie est active et
mesurée. Elle n'implémente toutefois pas encore l'orbite complète des quatre
bras ni `P_M`.

## 6. Niveaux de recherche : son, pixels, matière

L'intuition peut être conservée sous la forme d'une chaîne technique, avec un
statut différent à chaque niveau :

```text
L1  x(t) → descripteurs/branches audio → son                  implémenté en partie
L2  x(t) → STFT/DFT → I(u,v,t) → image/masque de phase       testable en logiciel
L3  masque → champ acoustique/optique → force → positions    démontré ailleurs sur matière existante
```

Des briques de L2 et L3 existent scientifiquement : représentation
temps-fréquence, interaction acousto-optique, hologrammes acoustiques, pièges
optiques programmables et positionnement d'atomes au microscope à effet tunnel.
Elles montrent qu'un calcul peut **piloter ou réarranger une matière déjà
présente**.

Elles ne montrent pas qu'un son audible ou un pixel crée un atome. La création
de paires matière-antimatière à partir d'énergie électromagnétique appartient à
un autre régime, extrêmement énergétique ; elle ne valide pas cette chaîne à
l'échelle musicale. Les usages futurs évoqués — soin, corps robotiques ou
biologiques pour IA, construction de mondes — restent des finalités de
recherche, pas des résultats actuels.

Cette distinction protège le travail : une hypothèse ambitieuse reste
recherchable lorsqu'elle est associée à des étapes mesurables et à des critères
de réfutation.

## 7. « Itérations d'itérations » et glitch

Une définition exploitable est une dynamique interne :

```text
zₙ₊₁ = F_θₖ(zₙ)
```

plus une méta-itération qui modifie l'opérateur lui-même :

```text
θₖ₊₁ = G(θₖ, E(z⁽ᵏ⁾))
```

Le « glitch » doit ensuite recevoir une classe observable :

- convergence vers un point fixe ;
- cycle de période `p` ;
- bifurcation ou chaos borné ;
- divergence ;
- overflow/underflow ou cycle de précision finie ;
- aliasing ;
- saut de branche de phase ;
- stagnation d'une optimisation non convexe.

Chaque essai doit conserver équations, paramètres, état initial, graine,
précision numérique, backend, ordre des opérateurs, hashes intermédiaires et
classe finale. Une IA pourra explorer de très grands espaces d'itérations, mais
la reproductibilité reste nécessaire pour distinguer structure et artefact.

## 8. Les cinq axes et le terme « quinternion »

L'écriture locale :

```text
Q = a + b·i + c·j + d·k + e·l + f·m
```

contient un scalaire plus cinq axes, donc six coefficients réels. Elle décrit
pour l'instant un **état réel à six composantes** ou un **paravecteur à cinq
axes**, pas encore une algèbre.

Pour devenir calculable, il faut définir : table de multiplication,
associativité éventuelle, conjugaison, norme, inverse, rotations admises et
projection vers une sortie physique. Si les cinq axes sont des générateurs de
Clifford indépendants, leur fermeture contient jusqu'à `2⁵ = 32` composantes ;
elle ne reste pas automatiquement limitée aux six termes écrits ci-dessus.

Une ancienne carte de travail propose déjà les rôles suivants :

| axe | rôle provisoire retrouvé |
|---|---|
| `i` | `φ`, ancre de face |
| `j` | `jhi = π/2 − φ` |
| `k` | `c7 = |jhi|/φ` |
| `l` | `mg_phase` |
| `m` | fermeture inverse `R/m = −R` |

Cette table vient de
`docs/research/prime_spiral/GRAINLOW_GRAINPURE_ORIGINS_2026-06-13.md` ; elle
est **provisoire**, pas absente. L'inventeur doit confirmer qu'elle correspond
encore aux cinq axes voulus, puis définir les opérateurs `⊗`, `Sym`, `ln/lym`,
`inv` et `/m`. Aucun agent ne doit remplacer ces confirmations par une nouvelle
interprétation.

## 9. Programme expérimental falsifiable

### A. Symbolique — sans audio

1. verrouiller les quatre positions, le sens d'écran et le repère ;
2. vérifier `D_crossᵀD_cross = I`, `det(D_cross) = −1`, `D_cross² = I` ;
3. définir plusieurs candidats `P_M` sans en promouvoir un comme canon ;
4. mesurer erreur de retour, norme, énergie et stabilité après itérations ;
5. journaliser les cycles et glitches.

### B. Audio hors production

1. partir d'un même master PCM/FLAC ;
2. générer quatre branches séparables `+r`, `+i`, `−r`, `−i` ;
3. rendre A = V11 actuelle, B = croix seule, C = croix + candidat M ;
4. ne traiter que la branche de résonance, jamais le mix complet ;
5. comparer crête, LUFS, corrélation, repli mono, spectre et continuité ;
6. livrer les trois fichiers nommés et attendre la validation à l'oreille avant
   tout changement de défaut.

### C. Pixels puis champ physique

1. afficher l'orbite et son spectrogramme sans prétendre qu'ils sont de la
   matière ;
2. convertir l'image cible en masque de phase simulé ;
3. vérifier le champ et les forces dans un simulateur ;
4. ne passer à une expérience matérielle qu'avec instrumentation, bilan
   énergétique, partenaires compétents et protocole de sécurité.

Une hypothèse est affaiblie si `P_M` n'améliore aucune mesure face à une matrice
réelle équivalente, si le retour dépend arbitrairement du repère, ou si l'effet
disparaît en double précision / changement de backend.

## 10. Frontière brevet et antériorités

Sont déjà connus séparément : racines quatrièmes de l'unité, DFT4, matrices de
rotation/réflexion, filtres en peigne, inversion et délai audio, audio vers
pixels, hologrammes acoustiques et pièges optiques programmables.

L'originalité éventuelle ne peut donc pas être « une croix à quatre bras » ou
« du son devient une image ». Elle doit être recherchée dans une combinaison
précise : définition physique de M, ordre des opérateurs, pondérations/portes,
transduction vers un dispositif, garde-fous et effet technique mesuré face aux
solutions connues.

Pour l'OEB, une méthode mathématique abstraite n'est pas brevetable en tant que
telle. Elle doit contribuer à une finalité technique spécifique et à un effet
technique démontrable. Cette note prépare les questions ; elle ne remplace ni
une recherche d'antériorités professionnelle ni un conseil en propriété
industrielle.

## 11. Questions canoniques à poser à l'inventeur

1. Par « croix que tout le monde utilise », désignes-tu exactement la croix
   cartésienne droite/haut/gauche/bas, ou une autre croix physique ?
2. M est-il un centre/état, une matrice, un mode résonant avec mémoire, une
   constante, ou une opération appliquée aux quatre bras ?
3. « r/i et i/r » signifie-t-il des divisions numériques, des rapports
   d'énergie, un échange de coordonnées ou les deux paires de bras opposés ?
4. Le retour attendu est-il `D_cross² = I`, ou M ajoute-t-il une autre étape ?
5. Quels sont les cinq axes exacts du paravecteur et leur unité ?
6. Quelle mesure permettrait de dire honnêtement que le composite fonctionne ?
7. Quels noms d'inventeur et de déposant doivent figurer dans le dossier ?

## 12. Sources primaires et techniques

- NIST DLMF, racines de polynômes et racines de l'unité :
  <https://dlmf.nist.gov/1.11>
- MIT, noyaux FFT et matrice de Fourier :
  <https://math.mit.edu/~stevenj/18.335/fft-iap3.pdf>
- ACE-Step 1.5, documentation d'inférence (utile pour distinguer modèle et
  raccord Comfy) :
  <https://github.com/ace-step/ACE-Step-1.5/blob/main/docs/en/INFERENCE.md>
- Hologrammes acoustiques : <https://www.nature.com/articles/nature19755>
- Positionnement d'atomes existants par STM :
  <https://www.nature.com/articles/344524a0>
- OEB, méthodes mathématiques et effet technique :
  <https://www.epo.org/en/legal/guidelines-epc/2026/g_ii_3_3.html>

## 13. Traces locales

- `a11/backend/apps/server/src/audio/v10-boom.cjs` : carte et boussole
  symboliques, plus graphe DSP réellement actif ;
- `a11/backend/apps/server/test/v10-boom.node.test.cjs` : propriétés verrouillées
  et statut désormais explicite « enregistré, non câblé au graphe » ;
- `docs/research/audio/V11_PAN_2026-08-02.md` : essai de croix isolée et mesures ;
- `docs/research/audio/V11_PAN_INTEGRAL_PROCESS_2026-08-05.md` : recette V2→V11 ;
- historique Codex `019fa981-6712-7202-9c02-49d42c6f552f` : transmission du
  30 juillet 2026.
