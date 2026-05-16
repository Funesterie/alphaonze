# A11 Semantic Resonance Engine

Objectif: apprendre aux agents a lire la charge humaine des mots, references,
blagues, symboles et interactions, au-dela du sens litteral.

Un agent ne doit pas seulement savoir ce qu'est une chose. Il doit aussi savoir
ce qu'elle represente pour les humains dans un contexte donne.

## Principe

Les humains ne communiquent pas seulement avec des mots. Ils activent des
reseaux d'associations:

- souvenirs
- odeurs
- scenes
- blagues
- archetypes
- emotions
- references pop
- doubles sens
- contrastes narratifs
- interactions deja vecues

Une reference forte agit comme un resonateur semantique. Plus elle relie de
couches humaines pertinentes, plus elle porte de densite et plus elle peut
produire d'intensite emotionnelle.

Exemple court:

```txt
sapin
-> arbre / foret / odeur de resine / hiver / Noel / bois
-> "ca sent le sapin" / declin / mort imminente / humour noir
-> possible double sens weed selon contexte
```

Ce n'est donc pas un simple mot. C'est un noeud vivant.

## Couches a enseigner

1. Sens litteral
   - Definition directe, objet, personne, lieu ou action.

2. Associations sensorielles
   - Odeur, couleur, matiere, saison, son, mouvement, texture.

3. Charge culturelle
   - Films, jeux, anime, musique, internet, souvenirs collectifs.

4. Charge emotionnelle
   - Nostalgie, defi, solitude, liberte, malaise, tendresse, menace.

5. Figures et doubles sens
   - Idiomes, calembours, glissements de sens, ambiguites utiles.

6. Archetypes narratifs
   - Trickster, rival, mentor, prodige, survivant, navire maudit, boucle.

7. Interactions legendaires
   - References qui gagnent de la force ensemble.
   - Exemple: Black Pearl + Flying Dutchman = passage du chaos vivant au
     systeme spectral autonome.

8. Temporalite
   - Une reference peut etre vivante, ancienne, morte, relancee, locale ou
     propre a Djeff/Funesterie.

## Regles agents

- Ne jamais reduire une reference forte a un simple fait.
- Toujours chercher ce que la reference represente dans le contexte.
- Ne pas forcer les references si elles n'aident pas.
- Garder la phrase claire avant de la rendre brillante.
- Respecter le sens de Djeff avant de proposer une lecture.
- Ne pas scraper en vrac: privilegier les seeds valides, les sources fiables,
  les notes de corpus et les retours humains.
- Les reparations automatiques restent separees: cette couche enrichit la
  comprehension, elle ne donne pas un droit d'action.

## Exemple Neo4j

```cypher
(:A11CulturalAnchor {
  id: "sapin",
  label: "sapin",
  type: "word",
  language: "fr",
  trust: 0.86,
  temporalStatus: "stable"
})

(:A11SemanticFacet {
  id: "sapin.forest",
  label: "foret",
  layer: "sensory",
  tone: "nature"
})

(:A11CulturalAnchor {id: "sapin"})
  -[:EVOKES {weight: 0.86}]->
(:A11SemanticFacet {id: "sapin.forest"})

(:A11CulturalAnchor {id: "sapin"})
  -[:HAS_WORDPLAY {weight: 0.82}]->
(:A11SemanticFacet {id: "sapin.ca-sent-le-sapin"})
```

Relations recommandees:

- `EVOKES`
- `CARRIES_TONE`
- `HAS_WORDPLAY`
- `PAIRS_WITH`
- `AMPLIFIES`
- `CONTRASTS_WITH`
- `BELONGS_TO_LAYER`
- `USED_BY_AGENT`

## Premier objectif

Installer une base petite mais solide:

- `semantic-resonance-seeds.json` contient les premiers noeuds humains.
- `semantic-resonance.cjs` charge, cherche, score et explique les resonances.
- Les agents A11, K44, Vivy et Kiro lisent la spec avant d'enrichir une
  reponse creative, media ou narrative.
- Toute extension du corpus passe par une revue simple: sens, contexte, ton,
  risques de contresens, confiance.
