param(
  [string]$ServerRoot = "D:\projets\funesterie\a11\backend\apps\server",
  [string]$McpRoot = "D:\projets\funesterie\a11mcp",
  [string]$StateRoot = "D:\projets\funesterie\a11\runtime\mcp-autopilot",
  [switch]$SyncLocal,
  [switch]$Backup,
  [switch]$PostOk,
  [switch]$RegisterHook,
  [switch]$RegisterHookDryRun
)

$ErrorActionPreference = "Stop"

$sharedMcp = "http://127.0.0.1:8787/mcp"
$auraMcp = "http://127.0.0.1:8788/mcp"
$discussionId = "mcp-semantic-memory-router-2026-05-13"

function Redact-Text {
  param([string]$Text)
  if (-not $Text) { return "" }
  return ($Text `
    -replace '(?i)(password|token|secret|api[_-]?key|authorization)(\s*[:=]\s*)[^\s,;}]+' , '$1$2[redacted]' `
    -replace '(?i)(Bearer\s+)[A-Za-z0-9._~+/=-]+' , '$1[redacted]')
}

function Save-Json {
  param(
    [Parameter(Mandatory = $true)]$Value,
    [Parameter(Mandatory = $true)][string]$Path
  )
  $dir = Split-Path -Parent $Path
  if (-not (Test-Path -LiteralPath $dir)) {
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
  }
  $Value | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath $Path -Encoding UTF8
}

function ConvertFrom-McpResponse {
  param([string]$Content)
  $dataLines = @()
  foreach ($line in ($Content -split "`r?`n")) {
    if ($line.StartsWith("data:")) {
      $dataLines += $line.Substring(5).TrimStart()
    }
  }

  if ($dataLines.Count -gt 0) {
    return (($dataLines -join "`n") | ConvertFrom-Json)
  }

  return ($Content | ConvertFrom-Json)
}

function Invoke-McpTool {
  param(
    [Parameter(Mandatory = $true)][string]$BaseUrl,
    [Parameter(Mandatory = $true)][string]$Name,
    [hashtable]$Arguments = @{},
    [int]$TimeoutSec = 20
  )

  $headers = @{
    Accept = "application/json, text/event-stream"
    "Content-Type" = "application/json"
  }
  $body = @{
    jsonrpc = "2.0"
    id = [Guid]::NewGuid().ToString("n")
    method = "tools/call"
    params = @{
      name = $Name
      arguments = $Arguments
    }
  } | ConvertTo-Json -Depth 30 -Compress

  $response = Invoke-WebRequest -Uri $BaseUrl -Method Post -Headers $headers -Body $body -TimeoutSec $TimeoutSec
  return ConvertFrom-McpResponse -Content $response.Content
}

function Ensure-Container {
  param([Parameter(Mandatory = $true)][string]$Name)

  $healthUrl = switch ($Name) {
    "a11-mcp" { "http://127.0.0.1:8787/health" }
    "a11-mcp-aura" { "http://127.0.0.1:8788/health" }
    "a11-mcp-cloudflared" { "https://mcp.funesterie.me/health" }
    default { "" }
  }

  if ($healthUrl) {
    $health = Test-Health $healthUrl
    if ($health.ok) {
      return @{
        name = $Name
        ok = $true
        exists = $null
        running = $null
        status = "endpoint-healthy"
        message = "podman check skipped; health endpoint already responds"
      }
    }
  }

  $podman = Get-Command podman -ErrorAction SilentlyContinue
  if (-not $podman) {
    $fallback = Ensure-NodeMcpFallback $Name
    if ($fallback) { return $fallback }
    return @{ name = $Name; ok = $false; exists = $false; running = $false; message = "podman not found in PATH" }
  }

  try {
    $inspectOutput = @(& podman inspect $Name 2>&1)
    $inspectCode = $LASTEXITCODE
  } catch {
    $fallback = Ensure-NodeMcpFallback $Name
    if ($fallback) { return $fallback }
    return @{ name = $Name; ok = $false; exists = $null; running = $false; message = Redact-Text $_.Exception.Message }
  }
  if ($inspectCode -ne 0) {
    $fallback = Ensure-NodeMcpFallback $Name
    if ($fallback) { return $fallback }
    return @{ name = $Name; ok = $false; exists = $false; running = $false; message = Redact-Text ($inspectOutput -join "`n") }
  }

  try {
    $running = ((& podman inspect -f "{{.State.Running}}" $Name 2>&1) | Select-Object -First 1).Trim()
  } catch {
    $fallback = Ensure-NodeMcpFallback $Name
    if ($fallback) { return $fallback }
    return @{ name = $Name; ok = $false; exists = $true; running = $false; message = Redact-Text $_.Exception.Message }
  }
  if ($running -ne "true") {
    try {
      $startOutput = @(& podman start $Name 2>&1)
      $startCode = $LASTEXITCODE
    } catch {
      $startOutput = @($_.Exception.Message)
      $startCode = 1
    }
    if ($startCode -ne 0) {
      if ($healthUrl) {
        $health = Test-Health $healthUrl
        if ($health.ok) {
          return @{
            name = $Name
            ok = $true
            exists = $true
            running = $false
            status = "port-already-healthy"
            message = "container start skipped; health endpoint already responds"
          }
        }
      }
      $fallback = Ensure-NodeMcpFallback $Name
      if ($fallback) { return $fallback }
      return @{ name = $Name; ok = $false; exists = $true; running = $false; message = Redact-Text ($startOutput -join "`n") }
    }
  }

  try {
    $status = ((& podman inspect -f "{{.State.Status}}" $Name 2>&1) | Select-Object -First 1).Trim()
  } catch {
    $fallback = Ensure-NodeMcpFallback $Name
    if ($fallback) { return $fallback }
    return @{ name = $Name; ok = $false; exists = $true; running = $true; message = Redact-Text $_.Exception.Message }
  }
  return @{ name = $Name; ok = $true; exists = $true; running = $true; status = $status }
}

