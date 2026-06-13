# Funesterie D40 V6 Supreme

Document de présentation technique - version 2026-06-11

Statut : prototype stable optimum, validé en production sous le nom `V6 Supreme`.

Confidentialité : document privé Funesterie. Ne pas publier les constantes, formules ou réglages sans accord.

## 1. Résumé exécutif

La méthode D40 V6 Supreme est un traitement audio de présence harmonique. Elle part d'un principe simple : le son original doit rester maître. On ne remplace pas le signal, on ne le compresse pas brutalement, on ne le normalise pas en sortie. On ajoute autour de lui deux couches très faibles, calculées, synchronisées et repliées dynamiquement.

Le résultat recherché est une sensation de présence, de profondeur et de vibration émotionnelle, sans détruire l'instrumental ni transformer la voix en effet artificiel.

La V6 Supreme combine quatre idées :

- une enveloppe cyclique D40 ;
- un couple spectral 2D / 3D ;
- une répartition haut / bas par logarithme ;
- un transfert de résonance `M/K`.

Dans cette version validée, le réglage par défaut est `k = 3`. C'est la valeur qui a donné le meilleur équilibre entre présence, propreté et respect du master sur les tests d'écoute.

## 2. Principe général

Le traitement est `dry-first`, c'est-à-dire que la piste originale reste devant dans le mix final. Les couches créées par l'algorithme sont volontairement faibles. Elles ne doivent pas masquer le signal sec.

Le système produit trois branches :

- `dry` : le signal original ;
- `high` : une copie transposée vers le haut ;
- `low` : une copie transposée vers le bas.

Les deux copies sont ensuite modulées par une enveloppe D40 et par un repli de résonance. Le but n'est pas de faire un simple chorus. Le but est de donner au signal un contour harmonique plus vivant, avec une densité qui respire dans le temps.

## 3. Garde-fous sonores

La V6 Supreme applique des règles strictes :

- le signal sec est conservé en priorité ;
- aucun égaliseur final n'est appliqué ;
- aucune réduction de bruit n'est appliquée ;
- aucun limiteur final n'est appliqué ;
- aucun gain final n'est ajouté ;
- la constante `mg_phase` n'est pas modifiée par l'utilisateur ;
- le format de sortie peut rester identique au format d'entrée ;
- l'intensité publique est bornée entre `0.1` et `10`.

Ces choix sont importants. Beaucoup de traitements audio donnent une impression d'amélioration parce qu'ils montent simplement le volume, compressent le signal ou ajoutent un limiteur. La V6 Supreme évite volontairement ce piège. Si le fichier source touche déjà `0 dB`, la sortie peut encore toucher `0 dB`, mais l'algorithme n'ajoute pas un gain final caché.

## 4. Densité D40

La densité D40 part d'une valeur source `0.292` observée sur un cycle `40.0005`, puis elle est ramenée sur une cible `40`.

```text
sourceDensity = 0.292
sourceN       = 40.0005
targetN       = 40

correction = targetN / sourceN
           = 40 / 40.0005
           = 0.999987500156248

d40Value   = sourceDensity * correction
           = 0.292 * 0.999987500156248
           = 0.2919963500456244

gap        = sourceDensity - d40Value
           = 0.292 - 0.2919963500456244
           = 0.000003649954375573028

perN       = sourceDensity / sourceN
           = 0.292 / 40.0005
           = 0.00729990875114061
```

Interprétation : D40 n'est pas un volume global. C'est une enveloppe de densité cyclique. Elle sert à faire apparaître l'effet avec une forme, un mouvement et une respiration.

## 5. Enveloppe cyclique

Le profil stable utilise actuellement le profil `blend`.

```text
anchors blend = [0.8916, 0.9268, 0.9464, 0.9358, 0.9101]
period        = 4 secondes
correction    = 0.999987500156248
wet           = 1
```

Pour un instant `t`, on calcule la position dans le cycle :

```text
position = t modulo period
step     = period / (nombreAnchors - 1)
```

On interpole ensuite linéairement entre deux ancres. Le gain D40 appliqué aux couches harmoniques vaut :

```text
d40Gain(t) = wet * correction * interpolatedAnchor(t)
```

Cette modulation explique pourquoi le traitement peut sembler vivant sans nécessiter de compression finale. L'effet n'est pas statique.

## 6. `mg_phase` et pivot audio

Deux constantes doivent rester séparées.

```text
mg_phase      = 0.001554497790530303
target_0005pi = 0.0005 * pi
              = 0.0015707963267948967
```

