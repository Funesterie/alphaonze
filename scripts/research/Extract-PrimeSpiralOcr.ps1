param(
  [Parameter(Mandatory = $true)]
  [string]$InputDir,

  [Parameter(Mandatory = $true)]
  [string]$OutputDir,

  [string]$Language = "fra+eng",

  [string]$TesseractPath = "",

  [string]$TessdataDir = "",

  [switch]$Recurse,

  [int]$MaxFiles = 0
)

$ErrorActionPreference = "Stop"
if (Get-Variable -Name PSNativeCommandUseErrorActionPreference -Scope Global -ErrorAction SilentlyContinue) {
  $Global:PSNativeCommandUseErrorActionPreference = $false
}

if (-not (Test-Path -LiteralPath $InputDir)) {
  throw "InputDir does not exist: $InputDir"
}

$tesseractExe = $TesseractPath
if (-not $tesseractExe) {
  $tesseract = Get-Command tesseract -ErrorAction SilentlyContinue
  if ($tesseract) {
    $tesseractExe = $tesseract.Source
  }
}
if (-not $tesseractExe -or -not (Test-Path -LiteralPath $tesseractExe)) {
  throw "tesseract is not installed or not on PATH; pass -TesseractPath"
}

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

$extensions = @(".png", ".jpg", ".jpeg", ".tif", ".tiff")
$gciArgs = @{
  LiteralPath = $InputDir
  File = $true
}
if ($Recurse) {
  $gciArgs.Recurse = $true
}

$files = Get-ChildItem @gciArgs |
  Where-Object { $extensions -contains $_.Extension.ToLowerInvariant() } |
  Sort-Object Name
if ($MaxFiles -gt 0) {
  $files = $files | Select-Object -First $MaxFiles
}
$index = @()

foreach ($file in $files) {
  $safeName = [IO.Path]::GetFileNameWithoutExtension($file.Name) + ".txt"
  if ($Recurse) {
    $relative = $file.FullName.Substring((Resolve-Path -LiteralPath $InputDir).Path.Length).TrimStart("\", "/")
    $safeName = ($relative -replace "[:\\\/]+", "__" -replace "\.[^.]+$", ".txt")
  }
  $outPath = Join-Path $OutputDir $safeName
  Write-Host "OCR $($file.Name)"
  $args = @($file.FullName, "stdout", "-l", $Language)
  if ($TessdataDir) {
    $args += @("--tessdata-dir", $TessdataDir)
  }
  $oldErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  $ocrText = & $tesseractExe @args 2>$null
  $exitCode = $LASTEXITCODE
  $ErrorActionPreference = $oldErrorActionPreference
  if ($null -eq $ocrText) {
    "" | Set-Content -LiteralPath $outPath -Encoding UTF8
  } else {
    $ocrText | Set-Content -LiteralPath $outPath -Encoding UTF8
  }
  $index += [pscustomobject]@{
    source = $file.FullName
    text = $outPath
    bytes = (Get-Item -LiteralPath $outPath).Length
    exitCode = $exitCode
  }
}

$index | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $OutputDir "index.json") -Encoding UTF8
Write-Host "Done: $($index.Count) files -> $OutputDir"