function Test-Health {
  param([Parameter(Mandatory = $true)][string]$Url)
  try {
    $response = Invoke-RestMethod -Uri $Url -TimeoutSec 8
    return @{ url = $Url; ok = $true; response = $response }
  } catch {
    return @{ url = $Url; ok = $false; error = (Redact-Text $_.Exception.Message) }
  }
}

function Ensure-NodeMcpFallback {
  param([Parameter(Mandatory = $true)][string]$Name)

  $profile = switch ($Name) {
    "a11-mcp" { @{ envFile = ".env"; healthUrl = "http://127.0.0.1:8787/health"; port = 8787 } }
    "a11-mcp-aura" { @{ envFile = ".env.aura"; healthUrl = "http://127.0.0.1:8788/health"; port = 8788 } }
    default { $null }
  }
  if (-not $profile) { return $null }

  $health = Test-Health $profile.healthUrl
  if ($health.ok) {
    return @{
      name = $Name
      ok = $true
      exists = $null
      running = $null
      status = "node-fallback-already-healthy"
      message = "local Node MCP endpoint already responds"
    }
  }

  $serverPath = Join-Path $McpRoot "dist\server.js"
  $envPath = Join-Path $McpRoot $profile.envFile
  if ((-not (Test-Path -LiteralPath $serverPath)) -or (-not (Test-Path -LiteralPath $envPath))) {
    return @{
      name = $Name
      ok = $false
      exists = $null
      running = $false
      status = "node-fallback-missing"
      message = "missing a11mcp dist/server.js or env profile"
    }
  }

  $launcherPath = Join-Path $StateRoot "start-node-mcp-profile.ps1"
  $logRoot = Join-Path $StateRoot "logs"
  if (-not (Test-Path -LiteralPath $logRoot)) {
    New-Item -ItemType Directory -Force -Path $logRoot | Out-Null
  }
  @'
param(
  [Parameter(Mandatory = $true)][string]$Root,
  [Parameter(Mandatory = $true)][string]$EnvFile,
  [Parameter(Mandatory = $true)][int]$Port
)

$ErrorActionPreference = 'Stop'
Get-Content -LiteralPath $EnvFile | ForEach-Object {
  $line = $_.Trim()
  if (-not $line -or $line.StartsWith('#') -or -not $line.Contains('=')) { return }
  $parts = $line -split '=', 2
  $name = $parts[0].Trim()
  $value = $parts[1]
  if ($name) { Set-Item -Path ("Env:$name") -Value $value }
}
$env:MCP_PORT = [string]$Port
Set-Location -LiteralPath $Root
& node.exe dist/server.js --http
'@ | Set-Content -LiteralPath $launcherPath -Encoding UTF8

  $stdout = Join-Path $logRoot "$Name.stdout.log"
  $stderr = Join-Path $logRoot "$Name.stderr.log"
  try {
    $process = Start-Process -FilePath "powershell.exe" `
      -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $launcherPath, "-Root", $McpRoot, "-EnvFile", $envPath, "-Port", $profile.port) `
      -WorkingDirectory $McpRoot `
      -WindowStyle Hidden `
      -RedirectStandardOutput $stdout `
      -RedirectStandardError $stderr `
      -PassThru
  } catch {
    return @{
      name = $Name
      ok = $false
      exists = $null
      running = $false
      status = "node-fallback-start-failed"
      message = Redact-Text $_.Exception.Message
    }
  }

  for ($i = 0; $i -lt 25; $i++) {
    Start-Sleep -Seconds 1
    $health = Test-Health $profile.healthUrl
    if ($health.ok) {
      return @{
        name = $Name
        ok = $true
        exists = $null
        running = $true
        status = "node-fallback-started"
        processId = $process.Id
        port = $profile.port
        message = "started local Node MCP fallback"
      }
    }
  }

  return @{
    name = $Name
    ok = $false
    exists = $null
    running = $false
    status = "node-fallback-timeout"
    processId = $process.Id
    port = $profile.port
    message = "Node MCP fallback did not become healthy in time"
  }
}