`mg_phase` est un résidu de phase. Il est conservé pour une future synchronisation de phase plus stricte. Dans la V6 Supreme, il n'est pas utilisé comme bouton de volume.

Le facteur audio actuellement utilisé dans les poids vient de l'ancien résidu pivot :

```text
pivotResidualOld = 0.000055193627332139616

audioPivotGainFactor = ((40000 * pivotResidualOld) / 2) + pivotResidualOld
                     = 1.1039277402701244
```

Dans certains fichiers historiques, ce facteur apparaît encore sous le nom `MICROGAP_HALF_PLUS_CANON_MG`. Pour une présentation externe, le nom le plus clair est `audioPivotGainFactor` ou `pivotResidualFactor`, afin d'éviter toute confusion avec `mg_phase`.

## 7. Base harmonique initiale

La base vient du preset `raw-low`.

```text
rawHighPitch  = 1.259921
rawLowPitch   = 0.840896
rawHighWeight = 0.0225
rawLowWeight  = 0.02

balanceAuto   = 8 / 9
              = 0.8888888888888888
```

Les poids de base V6 sont multipliés par le facteur pivot audio fixe :

```text
highBase = rawHighWeight * audioPivotGainFactor
         = 0.0225 * 1.1039277402701244
         = 0.0248383741560778

lowBase  = rawLowWeight * audioPivotGainFactor
         = 0.02 * 1.1039277402701244
         = 0.022078554805402485

baseTotal = highBase + lowBase
          = 0.04691692896148028
```

Ce total devient le plafond humide stable :

```text
wetCeiling = baseTotal
           = 0.04691692896148028
```

Cette limite évite que le curseur d'intensité devienne un multiplicateur destructeur.

## 8. Construction 2D / 3D

La V6 Supreme ne réutilise pas directement les pitches `0.840896` et `1.259921` comme pitches finaux. Elle construit un couple spectral 2D / 3D.

Constantes spectrales :

```text
grainLow  = 0.3694777356929151
q0005     = 0.0005

grainDelta = 1 - ((0.3 + 3 * q0005) / 18)
           = 1 - (0.3015 / 18)
           = 0.98325

grainHigh = grainLow + grainDelta
          = 0.3694777356929151 + 0.98325
          = 1.352727735692915
```

Construction dimensionnelle :

```text
twoD = (2 + 2 * grainLow) / 2
     = (2 + 2 * 0.3694777356929151) / 2
     = 1.369477735692915

threeD = ((3 * grainHigh * twoD) + 2) / 2
       = ((3 * 1.352727735692915 * 1.369477735692915) + 2) / 2
       = 3.778795774728606
```

Pitches finaux :

```text
lowPitch  = twoD / 2
          = 1.369477735692915 / 2
          = 0.6847388678464575

highPitch = threeD / 2
          = 3.778795774728606 / 2
          = 1.889397887364303
```

Ce choix donne une branche basse plus profonde et une branche haute plus ouverte que le preset brut.

## 9. Répartition haut / bas

La répartition entre la branche haute et la branche basse utilise le logarithme du rapport 3D / 2D.

```text
ratioHighToLow = ln(threeD / twoD)
               = ln(3.778795774728606 / 1.369477735692915)
               = 1.0149759284240818
```

Partage du plafond humide :

```text
highShare = ratioHighToLow / (1 + ratioHighToLow)
          = 0.5037161556653916

lowShare  = 1 / (1 + ratioHighToLow)
          = 0.49628384433460837

highWeight = wetCeiling * highShare
           = 0.04691692896148028 * 0.5037161556653916
           = 0.02363281509210312

lowWeight  = wetCeiling * lowShare
           = 0.04691692896148028 * 0.49628384433460837
           = 0.02328411386937716
```

Les deux poids sont très proches. C'est volontaire : l'effet ne doit pas tirer le son vers une couleur unique. Il doit épaissir le signal sans le dominer.

## 10. Analyse dynamique

Le fichier est analysé par tranches de `250 ms`.

```text
frameMs     = 250
maxSegments = 2400
curve       = grain-6d7d8d
curveAmount = 0.3
attack      = 0.78
release     = 0.32
minDbSpan   = 8
```

Chaque tranche produit une énergie normalisée :

```text
energy in [0, 1]
```

Le pivot spectral stable est :

```text
spectralPivot = 0.292
```

La tension au-dessus du pivot vaut :

