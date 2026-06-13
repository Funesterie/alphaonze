# Funesterie D40 - note recherche binaire mg-briques

Statut : hypothèse de recherche. Ne pas remplacer V6 Supreme ni V7 Briques sans test A/B.

## Intuition

La piste à garder : le produit du grain bas et du grain haut semble former une charnière presque exactement à demi-énergie.

```text
grainLow  = 0.369477735692915
grainHigh = 1.352727735692915

grainLow * grainHigh = 0.4998027807928222
écart à 1/2          = -0.00019721920717780117
sqrt(produit)        = 0.706967312393453
1/sqrt(2)            = 0.7071067811865475
```

Lecture possible : la branche basse et la branche haute ne sont pas seulement deux réglages séparés. Leur produit crée un pivot proche de `1/2`, donc proche du point de demi-puissance.

## Chaîne mg_phase

En multipliant ce pivot par `mg_phase` :

```text
mg_phase = 0.001554497790530303

(grainLow * grainHigh) * mg_phase = 0.0007769423184433435
1 / 0.0007769423184433435       = 1287.0968362279039
40.0005 * pi                    = 125.66527693991853

1287.0968362279039 / (40.0005 * pi) = 10.242263157891054
10.242263157891054 * 100            = 1024.2263157891055
```

Lecture possible : on retombe presque sur `1024`, donc sur une grille binaire. Ce n'est pas à utiliser comme un gain brut. La piste la plus saine est de le tester comme une grille de placement ou de quantification des briques `mg_phase`.

Avec les constantes actuellement codées, l'écart à `1024` est très faible :

```text
écart absolu  = 1024.226315789105 - 1024
              = 0.226315789105

écart relatif = 0.00022101151279785292
              ≈ 0.0221 %
```

Le produit exact nécessaire pour tomber pile sur `1024` serait :

```text
neededProductFor1024 = 100 / (1024 * mg_phase * (40.0005 * pi))
                     = 0.49991324296150597

écart avec le produit codé :
0.49991324296150597 - 0.49980278079282237
= 0.00011046216868360048
```

Donc si les valeurs non tronquées de `grainLow` / `grainHigh` déplacent le produit d'environ `0.00011046`, la grille tombe effectivement sur `1024`.

## Hypothèse V8 / V7.1

V7 Briques utilise déjà une logique macro :

```text
hauteur_signal -> trou -> 1 à 10 briques actives
```

La nouvelle piste serait une couche micro :

```text
binarySlotsPerSecond = 100 / ((grainLow * grainHigh) * mg_phase * (40.0005 * pi))
                     ~= 1024.226

binarySlotsPerSecondRounded = 1024
slotDurationSeconds         = 1 / 1024
```

Interprétation :

- Les 10 briques macro de V7 restent lisibles pour l'utilisateur.
- Chaque brique macro peut être placée ou lissée sur une grille interne proche de 1024 pas par seconde.
- `mg_phase` reste fixe.
- Le produit `grainLow * grainHigh` sert de pivot de symétrie basse/haute.
- D40 garde le cycle long.
- La grille binaire peut aider à poser les corrections dans le temps sans les transformer en volume ou compression.

## Correction du q spectral

Le terme historique `q0005 = 0.0005` est une approximation linéaire. Il ne doit pas être lu comme le vrai reste spectral.

La valeur retenue pour le calcul moteur est maintenant :

```text
target_0005pi      = 0.0005 * pi
mg_phase           = 0.001554497790530303
spectralRemainder  = target_0005pi - mg_phase
                   = 0.00001629853626459359

q_spectral         = 30 * spectralRemainder
                   = 0.0004889560879378077
```

Avec la formule actuelle :

```text
grainDelta = 1 - ((0.3 + 3 * q_spectral) / 18)
           = 0.9832518406520103

grainHigh  = grainLow + grainDelta
           = 1.3527295763449254
```

Cette correction est saine parce qu'elle remplace le `0.0005` brut par le reste spectral entre la cible dimensionnelle et le vrai `mg_phase`.

Elle ne ferme cependant pas toute seule la grille à `1024` :

```text
avec q0005 = 0.0005       -> 1024.226315789105 slots/s
avec q_spectral exact     -> 1024.224922129751 slots/s
```

Donc la correction de `q` est une correction de source, tandis que la fermeture exacte à `1024` reste une couche de quantification/grille V7.1. Si l'on force `q` seul à fermer `1024` dans cette formule, il devrait devenir négatif, ce qui indique que le problème serait alors une position ou un signe de formule, pas une simple précision décimale.

## À tester

1. Garder V7 tel quel, puis ajouter seulement une option expérimentale de placement binaire.
2. Comparer trois rendus :
   - V7 Briques actuelle ;
   - V7 + grille exacte 1024 ;
   - V7 + grille mesurée 1024.226.
