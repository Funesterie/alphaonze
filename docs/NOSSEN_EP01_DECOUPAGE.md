# NOSSEN — Épisode 1 : « Elle avait un réservoir blanc »

Découpage de production. ~22 plans, 4 à 8 secondes chacun → **2 min 30 environ**.

**Deux colonnes par plan.** `A` évite les visages en gros plan — c'est la version qui
tourne même avec un modèle moyen. `B` les assume. Tu tournes le test de constance
d'abord, puis tu bascules **plan par plan**, pas en bloc : certains plans passent en
B même si le modèle est moyen, parce que le visage y est de trois quarts ou dans
l'ombre.

Tout le dialogue est en **voix off**. Aucun modèle ne fait du synchro labial français
correct, et de toute façon la VO sert le sujet : c'est un épisode où l'on écoute
quelqu'un raconter.

---

## Le visage de Rei — évolution voulue, dérive interdite

*(Djeff, 2026-08-04)* « Rei évolue au fil du manga donc sa tête changera forcément,
légèrement mais un peu. »

**Ça ne relâche pas la contrainte, ça la déplace.** Il faut distinguer deux choses que
la production confond toujours :

```
évolution   entre les eras       voulue, écrite, contrôlée      → un visage de référence PAR era
dérive      dans une même scène  le modèle qui oublie           → interdite, elle casse le plan
```

Un visage qui change entre l'épisode 1 et l'épisode 5, c'est le personnage qui
grandit. Un visage qui change entre le plan 4 et le plan 9 de la même soirée, c'est
un défaut — le spectateur ne lit pas « il a mûri », il lit « ce n'est pas le même
gosse ».

**Donc : une fiche visage par era, pas une pour la série.** Et l'épisode 1 (12 ans) et
l'épisode 2 (14 ans) sont déjà deux eras — deux ans à cet âge-là, c'est un autre
visage. Ça tombe bien : ça veut dire deux jeux de références, pas un seul à tenir sur
des années.

*(lecture, à valider)* Le pouvoir de Rei est de **surévoluer**. Si son visage change
visiblement d'un arc à l'autre, ce n'est pas un artefact à cacher : c'est la trace
visible de son pouvoir. Ce que toute autre production devrait dissimuler, celle-ci
peut le montrer. À manier avec parcimonie — l'idée est bonne tant qu'elle reste
implicite.

---

## MiniMax H3 — ce que ça change

D'après l'annonce Comfy du 03/08 : open source, texte+image → vidéo, **jusqu'à 15 s
par clip**, 2K, son stéréo natif, **choix de la première ET de la dernière image**,
référence vidéo, retouche de plan directe, et ça tourne sur une RTX 3060 via ComfyUI.

**La fonction qui compte est le couple première/dernière image.** Elle déplace le
problème de constance du modèle vidéo vers le modèle d'image — là où tu contrôles
l'identité par références. Le plan de production devient :

```
1.  fiche visage de l'era          (images fixes, identité verrouillée)
2.  keyframes début + fin par plan (image, identité déjà tenue)
3.  H3 interpole entre les deux    (le mouvement, pas l'identité)
```

Conséquence directe : **la colonne B devient beaucoup plus atteignable**, parce que
le visage n'est plus « inventé » par le modèle vidéo — il est donné aux deux bouts.

Et 15 s par clip veut dire que les plans de 4-8 s de ce découpage passent
confortablement, avec de la marge pour des plans plus longs si tu veux respirer.

*Le son stéréo natif est à ignorer ici : les voix off et le 2-temps viennent de la
chaîne existante, qui est meilleure et que tu contrôles.*

## Le test décisif — à faire avant de produire un seul plan

Révisé pour H3 :

```
1.  fiche visage « Rei 12 ans » : 3 images fixes, 3 angles, même garçon
2.  un plan H3 avec première et dernière image imposées — le visage tient-il
    entre les deux bouts, ou dérive-t-il au milieu ?
3.  une Cagiva WMX 125 blanche/bleue/rouge reconnaissable de profil
```

Test 1 échoue → colonne A, et on ne discute plus.
Test 2 échoue → plans courts (4 s), le milieu n'a pas le temps de dériver.
Test 2 passe → colonne B ouverte, et le découpage peut respirer.
Test 3 → décide si la moto est montrée entière ou par morceaux (réservoir, roue,
guidon), ce qui est de toute façon plus beau.

