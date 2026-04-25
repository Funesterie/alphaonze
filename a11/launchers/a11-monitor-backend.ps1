param(
  [switch]$Raw,
  [switch]$AllServices
)

$ErrorActionPreference = 'Continue'

function Write-Info {
  param([string]$Message)
  Write-Host "[A11 monitor] $Message" -ForegroundColor Cyan
}

function Write-WarnLine {
  param([string]$Message)
  Write-Host "[A11 monitor] $Message" -ForegroundColor Yellow
}

function Get-ListeningProcessId {
  param([int]$Port)
  try {
    $connection = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction Stop | Select-Object -First 1
    if ($connection) { return [int]$connection.OwningProcess }
  } catch {
  }
  return $null
}

function Show-A11Status {
  param(
    [string]$SnapshotPath,
    [int]$BackendPort
  )

  if (Test-Path -LiteralPath $SnapshotPath) {
    try {
      $snapshot = Get-Content -LiteralPath $SnapshotPath -Raw | ConvertFrom-Json
      if ($snapshot.services) {
        foreach ($service in @($snapshot.services)) {
          $color = if ($service.ready) { 'Green' } elseif ($service.enabled) { 'Yellow' } else { 'DarkGray' }
          $pidText = if ($service.pid) { " pid=$($service.pid)" } else { '' }
          $portText = if ($service.port) { " port=$($service.port)" } else { '' }
          Write-Host ("{0,-9} {1,-18}{2}{3}" -f $service.key, $service.state, $portText, $pidText) -ForegroundColor $color
        }
        if ($snapshot.uiUrl) {
          Write-Info "UI: $($snapshot.uiUrl)"
        }
        return
      }
    } catch {
      Write-WarnLine "Snapshot illisible: $($_.Exception.Message)"
    }
  }

  $backendPid = Get-ListeningProcessId -Port $BackendPort
  if ($backendPid) {
    Write-Host ("backend   running            port={0} pid={1}" -f $BackendPort, $backendPid) -ForegroundColor Green
  } else {
    Write-WarnLine "Backend non detecte sur le port $BackendPort."
  }
}

function Should-DisplayLine {
  param([string]$Line)
  if ($Raw) { return $true }
  if (-not $Line) { return $false }
  return $Line -match '(?i)(\[A11\]\[(prompt|prompt-canon|sd|sd-tools|sd-strength|image|image-reference|janus|video|video-prompt|video-runtime|intent|intent-sync|intent-async)|\[DEBUG\]\[IMAGE|\[MASK\]\[compile|\[SD\]\[|FINAL_PROMPT|prompt_2|prompt_3|negative_prompt|generate_sd|generate_video|Janus|StableDiffusion|Loading pipeline|Loading weights|output_path|Traceback|error|warn|failed|fallback|cuda|bfloat16|ffmpeg|Frame [0-9]+/[0-9]+)'
}

function Write-FilteredLine {
  param([string]$Line)

  $color = 'Gray'
  if ($Line -match '(?i)error|failed|Traceback|exception') {
    $color = 'Red'
  } elseif ($Line -match '(?i)warn|fallback|retry') {
    $color = 'Yellow'
  } elseif ($Line -match '(?i)FINAL_PROMPT|prompt_2|prompt_3|negative_prompt|\[A11\]\[prompt|\[A11\]\[prompt-canon') {
    $color = 'Magenta'
  } elseif ($Line -match '(?i)\[A11\]\[sd|StableDiffusion|Loading pipeline|Loading weights|output_path') {
    $color = 'Green'
  } elseif ($Line -match '(?i)Janus|vision') {
    $color = 'Blue'
  } elseif ($Line -match '(?i)\[A11\]\[video|Frame [0-9]+/[0-9]+|ffmpeg') {
    $color = 'Cyan'
  }

  Write-Host ("[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $Line) -ForegroundColor $color
}

$launcherRoot = Split-Path -Parent $PSCommandPath
$a11Root = [System.IO.Path]::GetFullPath((Join-Path $launcherRoot '..'))

# Lire A11_RUNTIME_ROOT depuis le config si disponible, sinon fallback relatif
$configPath = Join-Path $launcherRoot 'config\a11-local.env'
$runtimeRoot = $null
if (Test-Path -LiteralPath $configPath) {
  $configLine = Get-Content -LiteralPath $configPath | Where-Object { $_ -match '^A11_RUNTIME_ROOT\s*=' } | Select-Object -Last 1
  if ($configLine) {
    $rawValue = ($configLine -split '=', 2)[1].Trim()
    if ([System.IO.Path]::IsPathRooted($rawValue)) {
      $runtimeRoot = $rawValue
    } else {
      $runtimeRoot = [System.IO.Path]::GetFullPath((Join-Path $launcherRoot $rawValue))
    }
  }
}
if (-not $runtimeRoot) {
  $runtimeRoot = Join-Path $a11Root 'runtime'
}
$launcherRuntimeRoot = Join-Path $runtimeRoot 'launcher'
$logsDirectory = Join-Path $launcherRuntimeRoot 'logs'
$snapshotPath = Join-Path $launcherRuntimeRoot 'a11-local.snapshot.json'
$backendPort = 3000
$keys = if ($AllServices) { @('backend', 'llm', 'tts', 'qflush', 'frontend') } else { @('backend') }
$paths = @()

foreach ($key in $keys) {
  $paths += Join-Path $logsDirectory "$key.out.log"
  $paths += Join-Path $logsDirectory "$key.err.log"
}

New-Item -ItemType Directory -Force -Path $logsDirectory | Out-Null
foreach ($path in $paths) {
  if (-not (Test-Path -LiteralPath $path)) {
    New-Item -ItemType File -Force -Path $path | Out-Null
  }
}

$host.UI.RawUI.WindowTitle = 'A11 - Ecoute backend'
Write-Host ''
Write-Host '== A11 backend monitor ==' -ForegroundColor Cyan
Write-Info "Racine: $a11Root"
Write-Info "Logs: $logsDirectory"
Write-Info "Filtre: $(if ($Raw) { 'brut' } else { 'prompts / SD / Janus / video / erreurs' })"
Write-Info 'Ctrl+C pour fermer. Options: -Raw pour tout afficher, -AllServices pour LLM/TTS/Qflush aussi.'
Write-Host ''
Show-A11Status -SnapshotPath $snapshotPath -BackendPort $backendPort
Write-Host ''
Write-Info 'Ecoute en cours... lance une generation dans A11.'

Get-Content -LiteralPath $paths -Tail 0 -Wait |
  ForEach-Object {
    $line = [string]$_
    if (Should-DisplayLine -Line $line) {
      Write-FilteredLine -Line $line
    }
  }
