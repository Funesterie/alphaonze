param(
  [string]$QuarantineRoot = "D:\_cleanup_review",
  [switch]$Execute,
  [string]$ConfirmToken = ""
)

$ErrorActionPreference = "Stop"

$requiredToken = "MOVE_TO_CLEANUP_REVIEW"
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$targetRoot = Join-Path $QuarantineRoot $stamp

function Resolve-ExistingPathOrNull {
  param([string]$Path)
  if (Test-Path -LiteralPath $Path) {
    return (Resolve-Path -LiteralPath $Path).Path
  }
  return $null
}

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

function Assert-SafeMoveSource {
  param([string]$Path)
  $resolved = Resolve-ExistingPathOrNull -Path $Path
  if (-not $resolved) { return $null }
  $forbidden = @(
    "D:\",
    "D:\projets",
    "D:\projets\funesterie",
    "D:\projets\funesterie\runtime",
    "D:\projets\funesterie\a11",
    "D:\projets\funesterie\a11\runtime",
    "D:\agent-bus"
  )
  foreach ($blocked in $forbidden) {
    $blockedResolved = (Resolve-Path -LiteralPath $blocked -ErrorAction SilentlyContinue)
    if ($blockedResolved -and $resolved.TrimEnd('\') -ieq $blockedResolved.Path.TrimEnd('\')) {
      throw "Refusing to quarantine protected root: $resolved"
    }
  }
  return $resolved
}

$safeCandidates = @(
  [pscustomobject]@{
    path = "D:\Non confirme 414773.crdownload"
    reason = "Incomplete browser download if still present"
    risk = "low"
  },
  [pscustomobject]@{
    path = "D:\Non confirmé 414773.crdownload"
    reason = "Incomplete browser download if still present"
    risk = "low"
  },
  [pscustomobject]@{
    path = "D:\tmp\Documents\loas11.iso"
    reason = "Large ISO under tmp; only keep if actively needed"
    risk = "medium"
  },
  [pscustomobject]@{
    path = "D:\projets\funesterie\.codex-tmp"
    reason = "Codex temporary snapshots; review before final delete"
    risk = "medium"
  },
  [pscustomobject]@{
    path = "D:\codex-merge-work\alphaonze"
    reason = "External work clone, reported clean in prior audit"
    risk = "medium"
  }
)

$manualReviewOnly = @(
  [pscustomobject]@{
    path = "D:\projets\funesterie\runtime\Corpus\Virtual Hard Disks\Lecteur USB\projets"
    reason = "Huge mirrored project tree. Do not move until runtime repair and backup are complete."
    risk = "high"
  },
  [pscustomobject]@{
    path = "D:\projets\Win11_25H2_Lab_2.25"
    reason = "Large lab kit; may be intentionally kept"
    risk = "medium"
  },
  [pscustomobject]@{
    path = "D:\projets\Flowframes"
    reason = "Large app/tooling; may be intentionally kept"
    risk = "medium"
  }
)

$planItems = foreach ($candidate in $safeCandidates) {
  $resolved = Assert-SafeMoveSource -Path $candidate.path
  [pscustomobject]@{
    path = $candidate.path
    resolvedPath = $resolved
    exists = [bool]$resolved
    sizeBytes = if ($resolved) { Get-PathSizeBytes -Path $resolved } else { 0 }
    sizeGB = if ($resolved) { [math]::Round((Get-PathSizeBytes -Path $resolved) / 1GB, 2) } else { 0 }
    reason = $candidate.reason
    risk = $candidate.risk
    action = "quarantine"
  }
}

$manualItems = foreach ($candidate in $manualReviewOnly) {
  $resolved = Resolve-ExistingPathOrNull -Path $candidate.path
  [pscustomobject]@{
    path = $candidate.path
    resolvedPath = $resolved
    exists = [bool]$resolved
    sizeBytes = if ($resolved) { Get-PathSizeBytes -Path $resolved } else { 0 }
    sizeGB = if ($resolved) { [math]::Round((Get-PathSizeBytes -Path $resolved) / 1GB, 2) } else { 0 }
    reason = $candidate.reason
    risk = $candidate.risk
    action = "manual_review_only"
  }
}

$result = [pscustomobject]@{
  schema = "funesterie.cleanup-quarantine-plan.v1"
  generatedAt = (Get-Date).ToString("o")
  execute = [bool]$Execute
  quarantineRoot = $targetRoot
  requiredToken = $requiredToken
  items = @($planItems)
  manualReviewOnly = @($manualItems)
}

if ($Execute) {
  if ($ConfirmToken -ne $requiredToken) {
    throw "Execute requested, but ConfirmToken must be '$requiredToken'."
  }
  New-Item -ItemType Directory -Path $targetRoot -Force | Out-Null
  foreach ($item in $planItems) {
    if (-not $item.exists) { continue }
    $dest = Join-Path $targetRoot ($item.resolvedPath -replace "^[A-Za-z]:\\", "" -replace "[:*?""<>|]", "_")
    $destParent = Split-Path -Parent $dest
    New-Item -ItemType Directory -Path $destParent -Force | Out-Null
    Move-Item -LiteralPath $item.resolvedPath -Destination $dest -Force
  }
}

$outDir = Join-Path "D:\projets\funesterie\docs\ops_tmp" "cleanup-plan-$stamp"
New-Item -ItemType Directory -Path $outDir -Force | Out-Null
$jsonPath = Join-Path $outDir "quarantine-plan.json"
$result | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $jsonPath -Encoding UTF8

[pscustomobject]@{
  ok = $true
  dryRun = -not [bool]$Execute
  json = $jsonPath
  quarantineRoot = $targetRoot
  candidateCount = @($planItems | Where-Object { $_.exists }).Count
  manualReviewCount = @($manualItems | Where-Object { $_.exists }).Count
} | ConvertTo-Json -Depth 4
