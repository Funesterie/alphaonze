param(
  [int]$Port = 8089,
  [string]$PublicMcpBaseUrl = "https://mcp.funesterie.me",
  [string]$PrivateMcpUrl = "http://127.0.0.1:8787/mcp",
  [string]$PrivateMcpFallbackUrl = "https://mcp.funesterie.me/mcp",
  [string]$TunnelHostname = "",
  [string]$AccessCode = "",
  [switch]$NoBrowser,
  [switch]$NoGate,
  [switch]$AllowMultiple,
  [switch]$SelfTest
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$root = $PSScriptRoot
if (-not $root) { $root = Split-Path -Parent $MyInvocation.MyCommand.Path }

function New-CockpitAccessCode {
  $bytes = New-Object byte[] 32
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  return [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

function Get-McpBearer {
  if ($env:MCP_AUTH_TOKEN) { return $env:MCP_AUTH_TOKEN.Trim() }

  $candidates = @(
    "D:\agent-bus\mcp-token-current.txt",
    "D:\projets\funesterie\a11mcp\.env",
    (Join-Path $root ".env")
  )

  foreach ($path in $candidates) {
    if (-not (Test-Path -LiteralPath $path)) { continue }
    if ($path -like "*.env") {
      $line = Get-Content -LiteralPath $path -ErrorAction SilentlyContinue |
        Where-Object { $_ -match '^\s*MCP_AUTH_TOKEN\s*=' } |
        Select-Object -First 1
      if ($line) {
        $value = ($line -replace '^\s*MCP_AUTH_TOKEN\s*=\s*', '').Trim('"', "'", ' ')
        if ($value -and $value -notmatch '^replace-with-') { return $value }
      }
      continue
    }

    $raw = (Get-Content -LiteralPath $path -Raw -ErrorAction SilentlyContinue).Trim()
    if ($raw) { return $raw }
  }

  return $null
}

function Protect-JsonText {
  param([string]$Text)
  if (-not $Text) { return $Text }
  $out = $Text
  $out = $out -replace '("?(?:token|secret|password|apiKey|api_key|authorization|bearer|client_secret)"?\s*:\s*")([^"]+)(")', '$1[REDACTED]$3'
  $out = $out -replace '(Bearer\s+)[A-Za-z0-9._~+/=-]{12,}', '$1[REDACTED]'
  $out = $out -replace '([A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,})', '[REDACTED_JWT]'
  return $out
}

function Send-Json {
  param($Response, $Object, [int]$Status = 200)
  $json = $Object | ConvertTo-Json -Depth 80 -Compress
  $json = Protect-JsonText $json
  $bytes = [Text.Encoding]::UTF8.GetBytes($json)
  $Response.StatusCode = $Status
  $Response.ContentType = "application/json; charset=utf-8"
  $Response.ContentLength64 = $bytes.Length
  $Response.OutputStream.Write($bytes, 0, $bytes.Length)
  $Response.OutputStream.Close()
}

function Send-Html {
  param($Response, [string]$Html, [int]$Status = 200)
  $bytes = [Text.Encoding]::UTF8.GetBytes($Html)
  $Response.StatusCode = $Status
  $Response.ContentType = "text/html; charset=utf-8"
  $Response.ContentLength64 = $bytes.Length
  $Response.OutputStream.Write($bytes, 0, $bytes.Length)
  $Response.OutputStream.Close()
}

function Send-Head {
  param($Response, [int]$Status = 200, [string]$ContentType = "text/plain; charset=utf-8")
  $Response.StatusCode = $Status
  $Response.ContentType = $ContentType
  $Response.ContentLength64 = 0
  $Response.OutputStream.Close()
}

function Read-JsonBody {
  param($Request)
  if (-not $Request.HasEntityBody) { return $null }
  $reader = New-Object IO.StreamReader($Request.InputStream, $Request.ContentEncoding)
  try {
    $text = $reader.ReadToEnd()
    if (-not $text) { return $null }
    return $text | ConvertFrom-Json
  } finally {
    $reader.Close()
  }
}

function Parse-McpResponse {
  param([string]$Content)
  $events = @()
  if ($Content -match '(?m)^data:\s*(.+)$') {
    foreach ($match in [regex]::Matches($Content, '(?m)^data:\s*(.+)$')) {
      $line = $match.Groups[1].Value.Trim()
      if (-not $line -or $line -eq '[DONE]') { continue }
      try {
        $events += @{ type = "message"; parsed = ($line | ConvertFrom-Json) }
      } catch {
        $events += @{ type = "message"; data = (Protect-JsonText $line) }
      }
    }
    return @{ events = $events }
  }

  try {
    return @{ events = @(@{ type = "json"; parsed = ($Content | ConvertFrom-Json) }) }
  } catch {
    return @{ text = (Protect-JsonText $Content) }
  }
}

function Invoke-McpProxy {
  param($Body)

  $allowedMethods = @(
    "initialize",
    "notifications/initialized",
    "tools/list",
    "tools/call",
    "resources/list",
    "resources/read",
    "prompts/list",
    "prompts/get"
  )

  $endpoint = "chatgpt"
  if ($Body -and $Body.endpoint) { $endpoint = [string]$Body.endpoint }
  $request = $Body.request
  if (-not $request -or -not $request.method) {
    return @{ ok = $false; status = 400; error = "bad_mcp_request" }
  }

  if ($allowedMethods -notcontains [string]$request.method) {
    return @{ ok = $false; status = 400; error = "method_not_allowed" }
  }

  $base = $PublicMcpBaseUrl.TrimEnd('/')
  $targets = @{
    chatgpt = @("$base/chatgpt/mcp")
    claude = @("$base/claude/mcp")
    gemini = @("$base/gemini/mcp")
    grok = @("$base/grok/mcp")
  }

  $headers = @{
    Accept = "application/json, text/event-stream"
  }

  if ($endpoint -eq "private") {
    $bearer = Get-McpBearer
    if (-not $bearer -and $Body.privateBearer) { $bearer = [string]$Body.privateBearer }
    if (-not $bearer) {
      return @{ ok = $false; status = 401; error = "missing_private_bearer" }
    }
    $headers.Authorization = "Bearer $bearer"
    $targets.private = @($PrivateMcpUrl, $PrivateMcpFallbackUrl) | Where-Object { $_ }
  }

  if (-not $targets.ContainsKey($endpoint)) {
    return @{ ok = $false; status = 400; error = "unknown_endpoint" }
  }

  $payload = $request | ConvertTo-Json -Depth 80 -Compress
  foreach ($url in $targets[$endpoint]) {
    try {
      $response = Invoke-WebRequest -Uri $url -Method Post -Headers $headers -ContentType "application/json" -Body $payload -TimeoutSec 25 -UseBasicParsing
      return @{
        ok = $true
        status = [int]$response.StatusCode
        endpoint = $endpoint
        upstream = ($url -replace '\?.*$', '')
        payload = (Parse-McpResponse -Content $response.Content)
      }
    } catch {
      $message = $_.Exception.Message
      $status = 502
      try {
        if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
          $status = [int]$_.Exception.Response.StatusCode
        }
      } catch {}
      $last = @{ ok = $false; status = $status; endpoint = $endpoint; error = $message }
    }
  }

  return $last
}

function Test-Session {
  param($Request)
  if ($NoGate) { return $true }
  if (-not $script:AccessCode) { return $true }

  $cookie = [string]$Request.Headers["Cookie"]
  if ($cookie -and $cookie -match 'nossen_cockpit_session=([^;]+)') {
    return ($matches[1] -eq $script:AccessCode)
  }
  return $false
}

function Send-SessionRedirect {
  param($Request, $Response)
  $target = $Request.Url.AbsolutePath
  if (-not $target) { $target = "/mcp" }
  $Response.StatusCode = 302
  $Response.Headers.Add("Set-Cookie", "nossen_cockpit_session=$script:AccessCode; Path=/; HttpOnly; SameSite=Lax")
  $Response.RedirectLocation = $target
  $Response.OutputStream.Close()
}

function Send-CockpitPage {
  param($Response)
  $path = Join-Path $root "mcp.html"
  if (-not (Test-Path -LiteralPath $path)) {
    Send-Html -Response $Response -Html "<!doctype html><title>missing</title><p>mcp.html missing</p>" -Status 500
    return
  }

  $tokenPresent = [bool](Get-McpBearer)
  $config = @{
    mode = "local-tunnel"
    hostname = $TunnelHostname
    serverSideBearer = $tokenPresent
  } | ConvertTo-Json -Compress
  $inject = "<script>window.__FUNESTERIE_LOCAL_COCKPIT__=$config;window.__FUNESTERIE_COCKPIT_USER__={email:'local-cockpit'};</script>"
  $html = Get-Content -LiteralPath $path -Raw
  $html = $html -replace '</head>', "$inject</head>"
  Send-Html -Response $Response -Html $html
}

function Start-Listener {
  param([int]$StartPort)
  $ports = @($StartPort, 8090, 8091, 8092, 8189, 8289, 9089, 9090)
  foreach ($candidate in $ports) {
    $listener = New-Object Net.HttpListener
    $listener.Prefixes.Add("http://127.0.0.1:$candidate/")
    try {
      $listener.Start()
      return @{ listener = $listener; port = $candidate }
    } catch {
      try { $listener.Close() } catch {}
    }
  }
  return $null
}

if ($SelfTest) {
  $page = Join-Path $root "mcp.html"
  if (-not (Test-Path -LiteralPath $page)) { throw "mcp.html missing" }
  Write-Output (@{ ok = $true; page = $page } | ConvertTo-Json -Compress)
  exit 0
}

if (-not $AccessCode -and -not $NoGate) { $AccessCode = New-CockpitAccessCode }
$script:AccessCode = $AccessCode

if (-not $AllowMultiple) {
  try {
    $selfPid = $PID
    $scriptPath = [IO.Path]::GetFullPath($MyInvocation.MyCommand.Path)
    $escapedScriptPath = [regex]::Escape($scriptPath)
    Get-CimInstance Win32_Process |
      Where-Object {
        $_.ProcessId -ne $selfPid -and
        $_.Name -match 'powershell|pwsh' -and
        $_.CommandLine -match $escapedScriptPath
      } |
      ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  } catch {}
}

$listen = Start-Listener -StartPort $Port
if (-not $listen) {
  Write-Host "No free local cockpit port found." -ForegroundColor Red
  exit 1
}

$listener = $listen.listener
$Port = $listen.port
$localUrl = "http://127.0.0.1:$Port/mcp"
$publicUrl = if ($TunnelHostname) { "https://$TunnelHostname/mcp" } else { "" }
$baseLaunchUrl = if ($publicUrl) { $publicUrl } else { $localUrl }
$launchUrl = if ($script:AccessCode) { "$baseLaunchUrl?access=$([Uri]::EscapeDataString($script:AccessCode))" } else { $baseLaunchUrl }

Write-Host ""
Write-Host "NOSSEN MCP cockpit local" -ForegroundColor Green
Write-Host "Local:  $localUrl" -ForegroundColor DarkGreen
if ($TunnelHostname) { Write-Host "Tunnel: $publicUrl" -ForegroundColor DarkGreen }
Write-Host "Gate:   $(if ($script:AccessCode) { 'session key active, not printed' } else { 'disabled' })" -ForegroundColor DarkGray
Write-Host "Token:  $(if (Get-McpBearer) { 'server-side MCP token detected' } else { 'no MCP token detected' })" -ForegroundColor DarkGray
Write-Host "Stop:   Ctrl+C" -ForegroundColor DarkGray
Write-Host ""

if (-not $NoBrowser) {
  try {
    Start-Process -FilePath "rundll32.exe" -ArgumentList @("url.dll,FileProtocolHandler", $launchUrl)
  } catch {
    Write-Host "Browser open skipped: $($_.Exception.Message)" -ForegroundColor DarkYellow
  }
}

while ($listener.IsListening) {
  try {
    $ctx = $listener.GetContext()
    $req = $ctx.Request
    $res = $ctx.Response
    $path = $req.Url.AbsolutePath
    $method = $req.HttpMethod

    if ($method -eq "OPTIONS") {
      $res.StatusCode = 204
      $origin = $req.Headers["Origin"]
      if (-not $origin) { $origin = "*" }
      $res.Headers.Add("Access-Control-Allow-Origin", $origin)
      $res.Headers.Add("Access-Control-Allow-Headers", "content-type, accept")
      $res.Headers.Add("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
      $res.OutputStream.Close()
      continue
    }

    if ($method -eq "HEAD") {
      if ($path -eq "/health") {
        Send-Head -Response $res -Status 200 -ContentType "application/json; charset=utf-8"
        continue
      }
      if ($path -in @("/", "/mcp", "/mcp.html", "/index.html")) {
        $headStatus = if (Test-Session -Request $req) { 200 } else { 403 }
        Send-Head -Response $res -Status $headStatus -ContentType "text/html; charset=utf-8"
        continue
      }
      Send-Head -Response $res -Status 404
      continue
    }

    if ($path -eq "/health") {
      Send-Json -Response $res -Object @{ ok = $true; service = "nossen-cockpit-local"; port = $Port; hostname = $TunnelHostname }
      continue
    }

    if ($script:AccessCode -and $req.QueryString["access"] -eq $script:AccessCode) {
      Send-SessionRedirect -Request $req -Response $res
      continue
    }

    if (-not (Test-Session -Request $req)) {
      Send-Html -Response $res -Status 403 -Html "<!doctype html><title>Access required</title><p>NOSSEN cockpit session required.</p>"
      continue
    }

    if ($path -in @("/", "/mcp", "/mcp.html", "/index.html")) {
      Send-CockpitPage -Response $res
      continue
    }

    if ($path -eq "/.netlify/functions/mcp-proxy" -and $method -eq "POST") {
      $body = Read-JsonBody -Request $req
      Send-Json -Response $res -Object (Invoke-McpProxy -Body $body)
      continue
    }

    if ($path -eq "/favicon.ico") {
      $res.StatusCode = 204
      $res.OutputStream.Close()
      continue
    }

    Send-Html -Response $res -Status 404 -Html "<!doctype html><title>Not found</title><p>Route not found.</p>"
  } catch {
    try {
      Send-Json -Response $ctx.Response -Status 500 -Object @{ ok = $false; error = $_.Exception.Message }
    } catch {}
  }
}
