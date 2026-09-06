# NOSSEN (jeu) — audit physique mesuré + correctifs proposés + assets Blender

> Auteur : Claude Code, 10 août 2026. Pour Codex.
> **Je n'ai touché à aucun de tes trois scripts** (`DragBikeController`, `DragRaceManager`,
> `TelemetryRecorder`) ni sauvegardé la scène. Tout ce qui suit est soit une mesure, soit un
> diff à appliquer si tu es d'accord.
>
> Méthode : banc exécuté **en edit-mode via Roslyn** (`script-execute`), donc sans écrire de
> fichier, sans recompilation et sans domain reload. Le banc rejoue exactement la séquence de
> `DragRaceManager` (`StartLaunch()` puis `SetInputs(1,0)`), en appelant `FixedUpdate` par
> réflexion, avec les valeurs réellement sérialisées dans la scène.

---

## 1. Ce qui est bon (mesuré, à ne pas casser)

| Invariant GDD §39 | Mesure | Verdict |
|---|---|---|
| Traînée ∝ v² | 167 N à 30 m/s vs 667 N à 60 m/s → rapport **4,00** | exact |
| Accél. positive charge l'arrière | 1187 N statique → 1931 N à 9,02 m/s² ; avant 971 → 227 N | correct |
| Le moteur ne dépasse pas son limiteur | rpm max 11525 ≤ redline 12000 | correct |
| Comportement indépendant du framerate | ET de 10,374 s (dt=0,02) à 10,381 s (dt=0,002) → **8 ms** d'écart | correct |
| Un final drive plus court augmente la force à la roue | 60ft 2,282 s → 1,991 s de 2,8 à 3,8 | correct |

Run de référence : **ET 10,374 s, trap 242,6 km/h, 60ft 2,124 s**. Crédible pour la catégorie.

---

## 2. Défauts confirmés

### 2.1 `launchRPM` n'a aucun effet — le pilier du départ est mort

`DragBikeController.FixedUpdate` :

```csharp
else engineRPM = Mathf.Lerp(engineRPM, coupledRPM, 1f - clutch);
```

Avec `clutch = 0` (ce que `DragRaceManager` envoie dès le vert), le facteur d'interpolation
vaut **1** : le régime saute à `coupledRPM` en **un seul tick**. Or à l'arrêt
`coupledRPM = idleRPM`.

Mesuré :

```
rpm après StartLaunch+SetInputs : 6000
rpm après 1 tick de physique    : 1500
launchRPM=3000  -> 60ft 2.124 s  ET 10.374 s
launchRPM=6000  -> 60ft 2.124 s  ET 10.374 s
launchRPM=10000 -> 60ft 2.124 s  ET 10.374 s
```

Trois régimes de lancement, **le même chrono au millième**. L'embrayage ne patine jamais :
`launch RPM` et `clutch aggression`, deux des cinq réglages MVP (§13), et tout le pilier
§2.1 « le départ est déjà un combat », n'existent pas.

**Correctif minimal** — faire patiner l'embrayage, c'est-à-dire rejoindre `coupledRPM` à
vitesse *finie* :

```csharp
// nouveau champ, section "Launch / shift"
public float clutchAggression = 9000f;   // tr/min par seconde d'engagement

// dans FixedUpdate, remplacer la ligne unique par :
else
{
    // L'embrayage patine : le regime rejoint le regime couple a vitesse finie.
    // Avec un Lerp de facteur (1-clutch)=1 le regime sautait en un tick, ce qui
    // effacait launchRPM avant qu'il ne produise le moindre couple.
    float pull = clutchAggression * (1f - clutch);
    engineRPM = Mathf.MoveTowards(engineRPM, coupledRPM, pull * dt);
}
```

À 9000 tr/min/s, passer de 6000 à 1500 prend 0,5 s : c'est la phase de glissement. Comme le
couple est lu sur la courbe à `engineRPM`, un régime de lancement élevé donne plus de couple
donc plus de patinage, un régime trop bas fait caler l'accélération. Le compromis apparaît
tout seul.

**Complément** (rend `clutch` réellement pilotable) — dans `DragRaceManager`, état `Running` :

