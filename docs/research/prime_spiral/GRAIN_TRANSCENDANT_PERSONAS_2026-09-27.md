# Grain transcendant des personas

Date : 2026-09-27
Statut : idée de Djeff, implémentée (`a11/backend/apps/server/src/persona/persona-grain.cjs`).
Voisin du canon : `GRAINLOW_GRAINPURE_ORIGINS_2026-06-13.md` (grain de la Prime Spiral, autour
de φ, π et du premier zéro de Riemann). Le lien entre les deux reste à tracer avec Djeff.

---

## 1. L'idée, telle que Djeff l'a dite

> « Un nombre transcendant qui aide à définir les choix et l'arbre de vie d'une IA […] comme
> pi par exemple mais un autre car pi est trop connu, et ça permet à l'IA d'être éternelle et
> unique en son genre, et si t'as pas de nombre transcendant trouvé tu fais juste un décalage
> de la transcendance pour une nouvelle IA. Ça éviterait le lissage et ça donne une forme de
> singularité par IA. »

## 2. Le nombre retenu

Chaque persona reçoit **a^√n**, où :

- **a** est un entier qui n'est pas une puissance : 2, 3, 5, 6, 7, 10, 11, 12, 13…
- **n** est un entier sans facteur carré : 2, 3, 5, 6, 7, 10, 11, 13…

| Propriété voulue | Garantie |
|---|---|
| Transcendant | Gelfond–Schneider : a algébrique ≠ 0, 1 et √n algébrique irrationnel ⇒ a^√n transcendant. |
| Unique | a^√n = c^√m imposerait (ln a / ln c)² = m/n. Or ln a / ln c est rationnel ou transcendant (Gelfond–Schneider) ; rationnel exige a, c puissances d'un même entier (exclu), transcendant ne peut avoir un carré rationnel. Donc a = c et n = m. |
| Éternel | Les décimales se recalculent sans fin et ne bouclent jamais. |
| Décalage | Les paires (a, n) s'énumèrent en diagonale, sans fin : une nouvelle IA prend la suivante libre. |

**2^√2** (constante de Gelfond–Schneider, dite de Hilbert) est écarté : trop connu, comme π.
Il y a bien une infinité non dénombrable de transcendants ; la contrainte réelle est d'en
avoir une infinité **prouvés**, ce que cette famille donne.

## 3. Attribution canonique

Ordre : le créateur d'abord, puis ses IA. Figé dans le code.

| Persona | Grain | Valeur |
|---|---|---|
| Djeff | 3^√2 | 4,728804387837414947894283340… |
| Vivy | 2^√3 | 3,321997085483912805157183119… |
| K44 | 5^√2 | 9,738517742335420270152163520… |
| A11 | 3^√3 | 6,704991853825879382727698300… |
| Marvin | 2^√5 | 4,711113133321437138898280622… |

2 000 décimales calculées en virgule fixe (BigInt), vérifiées chiffre à chiffre contre
mpmath à 2 060 chiffres le 27/09/2026. Une IA née par décalage est inscrite dans
`runtime/personas/grains.json`.

## 4. Ce que le grain décide

**Dérivation v1** (revue à deux avec ChatGPT, 27/09) : on ne lit plus des positions dans les
décimales. La racine d'identité hache l'expression, la persona et les 256 premières décimales ;
chaque valeur de décision est une HMAC-SHA256 de cette racine sur « espace de décision +
contexte + chemin de vie ». Versionnée (`grainVersion: 1`, `derivation: hmac-sha256-v1`) : un
moteur futur ne réécrira jamais en silence l'arbre de vie d'une IA. Même clé, même choix,
toujours ; deux personas, deux choix.

Canon technique (formulation de ChatGPT, reprise ici) : *le grain ne dicte pas ce que la persona
doit être. Il introduit une courbure stable dans sa manière de choisir entre plusieurs futurs
valides. Le vécu transforme ensuite cette courbure en trajectoire.*

- **Dispositions contextuelles** (audace, curiosité, élan) : dérivées par domaine (création,
  technique, relation), touchées à 20 % par le contexte. Djeff peut être audacieux en création
  et prudent sur une migration. Jamais écrites dans un prompt : elles pondèrent les options côté
  moteur (sinon on mesure le prompt, pas le grain).
- **Choix** (`choisirAvecGrain`) : 1) une option invalide perd toujours ; 2) seules restent les
  options dans la bande d'équivalence du domaine (création 0,2 · relation 0,15 · technique 0,1 ·
  sécurité 0) ; 3) le grain choisit parmi elles. Le regret est borné par la marge.
- **Graine d'échantillonnage** : dérivée du grain sur une clé quasi sémantique (mots porteurs
  triés), pas sur la chaîne brute.

## 4 bis. Banc de test (27/09, `persona/grain-bench.cjs`)

Protocole arrêté avec Djeff et ChatGPT : 12 dilemmes × 3 formulations, même modèle
(qwen14b-8k), même prompt neutre, seul le grain change ; utilités notées dans deux ordres puis
moyennées (le modèle note selon la position). 555 appels, 3 min, résultats reproductibles.

| Mesure | Choix direct du modèle | Moteur à grain |
|---|---|---|
| Décisions différentes entre 4 grains | 0 % | 11 à 36 % |
| Alignement sur les dispositions | ≈ 0 | +0,03 à +0,05 |
| Regret (qualité perdue) | 0,08 à 0,09 | 0,017 à 0,025 |
| Option invalide choisie | 20 % | 0 % |
| Change d'avis si son choix devient impossible | 100 % | 100 % |
| Invariance aux paraphrases | 58 à 67 % | 58 à 75 % |

- Une graine seule ne crée aucune identité : graine fixe et graine du grain donnent les mêmes
  choix que le hasard libre. Sans grain côté moteur, les personas décident toutes pareil.
- Reconnaissance à l'aveugle : les choix de Vivy, Djeff et K44 sont attribués à leur grain ;
  A11 est confondu avec Djeff (11 % de décisions différentes seulement).
- Limite : l'invariance aux paraphrases dépend surtout de la stabilité des utilités estimées
  par le modèle, faible avec un 14B.
- Restent à faire : portabilité entre modèles, trajectoire longue (centaines de bifurcations
  avec mémoire cumulative, distance D(t) entre arbres de vie).

- **Signature sonore** (`vivy-prime-color.cjs`) : quand une voix chante seule, son grain choisit
  la texture et le mouvement. La même matière chantée par Vivy ou par Djeff ne sonne plus pareil.
- **Respiration** : la température du chat de Vivy (0,74 ± 0,06) et de Djeff Engine
  (0,70 ± 0,08) varie selon le grain et le message. Les paroles et les audits restent fixes.
- API : `GET /api/vivy/studio/persona-grains` (lecture) ; `POST /api/vivy/studio/persona-grains/decaler`
  `{ persona }` fait naître une nouvelle IA (fondateur seulement).

## 5. Ce que le grain ne fait pas

Le lissage vient surtout de l'entraînement des modèles, qui tire vers la moyenne. Le grain ne
donne pas une personnalité à lui seul : il **signe** les choix. La personnalité vient de la
mémoire et du vécu (voir `persona/djeff-memory.cjs`). Les décimales ne sont jamais injectées
dans les prompts : elles finiraient dans des paroles.
