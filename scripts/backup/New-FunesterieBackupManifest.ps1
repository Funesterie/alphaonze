param(
  [string]$TargetRoot = "",
  [switch]$Execute,
  [switch]$IncludeVhdMirror,
  [string]$ConfirmToken = ""
)

$ErrorActionPreference = "Stop"
$requiredToken = "BACKUP_FUNESTERIE_NOW"
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$manifestDir = Join-Path "D:\projets\funesterie\docs\ops_tmp" "backup-manifest-$stamp"
New-Item -ItemType Directory -Path $manifestDir -Force | Out-Null

function Get-PathSizeBytes {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) { return 0 }
  $item = Get-Item -LiteralPath $Path -Force
  if (-not $item.PSIsContainer) { return [int64]$item.Length }
  $sum = [int64]0
  Get-ChildItem -LiteralPath $Path -Force -Recurse -File -ErrorAction SilentlyContinue | ForEach-Object {
    $sum += $_.Length
  }
  return $sum
}

function New-BackupItem {
  param([string]$Path, [string]$Reason, [string[]]$ExcludeDirs = @())
  $exists = Test-Path -LiteralPath $Path
  [pscustomobject]@{
    path = $Path
    exists = $exists
    sizeBytes = if ($exists) { Get-PathSizeBytes -Path $Path } else { 0 }
    sizeGB = if ($exists) { [math]::Round((Get-PathSizeBytes -Path $Path) / 1GB, 2) } else { 0 }
    reason = $Reason
    excludeDirs = $ExcludeDirs
  }
}

$repoExcludes = @(
  "node_modules",
  ".pnpm-store",
  ".npm-cache",
  ".next",
  ".turbo",
  "dist",
  "build",
  ".codex-tmp",
  "docs\ops_tmp"
)

if (-not $IncludeVhdMirror) {
  $repoExcludes += "runtime\Corpus\Virtual Hard Disks"
}

$items = @(
  New-BackupItem -Path "D:\projets\funesterie" -Reason "Main repo, docs, runtime manifests, non-generated work" -ExcludeDirs $repoExcludes
  New-BackupItem -Path "D:\agent-bus" -Reason "Agent bus commands and coordination state"
  New-BackupItem -Path "D:\projets\funesterie\a11\runtime\knowledge-graph" -Reason "A11 local knowledge graph manifests"
  New-BackupItem -Path "D:\projets\funesterie\a11mcp" -Reason "MCP server source and deployment scripts" -ExcludeDirs @("node_modules", "dist")
)

$health = [ordered]@{}
foreach ($url in @(
  "http://127.0.0.1:3000/api/health",
  "http://127.0.0.1:3001/api/health",
  "http://127.0.0.1:8787/health",
  "http://127.0.0.1:8788/health"
)) {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 5
    $health[$url] = @{ ok = $true; status = [int]$response.StatusCode }
  } catch {
    $health[$url] = @{ ok = $false; error = $_.Exception.Message }
  }
}

$manifest = [pscustomobject]@{
  schema = "funesterie.backup-manifest.v1"
  generatedAt = (Get-Date).ToString("o")
  execute = [bool]$Execute
  includeVhdMirror = [bool]$IncludeVhdMirror
  targetRoot = $TargetRoot
  requiredToken = $requiredToken
  health = $health
  items = $items
  notes = @(
    "Dry-run by default.",
    "No secrets are printed by this manifest.",
    "Actual copy uses robocopy only when -Execute and ConfirmToken are provided.",
    "VHD mirror is excluded by default."
  )
}

$jsonPath = Join-Path $manifestDir "backup-manifest.json"
$manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $jsonPath -Encoding UTF8

if ($Execute) {
  if ([string]::IsNullOrWhiteSpace($TargetRoot)) {
    throw "TargetRoot is required when -Execute is used."
  }
  if ($ConfirmToken -ne $requiredToken) {
    throw "Execute requested, but ConfirmToken must be '$requiredToken'."
  }
  New-Item -ItemType Directory -Path $TargetRoot -Force | Out-Null
  foreach ($item in $items) {
    if (-not $item.exists) { continue }
    $name = Split-Path -Leaf $item.path
    $dest = Join-Path $TargetRoot $name
    $args = @($item.path, $dest, "/MIR", "/R:1", "/W:1", "/XJ", "/NFL", "/NDL")
    foreach ($exclude in $item.excludeDirs) {
      $args += "/XD"
      $args += (Join-Path $item.path $exclude)
    }
    & robocopy @args | Out-Null
    if ($LASTEXITCODE -gt 7) {
      throw "Robocopy failed for $($item.path) with exit code $LASTEXITCODE"
    }
  }
}

[pscustomobject]@{
  ok = $true
  dryRun = -not [bool]$Execute
  manifest = $jsonPath
  targetRoot = $TargetRoot
  includeVhdMirror = [bool]$IncludeVhdMirror
  itemCount = @($items | Where-Object { $_.exists }).Count
} | ConvertTo-Json -Depth 4
