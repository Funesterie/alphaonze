# New-MathOcrCurator.ps1 - classify Djeff math OCR captures into usable research lanes.
# Input is a New-MathImageOcrIndex.ps1 JSON output. Raw OCR remains local.

param(
  [string]$InputIndex = "",
  [string]$OcrRoot = "D:\agent-bus\math-ocr-index",
  [string]$OutputRoot = "D:\agent-bus\math-ocr-curation",
  [int]$MinScore = 2,
  [int]$MaxEvidenceLines = 14
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

function Get-LatestOcrIndex {
  if ($InputIndex) {
    if (-not (Test-Path -LiteralPath $InputIndex -PathType Leaf)) {
      throw "InputIndex not found: $InputIndex"
    }
    return (Resolve-Path -LiteralPath $InputIndex).Path
  }

  $latest = Get-ChildItem -LiteralPath $OcrRoot -Directory -ErrorAction Stop |
    Sort-Object Name -Descending |
    ForEach-Object { Join-Path $_.FullName "math-image-ocr-index.json" } |
    Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } |
    Select-Object -First 1

  if (-not $latest) { throw "No OCR index found under $OcrRoot" }
  return $latest
}

function Add-Score {
  param(
    [hashtable]$Scores,
    [string]$Category,
    [int]$Value,
    [string]$Reason
  )
  if (-not $Scores.ContainsKey($Category)) {
    $Scores[$Category] = [pscustomobject]@{
      category = $Category
      score = 0
      reasons = New-Object System.Collections.Generic.List[string]
    }
  }
  $Scores[$Category].score += $Value
  if ($Reason) { $Scores[$Category].reasons.Add($Reason) }
}

function Get-EvidenceLines {
  param([string]$Text, [object]$Record)
  $lines = New-Object System.Collections.Generic.List[string]

  foreach ($line in @($Record.formulaLines)) {
    $trim = ($line -replace '\s+', ' ').Trim()
    if ($trim) { $lines.Add($trim) }
  }

  foreach ($line in ($Text -split "`r?`n")) {
    $trim = ($line -replace '\s+', ' ').Trim()
    if (-not $trim) { continue }
    if ($trim -match '(?i)(hypoth|suppos|si |donc|formule|equation|equation|loi|sym|op|reson|audio|spectr|phase|log|ln|exp|racine|invers|riemann|zeta|premier|theta|mod|fail|retry|corrig|faux|manquant|stable|verif)') {
      if ($trim.Length -gt 240) { $trim = $trim.Substring(0, 240) + "..." }
      if (-not $lines.Contains($trim)) { $lines.Add($trim) }
    }
    if ($lines.Count -ge $MaxEvidenceLines) { break }
  }

  return $lines.ToArray()
}

function Get-StrongFormulaLines {
  param([object]$Record)
  $strong = New-Object System.Collections.Generic.List[string]
  foreach ($line in @($Record.formulaLines)) {
    $trim = ($line -replace '\s+', ' ').Trim()
    if (-not $trim) { continue }
    if ($trim -match '(?i)(z_?n|theta|\bR\b\s*=|r\(n\)|P\(n\)|\bM[_ ]?[ri]\b|\bM\s*[+\-]?\b|\bop\b|op_sym|sym\(|log|ln|exp|sqrt|racine|mod\s*1|\+i|-i|phi|φ|π|\b1d\b|\b2d\b|\b3d\b|\b5d\b|\b7d\b|riemann|zeta|premier)') {
      if ($trim -match '=|\bop\b|sym\(|mod|\+i|-i|φ|π') {
        $strong.Add($trim)
      }
    }
  }
  return $strong.ToArray()
}