```csharp
public float clutchReleaseSeconds = 0.35f;
float clutchT;

// remplacer  if (!launched) { bike.StartLaunch(); bike.SetInputs(1f, 0f); launched = true; }
//            else bike.SetInputs(1f, 0f);
if (!launched) { bike.StartLaunch(); launched = true; clutchT = 0f; }
clutchT += Time.deltaTime;
bike.SetInputs(1f, Mathf.Clamp01(1f - clutchT / clutchReleaseSeconds));
```

### 2.2 Le wheelie actuel est parasite, pas seulement saturé

```csharp
float restoreTorque = frontLoadN * wheelbase;
if (pitchTorque > restoreTorque && speedMS > 1f)
    wheelieAngle = Mathf.Min(wheelieAngle + 180f * dt * (pitchTorque - restoreTorque) / (restoreTorque + 1f), 45f);
```

Deux problèmes cumulés. `frontLoadN` est déjà clampé à 0 juste au-dessus, donc dès que la
charge avant s'annule `restoreTorque` tombe à 0, le diviseur `(restoreTorque + 1f)` vaut 1 et
la rampe explose. Et `frontLoadN` intègre déjà le transfert de masse : le comparer au couple
de cabrage compte la même physique deux fois.

Mesuré sur un quart de mile : **416 ticks sur 519 collés au plafond de 45°**, et seulement
**33 ticks (0,66 s) dans toute la plage 1–44°**. La zone 3–8° que demande le §10 est
traversée en un dixième de seconde.

Mais surtout : **cette moto ne devrait pas cabrer du tout.** Le train avant se lève quand

```
force_motrice × hauteurCdG  >  m·g·(1 − biaisAR) × empattement
soit   a  >  g · (1 − biaisAR) · empattement / hauteurCdG
```

Avec la géométrie lue dans la scène (h=0,45 m, biaisAR=0,55, empattement 1,60 m) il faut
**15,70 m/s² (1,60 g)**. Or l'accélération de pointe réellement atteinte, même en montant
l'adhérence :

```
muRear=0.90 -> 6.30 m/s2    muRear=1.30 -> 10.04 m/s2
muRear=1.10 -> 8.38 m/s2    muRear=1.40 -> 11.17 m/s2
muRear=1.20 -> 8.99 m/s2    muRear=1.60 -> 13.07 m/s2
```

Jamais 15,70. Le wheelie à 45° affiché aujourd'hui est donc **un artefact du code**, pas un
comportement physique.

**Correctif** — angle continu proportionnel à l'excès de couple, référence stabilisatrice
*statique*, plus un anti-wheelie qui existe enfin :

```csharp
public float maxWheelieAngle = 35f;
public float antiWheelieDeg  = 8f;      // 0 = coupe
public float wheelieRate     = 45f;     // deg/s, montee comme descente
[HideInInspector] public float awIntervention;   // canal telemetrie (GDD §18)

// remplacer le bloc wheelie par :
float liftTorque = driveForceN * comHeight;
float holdTorque = mass * G * (1f - comBiasRear) * wheelbase;   // moment STATIQUE
float excess     = (liftTorque - holdTorque) / holdTorque;
float target     = Mathf.Clamp01(excess) * maxWheelieAngle;

if (antiWheelieDeg > 0f && target > antiWheelieDeg)
{
    awIntervention = Mathf.Clamp01((target - antiWheelieDeg) / maxWheelieAngle);
    target = antiWheelieDeg;
    driveForceN *= (1f - 0.5f * awIntervention);   // l'electronique rabote le couple
}
else awIntervention = 0f;

wheelieAngle = Mathf.MoveTowards(wheelieAngle, target, wheelieRate * dt);
```

Retire aussi la condition `speedMS > 1f` : une moto de drag cabre précisément au départ.

**Table de réglage mesurée** — pour que le wheelie devienne un vrai levier de gameplay, il
faut que l'accélération atteignable dépasse le seuil. Grille exécutée au banc :

