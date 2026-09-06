# Calibration V11 Pan intégrale — 5 août 2026

## Portée

Cette passe compare le master ACE sans perte et trois rendus écoutables déjà
produits. Elle vérifie crêtes, niveau moyen, sonie, plage dynamique, corrélation
stéréo et coût du repli mono. Elle ne choisit pas le défaut artistique : ce choix
reste soumis à l'écoute du propriétaire.

Les fichiers proviennent du lot local
`.codex-tmp/ace-learning-1785947692633/`. Ils servent de corpus de calibration,
pas de preuve qu'une nouvelle génération utilise déjà la politique de durée
corrigée.

## Mesures

| variante | codec | durée | LUFS-I | true peak | LRA | RMS | corrélation L/R | coût repli mono | side/mid |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| A — clean | MP3 | 300,042 s | -14,24 | -1,92 dBTP | 6,80 LU | -16,918 dBFS | 0,758985 | -0,558 dB | -8,625 dB |
| source | FLAC | **300,000 s** | -13,99 | -2,05 dBTP | 6,80 LU | -16,662 dBFS | 0,760789 | -0,554 dB | -8,662 dB |
| B — V11 douce | MP3 | 300,042 s | -13,91 | -1,80 dBTP | 6,20 LU | -16,332 dBFS | **0,764417** | **-0,547 dB** | -8,723 dB |
| C — V11 canonique | MP3 | 300,042 s | -13,88 | -1,70 dBTP | 6,10 LU | -16,290 dBFS | 0,757876 | -0,565 dB | -8,573 dB |

Méthode : décodage FFmpeg en flottants stéréo 48 kHz pour RMS, crêtes,
corrélation, mid/side et repli mono ; passe `loudnorm` d'analyse pour LUFS-I,
dBTP et LRA. Aucun fichier n'a été normalisé pendant la mesure.

## Lecture technique

- Aucun candidat ne clippe ; la marge true peak reste supérieure à 1,7 dB.
- Le repli mono coûte moins de 0,6 dB sur les quatre fichiers : aucun effondrement
  de phase global n'est visible.
- B est le candidat le plus prudent du lot traité : meilleure corrélation et
  coût mono le plus faible, tout en gagnant environ 0,33 LU sur la source.
- C ouvre un peu plus le side et réduit légèrement la plage dynamique. Il reste
  techniquement sûr, mais ce supplément doit être validé à l'oreille.
- Le FLAC source à **300,000 secondes exactement** confirme une cible imposée en
  amont. La chaîne corrigée ne demande plus cinq minutes par défaut.

## Décision de calibration

`B — V11 douce` reste le **candidat d'écoute**, pas le défaut automatique. Les
réglages de production ne changent qu'après comparaison au casque, enceintes et
repli mono. La source FLAC/PCM doit alimenter directement la recette cumulative
V2→V11 ; un MP3 déjà traité ne doit pas recevoir une seconde passe V11.

Pour le prochain morceau, la validation complète doit conserver : source
lossless, manifeste des paramètres V2→V11, mesures avant/après, A/B/C nommés et
choix final signé après écoute.
