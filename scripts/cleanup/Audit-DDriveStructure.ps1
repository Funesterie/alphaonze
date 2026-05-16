param(
  [string]$Root = "D:\",
  [string]$OutputDir = "",
  [int64]$LargeFileMinBytes = 500MB,
  [switch]$HashLargeFiles
)

$ErrorActionPreference = "Stop"

function New-SafeDirectory {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) {
    New-Item -ItemType Directory -Path $Path -Force | Out-Null
  }
}

function Get-DirectorySize {
  param([string]$Path)
  $sum = [int64]0
  Get-ChildItem -LiteralPath $Path -Force -Recurse -File -ErrorAction SilentlyContinue | ForEach-Object {
    $sum += $_.Length
  }
  [pscustomobject]@{
    path = $Path
    sizeBytes = $sum
    sizeGB = [math]::Round($sum / 1GB, 2)
    lastWriteTime = (Get-Item -LiteralPath $Path -Force).LastWriteTime.ToString("o")
  }
}

function Get-DirectoryChildrenSizes {
  param([string]$Path, [int]$Limit = 80)
  if (-not (Test-Path -LiteralPath $Path)) { return @() }
  $items = Get-ChildItem -LiteralPath $Path -Force -Directory -ErrorAction SilentlyContinue
  $out = foreach ($item in $items) {
    if ($item.FullName -match "\\System Volume Information$") { continue }
    Get-DirectorySize -Path $item.FullName
  }
  @($out | Sort-Object sizeBytes -Descending | Select-Object -First $Limit)
}

function Get-LargeFiles {
  param([string]$Path, [int64]$MinBytes)
  if (-not (Test-Path -LiteralPath $Path)) { return @() }
  Get-ChildItem -LiteralPath $Path -Force -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Length -ge $MinBytes } |
    Sort-Object Length -Descending |
    Select-Object FullName, Name, Length, LastWriteTime
}

if ([string]::IsNullOrWhiteSpace($OutputDir)) {
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $OutputDir = Join-Path "D:\projets\funesterie\docs\ops_tmp" "d-drive-audit-$stamp"
}

New-SafeDirectory -Path $OutputDir

$rootResolved = (Resolve-Path -LiteralPath $Root).Path
$topD = Get-DirectoryChildrenSizes -Path $rootResolved -Limit 80
$topProjets = Get-DirectoryChildrenSizes -Path "D:\projets" -Limit 80
$topFunesterie = Get-DirectoryChildrenSizes -Path "D:\projets\funesterie" -Limit 120
$largeFiles = @(Get-LargeFiles -Path $rootResolved -MinBytes $LargeFileMinBytes)

$largeFileRecords = foreach ($file in $largeFiles) {
  $hash = $null
  if ($HashLargeFiles) {
    try {
      $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $file.FullName -ErrorAction Stop).Hash
    } catch {
      $hash = "hash_failed"
    }
  }
  [pscustomobject]@{
    path = $file.FullName
    name = $file.Name
    sizeBytes = [int64]$file.Length
    sizeGB = [math]::Round($file.Length / 1GB, 2)
    lastWriteTime = $file.LastWriteTime.ToString("o")
    sha256 = $hash
  }
}

$duplicateGroups = @(
  $largeFileRecords |
    Group-Object name, sizeBytes |
    Where-Object { $_.Count -gt 1 } |
    ForEach-Object {
      [pscustomobject]@{
        key = $_.Name
        count = $_.Count
        totalSizeGB = [math]::Round((($_.Group | Measure-Object sizeBytes -Sum).Sum) / 1GB, 2)
        paths = @($_.Group | Select-Object -ExpandProperty path)
      }
    } |
    Sort-Object totalSizeGB -Descending
)

$report = [pscustomobject]@{
  schema = "funesterie.d-drive-audit.v1"
  generatedAt = (Get-Date).ToString("o")
  root = $rootResolved
  largeFileMinBytes = $LargeFileMinBytes
  hashLargeFiles = [bool]$HashLargeFiles
  topLevel = $topD
  projets = $topProjets
  funesterie = $topFunesterie
  largeFiles = $largeFileRecords
  possibleDuplicateLargeFiles = $duplicateGroups
}

$jsonPath = Join-Path $OutputDir "d-drive-audit.json"
$mdPath = Join-Path $OutputDir "d-drive-audit.md"
$report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $jsonPath -Encoding UTF8

$lines = @()
$lines += "# D Drive Audit"
$lines += ""
$lines += "Generated: $($report.generatedAt)"
$lines += "Root: $rootResolved"
$lines += "Large file threshold: $([math]::Round($LargeFileMinBytes / 1MB, 0)) MB"
$lines += "Hash large files: $([bool]$HashLargeFiles)"
$lines += ""
$lines += "## Top D:\\ directories"
$lines += ""
$lines += "| Path | Size GB |"
$lines += "| --- | ---: |"
foreach ($row in $topD | Select-Object -First 30) {
  $lines += "| $($row.path) | $($row.sizeGB) |"
}
$lines += ""
$lines += "## Top D:\\projets directories"
$lines += ""
$lines += "| Path | Size GB |"
$lines += "| --- | ---: |"
foreach ($row in $topProjets | Select-Object -First 30) {
  $lines += "| $($row.path) | $($row.sizeGB) |"
}
$lines += ""
$lines += "## Top funesterie directories"
$lines += ""
$lines += "| Path | Size GB |"
$lines += "| --- | ---: |"
foreach ($row in $topFunesterie | Select-Object -First 40) {
  $lines += "| $($row.path) | $($row.sizeGB) |"
}
$lines += ""
$lines += "## Possible duplicate large files"
$lines += ""
foreach ($group in $duplicateGroups | Select-Object -First 40) {
  $lines += "- $($group.key): $($group.count) copies, $($group.totalSizeGB) GB total"
  foreach ($path in $group.paths) {
    $lines += "  - $path"
  }
}

$lines | Set-Content -LiteralPath $mdPath -Encoding UTF8

[pscustomobject]@{
  ok = $true
  outputDir = $OutputDir
  json = $jsonPath
  markdown = $mdPath
  duplicateGroups = @($duplicateGroups).Count
  largeFiles = @($largeFileRecords).Count
} | ConvertTo-Json -Depth 4
