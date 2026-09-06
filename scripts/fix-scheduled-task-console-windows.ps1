<#
.SYNOPSIS
  Supprime les fenetres de console qui apparaissent toutes les 5 min (et toutes les
  45 min) a cause des taches planifiees Funesterie.

.DESCRIPTION
  Cause : les taches \Funesterie-WatchAgentBusPresence (PT5M, pwsh.exe) et
  \Funesterie-MCP-Token (PT45M, node.exe) ont LogonType = Interactive. Une tache
  interactive lance son processus DANS la session de l'utilisateur, donc Windows
  cree un conhost visible. Les deux taches fonctionnent (LastTaskResult = 0) :
  il ne faut pas les desactiver, juste les rendre silencieuses.

  Correctif : passer le principal en S4U ("executer meme si l'utilisateur n'est pas
  connecte"). La tache tourne alors hors session interactive, donc aucune fenetre.
  S4U ne stocke aucun mot de passe et n'eleve aucun privilege : RunLevel reste
  Limited et le compte reste le meme.

  Pourquoi pas -WindowStyle Hidden : ca ne marcherait que pour pwsh, pas pour
  node.exe, et la fenetre clignote quand meme brievement.

  Les taches vivent dans le dossier racine du planificateur : leur modification
  exige une elevation. Ce script se relance donc lui-meme en administrateur.

.NOTES
  Sauvegardes XML : D:\projets\funesterie\codex-backups\scheduled-tasks-20260810\
  Pour revenir en arriere :
    schtasks /Delete /TN "Funesterie-WatchAgentBusPresence" /F
    schtasks /Create /XML "<sauvegarde>\Funesterie-WatchAgentBusPresence.xml" `
             /TN "Funesterie-WatchAgentBusPresence"
#>
[CmdletBinding()]
param(
  [string[]]$TaskNames = @("Funesterie-WatchAgentBusPresence", "Funesterie-MCP-Token"),
  [string]$BackupDir = "D:\projets\funesterie\codex-backups\scheduled-tasks-20260810",
  [switch]$Revert
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Test-Admin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  (New-Object Security.Principal.WindowsPrincipal($id)).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-Admin)) {
  Write-Host "Elevation necessaire (les taches sont dans le dossier racine)." -ForegroundColor Yellow
  Write-Host "Une invite UAC va s'ouvrir : accepte, et la fenetre fera le travail." -ForegroundColor Yellow
  $host_exe = (Get-Process -Id $PID).Path
  $args = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $PSCommandPath)
  if ($Revert) { $args += "-Revert" }
  # -NoExit pour que tu puisses lire le resultat avant que la fenetre se ferme
  Start-Process -FilePath $host_exe -Verb RunAs -ArgumentList (@("-NoExit") + $args)
  return
}

Write-Host ""
Write-Host "=== Taches planifiees Funesterie : suppression des fenetres de console ===" -ForegroundColor Cyan
Write-Host ""

New-Item -ItemType Directory -Force $BackupDir | Out-Null

$cible = if ($Revert) { "Interactive" } else { "S4U" }
$resultats = @()

foreach ($n in $TaskNames) {
  $t = Get-ScheduledTask -TaskName $n -ErrorAction SilentlyContinue
  if (-not $t) {
    Write-Host ("  {0,-34} INTROUVABLE, ignoree" -f $n) -ForegroundColor DarkYellow
    continue
  }

  $avant = $t.Principal.LogonType

  # sauvegarde systematique avant toute modification
  $xmlPath = Join-Path $BackupDir ("{0}.xml" -f $n)
  if (-not (Test-Path $xmlPath)) {
    Set-Content -Path $xmlPath -Value (Export-ScheduledTask -TaskName $n) -Encoding UTF8
  }

  if ($avant -eq $cible) {
    Write-Host ("  {0,-34} deja en {1}, rien a faire" -f $n, $cible) -ForegroundColor DarkGray
    $resultats += [PSCustomObject]@{ Tache = $n; Avant = $avant; Apres = $avant; Resultat = "inchangee" }
    continue
  }

  try {
    $p = New-ScheduledTaskPrincipal -UserId $t.Principal.UserId -LogonType $cible -RunLevel Limited
    Set-ScheduledTask -TaskName $n -Principal $p -ErrorAction Stop | Out-Null
    $apres = (Get-ScheduledTask -TaskName $n).Principal.LogonType
    $couleur = if ($apres -eq $cible) { "Green" } else { "Red" }
    Write-Host ("  {0,-34} {1} -> {2}" -f $n, $avant, $apres) -ForegroundColor $couleur
    $resultats += [PSCustomObject]@{ Tache = $n; Avant = $avant; Apres = $apres; Resultat = "modifiee" }
  }
  catch {
    Write-Host ("  {0,-34} ECHEC : {1}" -f $n, $_.Exception.Message) -ForegroundColor Red
    $resultats += [PSCustomObject]@{ Tache = $n; Avant = $avant; Apres = $avant; Resultat = "echec" }
  }
}

# --- verification fonctionnelle : la tache doit encore reussir apres le changement
Write-Host ""
Write-Host "Verification : lancement immediat de chaque tache modifiee..." -ForegroundColor Cyan
foreach ($r in ($resultats | Where-Object { $_.Resultat -eq "modifiee" })) {
  try {
    Start-ScheduledTask -TaskName $r.Tache
    Start-Sleep -Seconds 6
    $info = Get-ScheduledTaskInfo -TaskName $r.Tache
    $code = $info.LastTaskResult
    $txt = if ($code -eq 0) { "OK (code 0)" } else { "code $code, a examiner" }
    $col = if ($code -eq 0) { "Green" } else { "Yellow" }
    Write-Host ("  {0,-34} {1}   dernier lancement {2}" -f $r.Tache, $txt, $info.LastRunTime) -ForegroundColor $col
  }
  catch {
    Write-Host ("  {0,-34} lancement impossible : {1}" -f $r.Tache, $_.Exception.Message) -ForegroundColor Red
  }
}

Write-Host ""
Write-Host "Sauvegardes XML : $BackupDir" -ForegroundColor DarkGray
Write-Host "Pour revenir en arriere : relance ce script avec -Revert" -ForegroundColor DarkGray
Write-Host ""
Write-Host "Plus aucune fenetre ne doit apparaitre. La prochaine echeance de la" -ForegroundColor Cyan
Write-Host "sentinelle est dans moins de 5 minutes : si rien ne s'ouvre, c'est regle." -ForegroundColor Cyan
Write-Host ""
