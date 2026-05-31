param(
  [string]$InventoryPath = "D:\projets\funesterie\.codex-tmp\prime-spiral-image-inventory.json",
  [string]$OcrRoot = "D:\projets\funesterie\.codex-tmp\prime-spiral-ocr",
  [string]$OutputPath = "D:\projets\funesterie\.codex-tmp\prime-spiral-tags.json"
)

$ErrorActionPreference = "Stop"

function Read-JsonFile($path) {
  if (-not (Test-Path -LiteralPath $path)) {
    return $null
  }
  return Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
}

function Get-Maturity($text, $path) {
  $hay = (($text + " " + $path) -as [string]).ToLowerInvariant()
  if ($hay -match "\bfail\b|faux|erreur|pas bon|cass|incorrect") { return "fail" }
  if ($hay -match "corrig|retry|recommence|nouvelle version|manquante") { return "retry" }
  if ($hay -match "resume|résumé|structure complete|structure complète|verification|vérification|concret|stable") { return "concrete" }
  if ($hay -match "peut|peut-etre|peut être|hypothese|hypothèse|intuition|essai|try") { return "try" }
  if ($hay -match "partiel|incomplet|a verifier|à vérifier") { return "partial" }
  return "unclear"
}

function Get-Families($text, $path) {
  $hay = (($text + " " + $path) -as [string]).ToLowerInvariant()
  $tags = New-Object System.Collections.Generic.List[string]
  if ($hay -match "op_sym|op sym|symetr|symétr|croix|\\bm\\b|mr|mi|inversion") { $tags.Add("op_symmetry") }
  if ($hay -match "op_closure|fermeture|equilibre|équilibre|= 1|z\\(n\\)") { $tags.Add("op_closure") }
  if ($hay -match "dimension|\\b1d\\b|\\b2d\\b|\\b3d\\b|\\b5d\\b|\\b7d\\b|racine imaginaire|ln|exponentiel") { $tags.Add("prime_dimensions") }
  if ($hay -match "spirale|phi|φ|\\bj\\b|rayon|theta|θ|logarithm") { $tags.Add("phi_j_spiral") }
  if ($hay -match "mod 1|modulaire|projection|reseau|réseau|diagonal|bande") { $tags.Add("modular_projection") }
  if ($hay -match "riemann|zeta|zêta|zero|zéro|40\\.0005|40,0005|chirp|mills") { $tags.Add("riemann_chirp") }
  if ($hay -match "audio|son|voix|frequence|fréquence|hz|spectr|formant|phase") { $tags.Add("audio_mapping") }
  if ($hay -match "0\\.369|0,369|0\\.0005|0,0005|1\\.265|1,265|pi|π|φ|golden|or") { $tags.Add("constants") }
  if ($tags.Count -eq 0 -and $hay -match "math|nombre|premier|prime|formule|equation|équation") { $tags.Add("math_general") }
  if ($tags.Count -eq 0) { $tags.Add("unclear") }
  return @($tags | Select-Object -Unique)
}

function Get-MathStatus($families, $maturity, $text) {
  $hay = ($text -as [string]).ToLowerInvariant()
  if ($maturity -eq "fail") { return "inconsistent" }
  if ($families -contains "op_symmetry" -or $families -contains "op_closure" -or $families -contains "prime_dimensions") { return "custom_op" }
  if ($families -contains "audio_mapping" -or $families -contains "riemann_chirp") { return "experimental_mapping" }
  if ($hay -match "unclear|illisible") { return "unclear" }
  return "unclear"
}

$inventory = Read-JsonFile $InventoryPath
if (-not $inventory) {
  throw "Inventory not found: $InventoryPath"
}

$ocrBySource = @{}
if (Test-Path -LiteralPath $OcrRoot) {
  Get-ChildItem -LiteralPath $OcrRoot -Recurse -Filter index.json -File | ForEach-Object {
    $idx = Read-JsonFile $_.FullName
    foreach ($entry in @($idx)) {
      if ($entry.source -and $entry.text -and (Test-Path -LiteralPath $entry.text)) {
        $ocrBySource[$entry.source.ToLowerInvariant()] = @{
          textPath = $entry.text
          text = Get-Content -LiteralPath $entry.text -Raw
        }
      }
    }
  }
}

$tagged = foreach ($file in @($inventory.files)) {
  $source = $file.path
  $ocr = $ocrBySource[$source.ToLowerInvariant()]
  $text = if ($ocr) { $ocr.text } else { "" }
  $families = Get-Families $text $source
  $maturity = Get-Maturity $text $source
  $mathStatus = Get-MathStatus $families $maturity $text
  [pscustomobject]@{
    source = $source
    name = $file.name
    root = $file.root
    ocrText = if ($ocr) { $ocr.textPath } else { $null }
    hasOcr = [bool]$ocr
    families = $families
    maturity = $maturity
    mathStatus = $mathStatus
    usableInModule = ($maturity -eq "concrete" -and $mathStatus -in @("custom_op", "standard_valid", "experimental_mapping"))
  }
}

$summary = [pscustomobject]@{
  schema = "funesterie.prime-spiral-image-tags.v1"
  generatedAt = (Get-Date).ToUniversalTime().ToString("o")
  inventoryPath = $InventoryPath
  ocrRoot = $OcrRoot
  count = @($tagged).Count
  withOcr = @($tagged | Where-Object { $_.hasOcr }).Count
  byFamily = $tagged | ForEach-Object { $_.families } | Group-Object | Sort-Object Count -Descending | ForEach-Object {
    [pscustomobject]@{ family = $_.Name; count = $_.Count }
  }
  byMaturity = $tagged | Group-Object maturity | Sort-Object Count -Descending | ForEach-Object {
    [pscustomobject]@{ maturity = $_.Name; count = $_.Count }
  }
  byMathStatus = $tagged | Group-Object mathStatus | Sort-Object Count -Descending | ForEach-Object {
    [pscustomobject]@{ mathStatus = $_.Name; count = $_.Count }
  }
  files = $tagged
}

$parent = Split-Path -Parent $OutputPath
New-Item -ItemType Directory -Force -Path $parent | Out-Null
$summary | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $OutputPath -Encoding UTF8
Write-Host "Tagged: $($summary.count) files, OCR=$($summary.withOcr) -> $OutputPath"
Write-Host "Families:"
$summary.byFamily | Format-Table -AutoSize
Write-Host "Maturity:"
$summary.byMaturity | Format-Table -AutoSize
