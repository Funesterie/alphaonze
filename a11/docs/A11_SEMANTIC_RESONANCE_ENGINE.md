# A11 Semantic Resonance Engine

Objectif : apprendre aux agents Funesterie à lire la charge humaine des mots, des références, des blagues, des symboles et des interactions.

Un agent ne doit pas seulement comprendre ce qu’une chose désigne. Il doit comprendre ce qu’elle réveille chez les humains : une sensation, un souvenir, une peur, une vanne, une scène, une honte, une fierté, une ambiguïté ou une promesse.

Pour Vivy, ce moteur sert à écrire mieux : moins de mots génériques, moins d’anciens thèmes recyclés, plus de scènes justes, d’images concrètes, d’allusions maîtrisées et de refrains qui portent vraiment le sujet.

## Principe

Les humains ne communiquent pas seulement par définition. Ils activent des réseaux d’associations.

Un mot peut porter :

- un sens littéral ;
- une odeur, une couleur, une texture, un son ;
- une référence culturelle ;
- une émotion ;
- une expression populaire ;
- une seconde lecture ;
- un souvenir de contexte ;
- une opposition comique ;
- un risque de contresens.

Une référence forte agit comme un résonateur sémantique. Plus elle relie de couches pertinentes, plus elle peut produire une émotion, une image, une chute ou un refrain.

## Lecture en couches

Pour chaque mot important, l’agent lit les couches suivantes.

1. Sens littéral
   Objet, action, personne, lieu, matière ou événement.

2. Associations sensorielles
   Odeur, couleur, saison, température, matière, mouvement, bruit, goût, lumière.

3. Charge culturelle
   Film, jeu, animé, musique, internet, expression populaire, souvenir collectif.

4. Charge émotionnelle
   Nostalgie, défi, honte, liberté, désir, colère, tendresse, menace, victoire.

5. Figures et doubles sens
   Idiome, calembour, homophonie, syllepse, métaphore, métonymie, sous-entendu.

6. Archétypes narratifs
   Rival, survivant, menteur drôle, prodige, mentor, machine vivante, ville malade, objet maudit.

7. Interactions légendaires
   Deux références peuvent devenir plus fortes ensemble. Exemple : machine + voix = dialogue avec l’invisible ; ville + néons = scène nocturne, solitude, vitesse ou spectacle.

8. Temporalité
   Une référence peut être actuelle, usée, ringarde, relancée, intime à Djeff/Funesterie ou propre à une session Twitch.

## Exemples utiles pour Vivy

### Exemple 1 : “violet néons”

```txt
Sens littéral :
couleur violette + lumière artificielle.

Associations :
nuit, enseignes, pluie sur le bitume, scène, cyberpunk, club, mégapole.

Charge émotionnelle :
mystère, énergie nocturne, beauté électrique, solitude possible.

Risque :
si le sujet ne parle pas de moto, ne pas importer casque, guidon, sirènes ou poursuite.

Bonne transformation :
Vivy chante au centre d’une ville violette, les machines répondent en rythme, la foule reprend le refrain.

Mauvaise transformation :
Vivy repart sur une moto avec gyros et hélicos parce qu’une ancienne chanson l’a fait.
```

### Exemple 2 : “baguette du matin”

```txt
Sens littéral :
pain frais, boulangerie, croûte, farine, chaleur du four.

Associations :
village, comptoir, panier, odeur chaude, file d’attente, routine du matin.

Seconde lecture possible :
paillarde légère si le contexte demande une chanson grivoise.

Règle :
ne jamais dire le sous-entendu frontalement. Le rire doit venir du quiproquo.

Bonne transformation :
Le village fait semblant de venir pour le pain, mais chacun trouve une excuse de plus en plus absurde pour repasser devant la boutique.

Mauvaise transformation :
expliquer “ceci est une double lecture” ou réciter les mots “surface / sous-texte / tabou”.
```

### Exemple 3 : “volant”

```txt
Sens littéral :
objet qui permet de diriger une voiture.

Lecture phonétique possible :
veau lent.

Usage comique :
la phrase prépare d’abord la voiture, puis force l’oreille à entendre l’animal.

Exemple chantable :
La voiture file droit sur la voie rapide,
mais au volant, c’est toujours le veau lent qui décide.

Règle :
le jeu de mots doit s’entendre sans écrire l’explication entre parenthèses.
```

### Exemple 4 : “carte graphique qui avale les bits”

```txt
Sens littéral :
matériel informatique, calcul, mémoire vidéo, chaleur, ventilateurs.

Associations :
faim, surcharge, bruit, cadence, performance, désir de puissance.

Jeux possibles :
bits / bites à l’oreille, giga / gigoter, RAM qui rame, ventirad qui met un vent.

Règle :
si la demande veut de l’humour adulte, le texte doit rester chantable et allusif. Il faut plusieurs pivots sonores, pas une seule blague isolée.

Bonne transformation :
la machine a faim de données, le ventilateur souffle des excuses, la RAM rame derrière les cœurs qui cadencent.

Mauvaise transformation :
une chanson technique sérieuse qui oublie le délire phonétique.
```

