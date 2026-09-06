# Projet de description technique — V11 Pan intégrale (V2→V11)

> **Document de travail, pas un avis juridique.** Ce texte organise la
> divulgation technique et propose une base de revendications à faire relire par
> un conseil en propriété industrielle. Il ne conclut ni à la nouveauté, ni à
> l'activité inventive, ni à la brevetabilité.

Date de consolidation : 5 août 2026  
Inventeur(s), déposant, dates de première divulgation : **à compléter et à
vérifier avant tout dépôt**.

## 1. Titre provisoire

Procédé de synthèse et de spatialisation audio à branches résonantes dérivées,
avec réinjection bornée, contrôle monophonique et rendu intermédiaire sans perte.

Le nom « V11 Pan » désigne ici **la recette cumulative issue des versions V2 à
V11**, et non le seul dernier opérateur d'ouverture stéréo.

## 2. Domaine technique

Le procédé concerne le traitement numérique de signaux audio, notamment la
construction de couches de fond instrumentales ou vocales à partir de branches
résonantes, leur spatialisation contrôlée, leur mélange sous un signal direct et
leur rendu pour la production musicale assistée par ordinateur.

## 3. Problème technique

Les chaînes usuelles d'élargissement ou de renforcement peuvent produire une
perte de grave en mono, des crêtes inter-échantillons, un son métallique, des
raccords audibles ou une accumulation de distorsion lorsque plusieurs étapes
sont appliquées à des fichiers compressés successifs. Le problème recherché est
de créer un fond sonore perceptible et large, à partir de composantes dérivées,
tout en :

- conservant un signal direct intelligible ;
- bornant l'énergie réinjectée et la largeur stéréo ;
- protégeant la compatibilité mono et la corrélation des canaux ;
- évitant les encodages avec perte intermédiaires ;
- rendant les paramètres et leur provenance reproductibles.

## 4. Résumé de la solution

Un signal d'entrée est décodé une seule fois en PCM. Une ou plusieurs branches
résonantes sont construites par filtrage, déphasage, transposition ou retard à
partir d'une constante de référence. Une coordonnée de calcul dite
« imaginaire » n'est pas envoyée telle quelle à un haut-parleur : elle pilote un
gain, une phase, un délai, une fréquence, une orientation ou une enveloppe
réels. Les branches rendues réelles sont réunies dans un bus résonant séparé.

Une opération de spatialisation, notamment mid/side, est appliquée **au bus
résonant**, puis ce bus est réinjecté sous le signal direct avec un taux borné.
Un contrôleur peut réduire largeur, taux humide ou énergie grave lorsque les
mesures de crête, de corrélation, de repli mono ou de sonie sortent d'une plage
admissible. La chaîne produit un master PCM ou FLAC avant un unique encodage de
distribution avec perte.

## 5. Description détaillée

### 5.1 Signal et constante de référence

Soit un signal stéréo d'entrée `x(t)`. Une constante de référence `M` fournit ou
indexe des paramètres de résonance : fréquences, retards, rapports de
transposition, incréments de phase et gains. Dans l'implémentation de référence,
les valeurs utilisées comprennent notamment une fondamentale voisine de 40 Hz,
un retard grave voisin de 12 ms, des retards stéréo asymétriques de 8 et 16 ms,
et un plafond de largeur de branche.

Ces valeurs décrivent une réalisation. Elles ne doivent être inscrites dans une
revendication indépendante que si elles sont réellement indispensables à
l'effet technique démontré.

**Réserve ajoutée le 5 août 2026 :** les sources utilisent aussi `M` pour le
centre de la croix complexe, `m` pour un axe hypercomplexe, *Mid* pour le canal
milieu et « résonance M » pour la branche grave. Ces objets doivent recevoir des
notations distinctes avant dépôt. La précision de l'inventeur
`C_ref = T_M(C_horaire)` est archivée, mais `T_M` n'est pas encore défini ni
exécuté par le graphe audio. Voir
`prime_spiral/CROIX_RESONANCE_HORAIRE_M_2026-08-05.md`.

