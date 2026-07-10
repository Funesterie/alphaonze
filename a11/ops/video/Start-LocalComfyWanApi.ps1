param(
  [string]$ComfyRoot = "E:\Funesterie\ComfyUI-Desktop\resources\ComfyUI",
  [string]$Python = "E:\Funesterie\ComfyUI-venv\Scripts\python.exe",
  [string]$WorkRoot = "E:\Funesterie",
  [string]$ComfyHost = "127.0.0.1",
  [int]$ComfyPort = 8188,
  [string]$RunnerHost = "127.0.0.1",
  [int]$RunnerPort = 17882,
  [string]$ApiKeyFile = "C:\Users\Djeff\Desktop\api comfy UI.txt",
  [bool]$DisableCustomNodes = $true,
  [switch]$NoRunner
)

$ErrorActionPreference = "Stop"

$runner = Join-Path $PSScriptRoot "local-comfy-wan-api-a11-runner.py"
$outputDir = Join-Path $WorkRoot "outputs\comfy"
$tempDir = Join-Path $WorkRoot "tmp\comfy"
$logDir = Join-Path $WorkRoot "logs"
$publicCopyDir = "D:\projets\funesterie\a11\backend\apps\server\runtime\files\generated\videos\comfy-wan"

foreach ($dir in @($outputDir, $tempDir, $logDir, $publicCopyDir)) {
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
}

if (-not (Test-Path -LiteralPath $ComfyRoot)) {
  throw "ComfyUI introuvable: $ComfyRoot"
}
if (-not (Test-Path -LiteralPath $Python)) {
  throw "Python Comfy introuvable: $Python"
}
if (-not (Test-Path -LiteralPath $runner)) {
  throw "Runner Comfy/Wan introuvable: $runner"
}

$env:UV_CACHE_DIR = Join-Path $WorkRoot "uv-cache"
$env:PIP_CACHE_DIR = Join-Path $WorkRoot "pip-cache"
$env:HF_HOME = Join-Path $WorkRoot "hf-cache"
$env:HUGGINGFACE_HUB_CACHE = Join-Path $WorkRoot "hf-cache\hub"
$env:TEMP = Join-Path $WorkRoot "tmp"
$env:TMP = Join-Path $WorkRoot "tmp"
$env:A11_COMFY_URL = "http://$ComfyHost`:$ComfyPort"
$env:A11_COMFY_OUTPUT_DIR = $outputDir
$env:A11_COMFY_TEMP_DIR = $tempDir
$env:A11_COMFY_PUBLIC_VIDEO_DIR = $publicCopyDir
$env:A11_VIDEO_LOCAL_RUNNER_URL = "http://$RunnerHost`:$RunnerPort/api/tools/generate_video"
if (-not $env:A11_COMFY_WAN_RESOLUTION) {
  $env:A11_COMFY_WAN_RESOLUTION = "480P"
}
if (-not $env:A11_COMFY_WAN_DURATION_SEC) {
  $env:A11_COMFY_WAN_DURATION_SEC = "5"
}

$comfyKey = [Environment]::GetEnvironmentVariable("A11_COMFY_ORG_API_KEY", "User")
if (-not $comfyKey) {
  $comfyKey = [Environment]::GetEnvironmentVariable("COMFY_ORG_API_KEY", "User")
}
if (-not $comfyKey -and (Test-Path -LiteralPath $ApiKeyFile)) {
  $comfyKey = (Get-Content -LiteralPath $ApiKeyFile -Raw).Trim()
}
if (-not $comfyKey) {
  throw "Cle Comfy Org absente. Mets-la en variable A11_COMFY_ORG_API_KEY ou passe -ApiKeyFile."
}
$env:A11_COMFY_ORG_API_KEY = $comfyKey
$env:COMFY_ORG_API_KEY = $comfyKey