### Exemple 5 : “grenouille qui voulait fumer”

```txt
Sens littéral :
petite grenouille + cigarette ou fumée.

Sous-thème :
vouloir paraître cool.

Morale cachée :
on n’a pas besoin d’imiter une mauvaise habitude pour exister.

Transformation narrative :
elle imite les humains, tousse en faisant des bulles, puis découvre que son vrai style vient de sa voix et de son rythme.

Règle :
ne pas faire un sermon anti-tabac. Montrer la conséquence par la scène.
```

## Règles pour les agents

- Ne jamais réduire une référence forte à un simple fait.
- Chercher ce que la référence représente dans le contexte exact.
- Ne pas importer un ancien thème si le sujet ne l’autorise pas.
- Garder la phrase claire avant de la rendre brillante.
- Préférer une scène concrète à une formule abstraite.
- Ne pas expliquer la blague : construire le malentendu, puis laisser la chute agir.
- Ne pas forcer les références si elles n’aident pas.
- Distinguer une allusion pertinente d’un bruit de session.
- Respecter le sens de Djeff avant de proposer une lecture.
- Les réparations automatiques restent séparées : cette couche enrichit la compréhension, elle ne donne pas un droit d’action.

## Règles spéciales pour Vivy

Vivy doit transformer une demande en matière chantable, pas en commentaire sur la demande.

Elle doit produire :

```txt
idée brute
-> lecture en couches
-> intention principale
-> sous-thème
-> éventuelle troisième intention
-> plan de scènes
-> paroles propres
-> brief musical séparé
```

### Architecture V9 : façade, combles et répercussions

Le thème principal forme la façade. Il doit rester reconnaissable sans explication : personnages, actions, lieux, objets et verbes précis viennent du sujet demandé.

Le sous-thème habite les combles. Il reste moins visible, mais il donne une seconde profondeur aux scènes. Il ne remplace jamais le thème et ne doit pas être annoncé dans les paroles.

La liaison entre les deux passe par des mots-pivots :

```text
première lecture claire
-> retour du même mot dans un autre contexte
-> conséquence concrète
-> compréhension humoristique ou dramatique nouvelle
```

La posologie textuelle est dynamique :

- forme courte : un à trois pivots nets ;
- chanson normale : trois à cinq pivots ;
- forme longue : cinq à huit pivots, seulement si l’histoire les justifie ;
- au maximum deux retours significatifs du même pivot hors refrain ;
- le refrain peut porter un pivot central dont le sens change au dernier retour.

Pour l’humour, la répercussion produit un quiproquo, une césure, une contradiction ou une conséquence disproportionnée. Pour le drame, elle charge progressivement le même mot d’une perte, d’un choix, d’un coût ou d’une révélation.

Un pivot n’existe pas parce qu’un mot est répété. Il existe lorsque son retour modifie la scène et oblige l’auditeur à relire ce qu’il avait compris.

Exemple de mécanique, à ne pas recopier :

```text
Façade : un hôtel ferme ses portes avant l’orage.
Mot-pivot : « chambre ».
Premier passage : une chambre à préparer pour un voyageur.
Répercussion : le personnage garde aussi une émotion « en chambre », sans la laisser sortir.
Conséquence dramatique : quand la dernière porte s’ouvre, ce n’est pas le client qui revient, mais ce qu’il refusait d’avouer.
```

Les coefficients sont internes au raisonnement V9. Les paroles ne doivent jamais parler de façade, de combles, de dosage, d’équation, de pivot ou de coefficient.

### La césure-piège

Certaines chansons comiques françaises font rire sans écrire le mot interdit. La phrase prépare une conclusion presque certaine, s’arrête juste avant, puis reprend avec un complément innocent. Pendant la pause, l’auditeur complète mentalement la version compromettante.

La mécanique est :

```text
contexte innocent
-> syntaxe qui appelle un mot prévisible
-> pause musicale
-> mot de remplacement banal et grammatical
-> conséquence qui confirme discrètement l’ambiguïté
```

La pause n’est pas un trou : c’est l’endroit où le public écrit lui-même la blague.

Pour que cela fonctionne :

- la première partie doit être naturelle et suffisamment précise ;
- le mot imaginé ne doit jamais être écrit ni expliqué ;
- la résolution innocente doit former une vraie phrase ;
- le chanteur garde un ton sérieux ou tendre au moment de la chute ;
- deux ou trois césures fortes suffisent ;
- la césure tombe sur une frontière musicale audible ;
- le couplet suivant exploite la conséquence du malentendu au lieu de recommencer la même blague.

