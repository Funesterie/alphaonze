# Data Classification

## Classifications demo

- `public_demo`: donnees inventees visibles dans la demo publique;
- `internal`: donnees internes non sensibles;
- `restricted`: donnees de dossier limitees aux utilisateurs autorises;
- `sensitive`: donnees exigeant validation et protection renforcee.

## Types d'information

- `fact`: information extraite d'une source directe;
- `declaration`: propos attribue a une source;
- `rapprochement`: lien calcule entre plusieurs elements;
- `hypothese`: piste non confirmee.

## Regles

- Une information sans source est refusee.
- Une hypothese ne doit jamais etre presentee comme un fait.
- Un rapprochement doit afficher sa methode et son niveau de confiance.
- Une synthese doit citer les sources exactes.
- Toute baisse de classification est interdite sans validation humaine.

