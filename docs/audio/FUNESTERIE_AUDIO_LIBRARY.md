# Librairie audio Funesterie — catalogue

> Inventaire établi le 2026-07-25 par lecture du code, pas de la documentation.
> Conclusion principale : **Funesterie possédait de la protection et des bips d'interface,
> mais aucun effet musical audible.** Les deux familles historiques n'ont jamais été reliées
> entre elles ni à la chaîne de production musicale.

---

## 1. Moteur SFX — `a11/backend/apps/server/lib/sfx-engine.cjs`

Synthèse 8-bit pure en Node, **sans dépendance externe** : table de notes + ADSR + formes
d'onde (`sine`, `square`, `triangle`, `sawtooth`) écrites directement en PCM.

- **Format de sortie : 22 050 Hz, mono, 16 bits** — inexploitable tel quel dans un mix 44,1 kHz stéréo.
- **Déclenchement : balises `[SFX:nom]` dans du texte.** C'est un système de signalétique
  d'interface (`parseSfxTags` / `stripSfxTags`), jamais branché sur le rendu musical.

### Les 15 cues

| Nom | Notes | Durée | Registre |
|---|---:|---:|---|
| `heart_lost` | 5 | 0,66 s | descente grave, Zelda game-over |
| `heart_gained` | 4 | 0,44 s | arpège montant, item get |
| `victory` | 18 | 2,00 s | fanfare Final Fantasy |
| `levelup` | 7 | 0,67 s | jingle ascendant |
| `error` | 5 | 0,37 s | buzzer |
| `notify` | 2 | 0,23 s | ding |
| `thinking` | 5 | 0,55 s | mélodie mystérieuse |
| **`shikai`** | 3 | 0,20 s | Bleach — dégainé léger |
| **`bankai`** | 4 | 0,60 s | Bleach — rafale de pression |
| `alert` | 5 | 0,34 s | pulsation radar |
| **`gear5`** | 8 | 0,54 s | One Piece — rebond clair |
| **`ui`** | 4 | 0,44 s | Ultra Instinct — quasi-silence, aura |
| **`domain`** | 5 | 0,74 s | Domain Expansion — barrière qui se déploie |
| **`void`** | 6 | 0,66 s | échos espacés vers le silence |
| `cri_echo_levier` | 10 | 0,84 s | cri, trois rebonds décroissants |

Les six en gras sont les « invocations » — la couche anime du lore.

---

## 2. Famille double-harmonic — `a11/backend/apps/server/src/audio/`

**Huit générations d'une seule et même idée : un sceau harmonique de protection.**
Aucune n'est un effet musical. Aucune ne contient de reverb, delay, chorus, phaser ou
quoi que ce soit de perceptible comme traitement.

Principe (`double-harmonic-d40.cjs`) : le morceau sec est conservé intact, et on lui
superpose deux copies mono pitch-shiftées via `rubberband` (×1,259921 et ×0,840896),
filtrées et pesées très bas, dont le gain suit une enveloppe périodique.

| Fichier | Génération | Apport |
|---|---|---|
| `double-harmonic-d40.cjs` | référence | enveloppe à 5 ancres, 3 profils, **seule variante câblée en production** |
| `double-harmonic-phase-lock-v2.cjs` | v2 | verrouillage de phase |
| `double-harmonic-dynamic-v3.cjs` | v3 | automation de poids dynamique |
| `double-harmonic-naked-v4.cjs` | v4 | variante dépouillée |
| `double-harmonic-log-v5.cjs` | v5 | courbe logarithmique |
| `double-harmonic-resonance-v6.cjs` | v6 | résonance |
| `double-harmonic-bricks-v7.cjs` | v7 | grille binaire (« briques ») |
| `double-harmonic-closed-phase-v8.cjs` | v8 | phase fermée, pivot |

**Les sept variantes v2→v8 ne sont appelées nulle part dans la production d'album.**

### Ordres de grandeur du sceau

```
PIVOT_RESIDUAL_OLD     = 5,5193627332139616e-5
AUDIO_PIVOT_GAIN_FACTOR = (40000 × PIVOT_RESIDUAL_OLD)/2 + PIVOT_RESIDUAL_OLD ≈ 1,1039
HARMONIC_WEIGHT_MAX    = 0,0225
→ poids réel de la couche haute ≈ 0,0248 contre 1 pour le sec, soit environ −32 dB
```