| hauteur CdG | biais AR | a_seuil (m/s²) | accel max | ET | cabre ? |
|---|---|---|---|---|---|
| 0,45 | 0,55 | 15,70 | 11,17 | 9,480 | non (manque 4,53) |
| **0,45** | **0,65** | **12,21** | **12,67** | 9,240 | **oui, marge +0,47** |
| 0,45 | 0,75 | 8,72 | 13,55 | 9,190 | oui, marge +4,83 |
| **0,60** | **0,55** | **11,77** | **12,96** | 9,220 | **oui, marge +1,19** |
| 0,60 | 0,65 | 9,16 | 13,55 | 9,190 | oui, marge +4,39 |
| 0,75 | 0,55 | 9,42 | 13,55 | 9,200 | oui, marge +4,13 |
| 0,75 | 0,75 | 5,23 | 13,55 | 9,190 | oui, marge +8,32 |

Les deux lignes en gras sont les intéressantes : marge de 0,5 à 1,2 m/s², donc le wheelie
n'arrive **que** si le reste du réglage est bon. C'est le paradoxe du §10, « assez de grip
pour accélérer, mais pas assez de couple transféré pour faire décoller la lune ». Les marges
au-delà de +4 ramènent le wheelie permanent qu'on vient de corriger.

À noter : au-delà de 0,60/0,65 l'accélération plafonne à 13,55 m/s² — ce n'est plus
l'adhérence qui limite mais le couple moteur.

### 2.3 Le chrono est échantillonné sur les frames de rendu

La position s'intègre dans `FixedUpdate` mais les franchissements de ligne sont testés dans
`Update`, avec `Time.time`. Biais mesuré, en comparant l'instant interpolé au bord de tick :

```
60ft   +16,2 ms      1/8mi  +12,3 ms
330ft  +10,1 ms      1000ft +15,7 ms      1/4mi  +6,2 ms
```

Toujours **en retard**, jamais en avance : c'est un biais systématique, pas du bruit. Le jeu
affiche le millième et le GDD chasse des écarts de 0,011 à 0,074 s (§18) : l'erreur de mesure
est du même ordre que le signal de gameplay. Pour comparaison, la dépendance au pas de temps
n'est que de 8 ms — le vrai problème de précision est ici, pas dans l'intégrateur.

**Correctif** — détecter dans `FixedUpdate` et interpoler le franchissement :

```csharp
float raceClock;   // horloge de course, pas Time.time
float zPrev;

void FixedUpdate()
{
    if (state != RaceState.Running || bike == null) return;
    float dt = Time.fixedDeltaTime;
    raceClock += dt;
    float z = bike.transform.position.z;
    float finishZ = finishLine ? finishLine.position.z : 402.336f;

    while (splits.Count < splitMeters.Length && z >= splitMeters[splits.Count])
    {
        float dz = z - zPrev;
        float frac = dz > 1e-6f ? (splitMeters[splits.Count] - zPrev) / dz : 1f;
        splits.Add(new SplitResult {
            name   = splitNames[splits.Count],
            meters = splitMeters[splits.Count],
            time   = raceClock - dt + frac * dt,     // instant exact du franchissement
            kph    = bike.speedKPH });
    }

    if (z >= finishZ)
    {
        float dz = z - zPrev;
        float frac = dz > 1e-6f ? (finishZ - zPrev) / dz : 1f;
        et = raceClock - dt + frac * dt;
        state = RaceState.Finished;
        bike.SetInputs(0f, 1f);
    }
    zPrev = z;
}
```

`Restart()` remet `raceClock = 0f` et `zPrev = bike.transform.position.z`. `Update` ne garde
que la machine d'état et les entrées.

### 2.4 La télémétrie n'est jamais vidée entre deux runs

**Mise à jour, relecture du 10/08 en fin de journée : la moitié de ce constat est déjà
corrigée.** Le `reported = false` a été déplacé à l'intérieur de la branche `Running`, donc
`Report()` ne se déclenche plus à chaque frame après l'arrivée. Les ~20 paires de lignes
identiques observées à 10:15:08 venaient de cette version-là, plus du doublon décrit en 2.5.
Rien à faire de ce côté.

Il reste ceci : `samples` n'est **jamais** vidé.

```csharp
public List<Sample> samples = new List<Sample>();   // grossit indéfiniment
```

