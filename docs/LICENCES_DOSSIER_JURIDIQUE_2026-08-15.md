# Dossier factuel — licences ZEN et modules NOSSEN

Établi le 15 août 2026. **Document de fait, pas d'avis juridique.**
Destiné à une consultation professionnelle et, le cas échéant, à un dépôt e-Soleau INPI.

Toutes les dates de publication viennent du registre npm (`registry.npmjs.org`),
toutes les dates de création viennent de l'historique git du dépôt
`Funesterie/alphaonze` (premier commit ajoutant le fichier).

---

## 1. Ce qui est publié publiquement, et sous quelle licence

| Paquet npm | Version | Licence déclarée | 1re publication | Dernière | Versions |
|---|---|---|---|---|---|
| `@nossen/zen` | 0.1.3 | **UNLICENSED** | 2026-06-07 | 2026-08-03 | 4 |
| `@nossen/logic-reduce` | 2.0.3 | **UNLICENSED** | 2026-05-23 | 2026-08-03 | 4 |
| `@nossen/knowledge-modules` | 0.2.3 | **UNLICENSED** | 2026-07-28 | 2026-08-09 | 5 |
| `@nossen/zen-gate` | 0.1.0 | **MIT** | 2026-08-10 | 2026-08-10 | 1 |
| `@nossen/mcp-bridge-tunnel` | 1.1.0 | **MIT** | 2026-08-14 | 2026-08-14 | 1 |
| `@nossen/all-in-one` | 0.1.14 | **MIT** | 2026-05-25 | 2026-08-10 | 15 |
| `@nossen/cf` | 0.1.0 | **MIT** | 2026-08-10 | 2026-08-10 | 1 |
| `@nossen/hetzner` | 0.1.0 | **MIT** | 2026-08-10 | 2026-08-10 | 1 |

Le scope `@funeste/*` répond `402 Payment Required` : il est privé, non consultable
publiquement. `@funeste/zen@0.1.3` et `@funeste/all-in-one-nossen@0.1.8` y sont
déclarés `UNLICENSED` dans le dépôt.

### Point d'attention principal

`@nossen/zen-gate@0.1.0` est publié sous **MIT**, et la version présente dans le
dépôt porte **le même numéro 0.1.0** : le code publié est donc le code courant, pas
une ébauche antérieure. Son `package.json` ne restreint pas le champ `files`, donc
l'intégralité du répertoire a été publiée.

Une concession de licence MIT déjà effectuée n'est pas révocable pour la version
concernée. Un changement de licence n'a d'effet que sur les versions publiées
ultérieurement.

### Incohérence à trancher

Le même contenu est publié sous deux licences différentes selon le scope :

- `@nossen/all-in-one` → MIT
- `@funeste/all-in-one-nossen` → UNLICENSED

Deux licences concurrentes sur un même code affaiblissent toute revendication :
un tiers retiendra naturellement la plus permissive.

---

## 2. Séparation canon / transport

La distinction demandée par le conseil : ce qui relève du **canon ZEN** (format,
conteneur, cryptographie) et ce qui relève du **transport** (acheminement,
déduplication).

### Canon ZEN — non publié sous licence permissive

| Fichier | 1re apparition (git) | Lignes | Contenu |
|---|---|---|---|
| `packages/nossen/zen/src/canon.cjs` | 2026-06-07 | 49 | Définition canonique, garde-fous, carte imaginaire, pipeline |
| `packages/nossen/zen/src/index.cjs` | 2026-06-07 | 425 | Encodage/décodage, en-tête public, AES-256-GCM authentifié |

Publié sous `UNLICENSED` depuis le 7 juin 2026 sur `@nossen/zen`.

### Sécurité / rotation — non publié sur npm

| Fichier | 1re apparition (git) | Lignes | Contenu |
|---|---|---|---|
| `src/dump/rubix-cube.cjs` | 2026-08-04 | 286 | Cube RGBA, rotation, fragmentation, checksum canal A |
| `src/dump/quinte-key.cjs` | 2026-08-04 | 243 | Dérivation de clé depuis résultat public + sel privé |
| `src/dump/epoch-sync.cjs` | 2026-08-04 | 239 | Seed de circuit par époque + événement public + sel |