function Get-Curation {
  param([object]$Record)

  $text = ""
  if ($Record.ocrTextFile -and (Test-Path -LiteralPath $Record.ocrTextFile -PathType Leaf)) {
    $text = Get-Content -LiteralPath $Record.ocrTextFile -Raw -Encoding UTF8
  } elseif ($Record.textPreview) {
    $text = [string]$Record.textPreview
  }

  $hay = (($Record.name + "`n" + $text) -replace '\s+', ' ').ToLowerInvariant()
  $strongFormulaLines = @(Get-StrongFormulaLines -Record $Record)
  $hasStrongFormula = $strongFormulaLines.Count -gt 0
  $hasMathVocabulary = $hay -match '(riemann|zeta|z[eê]ta|nombres? premiers?|premier|mills|spirale|logarithm|sym[eé]tr|op_sym|r[eé]sonance|rayon complexe|projection modulaire|condition globale|structure compl[eè]te|dimension|racine imaginaire)'
  $hasNoiseVocabulary = $hay -match '(snapchat|gmail|boite de reception|red hat account|download the react devtools|compte|mot de passe|devis|loyer|clope|assurance|voiture|carte graphique|rx ?580|ram |ddr|pc prix|p[aâ]te thermique|manga|bouygues|free 4g|publication de|avis de d[eé]c[eè]s)'
  $hasHardwareHz = $hay -match '(ram|ddr|carte graphique|processeur|cpu|gpu|pc).{0,60}\bhz\b'
  $scores = @{}

  if (($hasStrongFormula -or $hasMathVocabulary) -and $hay -match 'hypoth|suppos|conject|si on|imagine|principe|condition') {
    Add-Score $scores "hypothese" 2 "conditional or conjectural wording"
  }
  if ($hasStrongFormula -and $hay -match 'formule|[eé]quation|loi|th[eé]or[eè]me|donc|on obtient|r[eé]sum[eé] complet|structure compl[eè]te') {
    Add-Score $scores "formule-stable" 2 "formula or law wording"
  }
  if ($strongFormulaLines.Count -ge 2) {
    Add-Score $scores "formule-stable" 2 "multiple strong formula cues"
  }
  if (($hasStrongFormula -or $hasMathVocabulary) -and $hay -match 'corrig|correction|v[eé]rif|v[eé]rification|manquant|manquante|retry|fail|faux|erreur|avant|apr[eè]s inversion|apr[eè]s correction') {
    Add-Score $scores "correction" 2 "correction or verification wording"
  }
  if (($hasStrongFormula -or $hasMathVocabulary) -and $hay -match 'fail|retry|faux|erreur|marche pas|ne marche pas|rat[eé]|bloqu|test') {
    Add-Score $scores "fail-retry" 3 "explicit failure/retry wording"
  }
  if (-not $hasHardwareHz -and ($hasStrongFormula -or $hasMathVocabulary) -and $hay -match 'audio|spectr|fr[eé]quence|\bhz\b|phase|dephas|d[eé]phas|voix|\bson\b|harmon|vibr|fft') {
    Add-Score $scores "audio-spectral" 3 "audio or spectral wording"
  }
  if (($hasStrongFormula -or $hasMathVocabulary) -and $hay -match 'sym|symetr|sym[eé]tr|op_sym|\bop\b|croix|reson|r[eé]son|equilibr|[ée]quilibr|(-i|\+i|m[_ ]?[ri]).*(1|m)|\{i') {
    Add-Score $scores "symetrie-op" 3 "symmetry/operator/resonance wording"
  }
  if ($hay -match 'riemann|zeta|z[eê]ta|nombres? premiers?|\bpremier\b|prime|mills|spirale|logarithm|theta|mod 1') {
    Add-Score $scores "nombres-premiers" 2 "prime/Riemann/spiral wording"
  }
  if ($hay -match 'chatgpt auto|message pour nombre p|screen|photo') {
    Add-Score $scores "capture-chatgpt" 1 "ChatGPT screenshot context"
  }
  if ($hasNoiseVocabulary -and -not ($hasStrongFormula -or $hasMathVocabulary)) {
    Add-Score $scores "hors-scope-ou-bruit" 3 "non-math or UI noise"
  }

  $categories = @(
    $scores.Values |
      Where-Object { $_.score -ge $MinScore } |
      Sort-Object @{ Expression = "score"; Descending = $true }, category |
      ForEach-Object {
        [pscustomobject]@{
          category = $_.category
          score = $_.score
          reasons = @($_.reasons)
        }
      }
  )

  $primary = if ($categories.Count -gt 0) { $categories[0].category } else { "unclassified" }
  $categoryNames = @($categories | ForEach-Object { $_.category })
  $hasFailRetry = $categoryNames -contains "fail-retry"
  $hasFormulaStable = $categoryNames -contains "formule-stable"
  $hasCorrection = $categoryNames -contains "correction"
  $hasSymmetryOp = $categoryNames -contains "symetrie-op"
  $hasAudioSpectral = $categoryNames -contains "audio-spectral"
  $quality = "review"
  if ($primary -eq "hors-scope-ou-bruit") {
    $quality = "discard"
  } elseif ($hasFailRetry) {
    $quality = "retry"
  } elseif ($hasFormulaStable -and -not $hasCorrection) {
    $quality = "candidate-stable"
  } elseif ($hasSymmetryOp -or $hasAudioSpectral) {
    $quality = "candidate-module"
  }

  [pscustomobject]@{
    file = $Record.file
    name = $Record.name
    ocrTextFile = $Record.ocrTextFile
    sourceTags = @($Record.tags)
    strongFormulaLines = @($strongFormulaLines)
    primaryCategory = $primary
    categories = @($categories)
    quality = $quality
    evidenceLines = @(Get-EvidenceLines -Text $text -Record $Record)
    textPreview = (($text -replace '\s+', ' ').Trim()).Substring(0, [Math]::Min(360, (($text -replace '\s+', ' ').Trim()).Length))
  }
}

$indexPath = Get-LatestOcrIndex
$source = Get-Content -LiteralPath $indexPath -Raw -Encoding UTF8 | ConvertFrom-Json
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$outDir = Join-Path $OutputRoot $timestamp
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$records = @($source.records | ForEach-Object { Get-Curation -Record $_ })