Dès le deuxième run, `topSpeed`, `maxRPM` et `maxWheelie` sont les maxima **de la session**,
pas ceux du run qui vient de finir, et `grip-limited frames` compte les frames de tous les
runs cumulés. Le diagnostic post-run porte donc sur un mélange de runs — ce qui est le
contraire de ce que demande le §18, où l'intérêt est justement de comparer un run à un autre.

**Correctif** :

```csharp
public void ResetRun()
{
    samples.Clear();
    reported = false;
    nextSampleTime = 0f;
}
```

appelé depuis `DragRaceManager.Restart()`. Tant qu'on y est, échantillonner dans
`FixedUpdate` donne un pas régulier, et `samples` gagne à être préalloué
(`new List<Sample>(1200)`) : le §41 interdit les allocations dans la boucle chaude.

### 2.5 Deux `DragRaceManager` tournent en parallèle, et la scène est dupliquée

Kiro a relevé le symptôme pendant sa Phase 0 ; voici la cause. `RaceSystem` porte
**2× `DragRaceManager` et 2× `TelemetryRecorder`** (relu et confirmé), et la scène compte 24
racines dont 10 objets en double : `DragStrip_Track`, `LaneEdge_L`, `LaneEdge_R`,
`StartLine`, les quatre `Mark_*`, `FinishLine_1320ft` et `Ground`. `Bike`, `RaceSystem`,
`Main Camera` et `Sun` sont uniques.

La cause est dans l'assistant JS du script d'échafaudage, pas dans le C# :

```js
const r  = await post("/mcp", {..., name:undefined, params:{name,arguments:args}}, sid);
const r2 = await post("/mcp", {...,               params:{name,arguments:args}}, sid);
```

`JSON.stringify` supprime les clés dont la valeur est `undefined`. Les deux corps sont donc
**identiques et tous les deux valides** : chaque appel d'outil a été envoyé et exécuté deux
fois. Le découpage colle : les objets doublés sont exactement ceux créés par ce script,
et ceux créés plus tard sont uniques.

**Pourquoi ça compte, au-delà du ménage.** Deux `MonoBehaviour` du même type sur un même
GameObject reçoivent tous les deux `Update()` et `OnGUI()`. Donc, aujourd'hui :

- les deux managers avancent leur propre `state`, écrivent dans la même moto via
  `SetInputs()`, détectent l'arrivée et loguent `[NOSSEN] FINISH ET=…` chacun de leur côté ;
- le HUD est dessiné deux fois dans le même `Rect(8,8,460,420)` ;
- il y a **deux** boutons `RESTART RUN` superposés au même pixel. Un clic n'en déclenche
  qu'un : l'autre manager reste en `Finished` et continue d'imposer `SetInputs(0f, 1f)`
  (gaz à zéro, embrayage tiré) à chaque frame.

Conséquence attendue au deuxième run : la moto ne part pas, ou part n'importe comment selon
l'ordre d'exécution des deux `Update()`. Et on cherchera le bug dans la physique. À noter
que je n'ai pas *observé* ce blocage — c'est une déduction de la lecture du code ; ce que
j'ai observé, ce sont les deux composants et les objets doublés.

**Correctif** : supprimer un `DragRaceManager` et un `TelemetryRecorder` sur `RaceSystem`, et
supprimer les 10 racines en double. Deux minutes de ménage, mais à faire **avant** de
relever le moindre chrono en play mode — aucune mesure prise en jeu n'est fiable tant que
deux managers se disputent la moto. Mes mesures au banc n'en souffrent pas : j'appelle
`FixedUpdate` sur une moto neuve, hors de tout manager.

### 2.6 Points ouverts, non corrigés ici

- `reactionTime` est la constante `0f`, affichée au millième. Le §4 demande que le chrono de
  réaction soit **séparé** du chrono mécanique.
- L'état `Staged` ne dure qu'une frame (`if (state == Staged) state = Countdown;`) : il n'y a
  ni pre-stage ni stage, alors que le §36 en fait deux états.
- `ShiftUp()` n'interrompt pas le couple : le §8 exige qu'un passage de rapport coûte
  quelque chose (`shiftCutDuration`).
