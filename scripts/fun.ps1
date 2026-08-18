# fun.ps1 — Raccourci vers la CLI Funesterie en production.
#
#   fun                     ouvre la CLI interactive
#   fun logs                les 80 dernieres lignes du backend
#   fun logs zen-gate       les lignes qui contiennent « zen-gate »
#   fun shell               un shell dans le conteneur
#   fun exec <commande>     une commande quelconque dans le conteneur
#   fun which               dit juste quel conteneur est actif
#
# LES ITEMS DE NAVIGATION -- lecture seule, aucun credit depense
#
#   fun etat                toutes les salles d'un coup
#   fun voix                catalogue des voix, ce qui est mort et ce qui vit
#   fun personas            le casting LLM, qui parle sur quel modele
#   fun cout                ce qu'un clip coute et le plafond du mois
#   fun gratuit             etat du commutateur tout-gratuit et du quota
#   fun graphe              noeuds, relations et labels de Neo4j
#
# POURQUOI LE CONTENEUR N'EST PAS ECRIT EN DUR
#
# La production est en blue/green : le conteneur actif s'appelle
# a11-backend-blue ou a11-backend-green selon le dernier deploiement. Un
# raccourci qui figerait « green » marcherait aujourd'hui et pointerait sur le
# conteneur mort apres le prochain deploiement — en repondant « No such
# container », c'est-a-dire en ressemblant a une panne de serveur. On demande
# donc au serveur qui est vivant, a chaque appel.

$ErrorActionPreference = 'Stop'

$Cle = "C:\Users\cella\.ssh\codex-a11-hetzner-20260627_ed25519"
$Hote = "deploy@37.27.63.109"

# IdentitiesOnly=yes : sans lui, ssh propose toutes les cles de l'agent avant la
# bonne. Plusieurs echecs d'authentification d'affilee declenchent fail2ban cote
# serveur, et le bannissement se manifeste par un timeout — donc par quelque
# chose qui ressemble a un probleme reseau. Ne pas retirer.
$SshBase = @('-i', $Cle, '-o', 'IdentitiesOnly=yes')

# Couleur ACTIVE, pas la premiere venue.
#
# La premiere version prenait `docker ps ... | head -1`. L'ordre de docker ps
# n'est pas garanti : le raccourci pointait donc tantot sur green, tantot sur
# blue, et lire les logs du mauvais conteneur envoie chercher un probleme la ou
# il n'est pas. On lit d'abord la couleur declaree par le deploiement; le repli
# sur docker ps ne sert qu'a un premier demarrage, et il le dit.
function Get-ConteneurActif {
  # Le chemin est /home/deploy/a11-prod/bluegreen/active-color, PAS /srv/a11/...
  # La premiere version visait /srv/a11 : ce fichier n'existe pas, donc la lecture
  # echouait en silence et on retombait toujours sur le repli `docker ps | head -1`.
  # Ca marchait par accident, et ca redonnait une couleur au hasard des que
  # plusieurs conteneurs tournaient -- ce qui est desormais le cas des quatre.
  $script = @'
for f in /home/deploy/a11-prod/bluegreen/active-color /srv/a11/bluegreen/active-color; do
  if [ -s "$f" ]; then
    c=$(tr -d "[:space:]" < "$f")
    if docker ps --format "{{.Names}}" | grep -qx "a11-backend-$c"; then echo "a11-backend-$c"; exit 0; fi
  fi
done
docker ps --format "{{.Names}}" | grep -E "^a11-backend-(green|blue|yellow|purple)$" | head -1
'@
  $nom = (& ssh @SshBase $Hote $script 2>$null | Out-String).Trim()
  if (-not $nom) { throw "Aucun conteneur a11-backend-* en marche sur $Hote." }
  return $nom
}

# Un argument shell, rendu inoffensif.
#
# `fun exec node -e "require(...)"` echouait : les arguments etaient recolles
# avec des espaces et bash interpretait les parentheses et les guillemets. On
# entoure chaque argument de quotes simples, en neutralisant celles qu'il
# contient deja.
function ConvertTo-ArgShell([string]$a) {
  return "'" + ($a -replace "'", "'\''") + "'"
}

$commande = if ($args.Count -gt 0) { $args[0] } else { 'cli' }
$reste = if ($args.Count -gt 1) { $args[1..($args.Count - 1)] } else { @() }

switch ($commande) {
  'which' {
    Write-Output (Get-ConteneurActif)
  }

  'logs' {
    $c = Get-ConteneurActif
    if ($reste.Count -gt 0) {
      $motif = ($reste -join ' ')
      Write-Host "[$c] lignes contenant « $motif »" -ForegroundColor DarkGray
      & ssh @SshBase $Hote "docker logs '$c' 2>&1 | grep -i -- '$motif' | tail -80"
    } else {
      Write-Host "[$c] 80 dernieres lignes" -ForegroundColor DarkGray
      & ssh @SshBase $Hote "docker logs --tail 80 '$c' 2>&1"
    }
  }

  # Les « items » de navigation. Un verbe, une salle.
  #
  # Chacune de ces lectures a ete faite a la main le 18/08/2026 en collant des
  # `node -e` de trois lignes dans un SSH. Ca marche une fois; ca ne se retient
  # pas, et une accolade oubliee rend une erreur qui ressemble a une panne.
  # Le script vit dans le depot, il est donc lisible, relisable et corrigible.
  #
  # Lecture seule: rien n'ecrit, rien ne genere, rien ne depense un credit.
  'etat' {
    $c = Get-ConteneurActif
    $salle = if ($reste.Count -gt 0) { $reste[0] } else { 'tout' }
    Write-Host "[$c] etat : $salle" -ForegroundColor DarkGray
    & ssh @SshBase $Hote "docker exec '$c' node /app/scripts/fun-items/etat.cjs '$salle'"
  }

  'voix'     { & $PSCommandPath etat voix }
  'personas' { & $PSCommandPath etat personas }
  'cout'     { & $PSCommandPath etat cout }
  'gratuit'  { & $PSCommandPath etat gratuit }
  'graphe'   { & $PSCommandPath etat graphe }

  'shell' {
    $c = Get-ConteneurActif
    # -t alloue un terminal : sans lui, aucune invite interactive ne s'affiche.
    & ssh @SshBase '-t' $Hote "docker exec -it '$c' sh"
  }

  'exec' {
    if ($reste.Count -eq 0) { throw "usage : fun exec <commande>" }
    $c = Get-ConteneurActif
    $cmd = (($reste | ForEach-Object { ConvertTo-ArgShell $_ }) -join ' ')
    # Pas de -it : sans terminal attache, la sortie se capture proprement dans un
    # pipe. `fun shell` reste interactif, c'est son role.
    & ssh @SshBase $Hote "docker exec '$c' $cmd"
  }

  default {
    # Par defaut on ouvre la CLI. Si le premier argument n'est pas un
    # sous-commande connue, on le passe a la CLI plutot que de refuser : c'est
    # ce qu'on attend d'un raccourci.
    $c = Get-ConteneurActif
    $suffixe = if ($commande -eq 'cli') { ($reste -join ' ') } else { (@($commande) + $reste) -join ' ' }
    Write-Host "[$c] CLI Funesterie" -ForegroundColor DarkGray
    & ssh @SshBase '-t' $Hote "docker exec -it '$c' node /app/cli/funesterie.cjs $suffixe"
  }
}
