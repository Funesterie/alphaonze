param(
  [string]$WorkRoot = "E:\Funesterie\stt\faster-whisper",
  [string]$Python = "C:\Users\Djeff\AppData\Local\Programs\Python\Python311\python.exe",
  [string]$HostAddress = "127.0.0.1",
  [int]$Port = 17911,
  [string]$Model = "Systran/faster-whisper-large-v3",
  [string]$Device = "cpu",
  [string]$ComputeType = "int8",
  [switch]$DownloadModel,
  [switch]$Foreground
)

$ErrorActionPreference = "Stop"

$runner = Join-Path $PSScriptRoot "local-faster-whisper-a11-runner.py"
$requirements = Join-Path $PSScriptRoot "requirements.faster-whisper.txt"
$venvRoot = Join-Path $WorkRoot ".venv"
$venvPython = Join-Path $venvRoot "Scripts\python.exe"
$downloadRoot = Join-Path $WorkRoot "models"
$tempRoot = Join-Path $WorkRoot "tmp"
$logRoot = Join-Path $WorkRoot "logs"
$cacheRoot = Join-Path $WorkRoot "cache"

foreach ($dir in @($WorkRoot, $downloadRoot, $tempRoot, $logRoot, $cacheRoot)) {
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
}

if (-not (Test-Path -LiteralPath $Python)) {
  throw "Python 3.11 introuvable: $Python"
}
if (-not (Test-Path -LiteralPath $runner)) {
  throw "Runner STT introuvable: $runner"
}
if (-not (Test-Path -LiteralPath $requirements)) {
  throw "Requirements STT introuvable: $requirements"
}

$env:HF_HOME = Join-Path $cacheRoot "hf"
$env:HUGGINGFACE_HUB_CACHE = Join-Path $cacheRoot "hf\hub"
$env:TRANSFORMERS_CACHE = Join-Path $cacheRoot "transformers"
$env:PIP_CACHE_DIR = Join-Path $cacheRoot "pip"
$env:TEMP = $tempRoot
$env:TMP = $tempRoot
$env:A11_STT_FAST_WHISPER_MODEL = $Model
$env:A11_STT_WORK_ROOT = $WorkRoot
$env:A11_STT_DOWNLOAD_ROOT = $downloadRoot
$env:A11_STT_TEMP_ROOT = $tempRoot
$env:A11_STT_FAST_WHISPER_DEVICE = $Device
$env:A11_STT_FAST_WHISPER_COMPUTE_TYPE = $ComputeType

if (-not (Test-Path -LiteralPath $venvPython)) {
  & $Python -m venv $venvRoot
}

& $venvPython -m pip install --upgrade pip setuptools wheel
& $venvPython -m pip install -r $requirements

if ($DownloadModel) {
  $script = @"
from faster_whisper import WhisperModel
WhisperModel(r"$Model", device="cpu", compute_type="int8", download_root=r"$downloadRoot")
print("model_ready")
"@
  $script | & $venvPython -
}

function Test-HttpOk([string]$Url) {
  try {
    $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 8
    return [int]$response.StatusCode -ge 200 -and [int]$response.StatusCode -lt 500
  } catch {
    return $false
  }
}

$healthUrl = "http://$HostAddress`:$Port/health"
if (Test-HttpOk $healthUrl) {
  Write-Host "A11 faster-whisper deja pret: $healthUrl"
  exit 0
}

$args = @(
  $runner,
  "--host", $HostAddress,
  "--port", "$Port",
  "--model", $Model,
  "--download-root", $downloadRoot,
  "--temp-root", $tempRoot,
  "--device", $Device,
  "--compute-type", $ComputeType
)

if ($Foreground) {
  & $venvPython @args
  exit $LASTEXITCODE
}

$outLog = Join-Path $logRoot "faster-whisper-runner.out.log"
$errLog = Join-Path $logRoot "faster-whisper-runner.err.log"
Start-Process -FilePath $venvPython `
  -WorkingDirectory $PSScriptRoot `
  -WindowStyle Hidden `
  -RedirectStandardOutput $outLog `
  -RedirectStandardError $errLog `
  -ArgumentList $args | Out-Null

$deadline = (Get-Date).AddSeconds(45)
do {
  Start-Sleep -Seconds 2
  if (Test-HttpOk $healthUrl) { break }
} while ((Get-Date) -lt $deadline)

if (-not (Test-HttpOk $healthUrl)) {
  throw "A11 faster-whisper ne repond pas sur $healthUrl"
}

Write-Host "A11 faster-whisper pret"
Write-Host "  Health: $healthUrl"
Write-Host "  STT URL: http://$HostAddress`:$Port/v1/audio/transcriptions"
Write-Host "  Modele: $Model"
Write-Host "  Cache:  $WorkRoot"
