$ErrorActionPreference = 'Stop'

$script:HadErrors = $false
$cliArgs = @($args | ForEach-Object { [string]$_ })

function Has-Flag {
  param([string]$Flag)
  return $cliArgs -contains $Flag
}

function Resolve-FirstExistingPath {
  param([string[]]$Candidates)
  foreach ($candidate in $Candidates) {
    if ([string]::IsNullOrWhiteSpace($candidate)) { continue }
    if (Test-Path $candidate) { return $candidate }
  }
  return $null
}

function Get-A11R2Secrets {
  param([string]$Path)

  $result = [ordered]@{
    Endpoint = ''
    AccessKey = ''
    SecretKey = ''
    Bucket = 'a11-files'
    PublicBaseUrl = 'https://files.funesterie.me'
  }

  if (-not (Test-Path $Path)) {
    return [pscustomobject]$result
  }

  $lines = Get-Content -Path $Path
  $r2Index = -1
  for ($i = 0; $i -lt $lines.Count; $i++) {
    if ([string]$lines[$i] -match '^\s*R2\s*$') {
      $r2Index = $i
      break
    }
  }

  if ($r2Index -lt 0) {
    return [pscustomobject]$result
  }

  for ($i = $r2Index + 1; $i -lt $lines.Count; $i++) {
    $line = [string]$lines[$i]
    $trimmed = $line.Trim()
    if (-not $trimmed) { continue }
    if ($trimmed -match '^JWT SECRET=') { break }

    if (-not $result.Endpoint -and $trimmed -match '^https://.+\.r2\.cloudflarestorage\.com/?$') {
      $result.Endpoint = $trimmed
      continue
    }
    if (-not $result.AccessKey -and $trimmed -match '^[A-Fa-f0-9]{32}$') {
      $result.AccessKey = $trimmed
      continue
    }
    if (-not $result.SecretKey -and $trimmed -match '^[A-Fa-f0-9]{64}$') {
      $result.SecretKey = $trimmed
      continue
    }
  }

  return [pscustomobject]$result
}

function Get-ListeningProcessInfo {
  param([int]$Port)

  try {
    $connection = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction Stop | Select-Object -First 1
    if ($connection) {
      return [pscustomobject]@{
        Pid = [int]$connection.OwningProcess
      }
    }
  } catch {
  }

  $match = netstat -ano | Select-String -Pattern "^\s*TCP\s+\S+:$Port\s+\S+\s+LISTENING\s+(\d+)\s*$" | Select-Object -First 1
  if ($match -and $match.Matches.Count -gt 0) {
    return [pscustomobject]@{
      Pid = [int]$match.Matches[0].Groups[1].Value
    }
  }

  return $null
}

function Get-ProcessInfoByImageName {
  param([string]$ImageName)

  try {
    return Get-CimInstance Win32_Process -Filter "Name = '$ImageName'" -ErrorAction Stop | Select-Object -First 1
  } catch {
    return $null
  }
}

function Get-CommandPath {
  param([string]$Name)

  try {
    return (Get-Command $Name -ErrorAction Stop).Source
  } catch {
    return $null
  }
}

function Mark-Error {
  param([string]$Message)
  $script:HadErrors = $true
  Write-Host $Message -ForegroundColor Red
}

function Write-LauncherFatalLog {
  param([string]$Message)

  try {
    $baseDir = Split-Path -Parent $PSCommandPath
    $runtimeDir = Join-Path $baseDir 'runtime'
    $logDir = Join-Path $runtimeDir 'logs'
    New-Item -ItemType Directory -Force -Path $logDir | Out-Null
    $fatalLogPath = Join-Path $logDir 'start-prod-a11.fatal.log'
    $timestamp = Get-Date -Format o
    Add-Content -Path $fatalLogPath -Value "[$timestamp] $Message"
  } catch {
  }
}

