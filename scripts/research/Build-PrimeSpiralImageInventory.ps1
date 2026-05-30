param(
  [string[]]$InputDirs = @(
    "C:\Users\Djeff\Downloads\AmazonPhotos",
    "E:\maths"
  ),

  [string]$OutputPath = "D:\projets\funesterie\.codex-tmp\prime-spiral-image-inventory.json"
)

$ErrorActionPreference = "Stop"

$extensions = @(".png", ".jpg", ".jpeg", ".heic", ".tif", ".tiff")
$items = @()

foreach ($dir in $InputDirs) {
  if (-not (Test-Path -LiteralPath $dir)) {
    continue
  }
  Get-ChildItem -LiteralPath $dir -Recurse -File |
    Where-Object { $extensions -contains $_.Extension.ToLowerInvariant() } |
    ForEach-Object {
      $items += [pscustomobject]@{
        path = $_.FullName
        root = $dir
        name = $_.Name
        extension = $_.Extension.ToLowerInvariant()
        bytes = $_.Length
        lastWriteTime = $_.LastWriteTimeUtc.ToString("o")
      }
    }
}

$deduped = $items |
  Sort-Object Path -Unique |
  Sort-Object LastWriteTime, Name

$summary = [pscustomobject]@{
  schema = "funesterie.prime-spiral-image-inventory.v1"
  generatedAt = (Get-Date).ToUniversalTime().ToString("o")
  amazonShare = "https://www.amazon.fr/photos/share/JwzZH4k4e2OnxYjGskOvUnfX2rFNQPGx4R1VPJrd6t2"
  inputDirs = $InputDirs
  count = @($deduped).Count
  byExtension = $deduped | Group-Object Extension | ForEach-Object {
    [pscustomobject]@{ extension = $_.Name; count = $_.Count }
  }
  files = $deduped
}

$out = Resolve-Path -LiteralPath (Split-Path -Parent $OutputPath) -ErrorAction SilentlyContinue
if (-not $out) {
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $OutputPath) | Out-Null
}

$summary | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $OutputPath -Encoding UTF8
Write-Host "Inventory: $(@($deduped).Count) files -> $OutputPath"
