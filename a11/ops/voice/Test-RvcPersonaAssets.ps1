param(
  [string]$InstallDir = "D:\agent-bus\voice\XTTS-RVC-UI",
  [string]$DatasetRoot = "D:\agent-bus\voice\personas",
  [string]$VoiceBridgeUrl = "http://127.0.0.1:5000",
  [string]$BackendUrl = "http://127.0.0.1:3000",
  [switch]$IncludeBackendSmoke,
  [string]$SmokeText = "Test court voix persona Funesterie."
)

$ErrorActionPreference = "Stop"

function Get-ManifestEntry {
  param(
    [object]$Manifest,
    [string]$Style
  )
  $property = $Manifest.PSObject.Properties[$Style]
  if ($property) {
    return $property.Value
  }
  return $null
}

function Read-DatasetStats {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) {
    return [pscustomobject]@{
      exists = $false
      durationSec = 0
      chunks = 0
      readyForSmokeTraining = $false
      readyForBetterTraining = $false
    }
  }
  $manifest = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
  return [pscustomobject]@{
    exists = $true
    durationSec = [double]$manifest.stats.totalDurationSec
    chunks = [int]$manifest.stats.chunkCount
    readyForSmokeTraining = [bool]$manifest.stats.readyForSmokeTraining
    readyForBetterTraining = [bool]$manifest.stats.readyForBetterTraining
  }
}

function Invoke-JsonGet {
  param([string]$Url)
  try {
    return Invoke-RestMethod -Method Get -Uri $Url -TimeoutSec 15
  } catch {
    throw "GET failed: $Url :: $($_.Exception.Message)"
  }
}

function Invoke-JsonPost {
  param(
    [string]$Url,
    [object]$Body
  )
  try {
    return Invoke-RestMethod -Method Post -Uri $Url -Body ($Body | ConvertTo-Json -Depth 8) -ContentType "application/json" -TimeoutSec 90
  } catch {
    $statusCode = $null
    if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
      $statusCode = [int]$_.Exception.Response.StatusCode
    }
    throw "POST failed: $Url :: status=$statusCode :: $($_.Exception.Message)"
  }
}

function Test-BridgePersonaHealth {
  param(
    [object]$Health,
    [object[]]$Rows
  )

  $failures = @()
  foreach ($row in $Rows) {
    $styleHealth = $Health.styles.$($row.style)
    if (-not $styleHealth) {
      $failures += "$($row.persona)/$($row.style): missing bridge health style"
      continue
    }
    if (-not $styleHealth.hasVoice) {
      $failures += "$($row.persona)/$($row.style): missing reference voice"
    }
    if (-not $styleHealth.hasRvc) {
      $failures += "$($row.persona)/$($row.style): missing RVC model"
    }
    if (-not $styleHealth.hasIndex) {
      $failures += "$($row.persona)/$($row.style): missing RVC index"
    }
  }
  return $failures
}

function Test-BackendPersonaVoice {
  param(
    [string]$Url,
    [object]$Row,
    [string]$Text
  )

  $payload = @{
    text = $Text
    persona = $Row.persona
    voicePersona = $Row.persona
    voiceStyle = $Row.style
    provider = "xtts-rvc"
    voiceReferenceRequired = $true
  }
  $result = Invoke-JsonPost -Url "$Url/api/tts/speak" -Body $payload
  $caps = $result.providerCapabilities
  [pscustomobject]@{
    persona = $Row.persona
    style = $Row.style
    ok = [bool]$result.success
    provider = [string]$result.provider
    engine = [string]$result.engine
    audioUrl = [string]$result.audio_url
    rvcModel = [bool]$caps.rvcModel
    rvcIndex = [bool]$caps.rvcIndex
    voiceStyle = [string]$result.voiceConversion.voiceStyle
    error = [string]$result.error
  }
}

$rvcsDir = Join-Path $InstallDir "rvcs"
$voicesDir = Join-Path $InstallDir "voices"
$personaManifestPath = Join-Path $rvcsDir "funesterie-personas.json"
if (-not (Test-Path -LiteralPath $personaManifestPath)) {
  throw "Persona manifest missing: $personaManifestPath"
}

$manifest = Get-Content -LiteralPath $personaManifestPath -Raw | ConvertFrom-Json
$styles = @("a11-official-stern-french", "a11-voix-de-lait", "djeff-rap", "kaen44-official-french-narrator", "vivy")
$rows = foreach ($style in $styles) {
  $entry = Get-ManifestEntry -Manifest $manifest -Style $style
  if (-not $entry) {
    continue
  }
  $persona = [string]$entry.persona
  $voicePath = Join-Path $voicesDir ([string]$entry.voice)
  $rvcPath = Join-Path $rvcsDir ([string]$entry.rvc)
  $indexPath = Join-Path $rvcsDir ([string]$entry.index)
  $datasetPath = Join-Path (Join-Path $DatasetRoot $persona) "dataset-manifest.json"
  $dataset = Read-DatasetStats -Path $datasetPath
  [pscustomobject]@{
    style = $style
    persona = $persona
    voice = Test-Path -LiteralPath $voicePath
    rvcModel = Test-Path -LiteralPath $rvcPath
    rvcIndex = Test-Path -LiteralPath $indexPath
    dataset = $dataset.exists
    datasetSeconds = [math]::Round($dataset.durationSec, 2)
    datasetChunks = $dataset.chunks
    readyForSmokeTraining = $dataset.readyForSmokeTraining
    readyForBetterTraining = $dataset.readyForBetterTraining
  }
}

$rows | Format-Table -AutoSize

$missingModels = @($rows | Where-Object { -not $_.rvcModel -or -not $_.rvcIndex })
if ($missingModels.Count -gt 0) {
  Write-Host ""
  Write-Host "RVC inference is not persona-complete yet. Missing model/index for:" -ForegroundColor Yellow
  $missingModels | ForEach-Object {
    Write-Host "  - $($_.persona) ($($_.style))"
  }
  exit 1
}

Write-Host ""
Write-Host "Checking XTTS/RVC bridge health: $VoiceBridgeUrl/health"
$health = Invoke-JsonGet -Url "$VoiceBridgeUrl/health"
$bridgeFailures = @(Test-BridgePersonaHealth -Health $health -Rows @($rows))
if ($bridgeFailures.Count -gt 0) {
  Write-Host "Bridge persona health failed:" -ForegroundColor Red
  $bridgeFailures | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
  exit 1
}
Write-Host "Bridge persona health: OK" -ForegroundColor Green

if ($IncludeBackendSmoke) {
  Write-Host ""
  Write-Host "Checking backend persona voice smoke: $BackendUrl/api/tts/speak"
  $smokeRows = foreach ($row in $rows) {
    Test-BackendPersonaVoice -Url $BackendUrl -Row $row -Text $SmokeText
  }
  $smokeRows | Format-Table -AutoSize

  $failedSmoke = @($smokeRows | Where-Object {
    -not $_.ok -or $_.provider -ne "xtts-rvc" -or -not $_.rvcModel -or -not $_.rvcIndex
  })
  if ($failedSmoke.Count -gt 0) {
    Write-Host ""
    Write-Host "Backend persona smoke failed:" -ForegroundColor Red
    $failedSmoke | ForEach-Object {
      Write-Host "  - $($_.persona)/$($_.style): ok=$($_.ok), provider=$($_.provider), rvcModel=$($_.rvcModel), rvcIndex=$($_.rvcIndex), error=$($_.error)" -ForegroundColor Red
    }
    exit 1
  }
  Write-Host "Backend persona smoke: OK" -ForegroundColor Green
}
