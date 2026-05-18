param(
  [switch]$Start,
  [switch]$SkipVision,
  [switch]$SkipCudaRepair,
  [ValidateSet('stable','preview')]
  [string]$ReleaseChannel = 'stable'
)

$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$serverRoot = [System.IO.Path]::GetFullPath((Join-Path $scriptDir '..'))
$memoryRoot = $env:A11_SHARED_MEMORY_DIR
if ([string]::IsNullOrWhiteSpace($memoryRoot)) {
  $memoryRoot = 'D:\agent-bus\shared-memory'
}
$heartbeatScript = Join-Path $memoryRoot 'scripts\Send-HeartbeatSignal.ps1'
$cudaRepairScript = Join-Path $memoryRoot 'scripts\Repair-PodmanCuda.ps1'

function Write-Step([string]$Message) {
  Write-Host "[A11/Kaen44 auto] $Message" -ForegroundColor Cyan
}

function Require-Path([string]$Path, [string]$Label) {
  if (-not (Test-Path -LiteralPath $Path)) {
    throw "$Label introuvable: $Path"
  }
}

function Get-ComposeCommand {
  if (Get-Command docker -ErrorAction SilentlyContinue) {
    return @{ Exe = 'docker'; Args = @('compose') }
  }
  if (Get-Command podman-compose -ErrorAction SilentlyContinue) {
    return @{ Exe = 'podman-compose'; Args = @() }
  }
  if (Get-Command podman -ErrorAction SilentlyContinue) {
    return @{ Exe = 'podman'; Args = @('compose') }
  }
  throw 'Aucune commande compose trouvee: installe Docker CLI ou Podman compose.'
}

function Invoke-Heartbeat([string]$Topic, [hashtable]$Payload) {
  if (-not (Test-Path -LiteralPath $heartbeatScript)) {
    return
  }
  $json = [string](ConvertTo-Json -InputObject ([pscustomobject]$Payload) -Depth 20 -Compress)
  & $heartbeatScript `
    -From codex `
    -To broadcast `
    -Kind signal `
    -Topic $Topic `
    -Priority normal `
    -PayloadJson $json | Out-Null
}

function Test-CudaPodman {
  if ($SkipVision) {
    return $false
  }
  if (-not (Get-Command podman -ErrorAction SilentlyContinue)) {
    Write-Warning 'Podman introuvable: vision GPU ignoree.'
    return $false
  }
  if ((-not $SkipCudaRepair) -and (Test-Path -LiteralPath $cudaRepairScript)) {
    Write-Step 'Verification/reparation CUDA Podman'
    & powershell -NoProfile -ExecutionPolicy Bypass -File $cudaRepairScript | Out-Host
  }
  Write-Step 'Test rapide CUDA Podman'
  & podman run --rm --gpus all docker.io/nvidia/cuda:12.9.0-base-ubuntu24.04 nvidia-smi | Out-Host
  return $true
}

Push-Location $serverRoot
try {
  Write-Step "Racine serveur: $serverRoot"

  Require-Path (Join-Path $serverRoot 'server-a11.cjs') 'Entree A11'
  Require-Path (Join-Path $serverRoot 'server-kaen44.cjs') 'Entree Kaen44'
  Require-Path (Join-Path $serverRoot 'profiles\a11.env') 'Profil prive A11'
  Require-Path (Join-Path $serverRoot 'profiles\kaen44.env') 'Profil prive Kaen44'
  Require-Path (Join-Path $serverRoot 'docker-compose.yml') 'Compose base'
  Require-Path (Join-Path $serverRoot 'docker-compose.split.yml') 'Compose split'

  $composeFiles = @(
    'docker-compose.yml',
    'docker-compose.split.yml'
  )

  $visionEnabled = Test-CudaPodman
  if ($visionEnabled) {
    Require-Path (Join-Path $serverRoot 'docker-compose.vision.yml') 'Compose vision'
    $composeFiles += 'docker-compose.vision.yml'
  }

  $env:A11_RELEASE_CHANNEL = $ReleaseChannel
  $env:KAEN44_RELEASE_CHANNEL = $ReleaseChannel

  $compose = Get-ComposeCommand
  $fileArgs = @()
  foreach ($file in $composeFiles) {
    $fileArgs += @('-f', $file)
  }

  Write-Step "Validation compose ($($composeFiles -join ', '))"
  & $compose.Exe @($compose.Args + $fileArgs + @('config', '--quiet'))

  if ($Start) {
    Write-Step 'Demarrage A11 + Kaen44'
    & $compose.Exe @($compose.Args + $fileArgs + @('up', '-d', '--build'))

    Write-Step 'Health checks locaux'
    foreach ($target in @(
      @{ Name = 'A11'; Url = 'http://127.0.0.1:3000/health' },
      @{ Name = 'Kaen44'; Url = 'http://127.0.0.1:3001/health' }
    )) {
      try {
        $health = Invoke-WebRequest -Uri $target.Url -UseBasicParsing -TimeoutSec 10
        Write-Host "$($target.Name) -> $($health.StatusCode)"
      } catch {
        Write-Warning "$($target.Name) health non joignable: $($_.Exception.Message)"
      }
    }
  } else {
    Write-Step 'Dry-run OK. Relance avec -Start pour demarrer.'
  }

  Invoke-Heartbeat 'a11_kaen44_auto_init' @{
    releaseChannel = $ReleaseChannel
    visionEnabled = $visionEnabled
    started = [bool]$Start
    composeFiles = $composeFiles
    stable = @{
      a11 = 'https://a11.funesterie.me'
      kaen44 = 'https://funesterie.me'
    }
    preview = @{
      a11 = 'local:3000'
      kaen44 = 'local:3001'
    }
  }
} finally {
  Pop-Location
}
