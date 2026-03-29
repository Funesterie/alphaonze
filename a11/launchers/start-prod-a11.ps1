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
$apiUrl = 'https://api.funesterie.pro'
$healthUrl = "$apiUrl/health"
$statusUrl = "$apiUrl/api/status"
$ttsPublicUrl = 'https://ttssiwis-production.up.railway.app/health'
$qflushPublicUrl = 'https://qflush-production.up.railway.app/health'
$cerberePublicUrl = 'https://cerbere.funesterie.me/health'

$cerberePort = 4545
$llmPort = 8080
$localLlmBase = "http://127.0.0.1:$llmPort"
$localCerbereBase = "http://127.0.0.1:$cerberePort"

$openBrowser = -not (Has-Flag '--no-open')
$pauseAtEnd = -not (Has-Flag '--no-pause')
$showWindows = Has-Flag '--show-windows'
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

$cerbereScript = Resolve-FirstExistingPath @(
  (Join-Path $workspaceRoot 'a11backendrailway\apps\server\llm-router.mjs'),
  'D:\funesterie\a11\a11backendrailway\apps\server\llm-router.mjs'
)

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
Write-Host "[A11 PROD] Cerbere local : $localCerbereBase"
Write-Host "[A11 PROD] Cerbere public: $cerberePublicUrl"
Write-Host "[A11 PROD] Node         : $nodeExe"
Write-Host "[A11 PROD] PowerShell   : $powershellExe"
Write-Host "[A11 PROD] LLM exe       : $llmExe"
Write-Host "[A11 PROD] Cerbere      : $cerbereScript"
Write-Host "[A11 PROD] Tunnel script: $tunnelLauncher"
Write-Host "[A11 PROD] ngrok         : $ngrokExe"
Write-Host "[A11 PROD] Logs          : $launcherLogDir"
Write-Host ""

Test-HttpTarget -Name 'Frontend' -Url $frontendUrl
Test-HttpTarget -Name 'API health' -Url $healthUrl
Test-HttpTarget -Name 'API status' -Url $statusUrl
Test-HttpTarget -Name 'TTS public' -Url $ttsPublicUrl
Test-HttpTarget -Name 'Qflush public' -Url $qflushPublicUrl
Test-HttpTarget -Name 'Cerbere public' -Url $cerberePublicUrl

if ($startLlm) {
  $portInfo = Get-ListeningProcessInfo -Port $llmPort
  if ($portInfo) {
    Write-Host "[WARN] LLM deja actif sur $llmPort (PID $($portInfo.Pid)). Lancement saute."
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
  }
} else {
  Write-Host '[A11 PROD] LLM local desactive.'
}

if ($startCerbere) {
  $portInfo = Get-ListeningProcessInfo -Port $cerberePort
  if ($portInfo) {
    Write-Host "[WARN] Cerbere deja actif sur $cerberePort (PID $($portInfo.Pid)). Lancement saute."
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
  Write-Host '[A11 PROD] ngrok desactive.'
}

if ($openBrowser) {
  Write-Host "[A11 PROD] Ouverture du frontend en production..."
  Start-Process $frontendUrl | Out-Null
}

Write-Host ""
Write-Host "[A11 PROD] Resume"
Write-Host "  - frontend prod : $frontendUrl"
Write-Host "  - api prod      : $apiUrl"
Write-Host "  - llm local     : $localLlmBase"
Write-Host "  - cerbere local : $localCerbereBase"
Write-Host "  - cerbere public: $cerberePublicUrl"
Write-Host "  - logs          : $launcherLogDir"
Write-Host ""
Write-Host "[A11 PROD] Utilisation :"
Write-Host "  - normal        : double-clic sur ce fichier"
Write-Host "  - check only    : start-prod-a11.bat --check-only"
Write-Host "  - sans pause    : start-prod-a11.bat --no-pause"
Write-Host "  - sans LLM      : start-prod-a11.bat --no-llm"
Write-Host "  - sans Cerbere  : start-prod-a11.bat --no-cerbere"
Write-Host "  - sans tunnel   : start-prod-a11.bat --no-tunnel"
Write-Host "  - relance tunnel: start-prod-a11.bat --restart-tunnel"
Write-Host "  - mode legacy   : start-prod-a11.bat --with-ngrok"
Write-Host "  - voir consoles : start-prod-a11.bat --show-windows"
Write-Host ""
Write-Host "[A11 PROD] Le site et l'API restent en ligne ; le local sert au couple LLM + Cerbere + tunnel."
Write-Host "[A11 PROD] Railway doit viser https://cerbere.funesterie.me pour le LLM routeur distant."
Write-Host "[A11 PROD] Si cloudflared tournait deja en mode token, lance une fois avec --restart-tunnel."

if ($pauseAtEnd) {
  [void](Read-Host 'Appuie sur Entree pour fermer ce lanceur')
}

if ($script:HadErrors) { exit 1 }
exit 0
