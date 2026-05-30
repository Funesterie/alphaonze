# wip-rescue.ps1 - Secret-safe WIP rescue and audit bundle for Funesterie
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\nossen\wip-rescue.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\nossen\wip-rescue.ps1 -IncludeTrackedPatch

param(
  [string]$RepoRoot = "D:\projets\funesterie",
  [string]$OutputRoot = "D:\agent-bus\wip-rescue",
  [switch]$IncludeTrackedPatch,
  [switch]$SkipSemanticIndex,
  [switch]$SkipMathOcrCuration,
  [switch]$SkipMathResearchCards,
  [string]$MathOcrIndex = "",
  [string]$MathOcrCuration = "",
  [int]$KatanaTop = 16
)

$ErrorActionPreference = "Stop"

function Write-Utf8File {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Content
  )
  $dir = Split-Path -Parent $Path
  if ($dir) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  [System.IO.File]::WriteAllText($Path, $Content, [System.Text.UTF8Encoding]::new($false))
}

function Invoke-TextCommand {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [Parameter(Mandatory = $true)][string[]]$Arguments,
    [Parameter(Mandatory = $true)][string]$OutFile,
    [string]$WorkingDirectory = $RepoRoot
  )
  $psi = [System.Diagnostics.ProcessStartInfo]::new()
  $psi.FileName = $FilePath
  foreach ($arg in $Arguments) { [void]$psi.ArgumentList.Add($arg) }
  $psi.WorkingDirectory = $WorkingDirectory
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.UseShellExecute = $false
  $p = [System.Diagnostics.Process]::Start($psi)
  $stdout = $p.StandardOutput.ReadToEnd()
  $stderr = $p.StandardError.ReadToEnd()
  $p.WaitForExit()
  Write-Utf8File -Path $OutFile -Content ($stdout + $(if ($stderr) { "`n--- STDERR ---`n$stderr" } else { "" }))
  return $p.ExitCode
}

function Resolve-NossenTool {
  param([Parameter(Mandatory = $true)][string]$RelativePath)
  $candidates = @(
    (Join-Path $RepoRoot $RelativePath),
    (Join-Path "D:\agent-bus\nossen-all-in-one\node_modules\@nossen" ($RelativePath -replace '^runtime\\modules\\', ''))
  )
  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate) { return (Resolve-Path -LiteralPath $candidate).Path }
  }
  return ""
}