Ces trois fichiers vivent dans le backend, **pas dans un paquet npm publié**.
C'est le mécanisme « clé mouvante + labyrinthe mouvant » : la clé dérive d'un
résultat public (Quinté, Loto) combiné à un sel privé, et l'époque horaire
recalcule la rotation du cube.

### Transport — publié sous MIT

| Fichier | 1re apparition (git) | Lignes |
|---|---|---|
| `packages/nossen/zen-gate/src/chunker.cjs` | 2026-08-11 | 11 |
| `packages/nossen/zen-gate/src/reconstruct.cjs` | 2026-08-11 | 25 |
| (ensemble `src/`) | 2026-08-11 | 278 |

Fait notable : le paquet a été **publié le 10 août**, un jour avant la première
apparition de ces fichiers dans l'historique git du dépôt principal (11 août).
L'écart mérite d'être expliqué au conseil — publication depuis un autre poste,
ou fichiers versionnés après coup.

### Couche jukebox — non publiée

| Fichier | 1re apparition (git) | Lignes |
|---|---|---|
| `src/clips/jukebox-zen.cjs` | 2026-08-15 | 232 |
| `src/clips/jukebox-key.cjs` | 2026-08-15 | 145 |

Écrits le 15 août. Une clé par jukebox, dérivée en combinant secret maître,
identifiant et rotation du cube. Non publié, aucune licence concédée.

---

## 3. Vérifications techniques établies le 15 août 2026

Ces points ont été mesurés, non supposés :

- `@nossen/zen` chiffre en **AES-256-GCM** avec `getAuthTag`/`setAuthTag`
  (chiffrement authentifié). Une mauvaise clé est rejetée, elle ne rend pas de
  données altérées.
- `src/dump/quinte-key.cjs` chiffre en **AES-256-CBC**, sans authentification.
  Couche distincte, non utilisée par le jukebox.
- `resolveSalt` retombait sur la valeur littérale `funesterie-default-salt-change-me`
  en l'absence de `STEGO_SALT`. Les numéros du Quinté étant publics, la clé
  devenait calculable par lecture du dépôt. **Corrigé le 15 août** : refus de
  dériver sans sel (commit `1772c7438`).

---

## 4. Questions à porter au conseil

1. **Titularité.** Qui détient les droits patrimoniaux sur ZEN ? La réponse
   conditionne la mention de copyright et la capacité même à concéder une licence.
2. **Portée résiduelle du MIT.** Que reste-t-il opposable sur `zen-gate` et
   `mcp-bridge-tunnel` compte tenu des versions déjà diffusées ?
3. **Doublons de scope.** Comment traiter un même code publié sous deux licences ?
4. **Nommage.** Une licence interdisant l'usage commercial ne peut pas être
   qualifiée d'« open source » au sens OSI ; « source-available » ou
   « propriétaire » est le terme exact.
5. **e-Soleau.** Périmètre à déposer : canon, formats, schémas, ou également le
   mécanisme de rotation ?
6. **Brevet éventuel.** Le mécanisme clé-mouvante / cube-rotatif produit-il un
   effet technique suffisant ? À examiner **avant** toute publication
   supplémentaire de détails.

---

## 5. Actions techniques recommandées, indépendantes du volet juridique

1. Publier `zen-gate` en **0.2.0** sous la nouvelle licence : le passé reste MIT,
   la suite non.
2. `npm deprecate @nossen/zen-gate@0.1.0` avec renvoi vers la nouvelle licence —
   avertissement, sans effet juridique rétroactif.
3. Aligner `@nossen/all-in-one` et `@funeste/all-in-one-nossen` sur une licence unique.
4. Traiter les paquets locaux non publiés et non référencés — `clip-generator`,
   `discord-bot`, `jukebox-drive`, `song-title-generator`, tous déclarés MIT —
   avant qu'ils partent sur npm sous cette licence.
5. Restreindre le champ `files` des paquets sensibles pour ne publier que le
   nécessaire.