3. Vérifier surtout :
   - voix plus pleine ou seulement plus forte ;
   - artefacts robotiques ;
   - compatibilité mono ;
   - saturation ;
   - fatigue d'écoute sur 30 secondes.

## Scanner de fermeture spirale

Un scanner local a été ajouté pour comparer les familles de fermeture sans toucher à la prod :

```text
node scripts/research/scan-d40-spiral-closure.cjs --maxRows=12
```

Première conclusion :

- Plusieurs chemins ferment exactement `1024`, donc la fermeture seule ne prouve pas la bonne formule.
- Le facteur `30` est seulement une remise à l'échelle heuristique du reste spectral.
- Les familles à écouter en priorité :
  - `scaleExact`: `q = -79.3820008502611 * (0.0005π - mg_phase)`.
  - `spiral -25π`: `q = -25π * (0.0005π - mg_phase)`, presque fermé sans constante ajustée.
  - `decimal-phase`: `q = -25π * (0.0005 - k * mg_phase)` avec `k = 0.3110501005849742`.
  - `pivot-a`: garder `grainLow` mais remplacer `a` par `0.2946517004773446`.
  - `grain-low`: garder `a = 0.3` mais remplacer `grainLow` par `0.36954147832416295`.

Lecture opératoire : si on travaille vraiment en spirale, les bons chiffres sont peut-être des positions de fermeture dans une grille angle/rayon, pas des constantes isolées. L'écoute doit départager les chemins qui ferment mathématiquement.

## Hypothèse 145 dimensionnelle

La candidate d'écoute la plus intéressante du 12 juin 2026 ne doit pas être lue comme `-25π`.

La structure proposée par Djeff est :

```text
base = ((2 + 2) * 3^2)
     = 36

log5D = exp(log(1024) / 5)
      = 1024^(1/5)
      = 4

145 = base * log5D + 1
    = ((2 + 2) * 3^2) * exp(log(1024) / 5) + 1
```

Lecture possible :

- `2D` représente l'addition : `2 + 2`.
- `3D` représente la puissance : `3^2`.
- `36` représente le socle addition-puissance : `(2 + 2) * 3^2`.
- `5D` représente le repli logarithmique/exponentiel de la grille binaire : `exp(log(1024) / 5) = 4`.
- `+1` représente le point d'ancrage, la graine ou la fermeture de spirale.

Si on impose `scale = 145` et la fermeture binaire `1024`, alors le calcul ne doit pas changer arbitrairement `mg_phase` : il ajuste le grain bas pour fermer le produit cible.

```text
q = -145 * (0.0005π - mg_phase)
  = -0.0023632877583660704

grainLow  = 0.36943950493048733
grainHigh = 1.3531667195568817

grainLow * grainHigh = 0.49991324296150597
slots = 1024
```

Rendu local correspondant :

```text
C:\Users\Djeff\Downloads\music V3\test V7 spiral closure\11-v72-scale145-slots1024-x4.mp3
```

Statut : hypothèse V7.2 à écouter. Elle est plus cohérente que `-25π`, car `145` est formulable en structure dimensionnelle entière, mais elle n'est pas encore validée scientifiquement.

### Variante pivot verrouillé à 0.292

Si on garde `scale = 145` et `slots = 1024`, mais qu'on veut aussi forcer le pivot opératoire à `0.292`, il ne faut pas modifier `mg_phase`. La correction la plus propre est de remplacer le `0.3` approximatif par :

```text
a = 0.292 - 3q
  = 0.2990898632750982

pivot = a + 3q
      = 0.292
```

Le calcul donne alors :

```text
grainLow  = 0.3694286611319218
grainHigh = 1.3532064389096996

grainLow * grainHigh = 0.4999132429615061
slots = 1024
```

Rendu local correspondant :

```text
C:\Users\Djeff\Downloads\music V3\test V7 spiral closure\12-v72-scale145-pivot292-slots1024-x4.mp3
```

### Variante demi-produit avec `a = q`

Nouvelle contrainte proposée :

```text
grainLow * grainHigh = 1/2
a = q
```

Avec le signe courant de `q` :

```text
q = a = -0.0023632877583660704
pivot = a + 3q = -0.009453151033464282

grainLow  = 0.36591444777118887
grainHigh = 1.3664396228286035

grainLow * grainHigh = 0.5000000000000001
slots = 1023.8223215851641
```

Rendu :

```text
C:\Users\Djeff\Downloads\music V3\test V7 spiral closure\13-v72-scale145-aeq-q-half-x4.mp3
```

Avec le signe miroir positif :

