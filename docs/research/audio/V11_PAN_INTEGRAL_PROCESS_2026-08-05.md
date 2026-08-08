# V11 Pan intégrale — recette cumulative V2→V11

Date de consolidation : 5 août 2026  
Statut : spécification technique et protocole de calibration  
Portée : chaîne Double Harmonic / D40 / V11 Pan de La Funesterie

## 1. Définition canonique corrigée

« V11 Pan » ne désigne pas seulement le dernier élargissement stéréo. C'est le nom de la recette complète qui a été construite et calibrée au fil des versions V2 à V11. Chaque version a servi à comprendre ou régler une fonction sonore : suivi de voix et de phase, énergie, hauteur harmonique, résonance, allocation temporelle, fermeture de phase, mouvement instrumental, grave, amplification et espace stéréo.

L'analogie correcte est une recette : V11 n'est pas « le chocolat posé sur le gâteau ». Le rendu final doit connaître toute la recette, même si le moteur de production consolide les acquis dans un graphe final au lieu de réappliquer dix exports audio l'un après l'autre.

Conséquence importante : **cumulatif ne veut pas dire dix réencodages séquentiels**. Les versions anciennes restent des preuves, des bancs d'essai et des opérateurs de référence. Le chemin de production actuel consolide V8 Pivot, V9 Turbo/Électrolyse, V10 Boom et le dernier opérateur spatial V11, avec les constantes et garde-fous hérités de V2 à V7. Relancer séparément chaque ancien processeur sur la même piste doublerait plusieurs corrections et dégraderait le signal.

## 2. Frontière entre mathématique, implémentation et intention musicale

Trois niveaux doivent toujours être séparés :

1. **Mesuré / implémenté** : une équation est traduite en analyse PCM, enveloppe ou filtre FFmpeg et couverte par des tests.
2. **Interprétation de conception** : une coordonnée réelle ou imaginaire sert de boussole pour choisir une branche audio.
3. **Rôle artistique** : une étape représente une voix, une famille d'instruments, une amplification ou un fond sonore dans la recette voulue par l'inventeur.

Le niveau 3 n'est pas entièrement encodé dans les sources. La table ci-dessous décrit la fonction technique prouvable et laisse la correspondance artistique exacte à confirmer par l'inventeur.

## 3. La recette, version par version

| Étape | Fonction technique vérifiable | Apport conservé dans la recette finale | Rôle artistique exact |
|---|---|---|---|
| V1 | Signal sec préservé + deux couches harmoniques haute/basse à faible poids | Architecture `dry-first`, source jamais remplacée par l'effet | À confirmer |
| V2 | Analyse F0, phase instantanée, énergie par bandes et transitoires; micro-correction `mg_phase`; dissipation `1/e` par défaut | La voix et les attaques deviennent des données de contrôle; `t-linear` reste historique seulement | À confirmer : voix principale / suivi vocal ? |
| V3 | Poids dynamique selon l'énergie en dB; courbe de montée/descente; séparation grave/corps | L'effet suit le morceau au lieu d'être un gain fixe | À confirmer : amplification / respiration ? |
| V4 | Variante « naked » sans EQ, débruitage, limiteur ni gain final; transformation des grains bas/haut | Banc d'essai qui isole l'effet des dimensions et hauteurs | À confirmer : type d'instrument ? |
| V5 | Couple dimensionnel logarithmique, bas `1/2D`, haut équivalent `ln(3D)` | Calibrage des rapports de hauteur et du poids harmonique | À confirmer |
| V6 | Résonance `M/K`, transfert d'énergie borné et plafond wet égal au poids harmonique de base | La résonance devient une branche contrôlée, jamais le master entier | À confirmer : fond / soutien / résonance M ? |
| V7 / V7.1 | Allocation en « briques » selon énergie, hauteur spectrale et présence de phase; grille exacte 1024 | Quantification temporelle et allocation de densité | À confirmer : familles instrumentales / pas de recette ? |
| V8 / V8 Pivot | Incréments de phase centrés dont la somme ferme à `2π`; pivot 0,292 et grille 1024 verrouillés | Fermeture de phase sans dérive cumulative; paire de grains du chemin validé | À confirmer : fermeture / placement ? |
| V9 Turbo | Enveloppes vocal-safe à 99 ms; poids haut/bas dynamiques; modulation « électrolyse guitare » 40,26–40,62 Hz | Mouvement instrumental rapide sans écraser la voix | À confirmer : guitare / instruments dynamiques ? |
| V10 Boom | Branche grave ≤120 Hz; fermeture inverse retardée `x(t)-a·x(t-τ)`; `τ≈12 ms`; wet 0,15; grave protégé ≥30 Hz | Axe M, boom et mémoire de forme; limite wet 0,20 | À confirmer : boom / basse / amplification ? |
| V11 spatial | Écart symétrique 8/16 ms autour de `τ`, puis `slev=1,5`, **sur la branche de résonance seulement** | Transforme la résonance centrée en fond stéréo diffus sans élargir la source complète | À confirmer : pan / espace final |