### 5.2 Branche résonante et coordonnée « imaginaire »

Une branche complexe de travail peut s'écrire :

`z_k(t) = a_k(t) · exp(i·phi_k(t))`.

Le terme imaginaire représente une coordonnée de calcul. La sortie physique est
obtenue par projection ou mapping :

`h_k(t) = Re{ z_k(t) · H_k[x](t) }`,

où `H_k` peut comprendre filtrage, transformée de Hilbert, retard ou
transposition. Une autre réalisation convertit directement `Im(z_k)` en un
paramètre réel borné, par exemple :

- fréquence de coupure ou fréquence centrale ;
- gain humide ;
- retard gauche/droite ;
- angle de panoramique ;
- temps d'attaque ou de relâchement ;
- taux de transposition ou facteur de phase.

Le résultat audible est donc un signal réel. La coordonnée imaginaire sert de
commande structurée, pas de canal audio abstrait.

### 5.3 Consolidation du fond sonore

Les branches rendues sont réunies en un bus :

`r(t) = Somme_k g_k · h_k(t - tau_k)`.

Une enveloppe `E(t)` et un plafond `rho_max` bornent leur contribution :

`r_b(t) = clamp_energy(E(t) · r(t), rho_max)`.

Le bus peut être séparé en bandes. Une réalisation renforce une branche grave
par une différence retardée `b(t) = l(t) - a·l(t-tau)` et conserve le signal
large bande direct à part. Le fond naît de l'accumulation cohérente mais bornée
de ces composantes dérivées ; il ne remplace pas la source principale.

### 5.4 Spatialisation limitée à la branche

Pour le bus résonant stéréo `r_L, r_R` :

`mid = (r_L + r_R) / 2`  
`side = (r_L - r_R) / 2`  
`side' = w · side`, avec `w` borné  
`r'_L = mid + side'`  
`r'_R = mid - side'`.

Le signal final avant protection est :

`y(t) = x_direct(t) + rho · r'(t)`, avec `0 <= rho <= rho_max`.

Cette topologie est importante : l'ouverture n'est pas appliquée aveuglément au
mix complet. Le centre, la voix principale et le grave direct restent protégés.

### 5.5 Contrôle adaptatif et critères mesurables

Un contrôleur reçoit au moins une partie des mesures suivantes :

- crête vraie et marge avant saturation ;
- sonie intégrée et plage dynamique ;
- corrélation stéréo ;
- différence d'énergie ou de spectre après repli mono ;
- énergie de la branche par rapport au signal direct ;
- taux de crêtes ou de discontinuités courtes.

Si un seuil est franchi, il réduit au moins l'un de `w`, `rho`, le gain d'une
branche ou le gain d'une bande. Le manifeste de rendu conserve paramètres,
mesures avant/après et décision du contrôleur. La calibration recherchée est une
réponse mesurée, pas une durée musicale imposée.

### 5.6 Chemin de rendu

1. Décodage de la source en PCM.
2. Normalisation technique prudente, si nécessaire.
3. Construction des branches V2→V10 consolidées.
4. Spatialisation V11 du bus résonant seulement.
5. Réinjection sous le signal direct.
6. Contrôles crête, mono, corrélation, sonie et dynamique.
7. Limitation finale de sécurité.
8. Écriture d'un master PCM ou FLAC.
9. Encodage MP3/AAC/Opus éventuel, une seule fois, pour la distribution.

Quand le générateur amont fournit déjà du PCM, du WAV ou du FLAC, le procédé
utilise directement ces données. Il ne faut pas « repasser V11 » sur un MP3 déjà
traité : cela cumulerait traitement et artefacts de compression.

La durée du morceau est déterminée par la composition et le fournisseur, dans
leurs limites techniques. Une cible fixe de cinq ou deux minutes ne fait pas
partie du procédé. L'API ACE-Step native accepte une auto-durée pilotée par son
LM ; le raccord ComfyUI actuellement installé exige encore une longueur de
latent positive et utilise donc, sans demande explicite, un planificateur de
compatibilité adapté aux paroles et à la structure. Ce dernier ne doit pas être
confondu avec l'auto-durée native ACE.