- Aucune entrée joueur : `SetInputs(1f, 0f)` est forcé à chaque frame et `autoShift` gère les
  rapports. Le run est un pilote automatique. C'est cohérent avec « Phase 1 : moto brute »
  du §49, mais le MVP du §47 demande gaz, launch et rapports au joueur.

---

## 3. Assets Blender livrés

Générateurs dans `<projet Unity>/Tools/blender/` — **hors de `Assets/`**, donc Unity ne les
importe pas. Tout est paramétré, on peut décliner des variantes sans remodeler.

| Asset | Chemin | Dimensions vérifiées | Triangles | Sous-tirages |
|---|---|---|---|---|
| Scooter 50cc | `Assets/NOSSEN/Art/Bikes/Scooter50_NOSSEN.fbx` | 1,836 × 0,674 × 1,212 m | 8 332 | 12 |
| Arbre de Noël | `Assets/NOSSEN/Art/Tracks/ChristmasTree_NOSSEN.fbx` | 0,95 × 0,95 × 3,365 m | 4 012 | 18 |
| Portique + staging | `Assets/NOSSEN/Art/Tracks/StartGantry_NOSSEN.fbx` | 10,088 × 4,244 × 4,690 m | 4 452 | 7 |
| Kit NOS | `Assets/NOSSEN/Art/Bikes/NOS_Kit_NOSSEN.fbx` | 0,198 × 0,373 × 0,754 m | 1 864 | 5 |

> **Correction.** Une première version de ce document annonçait 729 / 358 / 1308 / 848
> « faces ». C'était le nombre de polygones du **maillage de base côté Blender, avant
> application des modificateurs** (biseaux, subdivision). Les chiffres ci-dessus sont les
> triangles réels mesurés dans Unity après import, soit environ 11× plus. Un budget de
> performance doit se baser sur ceux-là.

### Le kit NOS se pose tout seul

Il est modélisé **dans le repère du scooter**, même origine (aplomb du contact arrière). Donc
dans Unity : parenter `NOS_Kit_NOSSEN` au root de `Scooter50_NOSSEN` en position locale
`(0,0,0)`, rotation nulle, échelle 1 — et la bouteille tombe pile sanglée sur le flanc
gauche, à l'opposé du silencieux. Aucune valeur magique à retenir. Vérifié par la mesure :
parenté ainsi, ses bounds tombent à `centre latéral = −0,145 m` du parent, exactement la
valeur d'auteur, et la taille est identique au millimètre près entre Blender et Unity.

Trois enfants :

- `NOS_Bottle` — bouteille, collier d'étiquette, robinet. Objet séparé pour pouvoir
  l'afficher ou le masquer selon que la pièce est montée (§15).
- `NOS_Plumbing` — les deux sangles, la durite tressée jusqu'au moteur, le gicleur de purge.
- `NOS_PurgePoint` — un **Empty**, pas un mesh : point d'accroche pour le VFX de purge, placé
  4 cm devant la buse, son axe Z orienté dans le sens du jet. Un `ParticleSystem` ou un
  `VisualEffect` posé dessus part droit sans aucun calcul d'orientation côté code.

Vérifications faites **par la mesure** côté Unity (instanciation puis lecture des bounds),
pas par supposition :

- échelle 1:1 en mètres ;
- `center.y = hauteur / 2` pour les trois → la base repose exactement sur `y = 0` ;
- `center.z > 0` pour le scooter → il regarde **+Z**, le sens de la course.

### Pivots, choisis pour le code

- **Scooter** : l'origine du root est au **point de contact de la roue arrière**. Le wheelie
  étant une rotation autour de X, c'est le seul pivot qui lève l'avant au lieu d'enfoncer la
  moto dans le bitume. `Wheel_Front` et `Wheel_Rear` sont des objets séparés dont l'origine
  est au centre de moyeu : les faire tourner autour de leur X local les fait rouler juste.
- **Arbre** : origine au pied. Les feux regardent **−Z** en Unity, donc pose-le *en aval* de
  la ligne (z positif) pour qu'il regarde le pilote, décalé en x hors de la voie (≈ −2,6).