Le module `a11-director-motorcycle-domain.cjs` connaît maintenant les deux motos :
lui passer « Cagiva WMX 125 1985 » ou « Gilera GSM 2001 » injecte les bonnes
contraintes et les bons interdits.

---

## Note de casting — la voix du père

**Le père devrait avoir la voix de Djeff.**

Ce n'est pas qu'un choix pratique parce que la voix existe déjà dans le catalogue :
si Ghost88 est le père, alors le père *est* Rei adulte. Lui donner la voix de
l'auteur-personnage met le spoiler dans l'oreille du spectateur dès l'épisode 1, sans
qu'il puisse le savoir. À la relecture, l'épisode entier change de sens.

C'est gratuit, c'est réversible, et c'est le genre de chose qui ne peut plus être
ajoutée après.

---

## Découpage

### Séquence 1 — Avant l'image

**PLAN 1** · noir · 6 s
Écran noir. Un 2-temps démarre au kick. Il cale. Deuxième kick. Il prend.
*Aucune image. Le son seul.*

> Ce plan ne coûte rien à produire et il installe tout. Le son du démarrage
> Spitro peut servir directement.

**PLAN 2** · 5 s

| A — sans visage | B — visages |
|---|---|
| Fondu sur une photo cornée posée sur une table. Deux personnes sur une enduro blanche. On ne distingue pas les traits. | Même photo, mais la caméra s'approche jusqu'aux deux visages : un jeune homme, une jeune femme derrière lui. |

*Son : le 2-temps continue, puis s'éteint net.*

---

### Séquence 2 — Le récit (le cœur de l'épisode)

**INT. SALON — SOIR.** Le père raconte. La mère est dans la pièce, elle fait autre
chose. Rei, 12 ans, écoute.

**PLAN 3** · 6 s

| A | B |
|---|---|
| Les mains du père sur la table, la photo entre les doigts. | Le père de trois quarts, penché sur la photo, souriant. |

> VOIX OFF (père) — « Elle avait un réservoir blanc. Blanc, bleu, un peu de rouge
> sur le côté. Une 125. »

**PLAN 4** · 5 s

| A | B |
|---|---|
| Les pieds de Rei sous la table, qui ne bougent plus. | Rei, immobile, les yeux sur la photo. Il ne cligne pas. |

**PLAN 5** · 7 s — *plan de récit, en flash*

Extérieur, jour, années 80. La Cagiva de profil sur une route de campagne. Grain
photo, couleurs délavées.

> VOIX OFF (père) — « Je la poussais dans les chemins. Elle montait partout. »

*Prompt : `Cagiva WMX 125 1985 enduro side view, roue avant 21 pouces, livrée
blanc/bleu/rouge` — le module injecte les interdits.*

**PLAN 6** · 5 s

| A | B |
|---|---|
| Les mains de la mère, qui s'arrêtent au-dessus de l'évier. | La mère, de dos, qui cesse de bouger. |

**PLAN 7** · 6 s — **le pivot de l'épisode**

| A | B |
|---|---|
| Toujours ses mains. Elle repose l'assiette, doucement. | Elle se retourne à peine. On voit sa joue, pas ses yeux. |

> VOIX OFF (mère) — « Il y avait pas de rouge. C'était orange. »

> C'est le plan qui fait l'épisode. Elle corrige un détail que **seule quelqu'un qui
> était là** peut corriger. Elle ne dit rien d'autre. Elle vient de se trahir.

**PLAN 8** · 4 s

| A | B |
|---|---|
| Les mains du père s'immobilisent sur la photo. | Le père lève les yeux vers elle. Il ne dit rien. |

**PLAN 9** · 5 s

| A | B |
|---|---|
| Rei, cadré au buste, hors focus. Il tourne la tête vers sa mère. | Gros plan Rei. Il vient de comprendre quelque chose. |

**PLAN 10** · 6 s

| A | B |
|---|---|
| La photo, à l'envers sur la table. Une main la retourne. | La mère qui repose la photo face contre la table. |

> VOIX OFF (mère) — « Il aura pas de moto. »

*Silence total. Pas de musique.*

---

### Séquence 3 — Ce qu'il ne dit pas

**PLAN 11** · 5 s

