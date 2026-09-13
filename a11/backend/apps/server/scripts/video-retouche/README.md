# Retouche vidéo par Comfy Cloud (Wan VACE)

Circuit validé par Djeff le 13/09/2026 sur `IMG_3034.mov`. Dans la vidéo, sa main tient un
pistolet de massage pointé vers une figurine. Le circuit transforme le pistolet en blaster,
ajoute 3 salves d'éclairs bleus et fait exploser un impact sur la figurine. Le reste de la
pièce reste tel qu'il a été filmé.

Un plan de 5 s a coûté **25 crédits Comfy** (93 s de GPU sur une RTX PRO 6000).

## Chaîne

1. **Extraire** 81 images de 480×832 à 16 i/s (5,06 s) :
   `ffmpeg -i clip.mov -t 5.0625 -vf "fps=16,scale=480:832:force_original_aspect_ratio=increase,crop=480:832" -frames:v 81 frames/f%03d.png`
2. **Dessiner les effets** sur ces images (`blaster-fx.cjs`) : les tirs du canon vers la
   cible, puis l'impact. VACE les rend ensuite en vraie lumière (reflets, éclat). Laissé
   seul, le modèle 1.3B n'inventait aucun tir (essai 1).
3. **Encoder en GIF animé.** L'envoi Comfy (`upload_file`) n'accepte que les images et le
   son. Il **refuse le WebP animé** (422 « not a valid image ») mais accepte le GIF.
   `LoadImage` lit toutes les images du GIF en lot.
4. **Masque** en PNG de 480×832, blanc = zone à refaire, **bords nets**. Un masque flouté
   dessinait un cadre bleu dans la vidéo (essai 1).
5. **Workflow** (`blaster-workflow.cjs`) : LoadImage (GIF) → WanVaceToVideo (vidéo de
   contrôle + masque répété sur 81 images) → KSampler en 30 étapes → VHS_VideoCombine (mp4).
   Soumis avec `comfy__submit_workflow` via le pont MCP.
6. **Suivre** le job (`comfy-attente.cjs <prompt_id>`) : attente, lien de sortie signé
   (valable environ 6 h), secondes GPU facturées, solde.

## Pièges rencontrés

- **Wan VACE 14B** dépasse la durée maximale d'un job Comfy Cloud sur 81 images
  (« Job execution time exceeded maximum limit »). Le job n'est pas facturé. Garder le
  **1.3B**, ou passer au 14B sur 3 s au plus.
- **Images mixtes RGB/RGBA** (celles qui portent les effets ont un canal alpha) : ffmpeg 4.4
  plante (« Internal bug ») et le GIF s'arrête à 11-13 images. Il faut normaliser toutes les
  images en RGB avant l'encodage, puis **vérifier qu'il y a bien 81 images** avant l'envoi.
- **Composition** : utiliser le mode `over`, pas `screen`. Sur un fond clair, `screen`
  efface le bleu.
- **Suivi de la cible** : la couleur ne suffit pas (chapeau et petite voiture jaunes). Les
  positions de la figurine sont repérées à l'œil puis interpolées (`REPERES` dans
  `blaster-fx.cjs`). Elles sont propres à chaque clip.
- **Estimation** : `estimate_credits` rend 0 pour ces workflows, parce que seul le temps GPU
  est facturé. Le vrai coût se lit ensuite dans `get_billing_activity` (`gpu_seconds`).