## 6. Effets techniques à documenter par essais

Les essais de dépôt devraient comparer, sur un corpus figé :

- source directe ;
- fond résonant sans contrôle ;
- recette intégrale avec contrôle ;
- recette appliquée au bus seul contre application au mix complet ;
- traitement depuis FLAC/PCM contre doubles encodages MP3.

Mesures à conserver : true peak, LUFS-I, LRA, RMS par bande, corrélation,
différence de repli mono, différence spectrale, taux de clips, paramètres et
empreintes des fichiers. Une écoute en aveugle peut compléter ces mesures mais
ne remplace pas l'effet technique reproductible.

## 7. Figures proposées

- Figure 1 : graphe cumulatif V2→V11 et séparation direct/résonance.
- Figure 2 : conversion d'une coordonnée complexe en paramètres audio réels.
- Figure 3 : matrice mid/side appliquée au bus résonant seulement.
- Figure 4 : boucle de contrôle par mesures stéréo, mono, crête et sonie.
- Figure 5 : chemin PCM/FLAC puis encodage unique de distribution.

## 8. Projet de revendications

### Revendication 1 — procédé indépendant

1. Procédé de traitement numérique d'un signal audio comprenant : décoder le
signal audio en échantillons ; dériver, à partir desdits échantillons et d'au
moins une constante de référence, plusieurs branches résonantes dont au moins
un paramètre réel est déterminé par une coordonnée de phase ; réunir les
branches dans un bus distinct d'un signal direct ; spatialiser ledit bus ;
réinjecter le bus spatialisé sous le signal direct avec un taux borné ; mesurer
au moins un indicateur choisi parmi crête, corrélation stéréo et écart après
repli mono ; et modifier au moins la largeur du bus ou ledit taux lorsque
l'indicateur franchit un seuil.

### Revendications dépendantes

2. Procédé selon la revendication 1, dans lequel les canaux du bus reçoivent des
retards distincts et bornés.

3. Procédé selon l'une des revendications précédentes, dans lequel la
spatialisation est une transformation mid/side appliquée au bus résonant sans
être appliquée au signal direct.

4. Procédé selon l'une des revendications précédentes, dans lequel une branche
grave comprend la différence entre un signal filtré et une copie retardée et
pondérée dudit signal.

5. Procédé selon l'une des revendications précédentes, dans lequel la somme des
branches est soumise à une enveloppe d'énergie et à un plafond de gain humide.

6. Procédé selon l'une des revendications précédentes, dans lequel les branches
comprennent plusieurs transpositions harmoniques centrées autour d'un rapport
de référence.

7. Procédé selon l'une des revendications précédentes, dans lequel des
incréments de phase sont répartis symétriquement autour d'un pivot.

8. Procédé selon l'une des revendications précédentes, dans lequel la largeur
ou le taux de réinjection est réduit lorsqu'une perte d'énergie après repli mono
excède un seuil.

9. Procédé selon l'une des revendications précédentes, dans lequel un master
intermédiaire est écrit en PCM ou dans un format sans perte avant un unique
encodage avec perte destiné à la distribution.

10. Procédé selon l'une des revendications précédentes, comprenant l'écriture
d'un manifeste associant à la sortie les paramètres de branches, les mesures et
les décisions de correction.

11. Procédé selon l'une des revendications précédentes, dans lequel un taux de
discontinuités courtes ou de saturation commande un traitement de déclic ou une
réduction de gain.

12. Procédé selon l'une des revendications précédentes, dans lequel la durée de
sortie est indépendante des paramètres de spatialisation et n'est pas étendue
pour atteindre une durée musicale fixe.

### Revendications de dispositif et de support

13. Système de traitement audio comprenant un processeur et une mémoire portant
des instructions qui, lorsqu'elles sont exécutées, mettent en œuvre le procédé
selon l'une des revendications 1 à 12.