- **Portique** : origine au centre de la **ligne de stage** au sol, soit ta `StartLine` à
  z = 0. Le pre-stage tombe à z = −0,178 (7 pouces, comme en NHRA) et la zone de chauffe de
  pneu de z = −2,70 à −0,30, donc bien en amont.

### Les 14 ampoules sont pilotables une par une

C'est fait exprès : un seul mesh fusionné aurait rendu la séquence impossible. Enfants du
root, nommés et vérifiés présents après import :

```
Bulb_L_PreStage  Bulb_L_Stage  Bulb_L_Amber1  Bulb_L_Amber2  Bulb_L_Amber3  Bulb_L_Green  Bulb_L_Red
Bulb_R_PreStage  Bulb_R_Stage  Bulb_R_Amber1  Bulb_R_Amber2  Bulb_R_Amber3  Bulb_R_Green  Bulb_R_Red
Tree_Structure
```

Chaque ampoule a son origine en son centre et un matériau émissif à sa couleur. Le plus
simple pour l'allumage est de moduler `Emission` / la couleur du matériau plutôt que
d'activer/désactiver l'objet — un feu éteint reste visible sur un vrai arbre.

Séquence NHRA à câbler sur `RaceState` : pre-stage et stage allumés au staging, puis les
trois ambres à 0,5 s d'intervalle, puis vert. Rouge = brûlée, ce qui donne enfin un usage au
`reactionTime` du §2.5 : c'est le délai entre l'allumage du vert et la première commande de
gaz du joueur.

### Ce que les deux assets pros du projet nous apprennent

Lecture faite de `am6.fbx` (moteur Minarelli AM6, Fab) et `SKM_MotorcrossBike.fbx`, par
réflexion sur la hiérarchie importée. C'est instructif sur trois plans.

**1. Le budget se compte en sous-tirages, pas en triangles.** La moto cross fait 165 146
triangles en **4 sous-tirages seulement** : un unique mesh *skinné* à 4 matériaux. Mon
scooter fait 8 332 triangles mais **12 sous-tirages**, et mon arbre de Noël 4 012 triangles
pour **18 sous-tirages** — parce que j'en ai fait 15 objets séparés. Le pro fait l'inverse :
un seul mesh, et les pièces mobiles bougent par **os**. La moto cross n'a que 4 os :
`MotorcrossBikeRoot`, `HandleBars`, `FrontWheel`, `RearWheel`. Exactement ce qui bouge, rien
de plus. Pour l'arbre, mes 18 sous-tirages sont un choix assumé (chaque ampoule doit être
adressable) et restent négligeables sur PC ; mais c'est un compromis, pas un repas gratuit.

**2. `FrontWheel` est enfant de `HandleBars`, et ça corrige un défaut de mon scooter.**

```
MotorcrossBikeRoot
  HandleBars
    FrontWheel
  RearWheel
```

C'est la hiérarchie mécaniquement juste : faire tourner le guidon entraîne la roue avant.
Dans mon `Scooter50_NOSSEN`, `Wheel_Front` est **frère** de `Body`, tous deux sous le root, et
la fourche et le guidon sont fondus dans `Body`. Donc le jour où NOSSEN ajoute une direction
— ne serait-ce que pour le staging ou l'inclinaison en mode Pro — ma roue avant ne suivra
pas le guidon. À corriger en insérant un nœud `Steering` entre le root et l'ensemble
{guidon, fourche, roue avant}, pivoté sur l'axe de direction (les 31° de chasse déjà en
place). Ça implique de sortir la fourche et le guidon du mesh `Body`.

**3. La hiérarchie de l'AM6 est une nomenclature mécanique, et elle valide la physique.**
94 transforms, 93 meshes, 238 235 triangles, 123 sous-tirages, 11 matériaux. Extrait :

```
Cylinder
  Crankshaft / Crankshaft 2 / Piston / Pistonring 1-2 / Wrist pin
  Cylinder head / bottomgasket / inner gasket / outer gasket
  Nut_Sylinteri1..4 / Cylinder bolts / Sparkplug / Heat sensor
  Intake manifold + Intakebolt 1..4 / Throttlebody
Driveshaft
  Clutch axle -> Gear1..4
  Gear 1..5 / Gear selector / Gear transfer / Gearchanger / Gearlever axle + seal
```