$byCategory = @{}
foreach ($record in $records) {
  foreach ($cat in @($record.categories)) {
    if (-not $byCategory.ContainsKey($cat.category)) {
      $byCategory[$cat.category] = New-Object System.Collections.Generic.List[object]
    }
    $byCategory[$cat.category].Add($record)
  }
}

$summary = @(
  $byCategory.Keys | Sort-Object | ForEach-Object {
    [pscustomobject]@{
      category = $_
      count = $byCategory[$_].Count
    }
  }
)

$qualitySummary = @(
  $records | Group-Object quality | Sort-Object Name | ForEach-Object {
    [pscustomobject]@{ quality = $_.Name; count = $_.Count }
  }
)

$curation = [pscustomobject]@{
  schema = "funesterie.djeff-math-ocr-curation.v1"
  generatedAt = (Get-Date).ToUniversalTime().ToString("o")
  sourceIndex = $indexPath
  imageRoot = $source.imageRoot
  recordCount = $records.Count
  categorySummary = $summary
  qualitySummary = $qualitySummary
  records = $records
}

$jsonPath = Join-Path $outDir "math-ocr-curation.json"
Write-Utf8File -Path $jsonPath -Content (($curation | ConvertTo-Json -Depth 12) + "`n")

$sourceCard = [pscustomobject]@{
  schema = "funesterie.source-card.v1"
  id = "source-card:djeff-math-ocr-curation:$timestamp"
  title = "Djeff mathematical research OCR curation"
  kind = "local-curated-research-index"
  domain = "djeff-math-research"
  generatedAt = $curation.generatedAt
  sourceIndex = $indexPath
  curationJson = $jsonPath
  curationMarkdown = (Join-Path $outDir "math-ocr-curation.md")
  imageRoot = $source.imageRoot
  recordCount = $records.Count
  categories = $summary
  qualities = $qualitySummary
  routingTags = @(
    "math-ocr",
    "prime-riemann",
    "symetrie-op",
    "audio-spectral",
    "formula-curation",
    "rome-ready",
    "neo4j-source-card"
  )
  safeUse = @(
    "Use category summaries and selected evidence lines for retrieval.",
    "Do not ingest raw screenshots as truth; treat retry/fail rows as historical attempts.",
    "Promote candidate-stable rows only after mathematical review.",
    "Use candidate-module rows as inspiration for audio/Rome experiments, not as proven theorem statements."
  )
}

$sourceCardPath = Join-Path $outDir "source-card.json"
Write-Utf8File -Path $sourceCardPath -Content (($sourceCard | ConvertTo-Json -Depth 8) + "`n")

$md = New-Object System.Text.StringBuilder
[void]$md.AppendLine("# Djeff Math OCR Curation $timestamp")
[void]$md.AppendLine("")
[void]$md.AppendLine("Source index: $indexPath")
[void]$md.AppendLine("Image root: $($source.imageRoot)")
[void]$md.AppendLine("Records curated: $($records.Count)")
[void]$md.AppendLine("Source card: $sourceCardPath")
[void]$md.AppendLine("")
[void]$md.AppendLine("## Category Summary")
[void]$md.AppendLine("")
foreach ($row in $summary) {
  [void]$md.AppendLine("- $($row.category): $($row.count)")
}
[void]$md.AppendLine("")
[void]$md.AppendLine("## Quality Summary")
[void]$md.AppendLine("")
foreach ($row in $qualitySummary) {
  [void]$md.AppendLine("- $($row.quality): $($row.count)")
}
[void]$md.AppendLine("")

foreach ($category in @("formule-stable", "symetrie-op", "audio-spectral", "hypothese", "correction", "fail-retry", "nombres-premiers", "hors-scope-ou-bruit")) {
  $items = @($records | Where-Object { @($_.categories.category) -contains $category } | Sort-Object quality, name)
  if ($items.Count -eq 0) { continue }
  [void]$md.AppendLine("## $category")
  [void]$md.AppendLine("")
  foreach ($item in ($items | Select-Object -First 80)) {
    [void]$md.AppendLine("### $($item.name)")
    [void]$md.AppendLine("")
    [void]$md.AppendLine("- Quality: $($item.quality)")
    [void]$md.AppendLine("- Primary: $($item.primaryCategory)")
    [void]$md.AppendLine("- OCR: $($item.ocrTextFile)")
    if ($item.sourceTags.Count -gt 0) { [void]$md.AppendLine("- Source tags: $($item.sourceTags -join ', ')") }
    if ($item.evidenceLines.Count -gt 0) {
      [void]$md.AppendLine("- Evidence:")
      foreach ($line in ($item.evidenceLines | Select-Object -First $MaxEvidenceLines)) {
        [void]$md.AppendLine("  - $line")
      }
    }
    [void]$md.AppendLine("")
  }
}

$mdPath = Join-Path $outDir "math-ocr-curation.md"
Write-Utf8File -Path $mdPath -Content $md.ToString()

Write-Host "Math OCR curation written to: $outDir"
Write-Host "JSON: $jsonPath"
Write-Host "MD: $mdPath"