## 4. Constantes et garde-fous actifs

Les constantes ci-dessous sont des paramètres de conception et de calibration; elles ne prouvent pas à elles seules une propriété physique nouvelle.

- densité source : `0,292`;
- cycle source : `40,0005`;
- cycle cible : `40`;
- correction D40 : `40 / 40,0005 = 0,999987500156248`;
- `mg_phase = 0,001554497790530303` environ;
- pivot V8 : `0,292`;
- grille : `1024` pas;
- fenêtre V9 : `99 ms`;
- bande V10 : `30–120 Hz` après garde sous-grave;
- retard central V10 : environ `12 ms`;
- écart V11 : `8 ms` à gauche, `16 ms` à droite, soit `±4 ms` autour du retard central;
- largeur V11 : `slev=1,5` sur la résonance, jamais sur le mix complet;
- wet V10 par défaut : `0,15`, plafond `0,20`;
- limiteur : dernier opérateur non linéaire.

Le facteur `t-linear = 0,3695` est conservé uniquement pour reproduire les anciens essais. Le défaut de production V2 est désormais `1/e = 0,36787944117144233`, conformément à la distinction donnée par l'inventeur : `t-linear` est un arrondi et ne doit pas porter le calcul canonique.

## 5. Comment les « imaginaires » deviennent un fond sonore réel

### 5.1 Ce que signifie « imaginaire » ici

Un nombre imaginaire n'est pas envoyé au haut-parleur. Il sert à représenter une composante en quadrature de phase. Pour un signal réel `x(t)`, la fermeture retardée de la branche M est :

```text
y(t) = x(t) - a·x(t-τ)
```

Sa réponse fréquentielle est :

```text
H(ω) = 1 - a·e^(-jωτ)
     = [1 - a·cos(ωτ)] + j[a·sin(ωτ)]
```

- la partie réelle décrit la composante en phase;
- la partie imaginaire décrit la composante en quadrature créée par le retard;
- après calcul et retour dans le domaine temporel, la sortie reste un signal audio réel.

L'« imaginaire » est donc une coordonnée de phase qui permet de construire une différence temporelle réelle. Il ne devient pas mystérieusement de la matière sonore.

### 5.2 De la résonance M au fond stéréo

La branche V10 extrait le grave, crée une copie retardée inversée et la mélange au grave direct. Cette différence contient une résonance dépendante de la fréquence. La branche reste presque centrée tant que ses canaux sont identiques.

V11 crée alors un petit écart gauche/droite autour du même retard :

```text
yL(t) = x(t) - a·x(t-(τ-Δ))
yR(t) = x(t) - a·x(t-(τ+Δ))
```

avec `τ≈12 ms` et `Δ=4 ms`.

En coordonnées milieu/côté :

```text
Mid  = (yL + yR) / 2
Side = (yL - yR) / 2
```