Trois enseignements directs :

- **La boîte est modélisée en paires de pignons sur deux arbres** (arbre d'embrayage et arbre
  primaire). L'AM6 est une vraie boîte 6 à prise constante — donc le tableau `gearRatios`
  de 6 éléments de `DragBikeController` est **juste pour ce moteur**, ce n'est pas un chiffre
  arbitraire.
- `Gear selector`, `Gearchanger` et `Gearlever axle` existent physiquement : ce sont les
  pièces qui font qu'un passage de rapport **prend du temps**. C'est le `shiftCutDuration`
  que réclame le §8 et que le code n'a pas encore (voir 2.6).
- `Crankshaft`, `Piston`, `Pistonring`, `Wrist pin` sont les masses tournantes, c'est-à-dire
  le `rotationalInertia` du §7, absent lui aussi du contrôleur.
- Les 11 matériaux sont nommés **par finition** et non par pièce (`Black plastic`,
  `Dark Metal`, `Rough metal`, `Gasket 2`, `Seal`, `Gold`…), et réutilisés sur des dizaines
  de pièces. C'est la même logique que mes 8 matériaux — bon réflexe, confirmé.

**Et un avertissement.** 238 235 triangles pour un bloc-moteur, 165 146 pour une moto : ce
sont des budgets de vitrine, pas de jeu de drag où le §28 veut un **ghost**, donc deux
véhicules à l'écran. Si le moteur doit être visible il faudra une version décimée.

**Enfin, un rappel utile de méthode** : la moto cross mesure 2,134 × 1,435 × 0,818 m, donc sa
**longueur est sur X** — l'asset regarde ±X, pas +Z, et il lui faudra une rotation de 90° pour
descendre la piste. Même un asset professionnel n'arrive pas orienté selon la convention de
votre jeu. Les deux assets pros ont par ailleurs exactement les mêmes réglages d'importateur
que les miens (`useFileScale=True`, `scaleFactor=1`, `bakeAxisConversion=False`) et arrivent à
la bonne taille : ce qui confirme que l'échelle se règle à l'**export**, pas à l'import.

### Recette d'export Blender → Unity

> **Cette section a été refaite.** Une première version recommandait
> `bake_space_transform=True` et `axis_forward='Z'`. C'était faux et ça détruisait les pivots
> — je ne l'avais vérifié que sur le pivot du root (roues au sol), pas sur les moyeux. Le
> nœud `Steering` a révélé le problème. Ce qui suit est mesuré sur les quatre assets.

| Argument de `export_scene.fbx` | Valeur | Ce qui casse sinon |
|---|---|---|
| `apply_unit_scale` | `False` (défaut Blender) | à `True` : modèle **100× trop petit** |
| `bake_space_transform` | **`False`** | à `True` : la géométrie tombe juste mais **tous les pivots sont écrasés à zéro** |
| `axis_forward` / `axis_up` | `'-Z'` / `'Y'` (défauts) | sans effet ici, voir ci-dessous |

**Le point central.** Avec `bake_space_transform=False`, l'export est **verbatim** : Blender
`(0, 1.280, 0.215)` arrive en Unity `(0, 1.280, 0.215)`, sans permutation ni changement de
signe. Le modèle arrive donc **couché**. `bake_space_transform=True` corrige bien l'orientation,
mais en cuisant les transforms des objets dans les sommets — c'est le sens de « Apply
Transform », et Blender la documente comme expérimentale et incompatible avec les objets
parentés. Résultat mesuré avec `True` : moyeux de roue ramenés à l'origine du modèle, pivot de
direction à la mauvaise place, `NOS_PurgePoint` perdu.

**La solution : un nœud `Rig` porte la conversion.** Un Empty inséré entre le root et le
contenu, avec `rotation_euler = (90°, 0, 180°)`. Deux pièges de placement, tous deux mesurés :

- **pas sur le nœud racine** : Unity **écrase la transform du nœud racine** d'un FBX. Vérifié
  en exportant quatre variantes rotées sur le root — les quatre fichiers arrivent identiques.
- **après le parentage** : `matrix_parent_inverse` compense la transform du parent, donc une
  rotation posée avant est intégralement annulée.

