$ErrorActionPreference = 'Stop'

function Resolve-FirstExistingPath {
  param([string[]]$Candidates)

  foreach ($candidate in $Candidates) {
    if ([string]::IsNullOrWhiteSpace($candidate)) { continue }
    if (Test-Path $candidate) { return $candidate }
  }

  return $null
}

function Get-CommandPath {
  param([string]$Name)

  try {
    return (Get-Command $Name -ErrorAction Stop).Source
  } catch {
    return $null
  }
}

function Test-HttpHealthy {
  param(
    [string]$Url,
    [int]$TimeoutSec = 8
  )

  try {
    $response = Invoke-WebRequest -Uri $Url -Method Get -UseBasicParsing -TimeoutSec $TimeoutSec
    return ([int]$response.StatusCode -ge 200 -and [int]$response.StatusCode -lt 300)
  } catch {
    return $false
  }
}

function Wait-HttpHealthy {
  param(
    [string]$Name,
    [string]$Url,
    [int]$TimeoutSec = 45
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  do {
    if (Test-HttpHealthy -Url $Url -TimeoutSec 8) {
      Write-Host ("[BOOTSTRAP] {0} HEALTHY : {1}" -f $Name, $Url)
      return $true
    }
    Start-Sleep -Seconds 2
  } while ((Get-Date) -lt $deadline)

  return $false
}

function Get-OllamaModelNames {
  param(
    [string]$BaseUrl,
    [int]$TimeoutSec = 8
  )

  try {
    $payload = Invoke-RestMethod -Uri ($BaseUrl.TrimEnd('/') + '/api/tags') -Method Get -TimeoutSec $TimeoutSec
    $names = @()
    foreach ($entry in @($payload.models)) {
      $candidate = ''
      if ($entry.PSObject.Properties.Match('model').Count -gt 0) {
        $candidate = [string]$entry.model
      } elseif ($entry.PSObject.Properties.Match('name').Count -gt 0) {
        $candidate = [string]$entry.name
      }
      if (-not [string]::IsNullOrWhiteSpace($candidate)) {
        $names += $candidate.Trim()
      }
    }
    return @($names | Select-Object -Unique)
  } catch {
    return @()
  }
}

$scriptDir = Split-Path -Parent $PSCommandPath
$runtimeDir = Join-Path $scriptDir 'runtime'
$logDir = Join-Path $runtimeDir 'logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$ollamaExe = Resolve-FirstExistingPath @(
  (Get-CommandPath 'ollama'),
  'C:\Program Files\ollama\ollama.exe'
)

$ollamaBase = if ($env:OLLAMA_BASE) { [string]$env:OLLAMA_BASE } else { 'http://127.0.0.1:11434' }
$ollamaBase = $ollamaBase.TrimEnd('/')
$ollamaHealthUrl = $ollamaBase + '/api/tags'
$primaryModel = if ($env:A11_OLLAMA_PRIMARY_MODEL) { [string]$env:A11_OLLAMA_PRIMARY_MODEL } else { 'gemma4:e4b' }
$fallbackModel = if ($env:A11_OLLAMA_FALLBACK_MODEL) { [string]$env:A11_OLLAMA_FALLBACK_MODEL } else { '' }
$targetModels = @($primaryModel, $fallbackModel) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique
$showWindow = $args -contains '--show-window'

Write-Host "[BOOTSTRAP] Ollama exe       : $ollamaExe"
Write-Host "[BOOTSTRAP] Ollama base      : $ollamaBase"
Write-Host "[BOOTSTRAP] Primary model    : $primaryModel"
Write-Host "[BOOTSTRAP] Fallback model   : $fallbackModel"
Write-Host "[BOOTSTRAP] Logs             : $logDir"
Write-Host ""

if (-not $ollamaExe) {
  throw 'Ollama introuvable. Installe Ollama ou ajoute-le au PATH.'
}

if (Test-HttpHealthy -Url $ollamaHealthUrl -TimeoutSec 8) {
  Write-Host '[BOOTSTRAP] Ollama deja actif.'
} else {
  Write-Host '[BOOTSTRAP] Ollama inactif, lancement de "ollama serve"...'
  $stdoutPath = Join-Path $logDir 'bootstrap-ollama.out.log'
  $stderrPath = Join-Path $logDir 'bootstrap-ollama.err.log'
  $params = @{
    FilePath = $ollamaExe
    ArgumentList = @('serve')
    WorkingDirectory = (Split-Path -Parent $ollamaExe)
    RedirectStandardOutput = $stdoutPath
    RedirectStandardError = $stderrPath
    PassThru = $true
  }
  if ($showWindow) {
    $params.WindowStyle = 'Normal'
  } else {
    $params.WindowStyle = 'Hidden'
  }
  $process = Start-Process @params
  Write-Host "[BOOTSTRAP] ollama serve demarre (PID $($process.Id))."

  if (-not (Wait-HttpHealthy -Name 'Ollama' -Url $ollamaHealthUrl -TimeoutSec 45)) {
    throw "Ollama ne repond pas sur $ollamaHealthUrl"
  }
}

$installedBefore = Get-OllamaModelNames -BaseUrl $ollamaBase -TimeoutSec 12
foreach ($model in $targetModels) {
  if ($installedBefore -contains $model) {
    Write-Host "[BOOTSTRAP] Modele deja present : $model"
    continue
  }

  Write-Host "[BOOTSTRAP] Pull du modele : $model"
  & $ollamaExe pull $model
  if ($LASTEXITCODE -ne 0) {
    throw "Echec du pull Ollama pour $model"
  }
}

$installedAfter = Get-OllamaModelNames -BaseUrl $ollamaBase -TimeoutSec 12
Write-Host ""
Write-Host "[BOOTSTRAP] Modeles detectes:"
foreach ($model in $installedAfter) {
  Write-Host "  - $model"
}

Write-Host ""
Write-Host '[BOOTSTRAP] Bootstrap Gemma termine.'