14. Support lisible par ordinateur portant des instructions qui, lorsqu'elles
sont exécutées par un processeur, mettent en œuvre le procédé selon l'une des
revendications 1 à 12.

## 9. Piste d'amélioration multi-axes

Un quaternion peut modéliser un état à quatre composantes, par exemple signal
direct, branche grave, branche harmonique et ambiance, puis piloter une rotation
ou un mélange conservant une norme. Cette piste n'est pas revendiquée ici tant
qu'une implémentation, un effet mesuré et une définition stable des axes ne sont
pas disponibles.

Le mot « quinternion » n'a pas de définition mathématique unique dans ce projet.
Il ne doit pas apparaître comme caractéristique technique avant que l'inventeur
précise l'algèbre, la loi de composition, la norme et le mapping audio. On peut
d'abord tester un simple vecteur à cinq branches avec matrice orthogonale
bornée, sans prétendre à une nouvelle algèbre.

## 10. État de l'art initial et frontières

Les éléments suivants sont déjà connus et ne doivent pas être revendiqués seuls :

- ouverture stéréo mid/side et réglage du canal side ;
- délais différents entre canaux et pseudo-stéréo ;
- renforcement de grave par retard, inversion ou génération harmonique ;
- largeur adaptative ;
- limitation et encodage audio sans perte.

Références initiales à analyser avec un professionnel :

- [US6928168B2 — spatial enhancement](https://patents.google.com/patent/US6928168B2/en)
- [US6111958A — stereo enhancement](https://patents.google.com/patent/US6111958A/en)
- [US20090147963A1 — frequency selective stereo enhancement](https://patents.google.com/patent/US20090147963A1/en)
- [EP2248352B1 — adaptive stereo processing](https://patents.google.com/patent/EP2248352B1/en)
- [US20260025116 — audio bass enhancement](https://patents.justia.com/patent/20260025116)

La piste à examiner n'est donc pas « un élargisseur » ou « des imaginaires » en
soi. Elle est la combinaison concrète, mesurable et reproductible : dérivation
de branches, bus séparé, spatialisation limitée à ce bus, contrôle automatique
mono/corrélation/crête, provenance des paramètres et chemin sans perte.

## 11. Cadre de rédaction à vérifier

- [Code de la propriété intellectuelle — brevets](https://www.legifrance.gouv.fr/codes/id/LEGISCTA000006146364)
- [OEB — clarté des revendications](https://www.epo.org/en/legal/guidelines-epc/2025/f_iv_3_9.html)
- [OEB — approche problème-solution](https://www.epo.org/en/legal/guidelines-epc/2026/g_vii_5_4.html)
- [OEB — suffisance de la description](https://www.epo.org/en/legal/guidelines-epc/2026/f_ii_4_1.html)
- [OEB — programmes d'ordinateur et effet technique](https://www.epo.org/en/legal/guidelines-epc/2026/g_ii_3_6.html)

## 12. Éléments à figer avant relecture CPI

- code source et poids exacts de la réalisation de référence ;
- fichiers audio d'entrée et de sortie avec SHA-256 ;
- manifeste de paramètres et mesures ;
- captures du graphe de traitement ;
- journal daté des contributions de chaque inventeur ;
- comparaison avec les antériorités les plus proches ;
- résultats montrant l'avantage de la topologie bus-seul ;
- correspondance artistique exacte de chaque version V2 à V11.

## 13. Questions réservées à l'inventeur

1. Quelle fonction musicale exacte attribuer à chaque version V2 à V11 : voix,
   famille d'instrument, amplification, espace ou contrôle ?
2. Que désigne précisément la résonance `M` dans la théorie d'origine, au-delà
   de son implémentation actuelle ?
3. Le mapping complexe doit-il préserver une énergie, une phase globale ou une
   autre grandeur ?
4. Quelles sont les cinq composantes envisagées pour la piste « quinternion » ?
5. Quels essais d'écoute et quelles mesures ont déjà servi à choisir les
   constantes actuelles ?

Ces réponses doivent compléter la description sans réécrire a posteriori les
faits techniques ni inventer une signification absente du code et des archives.
