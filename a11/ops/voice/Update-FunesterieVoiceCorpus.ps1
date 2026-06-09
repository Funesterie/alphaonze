param(
  [string]$RuntimeVoiceLibrary = "D:\projets\funesterie\a11\backend\runtime\voice-library",
  [string]$OutputRoot = "D:\agent-bus\voice\personas",
  [switch]$Force
)

$ErrorActionPreference = "Stop"

$datasetScript = Join-Path $PSScriptRoot "New-RvcPersonaDataset.ps1"
if (-not (Test-Path -LiteralPath $datasetScript)) {
  throw "Dataset script missing: $datasetScript"
}

$profiles = @(
  [pscustomobject]@{
    persona = "a11"
    sources = @("a11-terminator.wav", "a11-terminator-context.wav")
    direction = "grave, cybernetique, protectrice, diction courte et nette"
  },
  [pscustomobject]@{
    persona = "kaen44"
    sources = @("kaen44-donna.wav", "kaen44-donna-extra.wav", "kaen44-donna-context.wav")
    direction = "assistante executive vive, elegante, precise, chaleur controlee"
  },
  [pscustomobject]@{
    persona = "vivy"
    sources = @("vivy.wav", "vivy-adaptive.wav", "vivy-song-context.wav", "vivy-pv-context.wav")
    direction = "voix claire, musicale, lumineuse, emotion precise, voyelles propres"
  },
  [pscustomobject]@{
    persona = "djeff"
    sources = @("djeff-rap-pignon.wav", "djeff-rap-valable.wav", "djeff-rap-moine.wav", "djeff-rap-temps.wav")
    direction = "rap francais technique, diction serree, grain Djeff consenti, energie mecanique pignon-couronne"
  }
)

$summary = New-Object System.Collections.Generic.List[object]

foreach ($profile in $profiles) {
  $sourcePaths = @(
    $profile.sources |
      ForEach-Object { Join-Path $RuntimeVoiceLibrary $_ } |
      Where-Object { Test-Path -LiteralPath $_ }
  )

  if ($sourcePaths.Count -eq 0) {
    $summary.Add([pscustomobject]@{
      persona = $profile.persona
      ok = $false
      reason = "no_sources"
      direction = $profile.direction
    })
    continue
  }

  $datasetArgs = @{
    Persona = $profile.persona
    Source = $sourcePaths
    OutputRoot = $OutputRoot
  }
  if ($Force) { $datasetArgs.Force = $true }

  & $datasetScript @datasetArgs
  if ($LASTEXITCODE -ne 0) {
    throw "Corpus update failed for $($profile.persona)"
  }

  $manifestPath = Join-Path (Join-Path $OutputRoot $profile.persona) "dataset-manifest.json"
  $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  $summary.Add([pscustomobject]@{
    persona = $profile.persona
    ok = $true
    direction = $profile.direction
    manifest = $manifestPath
    sourceCount = $manifest.stats.sourceCount
    chunkCount = $manifest.stats.chunkCount
    totalDurationSec = $manifest.stats.totalDurationSec
    readyForSmokeTraining = $manifest.stats.readyForSmokeTraining
    readyForBetterTraining = $manifest.stats.readyForBetterTraining
  })
}

New-Item -ItemType Directory -Force -Path $OutputRoot | Out-Null
$statusPath = Join-Path $OutputRoot "corpus-status.json"
[pscustomobject]@{
  schema = "funesterie.voice-corpus-status.v1"
  updatedAt = (Get-Date).ToUniversalTime().ToString("o")
  runtimeVoiceLibrary = $RuntimeVoiceLibrary
  outputRoot = $OutputRoot
  profiles = $summary
} | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $statusPath -Encoding UTF8

Write-Host "Funesterie voice corpus updated: $statusPath"
