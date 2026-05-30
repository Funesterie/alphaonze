# nossen-agriculture.ps1 - Orchestrateur de recolte WIP Funesterie
# Transforme le chaos créatif en tranches PR publiables.
#
# Usage :
#   .\scripts\nossen\nossen-agriculture.ps1 -Topic voice
#   .\scripts\nossen\nossen-agriculture.ps1 -Topic all -DryRun
#
# Topics disponibles : voice | drive | vivy-auth | ui | research | all

param(
  [ValidateSet("voice","drive","vivy-auth","ui","research","all")]
  [string]$Topic = "all",
  [string]$RepoRoot   = "D:\projets\funesterie",
  [string]$OutputRoot = "D:\agent-bus\nossen-agriculture",
  [switch]$DryRun,
  [switch]$SkipWipRescue,
  [switch]$SkipLogicReduce,
  [switch]$SkipPrSlice
)

$ErrorActionPreference = "Stop"

function Write-Utf8File {
  param([string]$Path, [string]$Content = "")
  $dir = Split-Path -Parent $Path
  if ($dir) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  $encoding = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Content, $encoding)
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$outDir    = Join-Path $OutputRoot "$Topic-$timestamp"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$phase = 0
function Write-Phase([string]$label) {
  $script:phase++
  Write-Host ""
  Write-Host "== PHASE $($script:phase) : $label ==" -ForegroundColor Cyan
}

Set-Location $RepoRoot

# ──────────────────────────────────────────────────────────────
# Mapping topic → fichiers ciblés
# ──────────────────────────────────────────────────────────────
$topicFiles = @{
  "voice" = @(
    "a11/backend/apps/voice-module/app/main.py",
    "a11/backend/apps/voice-module/requirements.txt",
    "a11/backend/apps/server/routes/tts.cjs",
    "a11/backend/apps/server/routes/tts-api.cjs",
    "a11/backend/apps/server/src/tts/voice-reference-store.cjs",
    "a11/backend/apps/server/src/routes/vivy-studio.cjs"
  )
  "drive" = @(
    "a11/backend/apps/server/src/routes/auth.cjs",
    "a11/backend/apps/server/src/routes/chat.cjs",
    "a11/backend/apps/server/src/routes/protected-chat-proxy.cjs",
    "a11/backend/apps/server/server.cjs"
  )
  "vivy-auth" = @(
    "a11/backend/apps/server/src/routes/vivy-studio.cjs",
    "a11/backend/apps/server/src/routes/auth.cjs",
    "a11/backend/apps/server/src/chat/a11-active-identity.cjs",
    "a11/frontend/apps/web/src/App.tsx"
  )
  "ui" = @(
    "a11/frontend/apps/web/src/App.tsx",
    "a11/backend/apps/server/server.cjs"
  )
  "research" = @(
    "a11/backend/apps/server/lib/file-ingestion.cjs"
  )
  "all" = @(
    "a11/backend/apps/server/server.cjs",
    "a11/frontend/apps/web/src/App.tsx",
    "a11/backend/apps/server/routes/tts.cjs",
    "a11/backend/apps/server/src/routes/auth.cjs",
    "a11/backend/apps/server/src/routes/vivy-studio.cjs",
    "a11/backend/apps/voice-module/app/main.py"
  )
}

$selectedTopicFiles = $topicFiles[$Topic]
if (-not $selectedTopicFiles) { $selectedTopicFiles = $topicFiles["all"] }