trap {
  $exceptionMessage = if ($_.Exception) { $_.Exception.Message } else { [string]$_ }
  $errorDump = ($_ | Out-String).Trim()

  Mark-Error "[FATAL] $exceptionMessage"
  Write-LauncherFatalLog -Message $errorDump

  $shouldPause = $true
  try {
    $shouldPause = [bool](Get-Variable -Name pauseAtEnd -ValueOnly -ErrorAction Stop)
  } catch {
  }

  if ($shouldPause) {
    [void](Read-Host 'Erreur fatale. Appuie sur Entree pour fermer ce lanceur')
  }

  exit 1
}

function Test-HttpTarget {
  param(
    [string]$Name,
    [string]$Url
  )

  try {
    $response = Invoke-WebRequest -Uri $Url -Method Get -UseBasicParsing -TimeoutSec 12
    Write-Host ("[A11 PROD] {0} OK  : {1}" -f $Name, $response.StatusCode)
  } catch {
    Write-Host ("[A11 PROD] {0} ERR : {1}" -f $Name, $_.Exception.Message)
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
    [int]$TimeoutSec = 60
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  do {
    if (Test-HttpHealthy -Url $Url -TimeoutSec 8) {
      Write-Host ("[A11 PROD] {0} HEALTHY : {1}" -f $Name, $Url)
      return $true
    }
    Start-Sleep -Seconds 3
  } while ((Get-Date) -lt $deadline)

  Mark-Error ("[ERR] {0} health timeout : {1}" -f $Name, $Url)
  return $false
}

function Start-ManagedProcess {
  param(
    [string]$Name,
    [string]$WorkingDirectory,
    [string]$FilePath,
    [string[]]$ArgumentList = @(),
    [hashtable]$Environment = @{},
    [string]$LogName = $Name,
    [bool]$ShowWindow = $false
  )

  if (-not $FilePath) {
    Mark-Error "[ERR] Executable introuvable pour $Name."
    return $null
  }

  $stdoutPath = Join-Path $launcherLogDir "$LogName.out.log"
  $stderrPath = Join-Path $launcherLogDir "$LogName.err.log"
  $previousEnv = @{}

  foreach ($entry in $Environment.GetEnumerator()) {
    $key = [string]$entry.Key
    $previousEnv[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
    [Environment]::SetEnvironmentVariable($key, [string]$entry.Value, 'Process')
  }

  try {
    $params = @{
      FilePath = $FilePath
      ArgumentList = $ArgumentList
      WorkingDirectory = $WorkingDirectory
      RedirectStandardOutput = $stdoutPath
      RedirectStandardError = $stderrPath
      PassThru = $true
    }
    if ($ShowWindow) {
      $params.WindowStyle = 'Normal'
    } else {
      $params.WindowStyle = 'Hidden'
    }

    $process = Start-Process @params
    Write-Host "[A11 PROD] $Name demarre (PID $($process.Id)). Logs: $stdoutPath"
    return $process
  } catch {
    Mark-Error "[ERR] Echec lancement $Name : $($_.Exception.Message)"
    return $null
  } finally {
    foreach ($entry in $previousEnv.GetEnumerator()) {
      [Environment]::SetEnvironmentVariable([string]$entry.Key, $entry.Value, 'Process')
    }
  }
}

$launchersDir = Split-Path -Parent $PSCommandPath
$workspaceRoot = Split-Path -Parent $launchersDir
$launcherRuntimeDir = Join-Path $launchersDir 'runtime'
$launcherLogDir = Join-Path $launcherRuntimeDir 'logs'
New-Item -ItemType Directory -Force -Path $launcherLogDir | Out-Null

$frontendUrl = 'https://a11.funesterie.pro'
$frontendLaunchUrl = '{0}?launcher=1&a11-reset-api-override=1&a11-force-api-mode=online&v={1}' -f $frontendUrl, ([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())
$apiUrl = 'https://api.funesterie.pro'
$healthUrl = "$apiUrl/health"
$statusUrl = "$apiUrl/api/status"
$ttsPublicUrl = 'https://ttssiwis-production.up.railway.app/health'
$qflushPublicUrl = 'https://qflush-production.up.railway.app/health'
$cerberePublicUrl = 'https://cerbere.funesterie.me/health'
$sdPublicUrl = 'https://sd.funesterie.me/health'

$backendPort = 3000
$cerberePort = 4545
$llmPort = 8080
$localBackendBase = "http://127.0.0.1:$backendPort"
$localLlmBase = "http://127.0.0.1:$llmPort"
$localCerbereBase = "http://127.0.0.1:$cerberePort"

$openBrowser = -not (Has-Flag '--no-open')
$pauseAtEnd = -not (Has-Flag '--no-pause')
$showWindows = Has-Flag '--show-windows'
$startBackend = -not (Has-Flag '--no-backend')
$startLlm = -not (Has-Flag '--no-llm')
$startCerbere = -not (Has-Flag '--no-cerbere')
$startTunnel = -not (Has-Flag '--no-tunnel')
$restartTunnel = Has-Flag '--restart-tunnel'
$startNgrok = Has-Flag '--with-ngrok'
$checkOnly = Has-Flag '--check-only'

if ($checkOnly) {
  $openBrowser = $false
  $startLlm = $false
  $startCerbere = $false
  $startTunnel = $false
  $startNgrok = $false
}

if ($env:A11_PROD_NO_OPEN -eq '1') { $openBrowser = $false }
if ($env:A11_PROD_NO_PAUSE -eq '1') { $pauseAtEnd = $false }
if ($env:A11_PROD_NO_BACKEND -eq '1') { $startBackend = $false }
if ($env:A11_PROD_NO_LLM -eq '1') { $startLlm = $false }
if ($env:A11_PROD_NO_CERBERE -eq '1') { $startCerbere = $false }
if ($env:A11_PROD_NO_TUNNEL -eq '1') { $startTunnel = $false }
if ($env:A11_PROD_RESTART_TUNNEL -eq '1') { $restartTunnel = $true }
if ($env:A11_PROD_USE_NGROK -eq '1') { $startNgrok = $true }
if ($env:A11_PROD_NO_NGROK -eq '1') { $startNgrok = $false }

$nodeExe = Get-CommandPath 'node'
$powershellExe = Get-CommandPath 'powershell'
$llmExe = Resolve-FirstExistingPath @(
  (Join-Path $workspaceRoot 'a11llm\llm\server\llama-server.exe'),
  'D:\funesterie\a11\a11llm\llm\server\llama-server.exe'
)

$modelPath = Resolve-FirstExistingPath @(
  (Join-Path $workspaceRoot 'a11llm\llm\models\Llama-3.2-3B-Instruct-Q4_K_M.gguf'),
  'D:\funesterie\a11\a11llm\llm\models\Llama-3.2-3B-Instruct-Q4_K_M.gguf'
)

$backendScript = Resolve-FirstExistingPath @(
  (Join-Path $workspaceRoot 'a11backendrailway\apps\server\server.cjs'),
  'D:\funesterie\a11\a11backendrailway\apps\server\server.cjs'
)

$cerbereScript = Resolve-FirstExistingPath @(
  (Join-Path $workspaceRoot 'a11backendrailway\apps\server\llm-router.mjs'),
  'D:\funesterie\a11\a11backendrailway\apps\server\llm-router.mjs'
)

$sdScriptPath = Resolve-FirstExistingPath @(
  (Join-Path $workspaceRoot 'a11backendrailway\apps\server\tools\sd\generate_sd_image.py'),
  (Join-Path $workspaceRoot 'a11llm\scripts\generate_sd_image.py'),
  'D:\funesterie\a11\a11backendrailway\apps\server\tools\sd\generate_sd_image.py',
  'D:\funesterie\a11\a11llm\scripts\generate_sd_image.py'
)

$sdPythonExe = Resolve-FirstExistingPath @(
  (Join-Path $workspaceRoot 'a11llm\scripts\venv\Scripts\python.exe'),
  'D:\funesterie\a11\a11llm\scripts\venv\Scripts\python.exe'
)

$sdOutputDir = Join-Path $workspaceRoot 'tmp\a11-images'
$downloadGuidePath = Join-Path $launchersDir 'LLM_DOWNLOAD_LINKS.md'
$keyFilePath = Join-Path $env:USERPROFILE 'Desktop\a11key.txt'
$r2Secrets = Get-A11R2Secrets -Path $keyFilePath

$tunnelLauncher = Resolve-FirstExistingPath @(
  (Join-Path $launchersDir 'start-cerbere-cloudflare-tunnel.ps1'),
  (Join-Path $launchersDir 'start-cloudflare-tunnel.ps1')
)

$ngrokExe = Resolve-FirstExistingPath @(
  (Join-Path $workspaceRoot 'a11backendrailway\apps\tts\ngrok.exe'),
  (Join-Path $workspaceRoot 'a11llm\llm\ngrok.exe'),
  (Join-Path $workspaceRoot 'ngrok.exe'),
  'D:\Tools\ngrok\ngrok.exe',
  'D:\funesterie\a11\ngrok.exe'
)

Write-Host "[A11 PROD] Launchers      : $launchersDir"
Write-Host "[A11 PROD] Workspace root : $workspaceRoot"
Write-Host "[A11 PROD] Frontend      : $frontendUrl"
Write-Host "[A11 PROD] API           : $apiUrl"
Write-Host "[A11 PROD] Health        : $healthUrl"
Write-Host "[A11 PROD] Status        : $statusUrl"
Write-Host "[A11 PROD] TTS public    : $ttsPublicUrl"
Write-Host "[A11 PROD] Qflush public : $qflushPublicUrl"
Write-Host "[A11 PROD] SD public     : $sdPublicUrl"
Write-Host "[A11 PROD] Backend local : $localBackendBase"
Write-Host "[A11 PROD] Cerbere local : $localCerbereBase"
Write-Host "[A11 PROD] Cerbere public: $cerberePublicUrl"
Write-Host "[A11 PROD] Node         : $nodeExe"
Write-Host "[A11 PROD] PowerShell   : $powershellExe"
Write-Host "[A11 PROD] Backend      : $backendScript"
Write-Host "[A11 PROD] LLM exe       : $llmExe"
Write-Host "[A11 PROD] LLM model     : $modelPath"
Write-Host "[A11 PROD] Cerbere      : $cerbereScript"
Write-Host "[A11 PROD] SD script     : $sdScriptPath"
Write-Host "[A11 PROD] SD python     : $sdPythonExe"
Write-Host "[A11 PROD] Tunnel script: $tunnelLauncher"
Write-Host "[A11 PROD] ngrok         : $ngrokExe"
Write-Host "[A11 PROD] Downloads     : $downloadGuidePath"
Write-Host "[A11 PROD] R2 key file   : $keyFilePath"
Write-Host "[A11 PROD] Logs          : $launcherLogDir"
Write-Host ""

Test-HttpTarget -Name 'Frontend' -Url $frontendUrl
Test-HttpTarget -Name 'API health' -Url $healthUrl
Test-HttpTarget -Name 'API status' -Url $statusUrl
Test-HttpTarget -Name 'TTS public' -Url $ttsPublicUrl
Test-HttpTarget -Name 'Qflush public' -Url $qflushPublicUrl
Test-HttpTarget -Name 'SD public' -Url $sdPublicUrl
Test-HttpTarget -Name 'Cerbere public' -Url $cerberePublicUrl

if ($startBackend) {
  $portInfo = Get-ListeningProcessInfo -Port $backendPort
  if ($portInfo) {
    Write-Host "[WARN] Backend local deja actif sur $backendPort (PID $($portInfo.Pid)). Lancement saute."
  } elseif (-not $nodeExe) {
    Mark-Error '[ERR] Node.js introuvable pour lancer le backend local.'
  } elseif (-not $backendScript) {
    Mark-Error '[ERR] Backend local introuvable.'
  } elseif ($checkOnly) {
    Write-Host "[CHECK] Backend local pret : $backendScript"
  } else {
    $backendEnvironment = @{
      PORT = "$backendPort"
      BACKEND = 'local'
      LLM_ROUTER_URL = $localCerbereBase
      LOCAL_LLM_URL = $localLlmBase
      LLAMA_BASE = $localLlmBase
      A11_SD_PROXY_URL = ''
      SD_PROXY_URL = ''
      ENABLE_SD = $(if ($sdScriptPath) { 'true' } else { 'false' })
      SD_OUTPUT_DIR = $sdOutputDir
      PUBLIC_API_URL = 'https://api.funesterie.pro'
      A11_ALLOW_PUBLIC_TUNNEL_LLM = '1'
      QFLUSH_REMOTE_URL = 'https://qflush-production.up.railway.app'
    }
    if ($sdScriptPath) {
      $backendEnvironment['SD_SCRIPT_PATH'] = $sdScriptPath
    }
    if ($sdPythonExe) {
      $backendEnvironment['SD_PYTHON_PATH'] = $sdPythonExe
    }
    if ($r2Secrets.Endpoint) {
      $backendEnvironment['R2_ENDPOINT'] = $r2Secrets.Endpoint
    }
    if ($r2Secrets.AccessKey) {
      $backendEnvironment['R2_ACCESS_KEY'] = $r2Secrets.AccessKey
    }
    if ($r2Secrets.SecretKey) {
      $backendEnvironment['R2_SECRET_KEY'] = $r2Secrets.SecretKey
    }
    if ($r2Secrets.Bucket) {
      $backendEnvironment['R2_BUCKET'] = $r2Secrets.Bucket
    }
    if ($r2Secrets.PublicBaseUrl) {
      $backendEnvironment['R2_PUBLIC_BASE_URL'] = $r2Secrets.PublicBaseUrl
    }

    Start-ManagedProcess `
      -Name 'A11 PROD BACKEND LOCAL' `
      -WorkingDirectory (Split-Path -Parent $backendScript) `
      -FilePath $nodeExe `
      -ArgumentList @($backendScript) `
      -Environment $backendEnvironment `
      -LogName 'prod-backend-local' `
      -ShowWindow $showWindows | Out-Null
  }
} else {
  Write-Host '[A11 PROD] Backend local desactive.'
}

if ($startLlm) {
  $portInfo = Get-ListeningProcessInfo -Port $llmPort
  $llmHealthUrl = "$localLlmBase/health"
  if ($portInfo -and (Test-HttpHealthy -Url $llmHealthUrl)) {
    Write-Host "[WARN] LLM deja actif sur $llmPort (PID $($portInfo.Pid)). Lancement saute."
  } elseif ($portInfo) {
    Write-Host "[WARN] LLM detecte sur $llmPort (PID $($portInfo.Pid)) mais health KO. Redemarrage..."
    try {
      Stop-Process -Id $portInfo.Pid -Force -ErrorAction Stop
      Start-Sleep -Seconds 2
    } catch {
      Mark-Error "[ERR] Impossible de redemarrer le LLM sur $llmPort : $($_.Exception.Message)"
    }
  } elseif (-not $llmExe) {
    Mark-Error '[ERR] LLM non trouve.'
  } elseif (-not $modelPath) {
    Mark-Error '[ERR] Modele LLM introuvable.'
  } elseif ($checkOnly) {
    Write-Host "[CHECK] LLM pret : $llmExe"
  } else {
    Start-ManagedProcess `
      -Name 'A11 PROD LLM' `
      -WorkingDirectory (Split-Path -Parent $llmExe) `
      -FilePath $llmExe `
      -ArgumentList @('-m', $modelPath, '--port', "$llmPort", '--host', '127.0.0.1') `
      -Environment @{} `
      -LogName 'prod-llama-server' `
      -ShowWindow $showWindows | Out-Null
    Wait-HttpHealthy -Name 'LLM local' -Url $llmHealthUrl -TimeoutSec 90 | Out-Null
  }
} else {
  Write-Host '[A11 PROD] LLM local desactive.'
}

if ($startCerbere) {
  $portInfo = Get-ListeningProcessInfo -Port $cerberePort
  $cerbereHealthUrl = "$localCerbereBase/health"
  if ($portInfo -and (Test-HttpHealthy -Url $cerbereHealthUrl)) {
    Write-Host "[WARN] Cerbere deja actif sur $cerberePort (PID $($portInfo.Pid)). Lancement saute."
  } elseif ($portInfo) {
    Write-Host "[WARN] Cerbere detecte sur $cerberePort (PID $($portInfo.Pid)) mais health KO. Redemarrage..."
    try {
      Stop-Process -Id $portInfo.Pid -Force -ErrorAction Stop
      Start-Sleep -Seconds 2
    } catch {
      Mark-Error "[ERR] Impossible de redemarrer Cerbere sur $cerberePort : $($_.Exception.Message)"
    }
  } elseif (-not $nodeExe) {
    Mark-Error '[ERR] Node.js introuvable pour lancer Cerbere.'
  } elseif (-not $cerbereScript) {
    Mark-Error '[ERR] Script Cerbere introuvable.'
  } elseif ($checkOnly) {
    Write-Host "[CHECK] Cerbere pret : $cerbereScript"
  } else {
    Start-ManagedProcess `
      -Name 'A11 PROD CERBERE' `
      -WorkingDirectory (Split-Path -Parent $cerbereScript) `
      -FilePath $nodeExe `
      -ArgumentList @($cerbereScript) `
      -Environment @{
        PORT = "$cerberePort"
        LLM_ROUTER_PORT = "$cerberePort"
        LOCAL_LLM_PORT = "$llmPort"
        LLAMA_PORT = "$llmPort"
        LOCAL_LLM_URL = $localLlmBase
        LLAMA_BASE = $localLlmBase
        QFLUSH_REMOTE_URL = 'https://qflush-production.up.railway.app'
      } `
      -LogName 'prod-cerbere' `
      -ShowWindow $showWindows | Out-Null
    Wait-HttpHealthy -Name 'Cerbere local' -Url $cerbereHealthUrl -TimeoutSec 45 | Out-Null
  }
} else {
  Write-Host '[A11 PROD] Cerbere local desactive.'
}

if ($startTunnel) {
  if (-not $powershellExe) {
    Mark-Error '[ERR] PowerShell introuvable pour lancer le tunnel Cloudflare.'
  } elseif (-not $tunnelLauncher) {
    Mark-Error '[ERR] Script tunnel Cloudflare introuvable.'
  } elseif ($checkOnly) {
    Write-Host "[CHECK] Tunnel pret : $tunnelLauncher"
  } else {
    $tunnelArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $tunnelLauncher)
    if ($restartTunnel) {
      $tunnelArgs += '-RestartExisting'
    }

    Start-ManagedProcess `
      -Name 'A11 PROD CLOUDFLARE' `
      -WorkingDirectory $launchersDir `
      -FilePath $powershellExe `
      -ArgumentList $tunnelArgs `
      -Environment @{} `
      -LogName 'prod-cloudflared' `
      -ShowWindow $showWindows | Out-Null
  }
} else {
  Write-Host '[A11 PROD] Tunnel Cloudflare desactive.'
}

if ($startNgrok) {
  $processInfo = Get-ProcessInfoByImageName -ImageName 'ngrok.exe'
  if ($processInfo) {
    Write-Host "[WARN] ngrok deja actif (PID $($processInfo.ProcessId)). Lancement saute."
  } elseif (-not $ngrokExe) {
    Mark-Error '[ERR] ngrok non trouve.'
  } elseif ($checkOnly) {
    Write-Host "[CHECK] ngrok pret : $ngrokExe"
  } else {
    Start-ManagedProcess `
      -Name 'A11 PROD NGROK' `
      -WorkingDirectory (Split-Path -Parent $ngrokExe) `
      -FilePath $ngrokExe `
      -ArgumentList @('http', "$llmPort") `
      -Environment @{} `
      -LogName 'prod-ngrok' `
      -ShowWindow $showWindows | Out-Null
  }
} else {
  Write-Host '[A11 PROD] ngrok legacy desactive (Cloudflare Tunnel actif ou prefere).'
}

if (-not $checkOnly) {
  Write-Host ""
  Write-Host "[A11 PROD] Verification finale post-demarrage..." -ForegroundColor Cyan
  Start-Sleep -Seconds 6
  Test-HttpTarget -Name 'Backend local health' -Url "$localBackendBase/health"
  Test-HttpTarget -Name 'LLM local health' -Url "$localLlmBase/health"
  Test-HttpTarget -Name 'Cerbere local health' -Url "$localCerbereBase/health"
  Test-HttpTarget -Name 'SD public final' -Url $sdPublicUrl
  Test-HttpTarget -Name 'Cerbere public final' -Url $cerberePublicUrl
}

if ($openBrowser) {
  Write-Host "[A11 PROD] Ouverture du frontend en production..."
  Start-Process $frontendLaunchUrl | Out-Null
}

Write-Host ""
Write-Host "[A11 PROD] Resume"
Write-Host "  - frontend prod : $frontendUrl"
Write-Host "  - api prod      : $apiUrl"
Write-Host "  - backend local : $localBackendBase"
Write-Host "  - llm local     : $localLlmBase"
Write-Host "  - cerbere local : $localCerbereBase"
Write-Host "  - cerbere public: $cerberePublicUrl"
Write-Host "  - sd public     : $sdPublicUrl"
Write-Host "  - downloads     : $downloadGuidePath"
Write-Host "  - logs          : $launcherLogDir"
Write-Host ""
Write-Host "[A11 PROD] Utilisation :"
Write-Host "  - normal        : double-clic sur ce fichier"
Write-Host "  - check only    : start-prod-a11.bat --check-only"
Write-Host "  - sans pause    : start-prod-a11.bat --no-pause"
Write-Host "  - sans backend  : start-prod-a11.bat --no-backend"
Write-Host "  - sans LLM      : start-prod-a11.bat --no-llm"
Write-Host "  - sans Cerbere  : start-prod-a11.bat --no-cerbere"
Write-Host "  - sans tunnel   : start-prod-a11.bat --no-tunnel"
Write-Host "  - relance tunnel: start-prod-a11.bat --restart-tunnel"
Write-Host "  - mode legacy   : start-prod-a11.bat --with-ngrok (fallback seulement)"
Write-Host "  - voir consoles : start-prod-a11.bat --show-windows"
Write-Host ""
Write-Host "[A11 PROD] Le site et l'API restent en ligne ; le local sert au backend image + LLM + Cerbere + tunnel."
Write-Host "[A11 PROD] Railway doit viser https://cerbere.funesterie.me pour le LLM routeur distant."
Write-Host "[A11 PROD] Railway doit viser https://sd.funesterie.me/api/tools/generate_sd pour la generation d'image distante."
Write-Host "[A11 PROD] Si cloudflared tournait deja en mode token, lance une fois avec --restart-tunnel."

if ($pauseAtEnd) {
  [void](Read-Host 'Appuie sur Entree pour fermer ce lanceur')
}

if ($script:HadErrors) { exit 1 }
exit 0
