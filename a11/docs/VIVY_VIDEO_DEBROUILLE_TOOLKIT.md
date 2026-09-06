# Vivy Vidéo : boîte à outils de débrouille

Objectif : produire des clips plus malins que coûteux. Avec peu de générations vidéo, Vivy, A11 et K44 doivent savoir monter, réutiliser, recadrer et rythmer au lieu de tout régénérer.

Ce document est une doctrine interne. Il apprend les choix de montage, pas un automatisme. Une technique n’est utilisée que si elle résout un problème visible ou une demande explicite.

## Principe

La bonne vidéo n’est pas celle qui consomme le plus. C’est celle qui donne l’impression d’avoir compris la chanson.

Pipeline conseillé :

```text
chanson
-> structure audio : intro, couplets, refrain, pont, final
-> motifs visuels : personnages, lieu, objet-pivot, émotion, couleur
-> budget : combien de boucles réellement nécessaires
-> montage : réemploi, recadrage, variation, rythme, transition
-> vérification : plein cadre, pas de texte parasite, pas de mosaïque non voulue
```

## Règle des cinq cacahuètes

Quand le budget ou le temps est faible, ne pas chercher un clip généré pour chaque ligne.

Stratégie par défaut :

- une image ou jaquette forte ;
- trois à cinq boucles vidéo maximum ;
- une boucle d’intro ;
- une boucle de couplet ;
- une boucle de refrain réutilisable ;
- une boucle de pont ou rupture ;
- une image finale ou reprise du refrain ;
- montage FFmpeg propre sur toute la durée.

Le refrain peut réutiliser la même boucle, mais il doit être remonté avec une variation de durée, de moment ou d’intensité. La répétition doit sembler musicale, pas pauvre.

## Mode Vivy DreamClip

DreamClip est l'inverse de la règle des cinq cacahuètes. Il ne sert pas à économiser : il sert à tenter un clip premium, généré scène par scène, pour un morceau fort.

À utiliser seulement si la demande le justifie :

- clip de rêve ;
- clip complet généré de A à Z ;
- test plein régime ;
- chanson courte ou moyenne avec vraie histoire ;
- crédits vidéo disponibles ;
- utilisateur prêt à accepter un échec propre plutôt qu'un faux clip.

Règles du mode :

- huit scènes maximum par défaut ;
- durée rendue plafonnée à cinq minutes ;
- chaque scène doit être générée comme une vraie vidéo ;
- pas de réutilisation automatique du refrain ;
- pas de secours par image fixe animée ;
- pas de découpage 3x3 sauf réparation explicitement demandée ;
- rejet des plans avec faux texte, affiches illisibles, mosaïques ou visage qui change d'identité ;
- si la couverture générée est trop faible, le clip doit échouer proprement.

Variables :

```text
VIVY_STREAM_FULL_CLIP_MODE=dreamclip
VIVY_STREAM_DREAMCLIP_SCENES=8
VIVY_STREAM_DREAMCLIP_MAX_DURATION_SECONDS=300
VIVY_STREAM_DREAMCLIP_MIN_GENERATED_COVERAGE=0.72
VIVY_STREAM_DREAMCLIP_ALLOW_STATIC_FALLBACK=0
```

Le mode normal reste :

```text
VIVY_STREAM_FULL_CLIP_MODE=economy
```

Le bon réflexe : économie pour le live courant, DreamClip pour un morceau qu'on assume de pousser.

## Outils disponibles

### Storyboard borné

Vivy découpe la chanson en scènes utiles :

- intro : installation du décor ;
- couplet 1 : première action ;
- pré-refrain : tension ;
- refrain : symbole mémorable ;
- couplet 2 : conséquence ;
- pont : bascule ;
- refrain final : résolution ;
- outro : image finale.

Limite normale : cinq scènes. Plein régime : huit scènes maximum, seulement si demandé ou si la chanson est longue.

### Boucles réutilisées

Une boucle peut servir plusieurs fois si elle représente un motif central : refrain, objet-pivot, visage, ville, machine, route, scène comique.

À faire :

- garder la même boucle pour le refrain ;
- changer le point d’entrée ou la durée ;
- alterner avec un plan de réaction ou une image fixe ;
- faire sentir une montée au refrain final.

À éviter :

