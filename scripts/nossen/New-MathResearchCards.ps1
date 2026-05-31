# New-MathResearchCards.ps1 - promote curated OCR rows into small reviewable research cards.
# This does not validate mathematics; it creates a triage deck for later audio/Rome experiments.

param(
  [string]$InputCuration = "",
  [string]$CurationRoot = "D:\agent-bus\math-ocr-curation",
  [string]$OutputRoot = "D:\agent-bus\math-research-cards",
  [int]$TopPerLane = 12,
  [int]$MaxEvidenceLines = 10
)

$ErrorActionPreference = "Stop"

function Write-Utf8File {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [string]$Content = ""
  )
  $dir = Split-Path -Parent $Path
  if ($dir) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  [System.IO.File]::WriteAllText($Path, $Content, [System.Text.UTF8Encoding]::new($false))
}

function Get-LatestCuration {
  if ($InputCuration) {
    if (-not (Test-Path -LiteralPath $InputCuration -PathType Leaf)) {
      throw "InputCuration not found: $InputCuration"
    }
    return (Resolve-Path -LiteralPath $InputCuration).Path
  }

  $latest = Get-ChildItem -LiteralPath $CurationRoot -Directory -ErrorAction Stop |
    Sort-Object Name -Descending |
    ForEach-Object { Join-Path $_.FullName "math-ocr-curation.json" } |
    Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } |
    Select-Object -First 1

  if (-not $latest) { throw "No curation JSON found under $CurationRoot" }
  return $latest
}

function Convert-ToArray {
  param($Value)
  if ($null -eq $Value) { return @() }
  if ($Value -is [System.Array]) { return @($Value) }
  return @($Value)
}

function Get-QualityRank {
  param([string]$Quality)
  switch ($Quality) {
    "candidate-module" { return 0 }
    "candidate-stable" { return 1 }
    "review" { return 2 }
    "retry" { return 3 }
    "discard" { return 9 }
    default { return 5 }
  }
}

function Get-LaneScore {
  param($Record, [string]$Lane)
  $score = 0
  foreach ($cat in (Convert-ToArray $Record.categories)) {
    if ($cat.category -eq $Lane) { $score += [int]$cat.score }
  }
  if ($Record.primaryCategory -eq $Lane) { $score += 3 }
  if ((Convert-ToArray $Record.sourceTags) -contains $Lane) { $score += 2 }
  $score += (Convert-ToArray $Record.strongFormulaLines).Count
  $score += [Math]::Min((Convert-ToArray $Record.evidenceLines).Count, 6)
  switch ($Record.quality) {
    "candidate-module" { $score += 5 }
    "candidate-stable" { $score += 4 }
    "review" { $score += 1 }
    "retry" { $score -= 3 }
    "discard" { $score -= 20 }
  }
  return $score
}

function Get-MathSignalScore {
  param($Record)
  $text = @(
    $Record.textPreview
    (Convert-ToArray $Record.evidenceLines)
    (Convert-ToArray $Record.strongFormulaLines)
  ) -join "`n"

  $score = 0
  $patterns = @(
    '[=≈∝√∆θφπζ]',
    '\blog\b|\bln\b|\bexp\b|\bmod\b|\bsym\b|\bop_?sym\b|\bresonance|résonance',
    '\bD[13578]\b|\bM[ri]\b|\bM[+-]\b|[+-]iM|[+-]i\b',
    'premier|nombres? premiers?|riemann|zeta|zêta|spectral|audio|spirale',
    '\bP\(n\)|\bz_n\b|\btheta\b|\bphi\b'
  )
  foreach ($pattern in $patterns) {
    if ($text -match $pattern) { $score++ }
  }
  $score += [Math]::Min((Convert-ToArray $Record.strongFormulaLines).Count, 4)
  return $score
}

function Test-ObviousNoise {
  param($Record)
  $text = @(
    $Record.textPreview
    (Convert-ToArray $Record.evidenceLines)
    (Convert-ToArray $Record.strongFormulaLines)
  ) -join "`n"
  return ($text -match 'UNSC|SPARTAN|carte graphique|p[aâ]te thermique|Bouygues|Snapchat|boite je passe|Pc prix/perf')
}

function New-Card {
  param($Record, [string]$Lane, [int]$Rank, [int]$LaneScore)

  $evidence = Convert-ToArray $Record.evidenceLines |
    Where-Object { $_ -and $_.Trim() } |
    Select-Object -First $MaxEvidenceLines

  $formulaLines = Convert-ToArray $Record.strongFormulaLines |
    Where-Object { $_ -and $_.Trim() } |
    Select-Object -First $MaxEvidenceLines

  [pscustomobject]@{
    id = "math-card:${Lane}:${Rank}:$($Record.name)"
    lane = $Lane
    rank = $Rank
    score = $LaneScore
    quality = $Record.quality
    primaryCategory = $Record.primaryCategory
    file = $Record.file
    name = $Record.name
    ocrTextFile = $Record.ocrTextFile
    sourceTags = @(Convert-ToArray $Record.sourceTags)
    evidenceLines = @($evidence)
    formulaLines = @($formulaLines)
    reviewStatus = if ($Record.quality -eq "retry" -or $Record.quality -eq "discard") { "historical-attempt" } else { "needs-human-math-review" }
    suggestedUse = switch ($Lane) {
      "audio-spectral" { "Audio experiment seed: translate formula rhythm/phase ideas into a DSP sketch, not a proof." }
      "symetrie-op" { "Algebra experiment seed: formalize op_sym/op balance rules and check closure tables." }
      "nombres-premiers" { "Prime-number experiment seed: compare against known prime/ring/spiral baselines." }
      "formule-stable" { "Candidate formula: rewrite cleanly, unit-test numerically, then classify as model or dead end." }
      "correction" { "Correction trail: inspect before promoting any related formula." }
      "hypothese" { "Hypothesis: preserve wording, derive falsifiable checks." }
      default { "Review only." }
    }
  }
}

