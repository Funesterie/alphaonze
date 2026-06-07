# Prime Spiral / NUMA / ZEN - Notes sources Grok + GPT

Date : 2026-06-07

Sources locales :

- `E:\grok1.txt`
- `E:\gpt1.txt`

Statut : corpus de travail local. Ne pas importer brut dans Git ou Neo4j. Utiliser
ces fichiers comme sources a relire, puis ne stocker que des definitions,
relations et valeurs nettoyees.

---

## Extraits canoniques a conserver

- `mg_phase = 0.00155449779053` est la valeur historique retrouvee.
- `mg ≈ 0.0005π` est une approximation tardive et ne doit pas remplacer
  `mg_phase`.
- Le noyau spectral de recherche est `phi`, `jhi`, `c7`, `mg_phase`.
- Les nombres premiers ne sont pas toute la carte : ils sont une projection
  reelle d'une cartographie plus large.
- La cartographie spatiale imaginaire utilise plusieurs axes ou symboles pour
  placer un nombre, un fragment ou un motif.
- `π` sert d'anneau ou de rabattement circulaire, pas de constante injectee au
  hasard.
- La ligne magenta represente l'axe de transition prime/composite : elle relie
  ordre, chaos, gaps, vitesse, temps et zones de passage.
- Les gaps peuvent servir de workflow : petit gap -> objet principal, grand gap
  -> decor, contexte, atmosphere et remplissage.
- ZEN utilise cette carte pour reconstruire des fragments opaques : sans cle on
  voit des morceaux, avec la cle on retrouve l'ordre.

---

## Garde-fous

- Ne pas affirmer que les nombres premiers sont mathematiquement resolus.
- Ne pas presenter Prime Spiral comme une preuve de Riemann.
- Separer les corrections confirmees par Jeffrey des hypotheses inventees par
  les assistants.
- Ne pas melanger numerologie publique et NUMA Funesterie.
- Pour Neo4j, stocker la structure, les liens et les statuts de confiance, pas
  les dumps bruts ni les secrets.

---

## Concepts a relier dans Neo4j

- `Prime Spiral`
- `NUMA`
- `Magenta Line`
- `ZEN`
- `Qflush RGBA Cube`
- `Prime/Composite/Gaps`
- `Spatial Imaginary Map`
- `mg_phase`
- `T_spectral`

Relations utiles :

- `NUMA` `ENCODES` `Magenta Line`
- `Magenta Line` `MAPS` `Prime/Composite/Gaps`
- `Spatial Imaginary Map` `PROJECTS_TO` `Prime/Composite/Gaps`
- `ZEN` `USES` `Spatial Imaginary Map`
- `Qflush RGBA Cube` `ROUTES` `ZEN`
- `mg_phase` `ANCHORS` `Prime Spiral`