```text
q = a = 0.0023632877583660704
pivot = a + 3q = 0.009453151033464282

grainLow  = 0.3661364128771255
grainHigh = 1.365611237819711

grainLow * grainHigh = 0.5000000000000001
slots = 1023.8223215851641
```

Rendu :

```text
C:\Users\Djeff\Downloads\music V3\test V7 spiral closure\14-v72-scale145-aeq-q-half-mirror-x4.mp3
```

Lecture : cette branche satisfait le demi-produit et l'égalité `a = q`, mais elle ne satisfait plus la fermeture exacte `1024`; elle converge vers `100 / (0.5 * mg_phase * 40.0005π) = 1023.8223215851641`.

### Lecture dimensionnelle des grains

Nouvelle clarification opératoire :

```text
grainBas   = 2D
grainHaut  = 3D
grainDelta = 5D
```

Donc :

```text
3D = 2D + 5D
5D = 3D - 2D
```

Avec le grain bas historique validé à l'écoute :

```text
2D = grainBas = 0.3694777356929151
```

Si on impose le demi-produit :

```text
2D * 3D = 1/2
```

alors :

```text
3D = 0.5 / 2D
   = 1.3532615140187125

5D = 3D - 2D
   = 0.9837837783257974
```

Et le pivot dérivé du delta retombe presque sur `0.292` :

```text
pivot = 18 * (1 - 5D)
      = 0.29189199013564604
```

Écart au pivot canon :

```text
0.292 - pivot = 0.00010800986435394178
```

Lecture : le grain bas historique semble relier naturellement `2D * 3D = 1/2` et le pivot `0.292`. La fermeture `1024` reste légèrement décalée (`1023.8223215851641`) si on impose le demi-produit exact.

## Hypothèse 7D : ln, inversion et fermeture du pivot

Nouvelle intuition utilisateur :

```text
grainBas   = 2D
grainHaut  = 3D
grainDelta = 5D

Puis il manque une 7D avec ln / inversion pour fermer le petit résidu.
```

En gardant le grain bas historique validé à l'écoute :

```text
grainLow = 0.3694777356929151
```

Si on impose le demi-produit :

```text
grainHigh_half = 0.5 / grainLow
               = 1.3532615140187125

delta_half = grainHigh_half - grainLow
           = 0.9837837783257974
```

Mais si on impose le pivot canon `0.292` directement par le delta :

```text
delta_pivot = 1 - (0.292 / 18)
            = 0.9837777777777778

grainHigh_pivot = grainLow + delta_pivot
                = 1.353255513470693
```

La correction exacte entre les deux est :

```text
sevenD_exact = delta_half - delta_pivot
             = 0.0000060005480196911876
```

Or le reste spectral donne presque la même valeur lorsqu'il est replié par `e` :

```text
spectralRemainder = 0.0005*pi - mg_phase
                  = 0.00001629853626459359

spectralRemainder / e
  = 0.000005995896412931177
```

Écart :

```text
sevenD_exact - spectralRemainder/e
  = 0.000000004651606760010616
```

Lecture : le rôle probable de la 7D n'est pas de changer fortement le son, mais de replier le reste spectral par une dissipation de type `1/e`. Cela ferme quasiment le pivot `0.292` sans casser le grain bas historique ni transformer le traitement en compresseur.

Deux rendus de test ont été produits :

```text
C:\Users\Djeff\Downloads\music V3\test V7 spiral closure\15-v72-historical-half-7d-inv-e-x4.mp3
C:\Users\Djeff\Downloads\music V3\test V7 spiral closure\16-v72-historical-half-7d-exact-pivot-x4.mp3
```

Valeurs principales :

```text
15 - 7D inverse/e :
grainLow  = 0.3694777356929151
grainHigh = 1.3532555181222996
product   = 0.4999977846497699
pivot     ≈ 0.291999916271079
slots     ≈ 1023.8268578552945

16 - 7D pivot exact :
grainLow  = 0.3694777356929151
grainHigh = 1.353255513470693
product   = 0.4999977829311048
pivot     = 0.292
slots     ≈ 1023.8268613745413
```

Validation d'écoute :

```text
Version préférée : 16-v72-historical-half-7d-exact-pivot-x4.mp3
Raison subjective : meilleure présence et meilleure cohérence que la 15.
```

Conclusion provisoire mise à jour : la version `16` devient la candidate d'écoute principale pour cette branche. La version `15` reste utile comme témoin naturel `spectralRemainder/e`, mais le pivot exact `0.292` semble mieux tomber à l'oreille.

## Résumé en une phrase

Le produit `grainLow * grainHigh` donne presque `1/2`, et combiné à `mg_phase` puis au cycle `40.0005*pi`, il retombe près de `1024`, ce qui suggère une grille binaire de placement des briques plutôt qu'un nouveau gain audio.