- générer huit boucles presque identiques ;
- recycler une boucle qui ne correspond plus aux paroles ;
- remplacer l’histoire par une seule image qui tourne en rond.

### Montage FFmpeg

FFmpeg sert à :

- concaténer des boucles ;
- boucler un plan court sur une section longue ;
- couper un plan en plusieurs morceaux utiles ;
- réarranger les morceaux selon intro, couplet, refrain, pont et final ;
- ralentir un plan de pont ou d’outro ;
- accélérer légèrement un refrain ou une montée ;
- recadrer en 16:9 ;
- uniformiser résolution, FPS et codec ;
- poser des fondus courts ou des cuts nets ;
- créer un clip complet à partir de quelques plans ;
- ajouter plus tard des transitions sobres si besoin.

FFmpeg est l’outil de débrouille principal : fiable, local, peu coûteux.

### Montage synchronisé au son

Le montage doit écouter la structure de la chanson avant de toucher aux images.

Le bon ordre :

```text
durée audio
-> sections : intro, couplet, pré-refrain, refrain, pont, final
-> points de coupe approximatifs
-> intensité de chaque section
-> choix : cut, ralenti, accélération, fondu, reprise du refrain
-> montage FFmpeg
```

Vivy ne doit pas générer une vidéo nouvelle pour chaque effet. Elle peut prendre cinq boucles et les monter comme un vrai clip :

- couper une boucle de couplet en plusieurs plans ;
- changer le point d’entrée quand le même refrain revient ;
- accélérer légèrement le refrain pour donner de l’impact ;
- ralentir le pont pour laisser respirer la bascule ;
- faire un fondu court en intro, pont ou outro ;
- faire un cut net sur refrain, drop, blague ou punchline ;
- revenir au même motif au refrain final avec une durée ou un cadrage différent.

Ce montage fonctionne au cas par cas par défaut. Vivy regarde la matière générée : durée réelle des boucles, répétitions, refrain qui revient, section trop longue, pont qui mérite une respiration, vidéo déjà assez longue pour tenir seule.

Il peut être forcé, coupé ou réglé par configuration :

```text
VIVY_STREAM_FULL_CLIP_PRO_EDIT=auto
VIVY_STREAM_FULL_CLIP_BPM=150
VIVY_STREAM_FULL_CLIP_MIN_EDIT_SEGMENT_SECONDS=2.5
VIVY_STREAM_FULL_CLIP_MAX_EDIT_SEGMENT_SECONDS=8
VIVY_STREAM_FULL_CLIP_TRANSITION_SECONDS=0.28
VIVY_STREAM_FULL_CLIP_MAX_EDIT_SEGMENTS=64
```

Mettre `VIVY_STREAM_FULL_CLIP_PRO_EDIT=0` revient à un assemblage direct plus simple.
Mettre `VIVY_STREAM_FULL_CLIP_PRO_EDIT=1` force le montage synchronisé même si Vivy aurait choisi de rester sobre.

Le montage synchronisé reste une décision de monteur : il sert le morceau. Il ne doit pas transformer une ballade en zapping, ni une scène calme en démonstration technique.

### Recadrage source

Une jaquette peut contenir du texte, une fiche identité ou des colonnes. Avant d’en faire une vidéo, recadrer la zone utile :

- visage ou personnage si c’est le sujet ;
- objet central si le sujet n’est pas humain ;
- décor si la chanson est instrumentale ;
- éviter les textes et logos.

Le recadrage sert à obtenir un plan cinéma plein cadre, pas une affiche animée.

### Image fixe animée

Quand la vidéo coûte trop cher ou que le provider sort mal :

- utiliser la jaquette ;
- faire un léger zoom ;
- ajouter un mouvement de lumière ;
- alterner avec waveform, titre court ou overlay ;
- garder le résultat propre.

Une image bien montée vaut mieux qu’une vidéo confuse.

### Vidéos de section

Pour une chanson complète, le bon compromis est souvent :

- intro ;
- couplet ;
- refrain ;
- pont ;
- final.

Chaque vidéo peut boucler sur la section correspondante. Le refrain peut revenir plusieurs fois. Le pont doit créer la différence.

### Images de soutien

Si les vidéos sont trop chères, générer plusieurs images de scènes :

- une image par grande section ;
- pan/zoom léger ;
- cuts au tempo ;
- refrain avec retour de l’image la plus forte.

