# New-MathImageOcrIndex.ps1 - OCR and semantic tags for Djeff math screenshots.
# Keeps raw OCR local and emits a searchable JSON/Markdown map.

param(
  [string]$ImageRoot = "C:\Users\Djeff\Desktop\prems",
  [string]$OutputRoot = "D:\agent-bus\math-ocr-index",
  [string]$TesseractExe = "C:\Program Files\Tesseract-OCR\tesseract.exe",
  [string]$Language = "fra+eng",
  [switch]$Recurse,
  [int]$MaxImages = 0
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

function Add-Tag {
  param([System.Collections.Generic.HashSet[string]]$Set, [string]$Value)
  [void]$Set.Add($Value)
}

function Get-MathTags {
  param([string]$Text, [string]$Name)
  $tags = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
  $hay = ($Name + "`n" + $Text).ToLowerInvariant()

  if ($hay -match 'prime|premier|nombre p|nombres premiers|riemann|zeta|zeta|mills') { Add-Tag $tags "prime-riemann" }
  if ($hay -match 'spirale|logarithm|log n|theta|rayon|r\(n\)|rotation') { Add-Tag $tags "spiral-logarithmic" }
  if ($hay -match 'sym|symetr|symétr|op_|op |croix|equilibr|équilibr|resonance|résonance') { Add-Tag $tags "symmetry-op-resonance" }
  if ($hay -match 'imaginaire|\bi\b|complexe|mr|mi|-i|racine') { Add-Tag $tags "complex-imaginary" }
  if ($hay -match 'ln|log|exp|inversion|inverse|racine') { Add-Tag $tags "operation-stack" }
  if ($hay -match 'audio|voix|spectral|frequence|fréquence|hz|phase|dephasage|déphasage') { Add-Tag $tags "audio-spectral" }
  if ($hay -match '\{i|,\s*-i|-\s*1|,\s*1|,\s*m\}') { Add-Tag $tags "output-set-i-minus1-one-m" }
  if ($hay -match 'fail|retry|faux|corrig|correction|manquant') { Add-Tag $tags "try-retry-corrected" }

  return @($tags | Sort-Object)
}

function Get-FormulaLines {
  param([string]$Text)
  $lines = $Text -split "`r?`n"
  $hits = New-Object System.Collections.Generic.List[string]
  foreach ($line in $lines) {
    $trim = ($line -replace '\s+', ' ').Trim()
    if (-not $trim) { continue }
    if ($trim -match '=|op|sym|log|ln|exp|sqrt|racine|theta|z_|M_|Mr|Mi|\bi\b|-i|\+i|mod|π|phi|φ') {
      if ($trim.Length -gt 220) { $trim = $trim.Substring(0, 220) + "..." }
      $hits.Add($trim)
    }
  }
  return $hits.ToArray()
}

if (-not (Test-Path -LiteralPath $ImageRoot)) {
  throw "ImageRoot not found: $ImageRoot"
}
if (-not (Test-Path -LiteralPath $TesseractExe)) {
  throw "Tesseract not found: $TesseractExe"
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$outDir = Join-Path $OutputRoot $timestamp
$rawDir = Join-Path $outDir "raw-ocr"
New-Item -ItemType Directory -Force -Path $rawDir | Out-Null

$images = Get-ChildItem -LiteralPath $ImageRoot -File -Recurse:$Recurse |
  Where-Object { $_.Extension -match '^\.(png|jpg|jpeg|webp|tif|tiff)$' } |
  Sort-Object Name
if ($MaxImages -gt 0) { $images = $images | Select-Object -First $MaxImages }

$records = New-Object System.Collections.Generic.List[object]

foreach ($image in $images) {
  $safeName = $image.BaseName -replace '[\\/:*?"<>|]', '_'
  $baseOut = Join-Path $rawDir $safeName
  $logPath = "$baseOut.log"
  $txtPath = "$baseOut.txt"

  $psi = [System.Diagnostics.ProcessStartInfo]::new()
  $psi.FileName = $TesseractExe
  $psi.Arguments = '"' + $image.FullName + '" "' + $baseOut + '" -l "' + $Language + '" --psm 6'
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.UseShellExecute = $false
  $p = [System.Diagnostics.Process]::Start($psi)
  $stdout = $p.StandardOutput.ReadToEnd()
  $stderr = $p.StandardError.ReadToEnd()
  $p.WaitForExit()
  Write-Utf8File -Path $logPath -Content ($stdout + $(if ($stderr) { "`n--- STDERR ---`n$stderr" } else { "" }))

  $text = if (Test-Path -LiteralPath $txtPath) { Get-Content -LiteralPath $txtPath -Raw -Encoding UTF8 } else { "" }
  $tags = Get-MathTags -Text $text -Name $image.Name
  $formulaLines = Get-FormulaLines -Text $text

  $records.Add([pscustomobject]@{
    file = $image.FullName
    name = $image.Name
    bytes = $image.Length
    ocrTextFile = $txtPath
    tesseractExitCode = $p.ExitCode
    tags = @($tags)
    formulaLines = @($formulaLines)
    textPreview = (($text -replace '\s+', ' ').Trim()).Substring(0, [Math]::Min(400, (($text -replace '\s+', ' ').Trim()).Length))
  })
}

$index = [pscustomobject]@{
  schema = "funesterie.djeff-math-ocr-index.v1"
  generatedAt = (Get-Date).ToUniversalTime().ToString("o")
  imageRoot = $ImageRoot
  imageCount = $records.Count
  records = $records.ToArray()
}

$jsonPath = Join-Path $outDir "math-image-ocr-index.json"
Write-Utf8File -Path $jsonPath -Content (($index | ConvertTo-Json -Depth 10) + "`n")

$md = New-Object System.Text.StringBuilder
[void]$md.AppendLine("# Djeff Math OCR Index $timestamp")
[void]$md.AppendLine("")
[void]$md.AppendLine("Image root: $ImageRoot")
[void]$md.AppendLine("Images indexed: $($records.Count)")
[void]$md.AppendLine("")

foreach ($record in $records) {
  [void]$md.AppendLine("## $($record.name)")
  [void]$md.AppendLine("")
  if ($record.tags.Count -gt 0) { [void]$md.AppendLine("- Tags: $($record.tags -join ', ')") }
  [void]$md.AppendLine("- OCR: $($record.ocrTextFile)")
  if ($record.formulaLines.Count -gt 0) {
    [void]$md.AppendLine("- Formula cues:")
    foreach ($line in ($record.formulaLines | Select-Object -First 12)) {
      [void]$md.AppendLine("  - $line")
    }
  }
  [void]$md.AppendLine("")
}

$mdPath = Join-Path $outDir "math-image-ocr-index.md"
Write-Utf8File -Path $mdPath -Content $md.ToString()

Write-Host "Math OCR index written to: $outDir"
Write-Host "JSON: $jsonPath"
Write-Host "MD: $mdPath"