Subtil, mais **pas littéralement inaudible** — c'est un sceau discret, pas un fantôme.

Profils : `prime3`, `prime11`, `blend` (défaut). Intensité bornée à `[0,888 ; 1,125]`.
Dépend de `rubberband` dans ffmpeg.

---

## 3. Export de relique — `src/audio/zen-relique-exporter.cjs`

Répare les WAV écrits en flux dont le header n'a jamais été finalisé : taille RIFF à
`0xFFFFFFFF` (`RIFF_INFINITE_SIZE`) ou taille `data` incohérente avec le buffer réel.
`fixReliqueWaveBuffer` réécrit les deux tailles sans toucher aux échantillons, et produit
un WAV standard + un FLAC + un manifeste JSON avec empreintes SHA-256.

Option `polish` : une coquille sacrificielle de bruit blanc à `amplitude=0.00022`, bandée
entre 8 500 et 15 500 Hz. Là encore, protection — pas musical.

> C'est le même mal que les FLAC `Lavf59.27.100` à `Duration: N/A` : un encodeur en flux
> qui ne finalise pas son header. Les lecteurs stricts affichent alors 0:01.

---

## 4. Prosodie — `src/vivy/prosody-prime-complex.cjs`

Analyse prosodique liée au casting vocal (`funesterie.vivy.prosody-prime-complex.v1`),
avec un pont vers la synchronisation double-harmonic
(`funesterie.vivy.double-harmonic-sync.v1`). Sert au chant et à la répartition des voix,
**pas au traitement d'un fichier audio existant**.

---

## 5. Faux amis — ne cherchez pas d'audio ici

| Module | Ce que le nom suggère | Ce que c'est réellement |
|---|---|---|
| `lib/funesterie-mixer.cjs` | table de mixage | moteur de recommandation : `detectIntent`, `scoreCandidate`, écrit du markdown/JSON |
| `lib/westside-chopper.cjs` | découpe audio | assemblage de recettes (`RUMBLE_BALLS`, `QUALITY_GATES`), aucun DSP |

---

## 6. La couche ajoutée — `scripts/funesterie-audio-fx.cjs`

Relie les deux familles et fournit ce qui manquait : **des effets réellement audibles**.

```bash
node scripts/funesterie-audio-fx.cjs --list

node scripts/funesterie-audio-fx.cjs \
  --in piste.wav --out piste-fx.mp3 \
  --space 0.35 --width 0.25 --glue 0.45 --air 0.25 --drive 0.15 \
  --invoke bankai@0 --invoke void@-4 --invoke-gain 0.38 \
  --seal blend
```

| Paramètre | Effet | Neutre |
|---|---|---|
| `--space` | profondeur / réverbération | 0 |
| `--width` | largeur stéréo | 0 |
| `--glue` | compression de cohésion | 0 |
| `--air` | brillance | 0 |
| `--drive` | saturation douce | 0 |
| `--invoke nom[@sec]` | pose une invocation, **temps négatif = depuis la fin** | — |
| `--seal` | sceau D40 : `blend` \| `prime3` \| `prime11` \| `off` | `blend` |

Tout à 0 rend le morceau inchangé : l'outil est sûr à essayer.

**Trois garanties :**

1. Les invocations sont rééchantillonnées en **44,1 kHz stéréo**, adoucies et spatialisées
   pour cohabiter avec un mix, au lieu de rester des bips 22 kHz mono.
2. Le niveau de sortie est **réaligné sur celui de la source**. Sans ça, les étages de
   réverbération coûtaient 8,6 dB — un master ne doit jamais ressortir plus faible.
   Le rapport JSON expose `loudness.makeupDb`.
3. Le sceau réutilise `processProtectMixD40` du projet, ce n'est pas une réimplémentation.

---

## Chaîne de production musicale — état réel

```
Suno / Mureka
   → probeVivyProductionAudioDurationSeconds
   → processDoubleHarmonicAudio (sceau D40 uniquement)
   → sortie
```

Ni les SFX, ni les variantes v2→v8, ni le polish zen n'y figurent.
`funesterie-audio-fx.cjs` est le point d'entrée pour les y faire entrer.
