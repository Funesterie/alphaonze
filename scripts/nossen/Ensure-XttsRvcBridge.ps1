param(
  [string]$InstallDir = "D:\agent-bus\voice\XTTS-RVC-UI",
  [int]$Port = 5000,
  [int]$TimeoutSeconds = 90,
  [switch]$Visible
)

$ErrorActionPreference = "Stop"

$venvPython = Join-Path $InstallDir ".venv311\Scripts\python.exe"
$bridgeFile = Join-Path $InstallDir "funesterie_xtts_rvc_api.py"
$healthUrl = "http://127.0.0.1:$Port/health"
$logDir = Join-Path $InstallDir "logs"
$stdoutLog = Join-Path $logDir "xtts-rvc-bridge.stdout.log"
$stderrLog = Join-Path $logDir "xtts-rvc-bridge.stderr.log"

function Test-BridgeHealth {
  try {
    $response = Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 3
    return ($response.StatusCode -ge 200 -and $response.StatusCode -lt 300)
  } catch {
    return $false
  }
}

function Get-BridgeSummary {
  try {
    $json = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 5
    $styles = @()
    foreach ($name in @("terminator", "donna", "vivy")) {
      $item = $json.styles.$name
      if ($item) {
        $styles += "$name voice=$($item.hasVoice) rvc=$($item.hasRvc) index=$($item.hasIndex)"
      }
    }
    return "xtts=$($json.xttsModel) styles=[$($styles -join '; ')]"
  } catch {
    return "health reachable, summary unavailable"
  }
}

if (Test-BridgeHealth) {
  Write-Host "XTTS/RVC bridge already healthy: $healthUrl" -ForegroundColor Green
  Write-Host "  $(Get-BridgeSummary)"
  exit 0
}

if (-not (Test-Path -LiteralPath $InstallDir)) {
  throw "XTTS/RVC install dir is missing: $InstallDir"
}
if (-not (Test-Path -LiteralPath $venvPython)) {
  throw "Python venv is missing: $venvPython. Run a11\ops\voice\Start-XttsRvcUi.ps1 once."
}
if (-not (Test-Path -LiteralPath $bridgeFile)) {
  throw "Bridge file is missing: $bridgeFile. Run a11\ops\voice\Start-XttsRvcUi.ps1 once."
}

New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$windowStyle = if ($Visible) { "Normal" } else { "Hidden" }
$envBlock = @"
`$env:A11_XTTS_RVC_DEVICE='cpu'
`$env:A11_XTTS_RVC_HOST='127.0.0.1'
`$env:A11_XTTS_RVC_PORT='$Port'
`$env:A11_XTTS_RVC_ROOT='$InstallDir'
Set-Location -LiteralPath '$InstallDir'
& '$venvPython' '$bridgeFile' 1>> '$stdoutLog' 2>> '$stderrLog'
"@

Write-Host "Starting XTTS/RVC bridge on $healthUrl" -ForegroundColor Cyan
Start-Process -FilePath "powershell.exe" -WindowStyle $windowStyle -ArgumentList @(
  "-NoProfile",
  "-ExecutionPolicy",
  "Bypass",
  "-Command",
  $envBlock
)

$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Seconds 2
  if (Test-BridgeHealth) {
    Write-Host "XTTS/RVC bridge healthy: $healthUrl" -ForegroundColor Green
    Write-Host "  $(Get-BridgeSummary)"
    Write-Host "  stdout: $stdoutLog" -ForegroundColor DarkGray
    Write-Host "  stderr: $stderrLog" -ForegroundColor DarkGray
    exit 0
  }
}

Write-Host "XTTS/RVC bridge did not become healthy within ${TimeoutSeconds}s." -ForegroundColor Red
Write-Host "  stdout: $stdoutLog" -ForegroundColor DarkGray
Write-Host "  stderr: $stderrLog" -ForegroundColor DarkGray
exit 1