| A | B |
|---|---|
| Un couloir. Une porte de chambre se referme sans claquer. | Rei qui referme sa porte, dos à la caméra, visage invisible. |

**PLAN 12** · 7 s

| A | B |
|---|---|
| Rei assis par terre, dos au lit, cadré du menton aux genoux. Il respire vite, une fois. Puis plus rien. | Même plan, visage inclus. Les yeux brillent. Aucune larme ne tombe. |

> **Ne jamais le faire pleurer.** Djeff a dit « en larmes intérieur ». La retenue est
> le personnage : c'est un gosse qui apprend à ne rien montrer, et c'est exactement
> ce qui deviendra sa force et son problème.

**PLAN 13** · 5 s
Sous la porte, la lumière du salon. Deux voix étouffées, inintelligibles. Elles
s'arrêtent.

---

### Séquence 4 — Le travail

**PLAN 14** · 5 s

| A | B |
|---|---|
| Un cahier d'école. Une main qui écrit, application excessive. | Rei penché sur son cahier, tard. |

**PLAN 15** · 6 s
Détail : dans la marge, une moto dessinée au stylo. Petite, précise, refaite dix fois.

**PLAN 16** · 5 s
Un carnet de notes. Des chiffres qui montent, mois après mois. Fondus enchaînés.

> VOIX OFF (père) — « Il a jamais redemandé. »

> La phrase est du père, pas du narrateur. Elle dit qu'il a remarqué — et qu'il a
> compté.

---

### Séquence 5 — Le rêve en 50cc

**PLAN 17-20** · 4 s chacun — *bloc onirique, pas de visage dans les deux colonnes*

Quatre plans très courts, montés serré, sur le son d'un 2-temps qui monte dans les
tours :

```
17.  une roue avant qui se lève, contre-jour, silhouette pure
18.  un compteur analogique, aiguille qui grimpe
19.  un phare qui pulse — plus fort quand le moteur monte
20.  du bitume qui défile, très près du sol
```

> Le plan 19 n'est pas décoratif : sur ces motos l'éclairage est alimenté par
> l'alternateur, donc **le phare bat avec le régime**. C'est vrai mécaniquement et
> c'est le domaine d'A-11. Autant l'installer dès l'épisode 1.

**PLAN 21** · 5 s
Le son coupe net. Silence.

| A | B |
|---|---|
| Rei dans son lit, cadré sur l'épaule et l'oreiller. Les yeux, hors champ, sont ouverts. | Rei dans son lit, yeux ouverts dans le noir. |

---

### Séquence 6 — La fin ouverte

**PLAN 22** · 8 s
Extérieur nuit, la rue vue de la fenêtre. Un 50cc passe au loin, en travers du cadre.
Le son s'éloigne. La fenêtre reste vide.

*Carton : **« NOSSEN — Épisode 1 »***

> Fin. Aucune promesse, aucun teaser. L'épisode 2 s'ouvrira sur « viens m'aider à
> chercher du matos ».

---

## Ce qu'il faut produire, dans l'ordre

1. **La fiche visage « Rei 12 ans »** — 3 images fixes, 3 angles. C'est l'actif le
   plus important de tout l'épisode : tout le reste en dépend, et elle se réutilise
   sur chaque plan.
2. **Le test H3 première/dernière image** — décide A ou B, et la durée des plans.
3. **Les voix off** — 6 répliques, dont 4 pour le père. Catalogue de voix et chaîne
   Suno déjà en place.
4. **Le son du 2-temps** — `Démarrage Spitro SLK.mp4` fournit le plan 1 tel quel, et
   `wheeliiing betaaaaaa.mp4` a 79 s de moteur en charge pour les plans 17-20, dont
   un régime stable à ~145 Hz.
5. **Les keyframes début+fin par plan** — avec le module moto pour les plans 5 et 22.
6. **H3 plan par plan**, puis montage ffmpeg — la chaîne existe déjà.

**Le seul verrou restant est le branchement.** Rien dans le dépôt ne parle à H3 : ni
provider vidéo, ni client ComfyUI. Deux voies possibles — l'API cloud Comfy, ou un
ComfyUI local piloté par son API HTTP. La seconde ne coûte rien par plan et garde
tout sur la machine, ce qui compte quand on itère plan par plan.
