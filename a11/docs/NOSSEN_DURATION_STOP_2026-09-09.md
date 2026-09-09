# NOSSEN : arrêt « durée réelle inconnue », 9 septembre 2026

## Cause reproduite, distincte du fil d'or

Le frontend `App.tsx` appelle `probeVivyProductionAudioDurationSeconds` avant V11.
Sans durée reçue, il tente de lire le média dans le navigateur, puis lève
`generation_suno_duree_inconnue` si aucune durée finie n'est disponible.

Le serveur avait deux défauts en chaîne :

1. `collectSunoTracks` assimilait `streamAudioUrl` au MP3 final, y compris pendant
   `TEXT_SUCCESS` / `FIRST_SUCCESS`, puis `getSunoMusicJob` annonçait `done`.
2. `materializeVivySunoMedia` rendait directement cette URL non autorisée par le
   téléchargeur, avant même de respecter `requireLocalSunoAudio` / `throwOnFailure`.

Reproduction sur le code actif `5a6f2594`, sans réseau ni génération : payload
`TEXT_SUCCESS`, `audioUrl=''`, `streamAudioUrl=https://audiostream.api.box/stream/repro.mp3`,
`duration=0`. Résultat : URL provisoire rendue malgré les deux drapeaux obligatoires,
aucun chemin local, durée zéro. Le navigateur arrêtait alors le suivi ; le callback
final arrivait plus tard sans que les MP3 soient rapatriés.

Les phases et la distinction URL fichier / URL streaming sont documentées par le
fournisseur : https://docs.kie.ai/suno-api/get-music-details/ et
https://docs.kie.ai/suno-api/upload-and-extend-audio-callbacks.

## Correctif

- Ignore les phases provisoires avant sélection et analyse audio ; attend le
  résultat final des deux variantes. Aucun changement d'allowlist vers le flux provisoire.
- Ne sélectionne plus les champs de streaming comme fichiers livrables.
- Aucun retour anticipé ne contourne l'obligation d'avoir un fichier local.
- Mesure aussi un MP3 déjà local ; une mesure impossible ne devient pas un succès
  grâce à la durée déclarée par le fournisseur.
- Un ancien callback provisoire en cache laisse le poller demander la suite.
- Pas de retrait du contrôle de durée dans le frontend, pas d'extension payante,
  pas de nouvelle génération.

## Tests et récupération

301 tests passent dans la sélection studio/Suno/localisation/fil d'or ; le test
frontend préexistant `Vivy frontend keeps download` est explicitement hors sélection.
Quatre nouveaux tests ciblent le flux provisoire, les retours anticipés, la mesure
réelle d'un MP3 et le parcours HTTP authentifié provisoire → cache périmé → final.
Les tests historiques de métadonnées distantes demandent désormais explicitement
un aperçu non local ; ils ne représentent plus le comportement final par défaut.

Dernière tâche concernée : `355c89cdc64478afef6ebe4eea5f2b5b`, callback `complete`
reçu à `2026-09-09T12:16:43.479Z`. Deux variantes téléchargées depuis le callback
existant, sans POST de génération :

- `9e188245-ff42-422e-8c57-627baa2cf289` → `vivy-music-suno-656b63dea447ca52.mp3`,
  151.875918 s mesurées, 3 645 693 octets.
- `9423a724-7e7f-4365-9975-749e134fba05` → `vivy-music-suno-03e65ed53c586f0f.mp3`,
  167.235918 s mesurées, 4 014 333 octets.

## Activation et preuve de bout en bout

- Code `77fa88cabe2ec793bd7e708303c77148d40d8936` poussé, release
  `/home/deploy/a11-prod/releases/20260909-143000`, active green. Image
  `funesterie-nossen-repair:20260909-143000`, SHA
  `4950737291d1c59d19d42880ff8579f9fa90d833ebe8fe1639f3f0f9dcecbd9c`.
  Retour arrière conservé : `20260909-140700`. Batch historique et suivi du fil
  d'or non interrompus ; aucun changement K44/Caddy.
- Image Linux : 9 tests réels ciblés passent (cycle Suno + flux). Les 19 fichiers
  du manifeste correspondent dans blue puis green. `/api/build` public confirme
  le commit après promotion ; green et blue sont sains.
- Appel authentifié par l'identité service déjà configurée, sans fabriquer de
  compte utilisateur : `GET /api/vivy/studio/jobs/355c89cdc64478afef6ebe4eea5f2b5b`
  retourne HTTP 200, `state=done`, `durationMeasured=true`, 167.235918 secondes et
  l'asset local `vivy-music-suno-03e65ed53c586f0f.mp3`.
- Puis **la même route de mix que le frontend**, avec ses paramètres réels :
  `POST /api/double-harmonic/v10boom/process`, HTTP 202, job
  `v11pan_1788956739100_fcb9e3cf`, suivi authentifié jusqu'à `status=done`.
  Profil blend, V9 électrolyse, V11 pan width 1.5/spread 4 ms confirmés.
- Contrôle du mix terminé : source et sortie réellement décodées
  **167.19698412698412 s**, pic stéréo -1.7 dBFS, pic mono -2.3 dBFS,
  variation de perte au repli mono négligeable ; SHA de la source inchangé.
  La différence avec 167.235918 s vient du padding/estimation du conteneur MP3.
- Copie durable du master validé :
  `/api/vivy/studio/assets/vivy-music-jukebox-v11pan-16ccd9933939a4781a79.mp3`.
  Fiche `history-masters` avec deux SHA fichiers, deux empreintes de flux, mesures
  et filiation. Les deux variantes sources ont été ajoutées à l'archive publique
  existante ; la variante choisie présente maintenant ce master et son original.
- Les deux sources et le master sont servis par la route publique d'assets avec
  des réponses Range HTTP 206. Aucun POST de génération Suno, extension ou autre
  appel de génération IA payant n'a été effectué pour cette réparation.

Le message d'échec déjà affiché dans l'ancien écran ne relance pas tout seul son
suivi : donner le lien du morceau récupéré, **ne pas demander de régénérer**.