if (-not (Test-Path -LiteralPath $RepoRoot)) {
  throw "RepoRoot not found: $RepoRoot"
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$outDir = Join-Path $OutputRoot $timestamp
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

Set-Location $RepoRoot

$status = git status --short
$trackedStatus = $status | Where-Object { $_ -notmatch '^\?\?' }
$untrackedStatus = $status | Where-Object { $_ -match '^\?\?' }
$branch = (git rev-parse --abbrev-ref HEAD 2>$null)
$head = (git rev-parse HEAD 2>$null)

Write-Utf8File -Path (Join-Path $outDir "git-status-short.txt") -Content (($status -join "`n") + "`n")
Write-Utf8File -Path (Join-Path $outDir "git-untracked-list.txt") -Content (($untrackedStatus -join "`n") + "`n")
git diff --stat HEAD | Out-File -Encoding utf8 -FilePath (Join-Path $outDir "git-diff-stat.txt")
git worktree list --porcelain | Out-File -Encoding utf8 -FilePath (Join-Path $outDir "git-worktrees.txt")
git branch -vv | Out-File -Encoding utf8 -FilePath (Join-Path $outDir "git-branches-vv.txt")

if ($IncludeTrackedPatch) {
  git diff --binary HEAD | Out-File -Encoding utf8 -FilePath (Join-Path $outDir "tracked-wip.patch")
}

$katanaBin = Resolve-NossenTool "runtime\modules\katana\bin\katana.cjs"
if (-not $katanaBin) {
  $katanaBin = "D:\agent-bus\nossen-all-in-one\node_modules\@nossen\katana\bin\katana.cjs"
}

$katanaTargets = @(
  "a11\backend\apps\server\server.cjs",
  "a11\frontend\apps\web\src\App.tsx"
) | Where-Object { Test-Path -LiteralPath (Join-Path $RepoRoot $_) }

foreach ($target in $katanaTargets) {
  $safeName = ($target -replace '[\\/:*?"<>|]', '_')
  $jsonOut = Join-Path $outDir "katana-$safeName.json"
  $mdOut = Join-Path $outDir "katana-$safeName.md"
  if (Test-Path -LiteralPath $katanaBin) {
    & node $katanaBin scan $target --root $RepoRoot --top $KatanaTop --json $jsonOut --md $mdOut | Out-File -Encoding utf8 -FilePath (Join-Path $outDir "katana-$safeName.log")
  }
}

$allmightBin = "D:\agent-bus\nossen-all-in-one\node_modules\@nossen\allmight\dist\cli\index.js"
$allmightOut = Join-Path $outDir "allmight-web-server"
if (Test-Path -LiteralPath $allmightBin) {
  & node $allmightBin scan "a11\frontend\apps\web\src" `
    --output $allmightOut `
    --ignore-dir node_modules `
    --ignore-dir dist `
    --ignore-dir logs `
    --ignore-path runtime `
    --ignore-ext map | Out-File -Encoding utf8 -FilePath (Join-Path $outDir "allmight-web-src.log")
}

$semanticScript = Join-Path $RepoRoot "scripts\nossen\New-SemanticFileIndex.ps1"
$semanticOut = Join-Path $outDir "semantic-index"
if (-not $SkipSemanticIndex -and (Test-Path -LiteralPath $semanticScript)) {
  $semanticTargets = @()
  $semanticTargets += $trackedStatus | ForEach-Object {
    $raw = $_.Substring(3).Trim()
    if ($raw -match ' -> ') { $raw = ($raw -split ' -> ')[-1] }
    $raw
  }
  $semanticTargets += @(
    "a11\backend\apps\server\routes\tts.cjs",
    "a11\backend\apps\server\server.cjs",
    "a11\backend\apps\voice-module\app\main.py",
    "a11\frontend\apps\web\src\App.tsx",
    "a11\frontend\apps\web\src\lib\api.ts"
  )
  $semanticTargets = $semanticTargets |
    Where-Object { $_ -and (Test-Path -LiteralPath (Join-Path $RepoRoot $_) -PathType Leaf) } |
    Sort-Object -Unique

  $semanticTargetList = Join-Path $outDir "semantic-targets.txt"
  Write-Utf8File -Path $semanticTargetList -Content (($semanticTargets -join "`n") + "`n")

  & powershell -NoProfile -ExecutionPolicy Bypass -File $semanticScript `
    -RepoRoot $RepoRoot `
    -OutputDir $semanticOut `
    -PathListFile $semanticTargetList | Out-File -Encoding utf8 -FilePath (Join-Path $outDir "semantic-index.log")
}

$mathCuratorScript = Join-Path $RepoRoot "scripts\nossen\New-MathOcrCurator.ps1"
$mathCuratorOut = Join-Path $outDir "math-ocr-curation"
if (-not $SkipMathOcrCuration -and (Test-Path -LiteralPath $mathCuratorScript)) {
  $args = @(
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    $mathCuratorScript,
    "-OutputRoot",
    $mathCuratorOut
  )
  if ($MathOcrIndex) {
    $args += @("-InputIndex", $MathOcrIndex)
  }
  & powershell @args | Out-File -Encoding utf8 -FilePath (Join-Path $outDir "math-ocr-curation.log")
}

$mathCardsScript = Join-Path $RepoRoot "scripts\nossen\New-MathResearchCards.ps1"
$mathCardsOut = Join-Path $outDir "math-research-cards"
if (-not $SkipMathResearchCards -and (Test-Path -LiteralPath $mathCardsScript)) {
  $args = @(
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    $mathCardsScript,
    "-OutputRoot",
    $mathCardsOut
  )
  if ($MathOcrCuration) {
    $args += @("-InputCuration", $MathOcrCuration)
  } elseif (-not $SkipMathOcrCuration) {
    $curationJson = Get-ChildItem -LiteralPath $mathCuratorOut -Recurse -Filter "math-ocr-curation.json" -ErrorAction SilentlyContinue |
      Sort-Object LastWriteTime -Descending |
      Select-Object -First 1
    if ($curationJson) {
      $args += @("-InputCuration", $curationJson.FullName)
    }
  }
  & powershell @args | Out-File -Encoding utf8 -FilePath (Join-Path $outDir "math-research-cards.log")
}

$summary = @"
# Funesterie WIP Rescue $timestamp

Repo: $RepoRoot
Branch: $branch
HEAD: $head

Tracked WIP entries: $($trackedStatus.Count)
Untracked entries: $($untrackedStatus.Count)
Tracked patch included: $($IncludeTrackedPatch.IsPresent)

Artifacts:
- git-status-short.txt
- git-untracked-list.txt
- git-diff-stat.txt
- git-worktrees.txt
- git-branches-vv.txt
- katana-*.md/json for extraction suggestions
- allmight-web-server/ duplicate/canonicalization reports
- semantic-index/*/semantic-index.md/json for internal anchors and tags
- math-ocr-curation/*/math-ocr-curation.md/json for Djeff math research lanes
- math-research-cards/*/math-research-cards.md/json for short reviewable math/audio/Rome candidates

Notes:
- This script does not reset, checkout, stash, commit, or push.
- It avoids copying untracked file contents by default.
- Use -IncludeTrackedPatch only when the local bundle is staying private.
- Use -SkipMathOcrCuration when the latest OCR corpus does not need reclassification.
- Use -SkipMathResearchCards when no candidate deck is needed.
"@

Write-Utf8File -Path (Join-Path $outDir "README.md") -Content $summary
Write-Host "WIP rescue written to: $outDir"