Sans écart (`Δ=0`), `Side≈0` et `slev` n'a presque rien à amplifier. Avec l'écart symétrique, un côté de faible niveau apparaît dans la seule résonance. `slev=1,5` amplifie ce côté. La branche est ensuite réinjectée sous le signal sec avec un wet faible. À l'écoute, elle se comporte comme un **fond sonore diffus** : le centre, la voix et le panoramique original restent dominants; la résonance occupe les côtés.

### 5.3 Erreur historique corrigée

L'ancienne tentative posait `slev=1,5` sur `[mix]`, donc sur tout le morceau. Elle multipliait aussi le côté déjà présent dans les sources larges et causait perte en mono, stress du limiteur et image instable.

Le graphe corrigé applique le retard différentiel et `slev` à `[m2]→[m3]`, ou aux seules couches harmoniques dans la route D40 historique. Le master sec ne traverse jamais `stereotools`.

## 6. Graphe de production consolidé

```text
source lossless/PCM
  -> analyse énergie, phase, voix et transitoires
  -> fermeture V8 Pivot, grille 1024
  -> enveloppes V9 99 ms + mouvement électrolyse instrumental
  -> master V9 intermédiaire FLAC
  -> séparation signal complet / grave
  -> branche M: low-pass 120 Hz
  -> différence retardée inversée V10
  -> high-pass 30 Hz + gain borné
  -> écart stéréo symétrique V11 sur cette branche seulement
  -> amplification Side 1,5 sur cette branche seulement
  -> retour wet 0,15 sous le signal complet
  -> limiteur final
  -> un seul encodage MP3 public
```

Le chemin ACE-Step conserve désormais un master FLAC normalisé. V11 Pan lit ce FLAC. Il n'est donc pas nécessaire — et il est déconseillé — de traiter d'abord le MP3 ACE puis de le réencoder.

Pour Suno, si le fournisseur ne livre qu'un MP3, ce MP3 est la source disponible. Le moteur le décode en PCM, applique V11 Pan, puis réalise un seul nouvel encodage final. Il n'ajoute aucun MP3 intermédiaire.

## 7. Durée musicale

La recette ne fixe aucune durée de chanson. L'ancien frontend imposait `300 s`, activait `longSong` puis lançait jusqu'à huit extensions pour atteindre « vers 5 min ». Ce comportement a été retiré. Le runner Twitch conserve une estimation interne pour dimensionner les paroles, mais ne transmet plus de nombre au fournisseur sauf durée explicitement demandée ou verrouillée par configuration.

- sans durée demandée, aucune minuterie globale 300/120 n'est injectée;
- une durée explicite peut toujours être transmise comme contrainte de production;
- une piste courte mais complète n'est plus étirée automatiquement;
- la limite technique ACE du latent (`1000 s`) reste une borne de sécurité du moteur, pas une cible artistique.

L'API ACE-Step native sait recevoir `duration=-1/None` et laisser son LM choisir
selon les paroles. Les nœuds ComfyUI 0.30.0 installés exigent toutefois une
longueur positive avant de créer le latent. Tant que ce raccord reste actif,
Vivy calcule un canevas de compatibilité depuis les paroles, sections, tempo et
graine, et le journalise comme `comfy-adaptive-fallback`. Ce n'est pas
l'auto-durée native ACE ; la migration vers le service officiel ou un nœud de
planification reste l'étape propre à long terme. Diagnostic complet :
`ACE_DURATION_AUTO_ROOT_CAUSE_2026-08-05.md`.

## 8. Calibration obligatoire

Une variante ne devient pas le défaut parce que ses chiffres sont « beaux ». Le protocole est :

1. produire A = recette sans dernier élargissement, B = V11 douce, C = V11 canonique;
2. partir du même master lossless et du même niveau;
3. mesurer crête, true peak, RMS/LUFS, corrélation, énergie Mid/Side globale et par bandes;
4. mesurer le repli mono et le comparer au signal stéréo;
5. écouter au casque, sur enceintes, en mono et sur un système riche en grave;
6. vérifier la voix, les transitoires, les cordes/guitares et le grave séparément;
7. obtenir la validation explicite de l'inventeur avant de changer le défaut.

