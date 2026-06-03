param(
  [string]$Python = "python",
  [string]$RepoDir = "E:\Funesterie\models\video\genmo-models",
  [string]$WeightsDir = "E:\Funesterie\models\video\weights",
  [string]$OutputDir = "E:\Funesterie\models\video\generated\videos",
  [string]$HostName = "127.0.0.1",
  [int]$Port = 17880
)

$ErrorActionPreference = "Stop"

$runner = Join-Path $PSScriptRoot "local-mochi-a11-runner.py"
if (-not (Test-Path -LiteralPath $runner)) {
  throw "Runner introuvable: $runner"
}
if (-not (Test-Path -LiteralPath $RepoDir)) {
  throw "Depot Genmo/Mochi introuvable: $RepoDir"
}
if (-not (Test-Path -LiteralPath $WeightsDir)) {
  throw "Weights Mochi introuvables: $WeightsDir"
}

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

$env:A11_VIDEO_LOCAL_WEIGHTS_DIR = $WeightsDir
$env:A11_MOCHI_REPO_DIR = $RepoDir
$env:A11_MOCHI_OUTPUT_DIR = $OutputDir
$env:A11_VIDEO_LOCAL_RUNNER_URL = "http://$HostName`:$Port/api/tools/generate_video"

Write-Host "A11 Mochi runner"
Write-Host "  Repo:    $RepoDir"
Write-Host "  Weights: $WeightsDir"
Write-Host "  Output:  $OutputDir"
Write-Host "  URL:     $env:A11_VIDEO_LOCAL_RUNNER_URL"
Write-Host ""
Write-Host "Important: ce runner charge Mochi au premier rendu. La doc Genmo indique ~60 Go de VRAM pour ce harness; ComfyUI est plus leger si la RTX ne suffit pas."

& $Python $runner `
  --host $HostName `
  --port $Port `
  --repo-dir $RepoDir `
  --weights-dir $WeightsDir `
  --output-dir $OutputDir