C’est peu coûteux et souvent plus lisible qu’un clip vidéo instable.

### Réparation de mosaïque

Le découpage 3x3 est un outil de réparation, pas une esthétique.

Il ne doit être utilisé que si un fournisseur renvoie réellement une mosaïque ou un contact sheet dans une seule vidéo.

Déclenchement autorisé :

```text
VIVY_STREAM_FULL_CLIP_DEMOSAIC_GRID=repair
```

Déclenchements interdits :

```text
VIVY_STREAM_FULL_CLIP_DEMOSAIC_GRID=1
VIVY_STREAM_FULL_CLIP_DEMOSAIC_GRID=true
```

Raison : un booléen oublié ne doit jamais transformer tous les clips en découpage 3x3. Si la vidéo générée est déjà plein cadre, on la garde plein cadre.

## Choisir la bonne technique

### Si le sujet est vague

Ne pas générer huit plans au hasard. Créer d’abord une identité visuelle simple :

- couleur dominante ;
- lieu ;
- personnage ou objet ;
- émotion ;
- mouvement principal.

Puis produire peu de boucles fortes.

### Si la chanson raconte une histoire

Créer une boucle par étape narrative :

- exposition ;
- problème ;
- tension ;
- bascule ;
- résolution.

Le montage suit les paroles. Il ne fabrique pas une autre histoire.

Puis découper ces boucles selon la tension :

- exposition : plans plus longs ;
- problème : coupes plus régulières ;
- tension : plans plus courts ;
- bascule : ralenti ou fondu ;
- résolution : retour du motif principal.

### Si la chanson est un banger

Priorité au rythme :

- plans courts ;
- symbole central ;
- retour fort du refrain ;
- cuts sur les montées ;
- final plus large.

Le refrain doit être reconnaissable. On peut réutiliser la boucle de refrain, mais jamais exactement de la même façon : autre point d’entrée, vitesse légèrement différente, cut plus sec, ou reprise plus large au final.

### Si la chanson est instrumentale

Pas de pseudo-paroles. Le montage suit :

- texture ;
- intensité ;
- instruments ;
- progression du décor ;
- respiration.

La coupe se cale sur les changements d’intensité plutôt que sur des mots. Les transitions peuvent être plus longues, surtout si le morceau est cinématique.

### Si la chanson est comique

Le montage doit porter la chute :

- plan sérieux ;
- détail absurde ;
- réaction ou conséquence ;
- retour de gimmick ;
- image finale qui retourne la blague.

Ne pas mettre du texte explicatif à l’écran.

La coupe drôle fonctionne souvent comme un quiproquo : plan normal, détail de travers, réaction, retour du motif. Le montage doit laisser une micro-respiration avant ou après la chute.

## Ce que les agents ne doivent pas faire

- Ne pas déclencher le 3x3 par défaut.
- Ne pas générer une vidéo chère quand une image montée suffit.
- Ne pas faire huit scènes si cinq racontent mieux.
- Ne pas transformer toutes les chansons en portrait de Vivy.
- Ne pas afficher de faux texte IA dans les vidéos.
- Ne pas recopier les paroles à l’écran.
- Ne pas changer l’identité visuelle des personnages entre deux plans.
- Ne pas confondre voix chantée et personnage visuel.
- Ne pas envoyer tous les outils en même temps.

## Décision simple

Avant de lancer une vidéo, l’agent choisit silencieusement :

```text
objectif : teaser, clip complet, boucle OBS, archive YouTube ou test
budget : faible, normal, plein régime
plans : 1, 3, 5 ou 8
réemploi : oui/non
provider : local, Comfy, proxy, cloud
montage : direct, synchronisé au son, cuts rapides, ralenti, fondus
réparation : aucune, recadrage, demosaic repair
```

Si l’utilisateur demande “plein régime”, huit scènes sont possibles. Sinon, la débrouille intelligente prime.

## Résultat attendu

Un bon montage Vivy doit donner :

- un plan plein cadre ;
- une identité cohérente ;
- peu ou pas de texte parasite ;
- un refrain visuellement reconnaissable ;
- une progression lisible ;
- des coupes qui suivent la musique ;
- des ralentis ou accélérations justifiés ;
- une consommation raisonnable ;
- une réparation 3x3 uniquement si nécessaire.