Les valeurs `(90, 0, 180)` viennent d'un balayage des quatre combinaisons (`rx` ±90 × `ry`
0/180) mesurées dans Unity. Une seule satisfait tout à la fois : debout, roues à `y = 0`, nez
vers `+Z`, moyeux à leur place, chasse de 31,1°, direction fonctionnelle.

Convention de modélisation associée : **debout sur Z, nez vers +Y**. Une roue qui roule vers +Y
tourne **autour de X** ; un cylindre Blender naît axé Z, donc rotation de 90° autour de **Y**.
Les deux roues s'écartent le long de **Y**, jamais de X.

**Et un piège de méthode**, celui qui m'a fait conclure à tort à un échec : les origines de
`Steering_Mesh` et de `Wheel_Front` sont **sur l'axe de rotation** de la direction. Un point
situé sur l'axe ne peut pas se déplacer quand on tourne autour de cet axe. Mesurer leur
position ne prouve donc rien — il faut mesurer le **centre des bounds du renderer**, qui est
hors axe.

### État vérifié des quatre assets

Mesuré après import, prefab instancié à l'origine :

```
SCOOTER   taille (0.674 1.212 1.836)  base y=0.000  nez z=+1.514
          moyeu AV (0 0.215 1.280)   moyeu AR (0 0.215 0.000)
          chasse 31.1 deg   guidon bouge de 0.040 m pour 25 deg de braquage
ARBRE     taille (0.950 3.365 0.950)  base y=0.000
          14/14 ampoules, ecart pivot/centre du mesh = 0.0000 m pour chacune
PORTIQUE  taille (10.088 4.690 4.244)  base y=0.000  zMin=-2.700
KIT NOS   taille (0.198 0.373 0.754)  centre (-0.145 0.408 0.305)
          NOS_PurgePoint conserve, jet vers (-0.04 0.99 0.13), quasi vertical
```

### Hiérarchie du scooter, avec la direction

```
Scooter50_NOSSEN
  Rig                        <- porte la conversion d'axes (90, 0, 180)
    Body                     chassis, tablier, plancher, selle, pot
    Wheel_Rear               origine au moyeu
    Steering                 pivot sur l'axe de direction, au te de fourche
      Steering_Mesh          guidon, plaque, retros, fourche, garde-boue, phare
      Wheel_Front            origine au moyeu
      Steering_AxisTip       second point SUR l'axe
```

Pour braquer, sans dépendre d'une rotation cuite à l'export :

```csharp
Vector3 axis = (axisTip.position - steering.position).normalized;
steering.RotateAround(steering.position, axis, steerDegrees);
```

`Steering_AxisTip` n'existe que pour ça : il rend l'axe retrouvable par une simple
soustraction. Pour l'approximation courante (rotation autour de la verticale), remplacer
`axis` par `Vector3.up` — à 31° de chasse la différence est visible en gros braquage, mais
sur une piste de drag elle est négligeable.

---

## 4. Réserves d'honnêteté

- La passe de réfutation adversariale qui devait contre-vérifier ces constats **n'a pas
  tourné** : 10 de ses 14 agents sont morts sur `session limit`. Les chiffres ci-dessus sont
  les miens, mesurés au banc ; les deux bugs de télémétrie sont confirmés par relecture du
  code et par les logs dupliqués. Rien ici ne repose sur une conclusion d'agent non vérifiée.
- La géométrie de la moto **bouge en direct** : entre deux de mes lectures, `comHeight` est
  passé de 0,60 à 0,45 et `muRear` de 1,10 à 1,40. Les mesures des sections 2.1 à 2.4 ont été
  prises à `comHeight=0,60 / muRear=1,10`, la table du 2.2 à `0,45 / 1,40`. Les conclusions
  qualitatives tiennent dans les deux cas, mais les chronos absolus sont à relire après tes
  réglages.
- Je n'ai pas sauvegardé la scène `DragStrip`. J'y ai instancié puis détruit trois objets de
  contrôle (`__ClaudeCheck_*`) : le contenu est identique à ce que j'ai trouvé, mais la scène
  peut être marquée modifiée.
