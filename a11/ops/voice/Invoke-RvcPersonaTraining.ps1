param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("a11", "kaen44", "vivy")]
  [string]$Persona,

  [string]$DatasetRoot = "D:\agent-bus\voice\personas",
  [string]$RvcRoot = "D:\agent-bus\voice\RVC-WebUI",
  [string]$OutputDir = "D:\agent-bus\voice\XTTS-RVC-UI\rvcs",
  [string]$Python = "D:\agent-bus\voice\XTTS-RVC-UI\.venv310\Scripts\python.exe",
  [int]$Epochs = 5,
  [int]$BatchSize = 4,
  [string]$Gpu = "cpu",
  [switch]$PrepareOnly
)

$ErrorActionPreference = "Stop"

$datasetManifestPath = Join-Path (Join-Path $DatasetRoot $Persona) "dataset-manifest.json"
if (-not (Test-Path -LiteralPath $datasetManifestPath)) {
  throw "Dataset manifest missing: $datasetManifestPath. Run New-RvcPersonaDataset.ps1 first."
}

$dataset = Get-Content -LiteralPath $datasetManifestPath -Raw | ConvertFrom-Json
if (-not [bool]$dataset.stats.readyForSmokeTraining) {
  Write-Host "Dataset exists but is short for RVC training: $($dataset.stats.totalDurationSec) sec." -ForegroundColor Yellow
  Write-Host "Target at least $($dataset.stats.minimumTrainingSec) sec for smoke training, $($dataset.stats.recommendedTrainingSec) sec for better training."
}

$expectedModelName = [string]$dataset.expectedArtifacts.model
$expectedIndexName = [string]$dataset.expectedArtifacts.index
if (-not $expectedModelName) {
  $expectedModelName = "$Persona.pth"
}
if (-not $expectedIndexName) {
  $expectedIndexName = "$Persona.index"
}

$trainEntrypoints = @(
  (Join-Path $RvcRoot "infer-web.py"),
  (Join-Path $RvcRoot "train.py"),
  (Join-Path $RvcRoot "tools\train.py")
) | Where-Object { Test-Path -LiteralPath $_ }

$requestPath = Join-Path (Join-Path $DatasetRoot $Persona) "training-request.json"
$request = [pscustomobject]@{
  schema = "funesterie.rvc-training-request.v1"
  persona = $Persona
  createdAt = (Get-Date).ToUniversalTime().ToString("o")
  datasetManifest = $datasetManifestPath
  chunksDir = Join-Path (Join-Path $DatasetRoot $Persona) "chunks"
  outputDir = $OutputDir
  expectedModel = Join-Path $OutputDir $expectedModelName
  expectedIndex = Join-Path $OutputDir $expectedIndexName
  rvcRoot = $RvcRoot
  trainerFound = ($trainEntrypoints.Count -gt 0)
  trainerEntrypoints = $trainEntrypoints
  notes = @(
    "Do not mark rvcModel=true until both expectedModel and expectedIndex exist.",
    "Use only approved persona audio; do not train on private or copyrighted voices without consent.",
    "This wrapper prepares the request. The selected RVC trainer decides exact CLI flags."
  )
}
$request | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $requestPath -Encoding UTF8

Write-Host "Training request written: $requestPath"
if ($trainEntrypoints.Count -eq 0) {
  Write-Host "No local RVC trainer found at $RvcRoot." -ForegroundColor Yellow
  Write-Host "Install a training-capable RVC WebUI there, then rerun this script."
  exit 0
}

Write-Host "RVC trainer candidate(s):"
$trainEntrypoints | ForEach-Object { Write-Host "  $_" }

if ($PrepareOnly) {
  Write-Host "PrepareOnly requested; training was not started."
  exit 0
}

if (-not (Test-Path -LiteralPath $Python)) {
  throw "Python runtime missing: $Python"
}

$trainer = Join-Path $PSScriptRoot "rvc_train_from_request.py"
if (-not (Test-Path -LiteralPath $trainer)) {
  throw "Training wrapper missing: $trainer"
}

Write-Host "Starting RVC training for $Persona. This can take a while."
& $Python $trainer --request $requestPath --rvc-root $RvcRoot --epochs $Epochs --batch-size $BatchSize --gpu $Gpu
if ($LASTEXITCODE -ne 0) {
  throw "RVC training failed with exit code $LASTEXITCODE"
}

Write-Host "Training completed. Re-run Test-RvcPersonaAssets.ps1 to verify bridge artifacts."