$videoProxyToken = [Environment]::GetEnvironmentVariable("A11_VIDEO_PROXY_TOKEN", "User")
if (-not $videoProxyToken) {
  $videoProxyToken = [Environment]::GetEnvironmentVariable("A11_VIDEO_BRIDGE_TOKEN", "User")
}
if ($videoProxyToken) {
  $env:A11_VIDEO_PROXY_TOKEN = $videoProxyToken
  $env:A11_VIDEO_BRIDGE_TOKEN = $videoProxyToken
}

function Test-HttpOk([string]$Url) {
  try {
    $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 8
    return [int]$response.StatusCode -ge 200 -and [int]$response.StatusCode -lt 500
  } catch {
    return $false
  }
}

$comfyHealthUrl = "http://$ComfyHost`:$ComfyPort/system_stats"
if (-not (Test-HttpOk $comfyHealthUrl)) {
  $comfyOut = Join-Path $logDir "comfy-server.out.log"
  $comfyErr = Join-Path $logDir "comfy-server.err.log"
  $comfyArgs = @(
    "main.py",
    "--listen", $ComfyHost,
    "--port", "$ComfyPort",
    "--disable-auto-launch",
    "--lowvram",
    "--reserve-vram", "1",
    "--output-directory", $outputDir,
    "--temp-directory", $tempDir
  )
  if ($DisableCustomNodes) {
    $comfyArgs += "--disable-all-custom-nodes"
  }
  Start-Process -FilePath $Python `
    -WorkingDirectory $ComfyRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput $comfyOut `
    -RedirectStandardError $comfyErr `
    -ArgumentList $comfyArgs | Out-Null

  $deadline = (Get-Date).AddSeconds(90)
  do {
    Start-Sleep -Seconds 3
    if (Test-HttpOk $comfyHealthUrl) { break }
  } while ((Get-Date) -lt $deadline)
}

if (-not (Test-HttpOk $comfyHealthUrl)) {
  throw "ComfyUI ne repond pas sur $comfyHealthUrl"
}

$wanInfoUrl = "http://$ComfyHost`:$ComfyPort/object_info/WanImageToVideoApi"
if (-not (Test-HttpOk $wanInfoUrl)) {
  throw "Noeud WanImageToVideoApi introuvable dans ComfyUI"
}

if (-not $NoRunner) {
  $runnerHealthUrl = "http://$RunnerHost`:$RunnerPort/health"
  if (-not (Test-HttpOk $runnerHealthUrl)) {
    $runnerOut = Join-Path $logDir "comfy-wan-runner.out.log"
    $runnerErr = Join-Path $logDir "comfy-wan-runner.err.log"
    Start-Process -FilePath $Python `
      -WorkingDirectory (Split-Path -Parent $runner) `
      -WindowStyle Hidden `
      -RedirectStandardOutput $runnerOut `
      -RedirectStandardError $runnerErr `
      -ArgumentList @(
        $runner,
        "--host", $RunnerHost,
        "--port", "$RunnerPort",
        "--comfy-url", "http://$ComfyHost`:$ComfyPort",
        "--public-copy-dir", $publicCopyDir
      ) | Out-Null

    $deadline = (Get-Date).AddSeconds(45)
    do {
      Start-Sleep -Seconds 2
      if (Test-HttpOk $runnerHealthUrl) { break }
    } while ((Get-Date) -lt $deadline)
  }

  if (-not (Test-HttpOk $runnerHealthUrl)) {
    throw "Runner Comfy/Wan ne repond pas sur $runnerHealthUrl"
  }
}

Write-Host "A11 Comfy/Wan API pret"
Write-Host "  Comfy:  http://$ComfyHost`:$ComfyPort"
if (-not $NoRunner) {
  Write-Host "  Runner: $env:A11_VIDEO_LOCAL_RUNNER_URL"
}
Write-Host "  Cle:    presente"
Write-Host "  Sorties: $outputDir"
Write-Host "  Cache:   $WorkRoot"