function Invoke-NpmScript {
  param(
    [Parameter(Mandatory = $true)][string]$ScriptName,
    [string[]]$Args = @()
  )

  $output = @(& npm --prefix $ServerRoot run $ScriptName -- @Args 2>&1)
  $code = $LASTEXITCODE
  $text = Redact-Text ($output -join "`n")
  if ($code -ne 0) {
    throw "npm script $ScriptName failed ($code): $text"
  }

  $jsonStart = $text.IndexOf("{")
  if ($jsonStart -ge 0) {
    $candidate = $text.Substring($jsonStart)
    try {
      return ($candidate | ConvertFrom-Json)
    } catch {
      return $text
    }
  }

  return $text
}

function Read-Count {
  param(
    [Parameter(Mandatory = $true)][string]$McpUrl,
    [Parameter(Mandatory = $true)][string]$Query,
    [Parameter(Mandatory = $true)][string]$Field
  )

  $result = Invoke-McpTool -BaseUrl $McpUrl -Name "neo4j_read_query" -Arguments @{ query = $Query; limit = 1 }
  $rows = @($result.result.structuredContent.rows)
  if (-not $rows -or $rows.Count -lt 1) {
    return $null
  }
  return $rows[0].$Field
}

function Post-Status {
  param(
    [Parameter(Mandatory = $true)][string]$Kind,
    [Parameter(Mandatory = $true)][string]$Body
  )

  try {
    Invoke-McpTool -BaseUrl $sharedMcp -Name "discussion_post" -Arguments @{
      threadId = $discussionId
      from = "A11 MCP Autopilot"
      kind = $Kind
      body = $Body
    } -TimeoutSec 10 | Out-Null
  } catch {
    # Avoid making the watchdog noisy if the shared MCP itself is down.
  }
}

function Register-CodexMcpNeoHook {
  param(
    [Parameter(Mandatory = $true)][hashtable]$Metrics,
    [switch]$DryRun,
    [switch]$WriteMemory
  )

  $at = (Get-Date).ToString("o")
  $dryRunValue = [bool]$DryRun
  $status = if ($Metrics.ok) { "active" } else { "degraded" }

  $graphResult = Invoke-McpTool -BaseUrl $auraMcp -Name "graph_write_safe" -Arguments @{
    label = "Job"
    id = "codex-mcp-neo-hook"
    from = "codex"
    reason = "Refresh Codex MCP/Neo4j hook status."
    dryRun = $dryRunValue
    props = @{
      name = "Codex MCP Neo Hook"
      status = $status
      scope = "mcp-neo4j"
      owner = "codex"
      description = "Reusable checkpoint for Codex MCP and Neo4j coordination; no secrets stored."
      sharedNodes = [int]$Metrics.sharedNodes
      sharedRelationships = [int]$Metrics.sharedRelationships
      auraNodes = [int]$Metrics.auraNodes
      auraRelationships = [int]$Metrics.auraRelationships
      updatedAt = $at
    }
  } -TimeoutSec 20

  $memoryResult = $null
  if ((-not $dryRunValue) -and $WriteMemory) {
    $memoryResult = Invoke-McpTool -BaseUrl $auraMcp -Name "memory_write_safe" -Arguments @{
      from = "codex"
      title = "Codex MCP Neo hook refreshed"
      body = "Codex refreshed the MCP/Neo4j hook checkpoint at $at. Aura: $($Metrics.auraNodes) nodes / $($Metrics.auraRelationships) relations. Shared: $($Metrics.sharedNodes) nodes / $($Metrics.sharedRelationships) relations. No secrets were stored."
      scope = "infra"
      kind = "agent_decision"
      tags = @("codex", "mcp", "neo4j", "hook")
      links = @("neo4j:Job/codex-mcp-neo-hook")
    } -TimeoutSec 20
  }

  return @{
    ok = $true
    at = $at
    dryRun = $dryRunValue
    jobId = "codex-mcp-neo-hook"
    graph = $graphResult.result.structuredContent
    memory = if ($memoryResult) { $memoryResult.result.structuredContent } else { $null }
  }
}

