# wip-status.ps1 — Snapshot rapide de l'état WIP Funesterie
# By Djeff / Funesterie
# Usage : .\scripts\nossen\wip-status.ps1

$ErrorActionPreference = 'Continue'
$repoRoot = "D:\projets\funesterie"

Write-Host ""
Write-Host "=== WIP STATUS FUNESTERIE $(Get-Date -Format 'yyyy-MM-dd HH:mm') ===" -ForegroundColor Cyan
Write-Host ""

# 1. Branche courante + fichiers modifiés
Set-Location $repoRoot
$branch = git rev-parse --abbrev-ref HEAD 2>$null
$statusLines = git status --short 2>$null | Where-Object { $_ -notmatch '^\?\?' }
$modified = ($statusLines | Measure-Object).Count
$untracked = (git status --short 2>$null | Where-Object { $_ -match '^\?\?' } | Measure-Object).Count

Write-Host "REPO PRINCIPAL" -ForegroundColor Yellow
Write-Host "  Branche   : $branch"
Write-Host "  Modifiés  : $modified fichiers" -ForegroundColor $(if ($modified -gt 0) { 'Red' } else { 'Green' })
Write-Host "  Untracked : $untracked fichiers"
Write-Host ""

# 2. Worktrees
$worktrees = git worktree list --porcelain 2>$null
$wtPaths = @()
$currentPath = ""
foreach ($line in $worktrees) {
  if ($line -match "^worktree (.+)") { $currentPath = $matches[1] }
  if ($line -eq "" -and $currentPath -and $currentPath -ne $repoRoot) {
    $wtPaths += $currentPath
    $currentPath = ""
  }
}

$clean = 0; $dirty = 0
foreach ($wt in $wtPaths) {
  if (Test-Path $wt) {
    $s = git -C $wt status --short 2>$null
    if ($s) { $dirty++ } else { $clean++ }
  }
}

Write-Host "WORKTREES" -ForegroundColor Yellow
Write-Host "  Total  : $($wtPaths.Count + 1) (repo principal inclus)"
Write-Host "  Sales  : $dirty" -ForegroundColor $(if ($dirty -gt 0) { 'Red' } else { 'Green' })
Write-Host "  Propres: $clean"
Write-Host ""

# 3. Branches locales avec commits non pushés
Write-Host "BRANCHES NON PUSHÉES" -ForegroundColor Yellow
$unpushed = git branch -vv 2>$null | Where-Object { $_ -notmatch '\[origin/' -and $_ -notmatch '^\*\s+HEAD' }
if ($unpushed) {
  $unpushed | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkYellow }
} else {
  Write-Host "  (aucune)" -ForegroundColor Green
}
Write-Host ""

# 4. Top 5 fichiers les plus modifiés dans le WIP
if ($modified -gt 0) {
  Write-Host "TOP FICHIERS WIP (par nb de lignes)" -ForegroundColor Yellow
  git diff --stat HEAD 2>$null |
    Where-Object { $_ -match '\|' } |
    Sort-Object { [int]($_ -replace '.*\|\s*(\d+).*', '$1') } -Descending |
    Select-Object -First 5 |
    ForEach-Object { Write-Host "  $_" }
  Write-Host ""
}

# 5. Serveurs actifs
Write-Host "SERVEURS ACTIFS" -ForegroundColor Yellow
$ports = @(3000, 3001, 5000, 5173, 8787)
foreach ($port in $ports) {
  $conn = netstat -ano 2>$null | Select-String ":$port " | Select-Object -First 1
  if ($conn) {
    $label = if ($port -eq 5000) { "  :$port  OK  XTTS/RVC voice bridge" } else { "  :$port  OK" }
    Write-Host $label -ForegroundColor Green
  } else {
    $label = if ($port -eq 5000) { "  :$port  --  XTTS/RVC voice bridge" } else { "  :$port  --" }
    Write-Host $label -ForegroundColor DarkGray
  }
}
Write-Host ""

# 6. Conseil rapide
Write-Host "PROCHAINES ÉTAPES SUGGÉRÉES" -ForegroundColor Yellow
if ($modified -gt 10) {
  Write-Host "  [!] Gros WIP - isoler en tranches (voir docs/ops/FUNESTERIE_WIP_AGRICULTURE.md)" -ForegroundColor Red
} elseif ($modified -gt 0) {
  Write-Host "  [~] WIP present - verifier si commit ou isoler en worktree" -ForegroundColor DarkYellow
} else {
  Write-Host "  [OK] Repo principal propre" -ForegroundColor Green
}
if ($dirty -gt 15) {
  Write-Host "  [!] Beaucoup de worktrees sales - faire le tour avant de creer de nouveaux" -ForegroundColor Red
}
Write-Host ""
Write-Host "Guide complet : docs/ops/FUNESTERIE_WIP_AGRICULTURE.md" -ForegroundColor DarkGray
Write-Host ""
