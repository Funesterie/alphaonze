param(
  [string]$InstallDir = "D:\agent-bus\voice\XTTS-RVC-UI",
  [string]$RemoteUrls = "https://a11.funesterie.me,https://k44.funesterie.me,https://vivy.funesterie.me",
  [string]$TokenFile = "D:\projets\funesterie\secrets\local-gpu-worker-token.txt",
  [string]$StatusPath = "D:\agent-bus\voice\local-gpu-worker-status.json",
  [ValidateSet("auto", "cuda", "cpu")]
  [string]$Device = "auto",
  [switch]$Visible
)

$ErrorActionPreference = "Stop"

$bridgePort = 5000
$healthUrl = "http://127.0.0.1:$bridgePort/health"
$workerScript = Join-Path $PSScriptRoot "local-gpu-voice-worker.cjs"
$logDir = Join-Path $InstallDir "logs"
$bridgeStdout = Join-Path $logDir "xtts-rvc-bridge.stdout.log"
$bridgeStderr = Join-Path $logDir "xtts-rvc-bridge.stderr.log"
$workerStdout = Join-Path $logDir "local-gpu-worker.stdout.log"
$workerStderr = Join-Path $logDir "local-gpu-worker.stderr.log"

function Write-Step {
  param([string]$Message)
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Find-BridgePython {
  $candidates = @(
    (Join-Path $InstallDir ".venv310\Scripts\python.exe"),
    (Join-Path $InstallDir ".venv311\Scripts\python.exe"),
    (Join-Path $InstallDir ".venv\Scripts\python.exe")
  )
  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate) { return $candidate }
  }
  throw "Aucun Python XTTS/RVC trouve dans $InstallDir. Lance d'abord Start-XttsRvcUi.ps1."
}

function Test-BridgeHealth {
  try {
    $response = Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 3
    return ($response.StatusCode -ge 200 -and $response.StatusCode -lt 300)
  } catch {
    return $false
  }
}

function New-WorkerTokenIfMissing {
  if (Test-Path -LiteralPath $TokenFile) {
    $existing = (Get-Content -LiteralPath $TokenFile -Raw).Trim()
    if ($existing) { return }
  }
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $TokenFile) | Out-Null
  $bytes = [byte[]]::new(32)
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $rng.GetBytes($bytes)
  } finally {
    if ($rng) { $rng.Dispose() }
  }
  $token = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
  Set-Content -LiteralPath $TokenFile -Value $token -Encoding ASCII
}

function Resolve-Device {
  param([string]$Python)
  if ($Device -eq "cpu") { return "cpu" }
  if ($Device -eq "cuda") { return "cuda:0" }
  $probe = @'
import sys
try:
    import torch
    if torch.cuda.is_available():
        x = torch.ones((1,), device="cuda")
        torch.cuda.synchronize()
        print("cuda")
    else:
        print("cpu")
except Exception as exc:
    print("cpu")
'@
  $resolved = ($probe | & $Python -).Trim().Split("`n")[-1].Trim().ToLowerInvariant()
  if ($resolved -eq "cuda") { return "cuda:0" }
  return "cpu"
}

New-Item -ItemType Directory -Force -Path $logDir | Out-Null
New-WorkerTokenIfMissing

$python = Find-BridgePython
$resolvedDevice = Resolve-Device -Python $python
$bridgeFile = Join-Path $InstallDir "funesterie_xtts_rvc_api.py"
if (-not (Test-Path -LiteralPath $bridgeFile)) {
  throw "Bridge XTTS/RVC introuvable: $bridgeFile"
}
if (-not (Test-Path -LiteralPath $workerScript)) {
  throw "Worker local introuvable: $workerScript"
}

if (-not (Test-BridgeHealth)) {
  Write-Step "Demarrage pont voix local ($resolvedDevice)"
  $envBlock = @"
`$env:A11_XTTS_RVC_DEVICE='$resolvedDevice'
`$env:A11_XTTS_RVC_HOST='127.0.0.1'
`$env:A11_XTTS_RVC_PORT='$bridgePort'
`$env:A11_XTTS_RVC_ROOT='$InstallDir'
`$env:TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD='1'
Set-Location -LiteralPath '$InstallDir'
& '$python' '$bridgeFile' 1>> '$bridgeStdout' 2>> '$bridgeStderr'
"@
  $windowStyle = if ($Visible) { "Normal" } else { "Hidden" }
  Start-Process -FilePath "powershell.exe" -WindowStyle $windowStyle -ArgumentList @(
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    $envBlock
  ) | Out-Null
}

$deadline = (Get-Date).AddSeconds(120)
while ((Get-Date) -lt $deadline) {
  if (Test-BridgeHealth) { break }
  Start-Sleep -Seconds 2
}
if (-not (Test-BridgeHealth)) {
  throw "Le pont voix local ne repond pas sur $healthUrl. Voir $bridgeStderr"
}

Write-Step "Demarrage worker GPU local"
$node = (Get-Command node -ErrorAction Stop).Source
$workerId = "$env:COMPUTERNAME-rtx5070-voice"
$workerEnv = @"
`$env:A11_LOCAL_GPU_WORKER_REMOTE_URLS='$RemoteUrls'
`$env:A11_LOCAL_GPU_WORKER_TOKEN_FILE='$TokenFile'
`$env:A11_LOCAL_GPU_VOICE_URL='http://127.0.0.1:$bridgePort'
`$env:A11_LOCAL_GPU_WORKER_STATUS_PATH='$StatusPath'
`$env:A11_LOCAL_GPU_WORKER_ID='$workerId'
Set-Location -LiteralPath 'D:\projets\funesterie'
& '$node' '$workerScript' 1>> '$workerStdout' 2>> '$workerStderr'
"@
$windowStyle = if ($Visible) { "Normal" } else { "Hidden" }
Start-Process -FilePath "powershell.exe" -WindowStyle $windowStyle -ArgumentList @(
  "-NoProfile",
  "-ExecutionPolicy",
  "Bypass",
  "-Command",
  $workerEnv
) | Out-Null

Write-Host "Local GPU voice worker started."
Write-Host "  bridge: $healthUrl ($resolvedDevice)"
Write-Host "  status: $StatusPath"
Write-Host "  logs: $logDir"
