# Inventaire technique en vue d'un dépôt — état au 2026-08-02

> **Ce document n'est pas un avis juridique et n'évalue pas la brevetabilité.**
> Je ne suis pas conseil en propriété industrielle. Ce qui suit est un inventaire
> **factuel** de ce qui existe dans le code, daté et sourcé, plus un repérage d'antériorités
> évidentes. La qualification — nouveauté, activité inventive, caractère technique — relève
> d'un professionnel, et la recherche d'antériorités formelle reste entière.

---

## 1. Ce qui est trivialement antérieur — à ne pas revendiquer seul

Autant l'écrire en premier, ça évitera une mauvaise surprise en examen.

| élément | antériorité |
|---|---|
| élargissement stéréo par gain du canal côté (mid/side) | technique standard depuis les années 1960 ; `stereotools=slev` est un filtre **de série** de ffmpeg |
| doublage harmonique par transposition | omniprésent en production musicale |
| retard inversé sur une bande grave | technique de renforcement de basses connue |
| transformée de Hilbert pour décorréler L/R | pseudo-stéréo classique |
| limiteur en fin de chaîne | pratique universelle de mastering |

**Conséquence directe :** la V11 pan prise isolément — `stereotools=slev=1.5` avant le
limiteur — n'a aucune chance d'être considérée comme nouvelle. C'est un réglage d'un outil
existant. Ce qui peut avoir une valeur, c'est l'**enchaînement complet et la manière dont les
paramètres sont dérivés**, pas l'opérateur.

---

## 2. Ce qui est spécifique au système — inventaire factuel

### 2.1 Dérivation des paramètres audio depuis une palette symbolique

- **Fichier :** `src/knowledge/modules/encoding.pulsar.palette.module.json`,
  `src/persona/{prompt-adn,pulsar-crypto,freeland-bros-pulsar}.cjs`
- **Objet :** dix couleurs, chacune portant teinte, fonction, complément et un poids `gamma`
  (canal Aγ), associées à des personas, servant à dériver des paramètres de génération.
- **État :** la palette et le mapping persona existent ; la dérivation `Aγ → paramètre audio`
  est **décrite mais pas implémentée** (`docs/research/prime_spiral/PAN_DECAGRAMME_RGBA_GAMMA_2026-08-02.md` §5).
- **Réserve :** la structure en décagramme est **incomplète dans les données** — quatre
  branches sur dix pointent vers des couleurs absentes de la palette. À corriger avant de
  décrire la structure dans un dépôt.

### 2.2 Signature sonore par morceau dérivée d'une courbe

- **Fichier :** `src/music/vivy-prime-color.cjs`
- **Objet :** une empreinte du sujet de la chanson (FNV-1a borné sur une période de 4000)
  indexe une courbe, dont le rang normalisé sélectionne une couleur et une direction sonore.
  Deux morceaux différents reçoivent des signatures différentes ; le même morceau redonne
  toujours la sienne.
- **État :** implémenté, testé (`test/vivy-prime-color.node.test.cjs`), déployé.

### 2.3 Arc dynamique avec plafond d'énergie par genre

- **Fichier :** `src/music/vivy-dynamic-arc.cjs`
- **Objet :** courbe d'intensité par section, culminant au centre, bornée par un plafond
  déduit de la direction musicale (berceuse 0.55, ballade 0.70, rap 0.92, techno 1).
- **État :** implémenté, testé, déployé.

### 2.4 Chaîne V10 Boom

- **Fichier :** `src/audio/v10-boom.cjs`
- **Objet :** `y(t) = x(t) − a·x(t−τ)` sur une bande grave isolée, remixée sous le signal
  complet à un taux borné, avec `τ` dérivé d'une constante de grille (12 ms ≈ demi-période
  de 40.0005 Hz).
- **État :** en production.

### 2.5 V11 pan et sa propriété de commutation

- **Fichiers :** `src/audio/double-harmonic-d40.cjs`, `src/audio/v10-boom.cjs`
- **Objet :** ouverture mid/side insérée en fin de chaîne, avant le limiteur, sur deux chaînes
  partageant une constante unique ; neutre exact à 1.
- **Élément mesuré et vérifiable :** l'opérateur **commute** avec la chaîne amont (filtre
  linéaire identique sur les deux canaux). Vérifié par différence échantillon par échantillon
  entre les deux ordres de rendu : **−91 dB, silence numérique**.
- **Réserve :** la commutation d'un filtre LTI par canal avec une matrice M/S constante est
  une propriété **mathématique élémentaire**, pas une invention. Elle a valeur de garantie
  d'implémentation, pas de revendication.

### 2.6 Filtre de tour porteur (« épreuve des dalles »)

- **Fichier :** `src/chat/load-bearing-turn.cjs`
- **Objet :** prédicat unique empêchant des instructions internes de fuiter dans un contenu
  généré destiné à un tiers (ici : les paroles envoyées au fournisseur de génération musicale).
- **État :** implémenté, testé, déployé.

---

## 3. Mesures reproductibles (utiles pour appuyer une description)

Sur un rendu réel de 40 s, écart milieu−côté en dB, plus petit = plus large :

```
brut du générateur      10.30      cordes -30.1
après V10 Boom          11.00      cordes -30.1     ← resserre, n'apporte rien aux cordes
après V11 pan 1.5        7.40      cordes -29.0     ← équilibre G/D conservé exactement
```

Méthode complète et commandes : `docs/research/audio/V11_PAN_2026-08-02.md` §7.

Sept constructions alternatives ont été mesurées et écartées, avec le motif de rejet de
chacune (même document, §4). Un dossier qui documente les voies **essayées et abandonnées**
vaut souvent mieux qu'un dossier qui ne montre que la solution retenue.

---

## 4. Ce qui reste à faire avant de parler à un conseil

1. **Corriger la palette** — quatre compléments pointent hors du jeu de dix (§2.1).
2. **Décider si la dérivation `Aγ → paramètre` est implémentée ou non.** Une caractéristique
   décrite mais absente du code affaiblit une description ; aujourd'hui l'ouverture du pan est
   une constante globale, identique pour tous les personas.
3. **Recherche d'antériorités formelle** — non faite. Les antériorités du §1 sont celles qui
   sautent aux yeux, ce n'est pas une recherche.
4. **Décider du périmètre** : le système complet (persona → couleur → paramètres → rendu) ou
   des briques isolées. Les briques isolées relèvent largement du §1.

---

## 5. Honnêteté sur la valeur

Le travail du 02/08 a produit un résultat mesurable et une documentation solide, et il a
surtout établi **une cause chiffrée** à un défaut réel (« on n'entend pas les violons »).
C'est de la bonne ingénierie.

Ce n'est pas, en soi, une invention brevetable : l'opérateur retenu est un filtre standard
utilisé à un réglage choisi à l'oreille. Ce qui peut porter un dépôt, c'est l'architecture
qui relie identité symbolique et paramètres de rendu — et cette partie-là est aujourd'hui
**décrite plus qu'implémentée**.