$targetFiles = $selectedTopicFiles |
  Where-Object { Test-Path -LiteralPath (Join-Path $RepoRoot ($_ -replace '/', '\')) }

# Descriptions PR par topic
$prSliceMap = @{
  "voice"      = @{
    Branch = "feat/voice-rvc-$timestamp"
    Title  = "feat(voice): RVC models + flux prompt->chanson propre"
    Scope  = @(
      "Inventaire et placement des modeles .pth A11/K44/Vivy dans voice-module/",
      "Nettoyage UI Vivy Studio : flux saisie texte -> selection voix -> generation -> lecture inline",
      "Suppression des anciens boutons de test voix orphelins"
    )
    Guard  = @(
      "Ne pas supprimer voice-reference-store.cjs sans audit",
      "Bridge :5000 doit rester fonctionnel (XTTS teste)"
    )
  }
  "drive"      = @{
    Branch = "feat/drive-sessions-$timestamp"
    Title  = "feat(storage): Google Drive / OneDrive session connectors"
    Scope  = @(
      "OAuth Google Drive + OneDrive lie a la session utilisateur",
      "Upload blobs (TTS output, RVC, assets) vers Drive au lieu de Hetzner",
      "Backend garde metadata + droits, Drive garde les blobs",
      "Fallback local si Drive indisponible"
    )
    Guard  = @(
      "Tokens OAuth jamais en clair dans le code",
      "Pas de breaking change sur les routes upload existantes",
      "Quotas Drive respectes (streaming, pas de copies inutiles)"
    )
  }
  "vivy-auth"  = @{
    Branch = "feat/vivy-auth-gate-$timestamp"
    Title  = "feat(auth): Vivy gate - login obligatoire frontend + backend"
    Scope  = @(
      "Guard frontend sur route Vivy -> redirect /login si pas de session",
      "Middleware auth sur toutes les routes /api/vivy/*",
      "Meme pattern que A11/K44"
    )
    Guard  = @(
      "Routes publiques non touchees",
      "Reutiliser le middleware auth existant, pas de nouveau"
    )
  }
  "ui"         = @{
    Branch = "fix/ui-header-cleanup-$timestamp"
    Title  = "fix(ui): nettoyage header doublon A11/K44/Vivy"
    Scope  = @(
      "Suppression du header doublon",
      "Nettoyage composant outil voix ancien",
      "Boutons voix par defaut dans Vivy"
    )
    Guard  = @("Aucun refactor global App.tsx, changements ciblés uniquement")
  }
  "research"   = @{
    Branch = "feat/research-agriculture-$timestamp"
    Title  = "feat(research): pipeline OCR Tesseract + semantic cards Djeff"
    Scope  = @(
      "Index OCR images math Djeff-recherche complet",
      "Curator -> Research Cards -> Neo4j source cards",
      "Commande unique : New-MathImageOcrIndex + Curator + Cards"
    )
    Guard  = @("Pas d'upload d'images en clair vers cloud", "Index local uniquement")
  }
  "all"        = @{
    Branch = "chore/nossen-agriculture-$timestamp"
    Title  = "chore: recolte WIP complete - snapshot + audit + semantic"
    Scope  = @("Audit global WIP", "Semantic index tous fichiers modifiés", "Rapport katana + allmight")
    Guard  = @("Lecture seule, aucun commit auto")
  }
}

# ──────────────────────────────────────────────────────────────
# PHASE 1 : WIP Radar
# ──────────────────────────────────────────────────────────────
Write-Phase "WIP RADAR"

$wipStatusScript = Join-Path $RepoRoot "scripts\nossen\wip-status.ps1"
if (Test-Path -LiteralPath $wipStatusScript) {
  if (-not $DryRun) {
    & powershell -NoProfile -ExecutionPolicy Bypass -File $wipStatusScript 2>&1 |
      Tee-Object -FilePath (Join-Path $outDir "wip-radar.txt")
  } else {
    Write-Host "  [DryRun] wip-status.ps1 skipped"
  }
} else {
  Write-Host "  [WARN] wip-status.ps1 not found" -ForegroundColor Yellow
}

# ──────────────────────────────────────────────────────────────
# PHASE 2 : WIP Rescue (snapshot + katana + allmight + semantic)
# ──────────────────────────────────────────────────────────────
Write-Phase "WIP RESCUE (snapshot + katana + allmight)"

$wipRescueScript = Join-Path $RepoRoot "scripts\nossen\wip-rescue.ps1"
$rescueOut = Join-Path $outDir "rescue"

if ($SkipWipRescue) {
  Write-Host "  [Skip] -SkipWipRescue actif"
} elseif (-not (Test-Path -LiteralPath $wipRescueScript)) {
  Write-Host "  [WARN] wip-rescue.ps1 not found" -ForegroundColor Yellow
} elseif ($DryRun) {
    Write-Host "  [DryRun] wip-rescue.ps1 skipped - ciblerait : $($targetFiles -join ', ')"
} else {
  $rescueArgs = @(
    "-NoProfile", "-ExecutionPolicy", "Bypass",
    "-File", $wipRescueScript,
    "-RepoRoot", $RepoRoot,
    "-OutputRoot", $rescueOut,
    "-SkipMathOcrCuration", "-SkipMathResearchCards"
  )
  # Pour research, inclure le pipeline OCR
  if ($Topic -in @("research","all")) {
    $rescueArgs = $rescueArgs | Where-Object { $_ -notin @("-SkipMathOcrCuration","-SkipMathResearchCards") }
  }
  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  $rescueOutput = & powershell @rescueArgs 2>&1
  $rescueExit = $LASTEXITCODE
  $ErrorActionPreference = $previousErrorActionPreference
  $rescueOutput | Out-File -Encoding utf8 -FilePath (Join-Path $outDir "rescue.log")
  if ($rescueExit -ne 0) {
    Write-Host "  [WARN] wip-rescue exit code: $rescueExit (see rescue.log)" -ForegroundColor Yellow
  }
  Write-Host "  Rescue -> $rescueOut"
}

# ──────────────────────────────────────────────────────────────
# PHASE 3 : Logic-Reduce (docs/briefs -> actions executables)
# ──────────────────────────────────────────────────────────────
Write-Phase "LOGIC-REDUCE (briefs -> actions)"

if ($SkipLogicReduce) {
  Write-Host "  [Skip] -SkipLogicReduce actif"
} else {
  $actionLines = [System.Collections.Generic.List[string]]::new()
  $docRoots = @("docs/ops", "docs", ".kiro")

  foreach ($docDir in $docRoots) {
    $absDir = Join-Path $RepoRoot $docDir
    if (-not (Test-Path -LiteralPath $absDir)) { continue }
    Get-ChildItem -LiteralPath $absDir -Recurse -Include "*.md","*.txt" -ErrorAction SilentlyContinue |
      Where-Object { $_.Length -lt 200KB } |
      ForEach-Object {
        $lines = Get-Content -LiteralPath $_.FullName -Encoding utf8 -ErrorAction SilentlyContinue
        $lines | Where-Object {
          ($_ -match '^\s*[-*]\s+\[.\]') -or   # checklist markdown
          ($_ -match '(?i)\bTODO\b|\bFIXME\b|\bRESTE\b|\bA FAIRE\b|\bWIP\b') -or
          ($_ -match '(?i)\bProchain\b|\bNext\b|\bA connecter\b|\bManquant\b')
        } | ForEach-Object { $actionLines.Add("[$($_.Name)]: $_") }
      }
  }

  # Filtre topic si pas "all"
  if ($Topic -ne "all") {
    $topicKeywords = @{
      "voice"     = @("voix","voice","tts","rvc","pth","xtts","vivy studio","chanson","song")
      "drive"     = @("drive","onedrive","google drive","blob","storage","upload","hetzner")
      "vivy-auth" = @("vivy","auth","login","gate","session","protég")
      "ui"        = @("header","doublon","bouton","composant","ui","frontend")
      "research"  = @("ocr","tesseract","math","djeff","recherche","carte","card")
    }
    $kw = $topicKeywords[$Topic]
    if ($kw) {
      $actionLines = [System.Collections.Generic.List[string]]($actionLines | Where-Object {
        $line = $_.ToLower()
        $kw | Where-Object { $line -contains $_ } | Select-Object -First 1
      })
    }
  }

  $reduceOut = Join-Path $outDir "logic-reduce-actions.md"
  $reduceContent = @"
# Logic-Reduce - Actions extraites ($Topic) $timestamp

Fichiers scannes : docs/ops/, docs/, .kiro/
Filtre topic : $Topic
Lignes trouvees : $($actionLines.Count)

$(if ($actionLines.Count -gt 0) {
  ($actionLines | Select-Object -First 60) -join "`n"
} else {
  "(aucune action identifiee dans les docs - verifier docs/ops/)"
})
"@
  Write-Utf8File -Path $reduceOut -Content $reduceContent
  Write-Host "  $($actionLines.Count) actions extraites -> $reduceOut"
}

# ──────────────────────────────────────────────────────────────
# PHASE 4 : Proposition de tranche PR
# ──────────────────────────────────────────────────────────────
Write-Phase "PR SLICE PROPOSAL"

if ($SkipPrSlice) {
  Write-Host "  [Skip] -SkipPrSlice actif"
} else {
  $slice = $prSliceMap[$Topic]
  $topicFilesList = if ($targetFiles.Count -gt 0) {
    ($targetFiles | ForEach-Object { "- $_" }) -join "`n"
  } else { "- (aucun fichier trouvé pour ce topic)" }

  $scopeList  = ($slice.Scope  | ForEach-Object { "- $_" }) -join "`n"
  $guardList  = ($slice.Guard  | ForEach-Object { "- [ ] $_" }) -join "`n"

  $sliceContent = @"
# PR Slice Proposal - $Topic ($timestamp)

## Branche suggeree
``$($slice.Branch)``

## Titre PR
$($slice.Title)

## Perimetre
$scopeList

## Fichiers cibles
$topicFilesList

## Gardes de securite avant merge
$guardList

## Commande pour creer le worktree
``````powershell
git worktree add ..\worktrees\$Topic $($slice.Branch) -b $($slice.Branch)
``````

## Prochaine etape
1. Creer le worktree
2. Relancer : ``.\scripts\nossen\nossen-agriculture.ps1 -Topic $Topic -SkipPrSlice``
3. Appliquer le patch Codex si disponible
4. Tests + commit
"@
  $sliceFile = Join-Path $outDir "pr-slice-proposal.md"
  Write-Utf8File -Path $sliceFile -Content $sliceContent
  Write-Host "  Tranche PR -> $sliceFile"
  Write-Host ""
  Write-Host "  Branche : $($slice.Branch)" -ForegroundColor Green
  Write-Host "  Titre   : $($slice.Title)"  -ForegroundColor Green
}

# --------------------------------------------------------------
# Resume final
# --------------------------------------------------------------
Write-Host ""
Write-Host "=======================================================" -ForegroundColor Cyan
Write-Host " NOSSEN AGRICULTURE - $Topic - $timestamp" -ForegroundColor Cyan
Write-Host " Output : $outDir" -ForegroundColor Cyan
Write-Host "=======================================================" -ForegroundColor Cyan
Write-Host ""