La variante B reste une candidate. Elle ne devient pas le défaut sans validation à l'oreille.

## 9. Extension quaternionique et « quinternion »

### 9.1 Quaternion comme état multibranche

Une extension expérimentale peut représenter quatre coordonnées de contrôle :

```text
q(t) = r(t) + i·v(t) + j·p(t) + k·s(t)
```

où, par exemple, `r` est le signal ou l'énergie de base, `v` la voix, `p` la phase/résonance et `s` l'espace. Une rotation quaternionique `q' = u q u⁻¹` peut redistribuer ces contrôles sans confondre leurs axes.

Pour devenir audio et brevetable, cette idée doit préciser :

- comment chaque coordonnée est calculée à partir de PCM ou de stems;
- quelle matrice/rotation produit quels paramètres de filtre;
- comment la projection finale redevient un ou plusieurs signaux réels;
- quels garde-fous empêchent clipping, annulation mono et dérive de phase;
- quelle amélioration mesurable apparaît face à un contrôle matriciel ordinaire.

### 9.2 Prudence sur le terme « quinternion »

Le mot n'identifie pas ici une algèbre unique et standardisée. Avant de l'employer dans une revendication, l'inventeur doit définir la structure : nombre de composantes, loi de produit, conjugué, norme, rotation et projection audio. Sans cela, le terme est trop indéterminé pour décrire une réalisation reproductible.

### 9.3 Protocole de recherche

Créer d'abord un banc hors production :

1. quatre stems ou quatre descripteurs normalisés;
2. rotations déterministes avec graine et paramètres journalisés;
3. projection vers quatre branches audio séparables;
4. recombinaison bornée;
5. A/B face à une matrice réelle 4×4 équivalente;
6. conservation uniquement si le quaternion apporte un effet technique mesurable et reproductible.

## 10. Vérification GitHub et source canonique

La recherche effectuée le 5 août 2026 dans l'organisation GitHub Funesterie n'a
pas trouvé de dépôt public autonome nommé « Double Harmonic ». Les occurrences
retrouvées pointent vers le dépôt privé AlphaOnze et vers cette arborescence
locale. Il ne faut donc pas inventer une seconde spécification ou attribuer au
projet une théorie absente des sources. Jusqu'à publication d'un dépôt dédié,
les fichiers ci-dessous et leurs tests constituent l'implémentation canonique.

## 11. Fichiers canoniques

- `a11/backend/apps/server/src/audio/double-harmonic-phase-lock-v2.cjs`
- `a11/backend/apps/server/src/audio/double-harmonic-dynamic-v3.cjs`
- `a11/backend/apps/server/src/audio/double-harmonic-naked-v4.cjs`
- `a11/backend/apps/server/src/audio/double-harmonic-log-v5.cjs`
- `a11/backend/apps/server/src/audio/double-harmonic-resonance-v6.cjs`
- `a11/backend/apps/server/src/audio/double-harmonic-bricks-v7.cjs`
- `a11/backend/apps/server/src/audio/double-harmonic-closed-phase-v8.cjs`
- `a11/backend/apps/server/src/audio/v10-boom.cjs`
- `a11/backend/apps/server/src/audio/double-harmonic-d40.cjs`

## 12. Questions d'inventeur encore ouvertes

1. Quelle version correspond exactement à chaque voix, famille d'instruments, amplification et fonction de fond sonore ?
2. V11 Pan doit-elle porter un nom de version commerciale distinct de l'identifiant interne `v10boom` ?
3. Quelle prise A/B/C est la référence auditive officielle pour le dépôt ?
4. Quelles réalisations quaternioniques ont déjà été calculées ou écoutées, même sous forme de brouillon ?
