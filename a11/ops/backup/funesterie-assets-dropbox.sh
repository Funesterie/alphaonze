#!/usr/bin/env bash
#
# funesterie-assets-dropbox.sh — Deuxieme copie hors site des assets Funesterie.
#
# POURQUOI UNE DEUXIEME COPIE
#
# La Storage Box porte deja une sauvegarde restic (chiffree, dedupliquee,
# planifiee). Elle est excellente, mais elle est chez le meme hebergeur que le
# serveur : un incident de compte Hetzner emporterait les deux d'un coup.
# Dropbox donne la diversite de fournisseur qui manque -- c'est le "1" hors site
# de la regle 3-2-1.
#
# Ce script ne remplace pas restic. Il double les fichiers qui ne se
# reconstruisent pas : les masters et les echantillons de voix.
#
# COPY ET NON SYNC — LE POINT LE PLUS IMPORTANT DE CE FICHIER
#
# `rclone sync` rend la destination identique a la source, donc il SUPPRIME chez
# Dropbox tout ce qui a disparu du serveur. Un `rm` malheureux, un disque plein
# qui tronque un dossier, et la commande suivante propage la perte dans
# l'archive. Une archive qui recopie fidelement une catastrophe n'est pas une
# archive.
#
# `rclone copy` n'efface jamais rien a destination. L'archive ne fait que
# grossir, ce qui est exactement ce qu'on lui demande. 7,2 Go de runtime contre
# 2 To d'abonnement : la place n'est pas le probleme.
#
# USAGE
#   ./funesterie-assets-dropbox.sh              simulation, rien n'est envoye
#   ./funesterie-assets-dropbox.sh --confirm    envoi reel
#
# PREALABLE, A FAIRE UNE FOIS. Le jeton ne doit transiter par aucun chat, et avec
# la methode ci-dessous il n'est meme jamais copie : il reste sur le serveur.
#
# Le probleme : rclone veut ouvrir un navigateur sur http://127.0.0.1:53682, et
# le serveur n'en a pas. Lancer `rclone authorize` sur le serveur ne marche donc
# pas -- le lien affiche pointe vers le localhost DU SERVEUR, injoignable depuis
# le poste. Essaye le 16/08/2026, c'est ce qui a bloque.
#
# La solution est un tunnel SSH sur ce port precis :
#
#   ssh -i <cle> -o IdentitiesOnly=yes -L 53682:127.0.0.1:53682 deploy@<serveur>
#   rclone config
#     n) new remote        nom : dropbox
#     Storage              dropbox
#     client_id/secret     laisser vide
#     Edit advanced        n
#     Use auto config      Y   <-- OUI : le tunnel rend le localhost joignable
#
# rclone affiche alors un lien 127.0.0.1:53682 qui s'ouvre dans le navigateur DU
# POSTE et ressort cote serveur. Dropbox renvoie le jeton directement a rclone,
# qui l'ecrit lui-meme dans sa configuration.
#
# L'autre methode (auto config N, `rclone authorize` sur le poste) marche aussi,
# mais exige rclone installe en local et fait transiter le jeton par un
# copier-coller -- donc par le presse-papier, l'historique du terminal, et tout
# ce qui les lit.

set -euo pipefail

REMOTE="${FUNESTERIE_DROPBOX_REMOTE:-dropbox}"
DEST="${FUNESTERIE_DROPBOX_PATH:-Funesterie/assets}"
RUNTIME="${FUNESTERIE_RUNTIME_ROOT:-/home/deploy/a11-data/runtime}"

# Ce qui ne se reconstruit pas. On n'archive PAS tout le runtime : les caches,
# les fichiers temporaires et les sorties regenerables n'ont rien a faire dans
# une archive, ils la rendent illisible et lente a parcourir.
SOURCES=(
  "double-harmonic-d40"   # les masters
  "voice-samples"         # l'ADN des personas
  "clips"                 # les clips rendus
)

# Le catalogue vaut autant que les echantillons : sans lui, voice-samples n'est
# qu'un tas de mp3 anonymes, et on ne sait plus qui a consenti a quoi.
FICHIERS=(
  "voice-catalog.json"
)

# Meme liste que les exclusions restic. Un secret qui part chez un tiers ne se
# rattrape pas : il faut le considerer comme divulgue et le faire tourner.
EXCLUS=(
  --exclude "*.env"
  --exclude "*.env.*"
  --exclude ".env"
  --exclude "**/*secret*"
  --exclude "**/*.pem"
  --exclude "**/*.key"
  --exclude "**/node_modules/**"
  --exclude "**/.git/**"
)

confirme=0
[[ "${1:-}" == "--confirm" ]] && confirme=1

if ! rclone listremotes 2>/dev/null | grep -q "^${REMOTE}:"; then
  printf 'Remote "%s" absent. Lancer `rclone config` (voir l en-tete de ce fichier).\n' "$REMOTE" >&2
  exit 1
fi

mode=(--dry-run)
etiquette="SIMULATION"
if [[ $confirme -eq 1 ]]; then
  mode=()
  etiquette="ENVOI REEL"
fi

printf '=== %s vers %s:%s ===\n' "$etiquette" "$REMOTE" "$DEST"

for nom in "${SOURCES[@]}"; do
  src="$RUNTIME/$nom"
  if [[ ! -d "$src" ]]; then
    # Bruyant volontairement : une source absente qui passe en silence donne une
    # archive incomplete dont personne ne saura qu'elle l'est.
    printf 'ABSENT, ignore : %s\n' "$src" >&2
    continue
  fi
  printf -- '--- %s ---\n' "$nom"
  rclone copy "$src" "${REMOTE}:${DEST}/${nom}" \
    "${mode[@]}" "${EXCLUS[@]}" \
    --transfers 4 \
    --bwlimit 20M \
    --stats 30s --stats-one-line \
    --log-level INFO
done

for fichier in "${FICHIERS[@]}"; do
  src="$RUNTIME/$fichier"
  [[ -f "$src" ]] || { printf 'ABSENT, ignore : %s\n' "$src" >&2; continue; }
  printf -- '--- %s ---\n' "$fichier"
  rclone copyto "$src" "${REMOTE}:${DEST}/${fichier}" "${mode[@]}" --log-level INFO
done

if [[ $confirme -eq 0 ]]; then
  printf '\nSimulation terminee. Rien n a ete envoye. Relancer avec --confirm.\n'
  exit 0
fi

# Verification apres coup. Sans elle on saurait seulement que la commande n'a pas
# renvoye d'erreur, pas que les fichiers sont arrives.
printf '\n=== verification ===\n'
for nom in "${SOURCES[@]}"; do
  [[ -d "$RUNTIME/$nom" ]] || continue
  local_n=$(find "$RUNTIME/$nom" -type f | wc -l)
  dist_n=$(rclone size "${REMOTE}:${DEST}/${nom}" --json 2>/dev/null | grep -oE '"count":[0-9]+' | cut -d: -f2 || echo 0)
  printf '%-24s local %4s  distant %4s  %s\n' "$nom" "$local_n" "$dist_n" \
    "$([[ "$local_n" == "$dist_n" ]] && echo OK || echo ECART)"
done