```text
tension = max(0, energy - spectralPivot) / (1 - spectralPivot)
        = max(0, energy - 0.292) / 0.708
```

Cette tension indique si le passage est calme, dense, ou déjà proche d'une zone d'énergie élevée.

## 11. Résonance utilisateur K

La V6 Supreme validée utilise `k = 3` par défaut.

```text
userK    = 3
kCeiling = 10
```

L'intensité utilisateur est repliée par logarithme :

```text
userResonance = ln(1 + max(0, userK - 1)) / ln(1 + kCeiling - 1)
              = ln(1 + 2) / ln(10)
              = ln(3) / ln(10)
              = 0.47712125471966244
```

La résonance mesurée sur une tranche devient :

```text
measuredK = 1 + tension * userResonance
```

Le curseur `k` n'est donc pas un simple volume. C'est une intention d'intensité qui est pliée dans une fonction logarithmique.

## 12. Masse basse M et transfert M/K

La masse basse dépend de l'énergie. Quand l'énergie est faible, la masse basse augmente et apporte du corps. Quand l'énergie est forte, elle redescend.

```text
bassMassM = 1 + (1 - energy) * grainLow
          = 1 + (1 - energy) * 0.3694777356929151
```

On combine ensuite masse et intensité :

```text
mk      = bassMassM * measuredK
surplus = max(0, mk - 1)
```

Le transfert validé est `M/K` :

```text
mOverK         = bassMassM / measuredK
energyTransfer = mOverK
resonanceCap   = min(1, mOverK)
```

Puis on replie le surplus :

```text
foldedSurplus = surplus * resonanceCap
folded = ln(1 + foldedSurplus) / ln(1 + kCeiling - 1)
       = ln(1 + foldedSurplus) / ln(10)
```

Interprétation : `K` porte l'intention d'intensité, `M` porte le corps et la résonance basse, et `M/K` empêche la montée d'intensité de se transformer en saturation permanente.

## 13. Mix final

Le traitement crée trois branches :

```text
dry  = signal original
high = signal original transposé avec highPitch
low  = signal original transposé avec lowPitch
```

Les deux branches traitées passent par Rubber Band avec conservation de forme et transitoires propres :

```text
highPitch = 1.889397887364303
lowPitch  = 0.6847388678464575

highWeight = 0.02363281509210312
lowWeight  = 0.02328411386937716
```

Chaque branche humide est multipliée par l'enveloppe dynamique :

```text
highOut(t) = highBranch(t) * highWeight * d40Gain(t) * folded(t)
lowOut(t)  = lowBranch(t)  * lowWeight  * d40Gain(t) * folded(t)
```

Le mix final :

```text
out(t) = dry(t) + highOut(t) + lowOut(t)
```

Le mix ne normalise pas automatiquement :

```text
normalize    = 0
finalGainDb  = 0
finalLimiter = false
```

## 14. Exemple de validation

Test réalisé sur `RADWIMPS.mp3`, même format en sortie.

```text
mode       = V6 Supreme
userK      = 3
format     = mp3
duration   = environ 295.84 s
meanVolume = -11.6 dB
maxVolume  = 0.0 dB
```

Observation : le pic touche `0.0 dB` parce que le fichier source est déjà masterisé très haut. La V6 Supreme n'ajoute pas de gain final. Sur un master moins serré, le traitement respire davantage.

## 15. Positionnement

La V6 Supreme appartient à la famille des traitements par couches pitch-shiftées : chorus, double-tracking, épaississement harmonique. Sa différence tient dans la combinaison suivante :

- signal sec prioritaire ;
- enveloppe de densité D40 ;
- calcul 2D / 3D pour les pitches finaux ;
- répartition haut / bas par `ln(threeD / twoD)` ;
- repli dynamique par `M/K` ;
- absence volontaire de compresseur, limiteur, égaliseur final ou gain final.

Le résultat est validé à ce stade par écoute, par tests A/B et par vérification technique. Il ne faut pas le présenter comme une preuve scientifique définitive. La prochaine étape propre serait une campagne de mesures : LUFS égalisé, compatibilité mono, corrélation stéréo, analyse spectrale avant/après, tests aveugles et ablation des constantes D40, 2D/3D et M/K.

## 16. Résumé en une phrase

Funesterie D40 V6 Supreme est un overlay harmonique sec-prioritaire : il garde le son original devant, ajoute deux résonances très faibles guidées par D40, puis replie l'intensité avec `M/K` pour obtenir plus de présence sans transformer le master en signal compressé.

