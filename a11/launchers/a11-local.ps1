param(
  [ValidateSet('start', 'desktop', 'stop', 'restart', 'status', 'status-json', 'check', 'package')]
  [string]$Command = 'start',
  [string]$ConfigPath = '',
  [switch]$NoOpen,
  [switch]$NoPause,
  [switch]$ShowWindows,
  [switch]$SkipUiBuild,
  [switch]$DryRun,
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
$script:HadErrors = $false

function Write-Info {
  param([string]$Message)
  Write-Host "[A11 LOCAL] $Message"
}

function Write-WarnLine {
  param([string]$Message)
  Write-Host "[WARN] $Message" -ForegroundColor Yellow
}

function Write-ErrorLine {
  param([string]$Message)
  $script:HadErrors = $true
  Write-Host "[ERR] $Message" -ForegroundColor Red
}

function Remove-DirectoryTreeBestEffort {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path,
    [string]$AllowedRoot = ''
  )

  if (-not (Test-Path -LiteralPath $Path)) {
    return
  }

  $resolvedPath = [System.IO.Path]::GetFullPath($Path)
  if (-not [string]::IsNullOrWhiteSpace($AllowedRoot)) {
    $resolvedAllowedRoot = [System.IO.Path]::GetFullPath($AllowedRoot)
    if (-not $resolvedPath.StartsWith($resolvedAllowedRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
      throw "Suppression refusee hors du dossier autorise: $resolvedPath"
    }
  }

  try {
    Remove-Item -LiteralPath $resolvedPath -Recurse -Force -ErrorAction Stop
    return
  } catch {
    Write-WarnLine "Best-effort cleanup for package root after Remove-Item failure: $resolvedPath"
  }

  Get-ChildItem -LiteralPath $resolvedPath -Force -Recurse -ErrorAction SilentlyContinue |
    Sort-Object FullName -Descending |
    ForEach-Object {
      try {
        if ($_.PSIsContainer) {
          Remove-Item -LiteralPath $_.FullName -Recurse -Force -ErrorAction SilentlyContinue
        } else {
          Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue
        }
      } catch {
      }
    }

  try {
    Remove-Item -LiteralPath $resolvedPath -Recurse -Force -ErrorAction SilentlyContinue
  } catch {
  }

  if (Test-Path -LiteralPath $resolvedPath) {
    throw "Impossible de nettoyer le dossier package: $resolvedPath"
  }
}

function Resolve-DesktopBrowserExecutable {
  param([string]$Preference = '')

  $preferred = ([string]$Preference).Trim().ToLowerInvariant()
  $candidates = New-Object System.Collections.Generic.List[object]

  if ($preferred -eq 'chrome') {
    $candidates.Add([pscustomobject]@{
      Name = 'chrome'
      Paths = @(
        (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
        (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
        (Join-Path $env:LocalAppData 'Google\Chrome\Application\chrome.exe')
      )
      Commands = @('chrome.exe', 'chrome')
    })
  }

  $candidates.Add([pscustomobject]@{
    Name = 'edge'
    Paths = @(
      (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
      (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe'),
      (Join-Path $env:LocalAppData 'Microsoft\Edge\Application\msedge.exe')
    )
    Commands = @('msedge.exe', 'msedge')
  })

  $candidates.Add([pscustomobject]@{
    Name = 'chrome'
    Paths = @(
      (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
      (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
      (Join-Path $env:LocalAppData 'Google\Chrome\Application\chrome.exe')
    )
    Commands = @('chrome.exe', 'chrome')
  })

  foreach ($candidate in $candidates) {
    foreach ($path in $candidate.Paths) {
      if ($path -and (Test-Path $path)) {
        return [pscustomobject]@{
          Name = $candidate.Name
          Path = [System.IO.Path]::GetFullPath($path)
        }
      }
    }

    foreach ($commandName in $candidate.Commands) {
      $resolved = Resolve-CommandExecutable -Name $commandName
      if ($resolved) {
        return [pscustomobject]@{
          Name = $candidate.Name
          Path = $resolved
        }
      }
    }
  }

  return $null
}

function Read-LauncherConfig {
  param([string]$Path)
  $config = [ordered]@{}
  if (-not (Test-Path $Path)) {
    throw "Launcher config not found: $Path"
  }

  foreach ($rawLine in Get-Content -Path $Path) {
    $line = [string]$rawLine
    $trimmed = $line.Trim()
    if (-not $trimmed) { continue }
    if ($trimmed.StartsWith('#')) { continue }
    $separatorIndex = $trimmed.IndexOf('=')
    if ($separatorIndex -lt 1) { continue }

    $key = $trimmed.Substring(0, $separatorIndex).Trim()
    $value = $trimmed.Substring($separatorIndex + 1)
    if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
      $value = $value.Substring(1, $value.Length - 2)
    }
    $config[$key] = $value
  }

  return $config
}

function Get-ConfigValue {
  param(
    [System.Collections.IDictionary]$Config,
    [string]$Name,
    [string]$Default = ''
  )

  if ($Config.Contains($Name)) {
    return [string]$Config[$Name]
  }
  return [string]$Default
}

function To-BoolValue {
  param(
    [string]$Value,
    [bool]$Default = $false
  )

  $raw = [string]$Value
  if ([string]::IsNullOrWhiteSpace($raw)) { return $Default }
  switch ($raw.Trim().ToLowerInvariant()) {
    '1' { return $true }
    'true' { return $true }
    'yes' { return $true }
    'on' { return $true }
    '0' { return $false }
    'false' { return $false }
    'no' { return $false }
    'off' { return $false }
    default { return $Default }
  }
}

function To-IntValue {
  param(
    [string]$Value,
    [int]$Default
  )

  $parsed = 0
  if ([int]::TryParse([string]$Value, [ref]$parsed)) {
    return $parsed
  }
  return $Default
}

function Resolve-LauncherRelativePath {
  param(
    [string]$Value,
    [string]$BaseDirectory
  )

  $raw = [string]$Value
  if ([string]::IsNullOrWhiteSpace($raw)) { return '' }
  if ([System.IO.Path]::IsPathRooted($raw)) {
    return [System.IO.Path]::GetFullPath($raw)
  }
  return [System.IO.Path]::GetFullPath((Join-Path $BaseDirectory $raw))
}

function Resolve-CommandExecutable {
  param([string]$Name)

  try {
    return (Get-Command $Name -ErrorAction Stop).Source
  } catch {
    return ''
  }
}

function Get-ListeningProcessId {
  param([int]$Port)

  try {
    $connection = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction Stop | Select-Object -First 1
    if ($connection) {
      return [int]$connection.OwningProcess
    }
  } catch {
  }

  try {
    $match = netstat -ano | Select-String -Pattern "^\s*TCP\s+\S+:$Port\s+\S+\s+LISTENING\s+(\d+)\s*$" | Select-Object -First 1
    if ($match -and $match.Matches.Count -gt 0) {
      return [int]$match.Matches[0].Groups[1].Value
    }
  } catch {
  }

  return $null
}

function Test-PortReady {
  param([int]$Port)
  return $null -ne (Get-ListeningProcessId -Port $Port)
}

function Test-HttpReady {
  param(
    [string]$Url,
    [int]$TimeoutSec = 3
  )

  try {
    $response = Invoke-WebRequest -Uri $Url -Method Get -TimeoutSec $TimeoutSec -ErrorAction Stop
    return ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500)
  } catch {
    return $false
  }
}

function Test-UiReady {
  param(
    [string]$Url,
    [int]$TimeoutSec = 4
  )

  try {
    $response = Invoke-WebRequest -Uri $Url -Method Get -TimeoutSec $TimeoutSec -ErrorAction Stop
    if ($response.StatusCode -lt 200 -or $response.StatusCode -ge 400) {
      return $false
    }

    $body = [string]$response.Content
    if ([string]::IsNullOrWhiteSpace($body)) {
      return $false
    }

    $contentType = [string]$response.Headers['Content-Type']
    if ($contentType -match 'application/json') {
      try {
        $json = $body | ConvertFrom-Json -ErrorAction Stop
        if ($null -ne $json.embeddedUiReady) {
          return [bool]$json.embeddedUiReady
        }
      } catch {
        return $false
      }
    }

    return ($body -match 'id=["'']root["'']')
  } catch {
    return $false
  }
}

function Get-AliveProcess {
  param([int]$ProcessId)
  try {
    return Get-Process -Id $ProcessId -ErrorAction Stop
  } catch {
    return $null
  }
}

function Get-ProcessMetadata {
  param([int]$ProcessId)

  if (-not $ProcessId) {
    return $null
  }

  try {
    return Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction Stop
  } catch {
    return $null
  }
}

function Test-ServiceOwnedProcess {
  param(
    [pscustomobject]$Service,
    [int]$ProcessId
  )

  if (-not $ProcessId) {
    return $false
  }

  $processInfo = Get-ProcessMetadata -ProcessId $ProcessId
  if (-not $processInfo) {
    return $false
  }

  $serviceExe = ''
  try {
    $serviceExe = [System.IO.Path]::GetFullPath([string]$Service.FilePath)
  } catch {
    $serviceExe = [string]$Service.FilePath
  }

  $processExe = [string]$processInfo.ExecutablePath
  if (-not $processExe) {
    return $false
  }

  $sameExecutable = [string]::Equals(
    $processExe,
    $serviceExe,
    [System.StringComparison]::OrdinalIgnoreCase
  )

  if (-not $sameExecutable) {
    return $false
  }

  $commandLine = [string]$processInfo.CommandLine
  $commandLineLower = $commandLine.ToLowerInvariant()
  $knownMarkers = switch ($Service.Key) {
    'llm' { @('llama-server.exe') }
    'backend' { @('server.cjs') }
    'tts' { @('siwis.py') }
    'qflush' { @('qflushd.js') }
    'frontend' { @('vite') }
    default { @() }
  }

  foreach ($marker in $knownMarkers) {
    if ($commandLineLower.Contains($marker.ToLowerInvariant())) {
      return $true
    }
  }

  if ([string]::IsNullOrWhiteSpace($commandLine)) {
    return $false
  }

  $markers = New-Object System.Collections.Generic.List[string]

  if ($Service.WorkingDirectory) {
    $markers.Add([System.IO.Path]::GetFullPath([string]$Service.WorkingDirectory))
  }

  foreach ($argument in @($Service.ArgumentList)) {
    $raw = [string]$argument
    if ([string]::IsNullOrWhiteSpace($raw)) { continue }
    if ($raw.StartsWith('-')) { continue }
    if ($raw -match '^\d+$') { continue }

    $candidate = $raw
    if ([System.IO.Path]::IsPathRooted($candidate) -or $candidate.Contains('\') -or $candidate.Contains('/')) {
      $markers.Add([System.IO.Path]::GetFileName($candidate))
      continue
    }

    $markers.Add($candidate)
  }

  foreach ($marker in $markers) {
    if ([string]::IsNullOrWhiteSpace($marker)) { continue }
    if ($commandLineLower.Contains($marker.ToLowerInvariant())) {
      return $true
    }
  }

  return $false
}

function Resolve-OwnedServicePid {
  param([pscustomobject]$Service)

  if (-not $Service.Port) {
    return $null
  }

  $listeningPid = Get-ListeningProcessId -Port $Service.Port
  if (-not $listeningPid) {
    return $null
  }

  if (Test-ServiceOwnedProcess -Service $Service -ProcessId $listeningPid) {
    return $listeningPid
  }

  return $null
}

function Get-OwnedServiceProcessIds {
  param([pscustomobject]$Service)

  $results = New-Object System.Collections.Generic.List[int]
  $processes = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue
  foreach ($processInfo in @($processes)) {
    if (-not $processInfo) { continue }
    $candidatePid = [int]$processInfo.ProcessId
    if ($candidatePid -le 0) { continue }
    if (Test-ServiceOwnedProcess -Service $Service -ProcessId $candidatePid) {
      $results.Add($candidatePid)
    }
  }

  return @($results.ToArray() | Sort-Object -Unique)
}

function Stop-ProcessTree {
  param([int]$ProcessId)

  if (-not $ProcessId) { return }
  try {
    & taskkill /PID $ProcessId /T /F | Out-Null
  } catch {
    Write-WarnLine "taskkill failed for PID ${ProcessId}: $($_.Exception.Message)"
  }
}

function Use-ProcessEnvironment {
  param(
    [hashtable]$Environment,
    [scriptblock]$Action
  )

  $previous = @{}
  foreach ($entry in $Environment.GetEnumerator()) {
    $key = [string]$entry.Key
    $previous[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
    [Environment]::SetEnvironmentVariable($key, [string]$entry.Value, 'Process')
  }

  try {
    & $Action
  } finally {
    foreach ($entry in $previous.GetEnumerator()) {
      [Environment]::SetEnvironmentVariable([string]$entry.Key, $entry.Value, 'Process')
    }
  }
}

function Load-State {
  param([string]$Path)

  if (-not (Test-Path $Path)) {
    return @{
      updatedAt = $null
      services = @{}
    }
  }

  try {
    $raw = Get-Content -Path $Path -Raw
    $data = $raw | ConvertFrom-Json
    $services = @{}
    if ($data.services) {
      foreach ($property in $data.services.PSObject.Properties) {
        $services[$property.Name] = $property.Value
      }
    }
    return @{
      updatedAt = $data.updatedAt
      services = $services
    }
  } catch {
    Write-WarnLine "State file unreadable, reset: $Path"
    return @{
      updatedAt = $null
      services = @{}
    }
  }
}

function Save-State {
  param(
    [string]$Path,
    [hashtable]$State
  )

  $payload = @{
    updatedAt = (Get-Date).ToString('o')
    services = $State.services
  }
  $json = $payload | ConvertTo-Json -Depth 10
  $json | Set-Content -Path $Path -Encoding UTF8
}

function Load-OperationState {
  param([string]$Path)

  if (-not (Test-Path $Path)) {
    return $null
  }

  try {
    $raw = Get-Content -LiteralPath $Path -Raw -ErrorAction Stop
    if ([string]::IsNullOrWhiteSpace($raw)) {
      Remove-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
      return $null
    }

    $parsed = $raw | ConvertFrom-Json -ErrorAction Stop
    $pid = 0
    [void][int]::TryParse([string]$parsed.pid, [ref]$pid)
    if ($pid -gt 0 -and (Get-AliveProcess -ProcessId $pid)) {
      return [pscustomobject]@{
        active = $true
        command = [string]$parsed.command
        pid = $pid
        startedAt = [string]$parsed.startedAt
        configPath = [string]$parsed.configPath
      }
    }
  } catch {
  }

  Remove-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
  return $null
}

function Save-OperationState {
  param(
    [string]$Path,
    [string]$CommandName,
    [string]$ConfigPath
  )

  $payload = @{
    active = $true
    command = $CommandName
    pid = $PID
    startedAt = (Get-Date).ToString('o')
    configPath = $ConfigPath
  }
  $payload | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $Path -Encoding UTF8
}

function Clear-OperationState {
  param(
    [string]$Path,
    [string]$CommandName = ''
  )

  $active = Load-OperationState -Path $Path
  if (-not $active) {
    return
  }

  if ($active.pid -eq $PID -or [string]::IsNullOrWhiteSpace($CommandName) -or $active.command -eq $CommandName) {
    Remove-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
  }
}

function Save-LauncherSnapshot {
  param(
    [string]$Path,
    [object]$Snapshot
  )

  try {
    Write-AtomicJsonFile -Path $Path -Payload $Snapshot
  } catch {
  }
}

function Write-AtomicJsonFile {
  param(
    [string]$Path,
    [object]$Payload
  )

  $tempPath = "$Path.$PID.tmp"
  $Payload | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $tempPath -Encoding UTF8
  Move-Item -LiteralPath $tempPath -Destination $Path -Force
}

function Set-LauncherProgress {
  param(
    [string]$Path,
    [string]$Phase,
    [string]$Message,
    [string]$ServiceKey = '',
    [string]$ServiceLabel = ''
  )

  try {
    Write-AtomicJsonFile -Path $Path -Payload @{
      active = $true
      phase = $Phase
      message = $Message
      serviceKey = $ServiceKey
      serviceLabel = $ServiceLabel
      updatedAt = (Get-Date).ToString('o')
      pid = $PID
    }
  } catch {
  }
}

function Get-LauncherProgress {
  param([string]$Path)

  if (-not (Test-Path $Path)) {
    return $null
  }

  try {
    return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json -ErrorAction Stop
  } catch {
    return $null
  }
}

function Clear-LauncherProgress {
  param([string]$Path)

  Remove-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
}

function Get-ActiveLauncherOperations {
  param([string[]]$CommandNames = @('start', 'restart', 'desktop'))

  $scriptPath = ''
  try {
    $scriptPath = [System.IO.Path]::GetFullPath($PSCommandPath).ToLowerInvariant()
  } catch {
    $scriptPath = [string]$PSCommandPath
  }

  $results = New-Object System.Collections.Generic.List[object]
  $processes = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue
  foreach ($processInfo in @($processes)) {
    if (-not $processInfo) { continue }
    if ([int]$processInfo.ProcessId -eq $PID) { continue }

    $commandLine = [string]$processInfo.CommandLine
    if ([string]::IsNullOrWhiteSpace($commandLine)) { continue }

    $commandLineLower = $commandLine.ToLowerInvariant()
    if (-not $commandLineLower.Contains($scriptPath)) { continue }

    foreach ($commandName in @($CommandNames)) {
      if ([string]::IsNullOrWhiteSpace($commandName)) { continue }
      $pattern = "(^|\s)$([regex]::Escape($commandName.ToLowerInvariant()))(\s|$)"
      if ($commandLineLower -match $pattern) {
        $startedAt = $null
        if ($processInfo.CreationDate) {
          try {
            $startedAt = ([System.Management.ManagementDateTimeConverter]::ToDateTime($processInfo.CreationDate)).ToString('o')
          } catch {
            $startedAt = [string]$processInfo.CreationDate
          }
        }

        $results.Add([pscustomobject]@{
          active = $true
          command = $commandName
          pid = [int]$processInfo.ProcessId
          startedAt = $startedAt
          commandLine = $commandLine
        })
        break
      }
    }
  }

  return @($results.ToArray())
}

function Stop-LauncherOperations {
  param([string[]]$CommandNames = @('start', 'restart', 'desktop'))

  $operations = Get-ActiveLauncherOperations -CommandNames $CommandNames
  foreach ($operation in @($operations)) {
    if (-not $operation.pid) { continue }
    Write-WarnLine "Arret du launcher '$($operation.command)' (PID $($operation.pid))."
    Stop-ProcessTree -ProcessId $operation.pid
  }

  Clear-OperationState -Path $operationFile
}

function Invoke-WithOperationLock {
  param(
    [string]$Path,
    [string]$CommandName,
    [scriptblock]$Action
  )

  $active = Load-OperationState -Path $Path
  if ($active -and $active.pid -ne $PID) {
    Write-WarnLine "Launcher deja occupe par '$($active.command)' (PID $($active.pid))."
    return $false
  }

  $liveOperations = Get-ActiveLauncherOperations -CommandNames @('start', 'restart', 'desktop') | Select-Object -First 1
  if ($liveOperations) {
    Write-WarnLine "Launcher deja occupe par '$($liveOperations.command)' (PID $($liveOperations.pid))."
    return $false
  }

  Save-OperationState -Path $Path -CommandName $CommandName -ConfigPath $resolvedConfigPath
  try {
    & $Action
    return $true
  } finally {
    Clear-OperationState -Path $Path -CommandName $CommandName
    Clear-LauncherProgress -Path $progressFile
  }
}

function Start-ManagedProcess {
  param(
    [pscustomobject]$Service,
    [string]$LogsDirectory,
    [bool]$ShowWindow
  )

  $stdoutPath = Join-Path $LogsDirectory "$($Service.LogKey).out.log"
  $stderrPath = Join-Path $LogsDirectory "$($Service.LogKey).err.log"

  $action = {
    $windowStyle = 'Hidden'
    if ($ShowWindow) {
      $windowStyle = 'Normal'
    }
    $startParams = @{
      FilePath = $Service.FilePath
      ArgumentList = $Service.ArgumentList
      WorkingDirectory = $Service.WorkingDirectory
      RedirectStandardOutput = $stdoutPath
      RedirectStandardError = $stderrPath
      PassThru = $true
      WindowStyle = $windowStyle
    }
    Start-Process @startParams
  }

  $process = Use-ProcessEnvironment -Environment $Service.Environment -Action $action
  Write-Info "$($Service.DisplayName) demarre (PID $($process.Id)). Logs: $stdoutPath"
  return [pscustomobject]@{
    Pid = $process.Id
    Stdout = $stdoutPath
    Stderr = $stderrPath
    StartedAt = (Get-Date).ToString('o')
  }
}

function Wait-UntilReady {
  param([pscustomobject]$Service)

  $deadline = (Get-Date).AddSeconds($Service.StartupTimeoutSec)
  while ((Get-Date) -lt $deadline) {
    if ($Service.Pid) {
      $alive = Get-AliveProcess -ProcessId $Service.Pid
      if (-not $alive) {
        return $false
      }
    }

    $portReady = $false
    if ($Service.Port) {
      $portReady = Test-PortReady -Port $Service.Port
    }

    if ($Service.HealthMode -eq 'http') {
      if ($portReady -and $Service.ReadyWhenPortOpen) {
        return $true
      }
      if (Test-HttpReady -Url $Service.HealthUrl -TimeoutSec 3) {
        return $true
      }
    } elseif ($portReady) {
      return $true
    }

    Start-Sleep -Milliseconds 1500
  }

  return $false
}

function Invoke-SynchronousCommand {
  param(
    [string]$WorkingDirectory,
    [string]$FilePath,
    [string[]]$ArgumentList,
    [hashtable]$Environment,
    [string]$Label
  )

  Write-Info $Label
  $action = {
    Push-Location $WorkingDirectory
    try {
      & $FilePath @ArgumentList | Out-Host
      $commandExitCode = $LASTEXITCODE
      if ($null -eq $commandExitCode) {
        $commandExitCode = 0
      }
      return [int]$commandExitCode
    } finally {
      Pop-Location
    }
  }

  $exitCode = Use-ProcessEnvironment -Environment $Environment -Action $action
  if ($exitCode -ne 0) {
    throw "$Label failed with exit code $exitCode"
  }
}

function Ensure-EmbeddedUiBuild {
  param(
    [string]$FrontendDirectory,
    [string]$WebDistDirectory,
    [string]$NpmCommand,
    [string]$LocalApiUrl,
    [string]$PublicApiUrl,
    [switch]$SkipBuild
  )

  if ($SkipBuild -and (Test-Path $WebDistDirectory)) {
    Write-Info "Frontend build reuse: $WebDistDirectory"
    return
  }

  if (-not (Test-Path $FrontendDirectory)) {
    throw "Frontend directory not found: $FrontendDirectory"
  }
  if (-not $NpmCommand) {
    throw 'npm command not found for frontend build'
  }

  Invoke-SynchronousCommand `
    -WorkingDirectory $FrontendDirectory `
    -FilePath $NpmCommand `
    -ArgumentList @('run', 'build') `
    -Environment @{
      VITE_API_BASE = '/api'
      VITE_API_BASE_URL = '/api'
      VITE_API_URL = '/api'
      VITE_A11_API_BASE_URL = '/api'
      VITE_A11_LOCAL_API_BASE_URL = $LocalApiUrl
      VITE_A11_ONLINE_API_BASE_URL = $PublicApiUrl
      VITE_LLM_ROUTER_URL = ''
    } `
    -Label 'Build frontend embed'

  if (-not (Test-Path $WebDistDirectory)) {
    throw "Frontend build output missing: $WebDistDirectory"
  }
}

function Ensure-QflushBuild {
  param(
    [string]$QflushDirectory,
    [string]$NpmCommand
  )

  $entryPoint = Join-Path $QflushDirectory 'dist\daemon\qflushd.js'
  if (Test-Path $entryPoint) {
    return $entryPoint
  }
  if (-not $NpmCommand) {
    throw 'npm command not found for qflush build'
  }

  Invoke-SynchronousCommand `
    -WorkingDirectory $QflushDirectory `
    -FilePath $NpmCommand `
    -ArgumentList @('run', 'railway:build') `
    -Environment @{} `
    -Label 'Build qflush daemon'

  if (-not (Test-Path $entryPoint)) {
    throw "qflush daemon entry point missing after build: $entryPoint"
  }
  return $entryPoint
}

function Invoke-DirectoryMirror {
  param(
    [string]$Source,
    [string]$Target,
    [string[]]$ExcludeDirs = @()
  )

  New-Item -ItemType Directory -Force -Path $Target | Out-Null
  $args = @($Source, $Target, '/E', '/R:1', '/W:1', '/NFL', '/NDL', '/NJH', '/NJS', '/NP')
  if ($ExcludeDirs.Count -gt 0) {
    $args += '/XD'
    $args += $ExcludeDirs
  }

  & robocopy @args | Out-Null
  $exitCode = $LASTEXITCODE
  if ($exitCode -gt 7) {
    throw "robocopy failed for $Source -> $Target (exit $exitCode)"
  }
}

function Write-PackagePlanFile {
  param(
    [string]$Path,
    [object[]]$Plan,
    [string]$PackageRoot
  )

  $lines = @(
    '# A11 Local Package Plan',
    '',
    'Aucun dossier source n''est deplace par ce process.',
    'Le packaging copie dans un staging propre, pret a zipper.',
    '',
    "Package root: $PackageRoot",
    '',
    '| Element | Emplacement actuel | Emplacement cible | Raison |',
    '| --- | --- | --- | --- |'
  )

  foreach ($item in $Plan) {
    $lines += "| $($item.Name) | $($item.Source) | $($item.Target) | $($item.Reason) |"
  }

  $lines | Set-Content -Path $Path -Encoding UTF8
}

function Write-PackagedConfig {
  param(
    [string]$Path,
    [pscustomobject]$Context
  )

  $content = @(
    '# A11 packaged local launcher configuration',
    'A11_LOCAL_HOST=127.0.0.1',
    'A11_UI_MODE=embedded',
    'A11_AUTO_OPEN_UI=1',
    "A11_DESKTOP_BROWSER=$($Context.DesktopBrowser)",
    "A11_DESKTOP_WIDTH=$($Context.DesktopWidth)",
    "A11_DESKTOP_HEIGHT=$($Context.DesktopHeight)",
    '',
    "A11_ENABLE_BACKEND=$([int]$Context.EnableBackend)",
    "A11_ENABLE_TTS=$([int]$Context.EnableTts)",
    "A11_ENABLE_LLM=$([int]$Context.EnableLlm)",
    "A11_ENABLE_QFLUSH=$([int]$Context.EnableQflush)",
    "A11_CHAT_PROVIDER_MODE=$($Context.ChatProviderMode)",
    '',
    "A11_BACKEND_PORT=$($Context.BackendPort)",
    "A11_TTS_PORT=$($Context.TtsPort)",
    "A11_LLM_PORT=$($Context.LlmPort)",
    'A11_LLM_STARTUP_TIMEOUT_SEC=90',
    "A11_QFLUSH_PORT=$($Context.QflushPort)",
    "A11_FRONTEND_PORT=$($Context.FrontendPort)",
    '',
    "A11_PUBLIC_API_URL=$($Context.PublicApiUrl)",
    "A11_PUBLIC_FRONTEND_URL=$($Context.PublicFrontendUrl)",
    '',
    'A11_BACKEND_DIR=..\backend',
    'A11_TTS_DIR=..\tts',
    'A11_FRONTEND_DIR=..\backend\web',
    'A11_WEB_DIST_DIR=..\backend\web\dist',
    'A11_QFLUSH_DIR=..\qflush',
    'A11_LLM_EXE=..\llm\llm\server\llama-server.exe',
    'A11_LLM_MODEL=..\llm\llm\models\Llama-3.2-3B-Instruct-Q4_K_M.gguf',
    'A11_LLM_MODEL_CATALOG_ID=llama32-3b-q4km',
    'A11_LLM_MODEL_URL=',
    'A11_REMOTE_PROVIDER_CATALOG_FILE=config\remote-providers.json',
    'A11_TTS_MODEL=..\tts\fr_FR-siwis-medium.onnx',
    'A11_TTS_PIPER=..\tts\piper.exe',
    'A11_TTS_ESPEAK=..\tts\espeak-ng-data',
    "A11_REMOTE_PROVIDER_ID=$($Context.RemoteProviderId)",
    "OPENAI_BASE_URL=$($Context.OpenAiBaseUrl)",
    'OPENAI_API_KEY=',
    "OPENAI_MODEL=$($Context.OpenAiModel)",
    '',
    "A11_QFLUSH_CHAT_FLOW=$($Context.QflushChatFlow)",
    "A11_QFLUSH_MEMORY_SUMMARY_FLOW=$($Context.QflushMemorySummaryFlow)",
    'A11_PACKAGE_ROOT=..\dist\a11-local'
  )

  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Path) | Out-Null
  $content | Set-Content -Path $Path -Encoding UTF8
}

function Build-ServiceDefinitions {
  param(
    [System.Collections.IDictionary]$Config,
    [string]$LauncherDirectory,
    [string]$NodeCommand,
    [string]$NpmCommand,
    [string]$PythonCommand,
    [string]$UiMode,
    [string]$LocalApiUrl,
    [string]$LocalUiUrl,
    [string]$LocalTtsUrl,
    [string]$LocalLlmUrl,
    [string]$LocalQflushUrl,
    [string]$PublicApiUrl,
    [string]$WebDistDirectory
  )

  $backendDir = Resolve-LauncherRelativePath -Value (Get-ConfigValue $Config 'A11_BACKEND_DIR' '..\a11backendrailway\apps\server') -BaseDirectory $LauncherDirectory
  $ttsDir = Resolve-LauncherRelativePath -Value (Get-ConfigValue $Config 'A11_TTS_DIR' '..\a11backendrailway\apps\tts') -BaseDirectory $LauncherDirectory
  $frontendDir = Resolve-LauncherRelativePath -Value (Get-ConfigValue $Config 'A11_FRONTEND_DIR' '..\a11frontendnetlify\apps\web') -BaseDirectory $LauncherDirectory
  $qflushDir = Resolve-LauncherRelativePath -Value (Get-ConfigValue $Config 'A11_QFLUSH_DIR' '..\a11qflushrailway') -BaseDirectory $LauncherDirectory
  $llmExe = Resolve-LauncherRelativePath -Value (Get-ConfigValue $Config 'A11_LLM_EXE' '..\a11llm\llm\server\llama-server.exe') -BaseDirectory $LauncherDirectory
  $llmModel = Resolve-LauncherRelativePath -Value (Get-ConfigValue $Config 'A11_LLM_MODEL' '..\a11llm\llm\models\Llama-3.2-3B-Instruct-Q4_K_M.gguf') -BaseDirectory $LauncherDirectory
  $ttsModel = Resolve-LauncherRelativePath -Value (Get-ConfigValue $Config 'A11_TTS_MODEL' '..\a11backendrailway\apps\tts\fr_FR-siwis-medium.onnx') -BaseDirectory $LauncherDirectory
  $ttsPiper = Resolve-LauncherRelativePath -Value (Get-ConfigValue $Config 'A11_TTS_PIPER' '..\a11backendrailway\apps\tts\piper.exe') -BaseDirectory $LauncherDirectory
  $ttsEspeak = Resolve-LauncherRelativePath -Value (Get-ConfigValue $Config 'A11_TTS_ESPEAK' '..\a11backendrailway\apps\tts\espeak-ng-data') -BaseDirectory $LauncherDirectory
  $remoteProviderCatalogFile = Resolve-LauncherRelativePath -Value (Get-ConfigValue $Config 'A11_REMOTE_PROVIDER_CATALOG_FILE' 'config\remote-providers.json') -BaseDirectory $LauncherDirectory

  $enableBackend = To-BoolValue (Get-ConfigValue $Config 'A11_ENABLE_BACKEND' '1') $true
  $enableTts = To-BoolValue (Get-ConfigValue $Config 'A11_ENABLE_TTS' '1') $true
  $enableLlm = To-BoolValue (Get-ConfigValue $Config 'A11_ENABLE_LLM' '1') $true
  $enableQflush = To-BoolValue (Get-ConfigValue $Config 'A11_ENABLE_QFLUSH' '0') $false
  $chatProviderMode = (Get-ConfigValue $Config 'A11_CHAT_PROVIDER_MODE' '').Trim().ToLowerInvariant()
  $remoteProviderId = Get-ConfigValue $Config 'A11_REMOTE_PROVIDER_ID' ''
  $openAiBaseUrl = (Get-ConfigValue $Config 'OPENAI_BASE_URL' '').Trim()
  $openAiApiKey = (Get-ConfigValue $Config 'OPENAI_API_KEY' '').Trim()
  $openAiModel = (Get-ConfigValue $Config 'OPENAI_MODEL' (Get-ConfigValue $Config 'A11_OPENAI_MODEL' 'gpt-4o-mini')).Trim()

  $backendPort = To-IntValue (Get-ConfigValue $Config 'A11_BACKEND_PORT' '3000') 3000
  $ttsPort = To-IntValue (Get-ConfigValue $Config 'A11_TTS_PORT' '5002') 5002
  $llmPort = To-IntValue (Get-ConfigValue $Config 'A11_LLM_PORT' '8080') 8080
  $llmStartupTimeoutSec = To-IntValue (Get-ConfigValue $Config 'A11_LLM_STARTUP_TIMEOUT_SEC' '90') 90
  $qflushPort = To-IntValue (Get-ConfigValue $Config 'A11_QFLUSH_PORT' '43421') 43421
  $frontendPort = To-IntValue (Get-ConfigValue $Config 'A11_FRONTEND_PORT' '5173') 5173

  $qflushChatFlow = Get-ConfigValue $Config 'A11_QFLUSH_CHAT_FLOW' ''
  $qflushMemorySummaryFlow = Get-ConfigValue $Config 'A11_QFLUSH_MEMORY_SUMMARY_FLOW' 'a11.memory.summary.v1'

  if (-not $chatProviderMode) {
    if ($enableLlm) {
      $chatProviderMode = 'local'
    } elseif ($openAiBaseUrl -or $openAiApiKey) {
      $chatProviderMode = 'remote'
    } else {
      $chatProviderMode = 'local'
    }
  }

  $useRemoteProvider = $chatProviderMode -eq 'remote' -and -not [string]::IsNullOrWhiteSpace($openAiBaseUrl) -and -not [string]::IsNullOrWhiteSpace($openAiApiKey)
  $effectiveEnableLlm = $enableLlm -and -not $useRemoteProvider
  $qflushRuntimeUrl = ''
  if ($enableQflush) {
    $qflushRuntimeUrl = $LocalQflushUrl
  }
  $effectiveQflushChatFlow = if ($enableQflush -and -not $useRemoteProvider) { $qflushChatFlow } else { '' }
  $backendWebDist = ''
  $serveStatic = 'false'
  if ($UiMode -eq 'embedded') {
    $backendWebDist = $WebDistDirectory
    $serveStatic = 'true'
  }
  $viteRouterUrl = ''
  if ($enableQflush) {
    $viteRouterUrl = $LocalQflushUrl
  }
  $services = @()

  $services += [pscustomobject]@{
    Key = 'llm'
    DisplayName = 'A11 LLM'
    Required = $true
    Enabled = $effectiveEnableLlm
    FilePath = $llmExe
    WorkingDirectory = (Split-Path -Parent $llmExe)
    ArgumentList = @('-m', $llmModel, '--port', "$llmPort", '--host', '127.0.0.1')
    Environment = @{}
    Port = $llmPort
    HealthUrl = "http://127.0.0.1:$llmPort/health"
    HealthMode = 'http'
    ReadyWhenPortOpen = $true
    StartupTimeoutSec = $llmStartupTimeoutSec
    LogKey = 'llm'
    Issues = @(
      if (-not (Test-Path $llmExe)) { "Missing llama executable: $llmExe" }
      if (-not (Test-Path $llmModel)) { "Missing llama model: $llmModel" }
    ) | Where-Object { $_ }
  }

  $services += [pscustomobject]@{
    Key = 'tts'
    DisplayName = 'A11 TTS'
    Required = $true
    Enabled = $enableTts
    FilePath = $PythonCommand
    WorkingDirectory = $ttsDir
    ArgumentList = @('siwis.py')
    Environment = @{
      PORT = $ttsPort
      BASE_URL = $LocalTtsUrl
      MODEL_PATH = $ttsModel
      PIPER_PATH = $ttsPiper
      ESPEAK_DATA_PATH = $ttsEspeak
      A11_AVATAR_UPDATE_URL = "$LocalApiUrl/api/avatar/update"
    }
    Port = $ttsPort
    HealthUrl = "$LocalTtsUrl/health"
    HealthMode = 'http'
    ReadyWhenPortOpen = $true
    StartupTimeoutSec = 35
    LogKey = 'tts'
    Issues = @(
      if (-not $PythonCommand) { 'Python command not found' }
      if (-not (Test-Path $ttsDir)) { "Missing TTS directory: $ttsDir" }
      if (-not (Test-Path $ttsModel)) { "Missing TTS model: $ttsModel" }
      if (-not (Test-Path $ttsPiper)) { "Missing Piper executable: $ttsPiper" }
      if (-not (Test-Path $ttsEspeak)) { "Missing espeak data: $ttsEspeak" }
    ) | Where-Object { $_ }
  }

  $qflushEntry = Join-Path $qflushDir 'dist\daemon\qflushd.js'
  $services += [pscustomobject]@{
    Key = 'qflush'
    DisplayName = 'Qflush'
    Required = $false
    Enabled = $enableQflush
    FilePath = $NodeCommand
    WorkingDirectory = $qflushDir
    ArgumentList = @($qflushEntry)
    Environment = @{
      PORT = $qflushPort
      QFLUSHD_PORT = $qflushPort
      QFLUSH_DISABLE_REDIS = '1'
      QFLUSH_DISABLE_COPILOT = '1'
      QFLUSH_TELEMETRY = '0'
      QFLUSH_REQUIRE_AUTH = '0'
      LOCAL_LLM_URL = $LocalLlmUrl
      LLAMA_BASE = $LocalLlmUrl
      A11_SERVER_HEALTH_URL = "$LocalApiUrl/health"
    }
    Port = $qflushPort
    HealthUrl = "$LocalQflushUrl/health"
    HealthMode = 'http'
    ReadyWhenPortOpen = $true
    StartupTimeoutSec = 35
    LogKey = 'qflush'
    Issues = @(
      if (-not $NodeCommand) { 'Node command not found' }
      if (-not (Test-Path $qflushDir)) { "Missing qflush directory: $qflushDir" }
    ) | Where-Object { $_ }
  }

  $backendEnvironment = @{
    PORT = $backendPort
    NODE_ENV = 'development'
    A11_LOCAL_MODE = '1'
    A11_RUNTIME_PROFILE = 'local'
    BACKEND = $(if ($useRemoteProvider) { 'openai' } else { 'local' })
    APP_URL = $LocalUiUrl
    FRONT_URL = $LocalUiUrl
    PUBLIC_API_URL = $LocalApiUrl
    API_URL = $LocalApiUrl
    LOCAL_LLM_URL = $(if ($effectiveEnableLlm) { $LocalLlmUrl } else { '' })
    LLAMA_BASE = $(if ($effectiveEnableLlm) { $LocalLlmUrl } else { '' })
    LLAMA_PORT = $llmPort
    LOCAL_LLM_PORT = $llmPort
    OPENAI_BASE_URL = $openAiBaseUrl
    OPENAI_API_KEY = $openAiApiKey
    OPENAI_MODEL = $openAiModel
    A11_OPENAI_MODEL = $openAiModel
    A11_REMOTE_PROVIDER_ID = $remoteProviderId
    A11_REMOTE_PROVIDER_CATALOG_FILE = $remoteProviderCatalogFile
    A11_CHAT_PROVIDER_MODE = $chatProviderMode
    TTS_PORT = $ttsPort
    TTS_URL = $LocalTtsUrl
    TTS_BASE_URL = $LocalTtsUrl
    TTS_PUBLIC_BASE_URL = $LocalTtsUrl
    QFLUSH_URL = $qflushRuntimeUrl
    QFLUSH_REMOTE_URL = $qflushRuntimeUrl
    QFLUSH_CHAT_FLOW = $effectiveQflushChatFlow
    QFLUSH_MEMORY_SUMMARY_FLOW = $qflushMemorySummaryFlow
    A11_WEB_DIST_DIR = $backendWebDist
    SERVE_STATIC = $serveStatic
    A11_PACKAGE_MODE = '0'
  }

  $services += [pscustomobject]@{
    Key = 'backend'
    DisplayName = 'A11 Backend'
    Required = $true
    Enabled = $enableBackend
    FilePath = $NodeCommand
    WorkingDirectory = $backendDir
    ArgumentList = @('server.cjs')
    Environment = $backendEnvironment
    Port = $backendPort
    HealthUrl = "$LocalApiUrl/health"
    HealthMode = 'http'
    ReadyWhenPortOpen = $true
    StartupTimeoutSec = 45
    LogKey = 'backend'
    Issues = @(
      if (-not $NodeCommand) { 'Node command not found' }
      if (-not (Test-Path $backendDir)) { "Missing backend directory: $backendDir" }
      if (-not (Test-Path (Join-Path $backendDir 'server.cjs'))) { "Missing backend entry point: $(Join-Path $backendDir 'server.cjs')" }
    ) | Where-Object { $_ }
  }

  if ($UiMode -eq 'dev') {
    $services += [pscustomobject]@{
      Key = 'frontend'
      DisplayName = 'A11 Frontend'
      Required = $false
      Enabled = $true
      FilePath = $NpmCommand
      WorkingDirectory = $frontendDir
      ArgumentList = @('run', 'dev', '--', '--host', '127.0.0.1', '--port', "$frontendPort")
      Environment = @{
        VITE_API_BASE = $LocalApiUrl
        VITE_API_BASE_URL = $LocalApiUrl
        VITE_API_URL = $LocalApiUrl
        VITE_A11_API_BASE_URL = $LocalApiUrl
        VITE_A11_LOCAL_API_BASE_URL = $LocalApiUrl
        VITE_A11_ONLINE_API_BASE_URL = $PublicApiUrl
        VITE_LLM_ROUTER_URL = $viteRouterUrl
      }
      Port = $frontendPort
      HealthUrl = "http://127.0.0.1:$frontendPort/"
      HealthMode = 'http'
      ReadyWhenPortOpen = $true
      StartupTimeoutSec = 40
      LogKey = 'frontend'
      Issues = @(
        if (-not $NpmCommand) { 'npm command not found' }
        if (-not (Test-Path $frontendDir)) { "Missing frontend directory: $frontendDir" }
      ) | Where-Object { $_ }
    }
  }

  return [pscustomobject]@{
    Services = $services
    BackendDir = $backendDir
    TtsDir = $ttsDir
    FrontendDir = $frontendDir
    WebDistDirectory = $WebDistDirectory
    QflushDir = $qflushDir
    QflushEntry = $qflushEntry
    LlmExe = $llmExe
    LlmModel = $llmModel
    BackendPort = $backendPort
    TtsPort = $ttsPort
    LlmPort = $llmPort
    QflushPort = $qflushPort
    FrontendPort = $frontendPort
    QflushChatFlow = $qflushChatFlow
    QflushMemorySummaryFlow = $qflushMemorySummaryFlow
    EnableBackend = $enableBackend
    EnableTts = $enableTts
    EnableLlm = $effectiveEnableLlm
    EnableQflush = $enableQflush
    ChatProviderMode = $chatProviderMode
    UseRemoteProvider = $useRemoteProvider
    RemoteProviderId = $remoteProviderId
    RemoteProviderCatalogFile = $remoteProviderCatalogFile
    OpenAiBaseUrl = $openAiBaseUrl
    OpenAiModel = $openAiModel
  }
}

function Get-ServiceStatus {
  param(
    [pscustomobject]$Service,
    [hashtable]$StateServices
  )

  $stateEntry = $null
  if ($StateServices.ContainsKey($Service.Key)) {
    $stateEntry = $StateServices[$Service.Key]
  }

  $servicePid = $null
  $managedByLauncher = $false
  if ($stateEntry -and $stateEntry.pid) {
    $servicePid = [int]$stateEntry.pid
  }
  if ($stateEntry -and $null -ne $stateEntry.managedByLauncher) {
    $managedByLauncher = [bool]$stateEntry.managedByLauncher
  }
  $alive = $false
  if ($servicePid) {
    $alive = $null -ne (Get-AliveProcess -ProcessId $servicePid)
  }

  $listeningPid = $null
  if ($Service.Port) {
    $listeningPid = Get-ListeningProcessId -Port $Service.Port
  }
  if ($listeningPid -and $servicePid -and $servicePid -ne $listeningPid) {
    if (Test-ServiceOwnedProcess -Service $Service -ProcessId $listeningPid) {
      $servicePid = $listeningPid
      $alive = $true
      $managedByLauncher = $true
    }
  }
  if (-not $managedByLauncher -and $listeningPid) {
    if (Test-ServiceOwnedProcess -Service $Service -ProcessId $listeningPid) {
      $managedByLauncher = $true
      if (-not $servicePid) {
        $servicePid = $listeningPid
      }
    }
  }
  $healthy = $false
  if ($Service.HealthMode -eq 'http') {
    if ($listeningPid -or $alive -or (-not $Service.Port)) {
      $healthy = Test-HttpReady -Url $Service.HealthUrl -TimeoutSec 2
    }
  }
  if (-not $healthy -and $Service.Port) {
    $healthy = $null -ne $listeningPid
  }
  $resolvedPid = $null
  if ($servicePid -and $alive) {
    $resolvedPid = $servicePid
  } elseif ($listeningPid) {
    $resolvedPid = $listeningPid
  }

  $stateLabel = 'stopped'
  if (-not $Service.Enabled) {
    if ($alive -or $listeningPid) {
      $stateLabel = 'disabled-external'
    } else {
      $stateLabel = 'disabled'
    }
  } elseif ($alive -and $healthy) {
    if ($managedByLauncher) {
      $stateLabel = 'running-managed'
    } else {
      $stateLabel = 'running-external'
    }
  } elseif ($alive -and -not $healthy) {
    if ($managedByLauncher) {
      $stateLabel = 'degraded-managed'
    } else {
      $stateLabel = 'degraded-external'
    }
  } elseif (-not $alive -and $listeningPid) {
    $stateLabel = 'running-external'
  }

  return [pscustomobject]@{
    Service = $Service.DisplayName
    Key = $Service.Key
    Enabled = $Service.Enabled
    State = $stateLabel
    Port = $Service.Port
    Pid = $resolvedPid
    Healthy = $healthy
    Url = $Service.HealthUrl
  }
}

function Get-LauncherStatusSnapshot {
  $activeOperation = Load-OperationState -Path $operationFile
  if (-not $activeOperation) {
    $liveLauncherOperation = Get-ActiveLauncherOperations -CommandNames @('start', 'restart', 'desktop') | Select-Object -First 1
    if ($liveLauncherOperation) {
      $activeOperation = [pscustomobject]@{
        active = $true
        command = [string]$liveLauncherOperation.command
        pid = [int]$liveLauncherOperation.pid
        startedAt = [string]$liveLauncherOperation.startedAt
        configPath = $resolvedConfigPath
      }
    }
  }
  $progress = Get-LauncherProgress -Path $progressFile
  $rows = foreach ($service in $definitionBundle.Services) {
    $status = Get-ServiceStatus -Service $service -StateServices $state.services
    [pscustomobject]@{
      key = $service.Key
      label = $service.DisplayName
      enabled = [bool]$status.Enabled
      state = [string]$status.State
      port = if ($null -ne $status.Port) { [int]$status.Port } else { $null }
      pid = if ($null -ne $status.Pid) { [int]$status.Pid } else { $null }
      ready = [bool]$status.Healthy
      required = [bool]$service.Required
      healthUrl = [string]$status.Url
    }
  }

  $requiredReady = @($rows | Where-Object { $_.required -and $_.enabled }).Count -eq 0 -or
    (@($rows | Where-Object { $_.required -and $_.enabled -and -not $_.ready }).Count -eq 0)
  $uiReady = Test-UiReady -Url $localUiUrl -TimeoutSec 4

  $snapshot = [pscustomobject]@{
    ok = (-not $script:HadErrors)
    command = $Command
    uiMode = $uiMode
    uiUrl = $localUiUrl
    uiReady = $uiReady
    requiredServicesReady = $requiredReady
    ready = ($requiredReady -and $uiReady)
    logsDirectory = $logsDirectory
    launcherConfig = $resolvedConfigPath
    remoteProviderCatalogFile = $definitionBundle.RemoteProviderCatalogFile
    operation = $activeOperation
    progress = $progress
    services = $rows
  }

  Save-LauncherSnapshot -Path $snapshotFile -Snapshot $snapshot
  return $snapshot
}

function Update-LauncherSnapshotCache {
  try {
    [void](Get-LauncherStatusSnapshot)
  } catch {
  }
}

function Open-A11DesktopWindow {
  param(
    [string]$Url,
    [string]$BrowserPreference,
    [int]$Width,
    [int]$Height,
    [string]$RuntimeDirectory
  )

  $browser = Resolve-DesktopBrowserExecutable -Preference $BrowserPreference
  if (-not $browser) {
    Write-WarnLine "No Edge/Chrome executable found, opening the default browser instead."
    Start-Process $Url | Out-Null
    return
  }

  $profileDirectory = Join-Path $RuntimeDirectory 'desktop-browser-profile'
  New-Item -ItemType Directory -Force -Path $profileDirectory | Out-Null

  $arguments = @(
    "--app=$Url",
    "--window-size=$Width,$Height",
    "--user-data-dir=$profileDirectory"
  )

  Start-Process -FilePath $browser.Path -ArgumentList $arguments | Out-Null
  Write-Info "Desktop window: $($browser.Name) app mode on $Url"
}

function Start-A11Stack {
  param([switch]$DesktopWindow)

  Set-LauncherProgress -Path $progressFile -Phase 'validation' -Message 'Verification de la stack locale...'
  Update-LauncherSnapshotCache
  $validationStateChanged = $false

  foreach ($service in $definitionBundle.Services) {
    if (-not $service.Enabled) { continue }

    $externalPid = if ($service.Port) { Get-ListeningProcessId -Port $service.Port } else { $null }
    if ($externalPid) {
      $ownedExternal = Test-ServiceOwnedProcess -Service $service -ProcessId $externalPid
      if ($ownedExternal) {
        Write-Info "$($service.DisplayName) already active locally on port $($service.Port) (PID $externalPid)"
      } else {
        Write-WarnLine "$($service.DisplayName) already active on port $($service.Port) (PID $externalPid)"
      }
      $state.services[$service.Key] = @{
        pid = $externalPid
        port = $service.Port
        healthUrl = $service.HealthUrl
        managedByLauncher = $ownedExternal
      }
      $validationStateChanged = $true
      continue
    }

    if ($service.Issues.Count -gt 0) {
      foreach ($issue in $service.Issues) {
        Write-ErrorLine "$($service.DisplayName): $issue"
      }
    }
  }
  if ($validationStateChanged) {
    Save-State -Path $stateFile -State $state
    Update-LauncherSnapshotCache
  }
  if ($script:HadErrors) { return }

  if ($uiMode -eq 'embedded') {
    Set-LauncherProgress -Path $progressFile -Phase 'ui-build' -Message 'Preparation de l interface embarquee...'
    Update-LauncherSnapshotCache
    Ensure-EmbeddedUiBuild `
      -FrontendDirectory $definitionBundle.FrontendDir `
      -WebDistDirectory $definitionBundle.WebDistDirectory `
      -NpmCommand $npmCommand `
      -LocalApiUrl $localApiUrl `
      -PublicApiUrl $publicApiUrl `
      -SkipBuild:$SkipUiBuild
  }
  if ($definitionBundle.EnableQflush) {
    Set-LauncherProgress -Path $progressFile -Phase 'qflush-build' -Message 'Preparation de Qflush...'
    Update-LauncherSnapshotCache
    [void](Ensure-QflushBuild -QflushDirectory $definitionBundle.QflushDir -NpmCommand $npmCommand)
    ($definitionBundle.Services | Where-Object { $_.Key -eq 'qflush' } | Select-Object -First 1).ArgumentList = @((Join-Path $definitionBundle.QflushDir 'dist\daemon\qflushd.js'))
  }

  foreach ($service in $definitionBundle.Services) {
    if (-not $service.Enabled) {
      Write-Info "$($service.DisplayName): disabled"
      continue
    }

    $existingState = $null
    if ($state.services.ContainsKey($service.Key)) {
      $existingState = $state.services[$service.Key]
    }
    if ($existingState -and ($existingState.managedByLauncher -eq $false) -and $existingState.pid) {
      $externalStatus = Get-ServiceStatus -Service $service -StateServices $state.services
      if ($externalStatus.State -eq 'running-external' -or $externalStatus.State -eq 'degraded-external' -or $externalStatus.State -eq 'disabled-external') {
        continue
      }

      Write-WarnLine "$($service.DisplayName) stale external state cleared (PID $($existingState.pid))"
      [void]$state.services.Remove($service.Key)
      Save-State -Path $stateFile -State $state
    }

    Set-LauncherProgress -Path $progressFile -Phase 'service-start' -Message "Demarrage de $($service.DisplayName)..." -ServiceKey $service.Key -ServiceLabel $service.DisplayName
    Update-LauncherSnapshotCache
    $started = Start-ManagedProcess -Service $service -LogsDirectory $logsDirectory -ShowWindow:$ShowWindows
    $service | Add-Member -NotePropertyName Pid -NotePropertyValue $started.Pid -Force
    $state.services[$service.Key] = @{
      pid = $started.Pid
      port = $service.Port
      healthUrl = $service.HealthUrl
      stdout = $started.Stdout
      stderr = $started.Stderr
      startedAt = $started.StartedAt
      managedByLauncher = $true
    }
    Save-State -Path $stateFile -State $state
    Update-LauncherSnapshotCache
    Set-LauncherProgress -Path $progressFile -Phase 'service-wait' -Message "Attente de $($service.DisplayName)..." -ServiceKey $service.Key -ServiceLabel $service.DisplayName
    Update-LauncherSnapshotCache
    if (-not (Wait-UntilReady -Service $service)) {
      Write-ErrorLine "$($service.DisplayName) did not become ready in time"
    }
    Update-LauncherSnapshotCache
  }

  if (-not $script:HadErrors) {
    Set-LauncherProgress -Path $progressFile -Phase 'finalizing' -Message 'Finalisation de la stack locale...'
    Update-LauncherSnapshotCache
    Write-Info "UI: $localUiUrl"
    Write-Info "API: $localApiUrl"
    Write-Info "TTS: $localTtsUrl"
    Write-Info "LLM: $localLlmUrl"
    Write-Info "Qflush: $localQflushUrl"
    Write-Info "Logs: $logsDirectory"
    if (-not $NoOpen) {
      if ($DesktopWindow) {
        Open-A11DesktopWindow `
          -Url $localUiUrl `
          -BrowserPreference $desktopBrowserPreference `
          -Width $desktopWindowWidth `
          -Height $desktopWindowHeight `
          -RuntimeDirectory $runtimeDirectory
      } elseif ($autoOpenUi) {
        Start-Process $localUiUrl | Out-Null
      }
    }
  }

  $finalStatuses = foreach ($service in $definitionBundle.Services) {
    Get-ServiceStatus -Service $service -StateServices $state.services
  }
  $enabledFailures = $finalStatuses | Where-Object { $_.Enabled -and -not $_.Healthy }
  if (-not $enabledFailures -or $enabledFailures.Count -eq 0) {
    $script:HadErrors = $false
  }
  Update-LauncherSnapshotCache
}

function Stop-A11Stack {
  Set-LauncherProgress -Path $progressFile -Phase 'stop' -Message 'Arret de la stack locale...'
  Update-LauncherSnapshotCache
  $stopOrder = @('frontend', 'backend', 'qflush', 'tts', 'llm')
  foreach ($serviceKey in $stopOrder) {
    $service = $definitionBundle.Services | Where-Object { $_.Key -eq $serviceKey } | Select-Object -First 1
    if (-not $service) { continue }

    $stateEntry = $null
    if ($state.services.ContainsKey($service.Key)) {
      $stateEntry = $state.services[$service.Key]
    }
    $managedByLauncher = $false
    if ($stateEntry -and $null -ne $stateEntry.managedByLauncher) {
      $managedByLauncher = [bool]$stateEntry.managedByLauncher
    }

    if (-not $managedByLauncher) {
      $ownedPid = Resolve-OwnedServicePid -Service $service
      if ($ownedPid) {
        $managedByLauncher = $true
        $stateEntry = @{
          pid = $ownedPid
          port = $service.Port
          healthUrl = $service.HealthUrl
          managedByLauncher = $true
        }
        $state.services[$service.Key] = $stateEntry
      }
    }

    if (-not $service.Enabled -and -not $managedByLauncher) {
      Write-Info "$($service.DisplayName) ignored (disabled in config)"
      if ($stateEntry -and $state.services.ContainsKey($service.Key)) {
        $state.services.Remove($service.Key)
      }
      continue
    }
    if (-not $managedByLauncher) {
      if ($stateEntry -and $state.services.ContainsKey($service.Key)) {
        $state.services.Remove($service.Key)
      }
      if ($service.Port -and (Get-ListeningProcessId -Port $service.Port)) {
        Write-Info "$($service.DisplayName) left running (external process not owned by launcher)"
      } else {
        Write-Info "$($service.DisplayName) already stopped"
      }
      continue
    }

    $targetPids = New-Object System.Collections.Generic.List[int]
    if ($stateEntry -and $stateEntry.pid) {
      $targetPids.Add([int]$stateEntry.pid)
    }

    foreach ($ownedPid in @(Get-OwnedServiceProcessIds -Service $service)) {
      if ($ownedPid -and -not $targetPids.Contains([int]$ownedPid)) {
        $targetPids.Add([int]$ownedPid)
      }
    }

    if ($targetPids.Count -gt 0) {
      foreach ($targetPid in @($targetPids.ToArray() | Sort-Object -Unique)) {
        Write-Info "Stopping $($service.DisplayName) (PID $targetPid)"
        Stop-ProcessTree -ProcessId $targetPid
      }
    } else {
      Write-Info "$($service.DisplayName) already stopped"
    }

    if ($state.services.ContainsKey($service.Key)) {
      $state.services.Remove($service.Key)
    }
  }
  Save-State -Path $stateFile -State $state
  Update-LauncherSnapshotCache
}

$launcherDirectory = Split-Path -Parent $PSCommandPath
$runtimeDirectory = Join-Path $launcherDirectory 'runtime'
$logsDirectory = Join-Path $runtimeDirectory 'logs'
$stateFile = Join-Path $runtimeDirectory 'a11-local.state.json'
$snapshotFile = Join-Path $runtimeDirectory 'a11-local.snapshot.json'
$operationFile = Join-Path $runtimeDirectory 'a11-local.operation.json'
$progressFile = Join-Path $runtimeDirectory 'a11-local.progress.json'
New-Item -ItemType Directory -Force -Path $logsDirectory | Out-Null

$resolvedConfigPath = if ($ConfigPath) {
  Resolve-LauncherRelativePath -Value $ConfigPath -BaseDirectory $launcherDirectory
} else {
  Join-Path $launcherDirectory 'config\a11-local.env'
}

$config = Read-LauncherConfig -Path $resolvedConfigPath
$nodeCommand = Resolve-CommandExecutable -Name 'node'
$npmCommand = (Resolve-CommandExecutable -Name 'npm.cmd')
if (-not $npmCommand) { $npmCommand = Resolve-CommandExecutable -Name 'npm' }
$pythonCommand = Resolve-CommandExecutable -Name 'python'

$localHost = Get-ConfigValue $config 'A11_LOCAL_HOST' '127.0.0.1'
$uiMode = (Get-ConfigValue $config 'A11_UI_MODE' 'embedded').Trim().ToLowerInvariant()
$autoOpenUi = To-BoolValue (Get-ConfigValue $config 'A11_AUTO_OPEN_UI' '1') $true
$desktopBrowserPreference = Get-ConfigValue $config 'A11_DESKTOP_BROWSER' 'edge'
$desktopWindowWidth = To-IntValue (Get-ConfigValue $config 'A11_DESKTOP_WIDTH' '1440') 1440
$desktopWindowHeight = To-IntValue (Get-ConfigValue $config 'A11_DESKTOP_HEIGHT' '960') 960
$publicApiUrl = Get-ConfigValue $config 'A11_PUBLIC_API_URL' 'https://api.funesterie.pro'
$publicFrontendUrl = Get-ConfigValue $config 'A11_PUBLIC_FRONTEND_URL' 'https://a11.funesterie.pro'
$webDistDirectory = Resolve-LauncherRelativePath -Value (Get-ConfigValue $config 'A11_WEB_DIST_DIR' '..\a11frontendnetlify\apps\web\dist') -BaseDirectory $launcherDirectory

$backendPort = To-IntValue (Get-ConfigValue $config 'A11_BACKEND_PORT' '3000') 3000
$ttsPort = To-IntValue (Get-ConfigValue $config 'A11_TTS_PORT' '5002') 5002
$llmPort = To-IntValue (Get-ConfigValue $config 'A11_LLM_PORT' '8080') 8080
$qflushPort = To-IntValue (Get-ConfigValue $config 'A11_QFLUSH_PORT' '43421') 43421
$frontendPort = To-IntValue (Get-ConfigValue $config 'A11_FRONTEND_PORT' '5173') 5173

$localApiUrl = "http://${localHost}:$backendPort"
$localTtsUrl = "http://${localHost}:$ttsPort"
$localLlmUrl = "http://${localHost}:$llmPort"
$localQflushUrl = "http://${localHost}:$qflushPort"
$localUiUrl = if ($uiMode -eq 'embedded') { $localApiUrl } else { "http://${localHost}:$frontendPort" }

$definitionBundle = Build-ServiceDefinitions `
  -Config $config `
  -LauncherDirectory $launcherDirectory `
  -NodeCommand $nodeCommand `
  -NpmCommand $npmCommand `
  -PythonCommand $pythonCommand `
  -UiMode $uiMode `
  -LocalApiUrl $localApiUrl `
  -LocalUiUrl $localUiUrl `
  -LocalTtsUrl $localTtsUrl `
  -LocalLlmUrl $localLlmUrl `
  -LocalQflushUrl $localQflushUrl `
  -PublicApiUrl $publicApiUrl `
  -WebDistDirectory $webDistDirectory

$state = Load-State -Path $stateFile
$llmPackageSource = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $definitionBundle.LlmExe))

switch ($Command) {
  'check' {
    Write-Info "Config: $resolvedConfigPath"
    Write-Info "UI mode: $uiMode"
    foreach ($service in $definitionBundle.Services) {
      if (-not $service.Enabled) {
        Write-Info "$($service.DisplayName): disabled"
        continue
      }
      if ($service.Issues.Count -gt 0) {
        foreach ($issue in $service.Issues) {
          Write-ErrorLine "$($service.DisplayName): $issue"
        }
      } else {
        Write-Info "$($service.DisplayName): ready"
      }
    }

    if ($uiMode -eq 'embedded') {
      if (Test-Path $definitionBundle.WebDistDirectory) {
        Write-Info "Embedded UI build found: $($definitionBundle.WebDistDirectory)"
      } else {
        Write-WarnLine "Embedded UI build missing: $($definitionBundle.WebDistDirectory)"
      }
    }
  }

  'status' {
    $rows = foreach ($service in $definitionBundle.Services) {
      Get-ServiceStatus -Service $service -StateServices $state.services
    }
    $rows | Sort-Object Service | Format-Table Service,State,Port,Pid,Healthy,Url -AutoSize
  }

  'status-json' {
    $snapshot = Get-LauncherStatusSnapshot
    $snapshot | ConvertTo-Json -Depth 8
  }

  'stop' {
    Stop-LauncherOperations
    [void](Invoke-WithOperationLock -Path $operationFile -CommandName 'stop' -Action {
      Stop-A11Stack
    })
  }

  'restart' {
    [void](Invoke-WithOperationLock -Path $operationFile -CommandName 'restart' -Action {
      Stop-A11Stack
      Start-A11Stack
    })
  }

  'package' {
    $packageRoot = Resolve-LauncherRelativePath -Value (Get-ConfigValue $config 'A11_PACKAGE_ROOT' 'dist\a11-local') -BaseDirectory $launcherDirectory
    $packageContainerRoot = Join-Path $launcherDirectory 'dist'
    $plan = @(
      [pscustomobject]@{ Name = 'backend'; Source = $definitionBundle.BackendDir; Target = (Join-Path $packageRoot 'backend'); Reason = 'API locale A11' }
      [pscustomobject]@{ Name = 'tts'; Source = $definitionBundle.TtsDir; Target = (Join-Path $packageRoot 'tts'); Reason = 'Service audio local' }
      [pscustomobject]@{ Name = 'llm'; Source = $llmPackageSource; Target = (Join-Path $packageRoot 'llm'); Reason = 'Runtime local + modeles' }
      [pscustomobject]@{ Name = 'qflush'; Source = $definitionBundle.QflushDir; Target = (Join-Path $packageRoot 'qflush'); Reason = 'Orchestration separee optionnelle' }
      [pscustomobject]@{ Name = 'launcher'; Source = $launcherDirectory; Target = (Join-Path $packageRoot 'launcher'); Reason = 'Demarrage one-click et supervision locale' }
      [pscustomobject]@{ Name = 'frontend-dist'; Source = $definitionBundle.WebDistDirectory; Target = (Join-Path $packageRoot 'backend\web\dist'); Reason = 'UI web embarquee servie par le backend local' }
    )

    $generatedPlanPath = Join-Path $runtimeDirectory 'PACKAGE_LAYOUT_PLAN.generated.md'
    Write-PackagePlanFile -Path $generatedPlanPath -Plan $plan -PackageRoot $packageRoot
    Write-Info "Packaging plan written: $generatedPlanPath"

    if ($DryRun) {
      $plan | Format-Table Name,Source,Target,Reason -AutoSize
      break
    }

    if (Test-Path $packageRoot) {
      if ($Force) {
        Remove-DirectoryTreeBestEffort -Path $packageRoot -AllowedRoot $packageContainerRoot
      } else {
        Write-WarnLine "Package root already exists, files will be updated: $packageRoot"
      }
    }
    New-Item -ItemType Directory -Force -Path $packageRoot | Out-Null

    Ensure-EmbeddedUiBuild `
      -FrontendDirectory $definitionBundle.FrontendDir `
      -WebDistDirectory $definitionBundle.WebDistDirectory `
      -NpmCommand $npmCommand `
      -LocalApiUrl $localApiUrl `
      -PublicApiUrl $publicApiUrl `
      -SkipBuild:$SkipUiBuild

    if (Test-Path $definitionBundle.QflushDir) {
      [void](Ensure-QflushBuild -QflushDirectory $definitionBundle.QflushDir -NpmCommand $npmCommand)
    }

    Invoke-DirectoryMirror -Source $definitionBundle.BackendDir -Target (Join-Path $packageRoot 'backend') -ExcludeDirs @('coverage')
    Invoke-DirectoryMirror -Source $definitionBundle.TtsDir -Target (Join-Path $packageRoot 'tts') -ExcludeDirs @('__pycache__', 'out')
    Invoke-DirectoryMirror -Source $llmPackageSource -Target (Join-Path $packageRoot 'llm') -ExcludeDirs @('.git')
    Invoke-DirectoryMirror -Source $definitionBundle.QflushDir -Target (Join-Path $packageRoot 'qflush') -ExcludeDirs @('.git', 'coverage')
    Invoke-DirectoryMirror -Source $launcherDirectory -Target (Join-Path $packageRoot 'launcher') -ExcludeDirs @('runtime', 'dist', '.git')
    Invoke-DirectoryMirror -Source $definitionBundle.WebDistDirectory -Target (Join-Path $packageRoot 'backend\web\dist')

    Write-PackagedConfig -Path (Join-Path $packageRoot 'launcher\config\a11-local.env') -Context ([pscustomobject]@{
      EnableBackend = $definitionBundle.EnableBackend
      EnableTts = $definitionBundle.EnableTts
      EnableLlm = $definitionBundle.EnableLlm
      EnableQflush = $definitionBundle.EnableQflush
      BackendPort = $definitionBundle.BackendPort
      TtsPort = $definitionBundle.TtsPort
      LlmPort = $definitionBundle.LlmPort
      QflushPort = $definitionBundle.QflushPort
      FrontendPort = $definitionBundle.FrontendPort
      DesktopBrowser = $desktopBrowserPreference
      DesktopWidth = $desktopWindowWidth
      DesktopHeight = $desktopWindowHeight
      PublicApiUrl = $publicApiUrl
      PublicFrontendUrl = $publicFrontendUrl
      QflushChatFlow = $definitionBundle.QflushChatFlow
      QflushMemorySummaryFlow = $definitionBundle.QflushMemorySummaryFlow
      ChatProviderMode = $definitionBundle.ChatProviderMode
      RemoteProviderId = $definitionBundle.RemoteProviderId
      OpenAiBaseUrl = $definitionBundle.OpenAiBaseUrl
      OpenAiModel = $definitionBundle.OpenAiModel
    })
    Write-PackagePlanFile -Path (Join-Path $packageRoot 'PACKAGE_LAYOUT_PLAN.md') -Plan $plan -PackageRoot $packageRoot
    Write-Info "Local package staging ready: $packageRoot"
  }

  'start' {
    [void](Invoke-WithOperationLock -Path $operationFile -CommandName 'start' -Action {
      Start-A11Stack
    })
  }

  'desktop' {
    [void](Invoke-WithOperationLock -Path $operationFile -CommandName 'desktop' -Action {
      Start-A11Stack -DesktopWindow
    })
  }
}

if ($state.services.Count -gt 0) {
  Save-State -Path $stateFile -State $state
}

if (-not $NoPause -and $Command -eq 'start') {
  [void](Read-Host 'Appuie sur Entree pour fermer le launcher')
}

if ($script:HadErrors) { exit 1 }
exit 0