$inputPath = Get-LatestCuration
$curation = Get-Content -LiteralPath $inputPath -Raw | ConvertFrom-Json
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$outDir = Join-Path $OutputRoot $stamp
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$lanes = @(
  "symetrie-op",
  "audio-spectral",
  "formule-stable",
  "nombres-premiers",
  "hypothese",
  "correction"
)

$cards = @()
foreach ($lane in $lanes) {
  $rank = 0
  $selected = Convert-ToArray $curation.records |
    Where-Object {
      $mathSignal = Get-MathSignalScore $_
      $_.quality -ne "discard" -and (
        $_.primaryCategory -eq $lane -or
        ((Convert-ToArray $_.categories | Where-Object { $_.category -eq $lane }).Count -gt 0) -or
        ((Convert-ToArray $_.sourceTags) -contains $lane)
      ) -and
      $mathSignal -ge 3 -and
      -not (Test-ObviousNoise $_)
    } |
    ForEach-Object {
      $score = Get-LaneScore -Record $_ -Lane $lane
      [pscustomobject]@{ record = $_; score = $score; qualityRank = Get-QualityRank $_.quality }
    } |
    Sort-Object @{ Expression = "qualityRank"; Ascending = $true }, @{ Expression = "score"; Descending = $true }, @{ Expression = { $_.record.name }; Ascending = $true } |
    Select-Object -First $TopPerLane

  foreach ($item in $selected) {
    $rank++
    $cards += New-Card -Record $item.record -Lane $lane -Rank $rank -LaneScore $item.score
  }
}

$deck = [pscustomobject]@{
  schema = "funesterie.djeff-math-research-cards.v1"
  generatedAt = (Get-Date).ToUniversalTime().ToString("o")
  sourceCuration = $inputPath
  outputRoot = $outDir
  topPerLane = $TopPerLane
  lanes = $lanes
  cardCount = $cards.Count
  cards = $cards
}

$jsonPath = Join-Path $outDir "math-research-cards.json"
$mdPath = Join-Path $outDir "math-research-cards.md"
$sourceCardPath = Join-Path $outDir "source-card.json"

Write-Utf8File -Path $jsonPath -Content ($deck | ConvertTo-Json -Depth 12)

$md = New-Object System.Text.StringBuilder
[void]$md.AppendLine("# Djeff Math Research Cards $stamp")
[void]$md.AppendLine("")
[void]$md.AppendLine("Source curation: $inputPath")
[void]$md.AppendLine("Cards: $($cards.Count)")
[void]$md.AppendLine("")
[void]$md.AppendLine("Rule: these cards are triage material. They are not proofs; retry/fail history stays visible.")
[void]$md.AppendLine("")

foreach ($lane in $lanes) {
  [void]$md.AppendLine("## $lane")
  [void]$md.AppendLine("")
  foreach ($card in ($cards | Where-Object { $_.lane -eq $lane } | Sort-Object rank)) {
    [void]$md.AppendLine("### $($card.rank). $($card.name)")
    [void]$md.AppendLine("")
    [void]$md.AppendLine("- Quality: $($card.quality)")
    [void]$md.AppendLine("- Score: $($card.score)")
    [void]$md.AppendLine("- Status: $($card.reviewStatus)")
    [void]$md.AppendLine("- File: $($card.file)")
    [void]$md.AppendLine("- OCR: $($card.ocrTextFile)")
    [void]$md.AppendLine("- Suggested use: $($card.suggestedUse)")
    if ($card.formulaLines.Count -gt 0) {
      [void]$md.AppendLine("- Formula lines:")
      foreach ($line in $card.formulaLines) { [void]$md.AppendLine("  - $line") }
    }
    if ($card.evidenceLines.Count -gt 0) {
      [void]$md.AppendLine("- Evidence:")
      foreach ($line in $card.evidenceLines) { [void]$md.AppendLine("  - $line") }
    }
    [void]$md.AppendLine("")
  }
}

Write-Utf8File -Path $mdPath -Content $md.ToString()

$sourceCard = [pscustomobject]@{
  schema = "funesterie.source-card.v1"
  id = "source-card:djeff-math-research-cards:$stamp"
  title = "Djeff math research candidate cards"
  kind = "local-curated-research-card-deck"
  domain = "djeff-math-research"
  generatedAt = (Get-Date).ToUniversalTime().ToString("o")
  sourceCuration = $inputPath
  cardsJson = $jsonPath
  cardsMarkdown = $mdPath
  outputRoot = $outDir
  cardCount = $cards.Count
  lanes = $lanes
  routingTags = @("math-research-cards", "symetrie-op", "audio-spectral", "rome-ready", "module-candidates")
  safeUse = @(
    "Use as a human-review deck before coding math/audio behavior.",
    "Candidate-module cards may inspire prototypes but do not prove mathematical claims.",
    "Keep raw OCR local; promote only reviewed formulas into runtime modules."
  )
}
Write-Utf8File -Path $sourceCardPath -Content ($sourceCard | ConvertTo-Json -Depth 8)

[pscustomobject]@{
  ok = $true
  input = $inputPath
  outputDir = $outDir
  cardsJson = $jsonPath
  cardsMarkdown = $mdPath
  sourceCard = $sourceCardPath
  cardCount = $cards.Count
} | ConvertTo-Json -Depth 6