Exemple original de structure, à ne pas recopier :

```text
Un personnage promet de montrer sa grande...
[pause]
collection, soigneusement rangée dans le salon.
```

La lecture chantée reste familiale. La lecture imaginée appartient au public. Vivy doit inventer ses propres phrases à partir du sujet courant et ne jamais reproduire les paroles d’une œuvre de référence.

### La parodie de format

L’humour français fonctionne aussi très bien quand un format social est joué avec un sérieux excessif. Le sujet n’est pas seulement drôle : il entre dans une machine de cérémonie, de concours, de jury, d’audition, d’émission, de reportage, de battle ou de confessionnal.

La mécanique est :

```text
format crédible
-> règles implicites du format
-> personnage qui y croit trop
-> détail absurde traité comme enjeu majeur
-> surinterprétation par un témoin, un jury ou un narrateur
-> retour de gimmick
-> chute qui retourne le format contre lui-même
```

Vivy doit choisir le format avant d’écrire. Un sujet de boulanger peut devenir une finale culinaire, un sujet de carte graphique peut devenir une audition de composants, un sujet de grenouille peut devenir un grand concours du marais. Le format donne des rôles, des transitions et des attentes, mais les paroles restent une chanson.

Une bonne parodie de format :

- garde le thème principal en façade ;
- donne un rôle clair à chaque personnage ;
- fait monter l’absurde par conséquences visibles ;
- utilise un gimmick qui revient avec un sens différent ;
- laisse les personnages prendre l’histoire au sérieux ;
- ne cite jamais la référence ;
- ne dit jamais “c’est une parodie”.

Exemple original de structure, à ne pas recopier :

```text
Format : concours d’invention de quartier.
Sujet : un réveil qui arrive toujours en retard.
Première scène : le réveil se présente comme un candidat discipliné.
Faille : il sonne après la délibération.
Surinterprétation : le jury appelle cela “une gestion personnelle du tempo”.
Gimmick : “il était presque à l’heure”.
Chute : le trophée sonne à sa place et réveille toute la salle.
```

La parodie ne remplace pas les rimes, la mélodie ou le refrain. Elle donne une architecture de scènes pour éviter que Vivy récite un prompt ou répète la même blague.

Les paroles finales ne doivent jamais contenir :

- “prompt” ;
- “règle privée” ;
- “surface” ;
- “sous-texte” ;
- “double lecture” comme explication ;
- “morale cachée” comme annonce ;
- “style musical” ;
- “Suno” ;
- “Mureka” ;
- “Twitch” si le sujet ne parle pas de Twitch.

## Exemple Neo4j

```cypher
(:A11CulturalAnchor {
  id: "volant",
  label: "volant",
  type: "word",
  language: "fr",
  trust: 0.9,
  temporalStatus: "stable"
})

(:A11SemanticFacet {
  id: "volant.direction",
  label: "direction d’un véhicule",
  layer: "literal",
  tone: "action"
})

(:A11SemanticFacet {
  id: "volant.veau-lent",
  label: "veau lent",
  layer: "phonetic_wordplay",
  tone: "humour"
})

(:A11CulturalAnchor {id: "volant"})
  -[:EVOKES {weight: 0.82}]->
(:A11SemanticFacet {id: "volant.direction"})

(:A11CulturalAnchor {id: "volant"})
  -[:HAS_WORDPLAY {weight: 0.88}]->
(:A11SemanticFacet {id: "volant.veau-lent"})
```

Relations recommandées :

- `EVOKES`
- `CARRIES_TONE`
- `HAS_WORDPLAY`
- `HAS_HIDDEN_INTENTION`
- `PAIRS_WITH`
- `AMPLIFIES`
- `CONTRASTS_WITH`
- `BELONGS_TO_LAYER`
- `RISKS_CONTEXT_LEAK`
- `USED_BY_AGENT`

## Premier objectif

Installer une base petite mais solide :

- `semantic-resonance-seeds.json` contient les premiers nœuds humains.
- `semantic-resonance.cjs` charge, cherche, score et explique les résonances.
- Les agents A11, K44, Vivy et Kiro lisent la spec avant d’enrichir une réponse créative, média ou narrative.
- Toute extension du corpus passe par une revue simple : sens, contexte, ton, risque de contresens, niveau de confiance.

## Critère de réussite

Une bonne résonance aide Vivy à écrire une chanson plus juste.

Elle doit permettre :

- un meilleur choix d’images ;
- moins de répétitions ;
- moins de recyclage d’anciens thèmes ;
- des doubles lectures plus naturelles ;
- une morale cachée plus subtile ;
- une scène finale plus mémorable.

Si la résonance ne rend pas la création plus claire, plus drôle, plus émouvante ou plus précise, elle doit rester en mémoire mais ne pas être injectée dans la chanson.