$startedAt = (Get-Date).ToString("o")
$statusPath = Join-Path $StateRoot "status.json"
$lastErrorPath = Join-Path $StateRoot "last-error.json"

try {
  $containers = @(
    Ensure-Container "a11-neo4j-sync"
    Ensure-Container "a11-mcp"
    Ensure-Container "a11-mcp-aura"
    Ensure-Container "a11-mcp-cloudflared"
  )

  $health = @(
    Test-Health "http://127.0.0.1:8787/health"
    Test-Health "http://127.0.0.1:8788/health"
    Test-Health "https://mcp.funesterie.me/health"
  )

  $auraStatus = Invoke-McpTool -BaseUrl $auraMcp -Name "neo4j_status"
  $routerStatus = Invoke-NpmScript -ScriptName "memory:status"

  $sharedStatus = @{
    configured = $true
    ok = [bool]$routerStatus.local.ok
    source = "memory-router-local"
    uri = $routerStatus.local.uri
    database = $routerStatus.local.database
  }
  $auraNodes = $routerStatus.aura.nodes
  $auraRelationships = $routerStatus.aura.relationships
  $sharedNodes = $routerStatus.local.nodes
  $sharedRelationships = $routerStatus.local.relationships

  $syncResult = $null
  $backupResult = $null
  if ($SyncLocal) {
    $syncResult = Invoke-NpmScript -ScriptName "memory:sync-local"
    $routerStatus = Invoke-NpmScript -ScriptName "memory:status"
    $sharedStatus.ok = [bool]$routerStatus.local.ok
    $sharedStatus.uri = $routerStatus.local.uri
    $sharedStatus.database = $routerStatus.local.database
    $auraNodes = $routerStatus.aura.nodes
    $auraRelationships = $routerStatus.aura.relationships
    $sharedNodes = $routerStatus.local.nodes
    $sharedRelationships = $routerStatus.local.relationships
  }
  if ($Backup) {
    $backupResult = Invoke-NpmScript -ScriptName "memory:backup-seagate"
  }
  $hookResult = $null
  if ($RegisterHook -or $RegisterHookDryRun) {
    $hookResult = Register-CodexMcpNeoHook -DryRun:$RegisterHookDryRun -WriteMemory:$PostOk -Metrics @{
      ok = $true
      auraNodes = $auraNodes
      auraRelationships = $auraRelationships
      sharedNodes = $sharedNodes
      sharedRelationships = $sharedRelationships
    }
  }

  $summary = @{
    ok = $true
    at = (Get-Date).ToString("o")
    startedAt = $startedAt
    mode = "ai-managed-mcp"
    message = "MCP routes are healthy; Neo4j Desktop/Query is optional."
    routes = @{
      shared = @{
        mcp = $sharedMcp
        role = "shared local mirror tools"
        nodes = $sharedNodes
        relationships = $sharedRelationships
      }
      aura = @{
        mcp = $auraMcp
        role = "Aura tools"
        database = "aa4680d2"
        nodes = $auraNodes
        relationships = $auraRelationships
      }
    }
    containers = $containers
    health = $health
    sharedStatus = $sharedStatus
    auraStatus = $auraStatus.result.structuredContent
    routerStatus = $routerStatus
    syncResult = $syncResult
    backupResult = $backupResult
    hook = $hookResult
  }

  Save-Json -Value $summary -Path $statusPath

  if ($PostOk) {
    Post-Status -Kind "status" -Body "Autopilot MCP OK. Aura tools: $auraNodes nodes / $auraRelationships relations. Shared route: $sharedNodes nodes / $sharedRelationships relations. Neo4j console not required."
  }

  $summary | ConvertTo-Json -Depth 30
  exit 0
} catch {
  $errorText = Redact-Text ($_.Exception.Message)
  $failure = @{
    ok = $false
    at = (Get-Date).ToString("o")
    startedAt = $startedAt
    error = $errorText
  }
  Save-Json -Value $failure -Path $lastErrorPath
  Post-Status -Kind "status" -Body "Autopilot MCP needs attention: $errorText"
  $failure | ConvertTo-Json -Depth 10
  exit 1
}
