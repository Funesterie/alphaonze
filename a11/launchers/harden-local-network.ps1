param(
  [switch]$ReportOnly,
  [switch]$SkipFreeboxAudit,
  [switch]$AsJson
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$script:TargetPorts = @(
  [PSCustomObject]@{ Service = 'A11'; Port = 3000; FirewallRule = 'A11 LocalOnly Backend 3000'; ExpectedHosts = @('127.0.0.1', '::1') },
  [PSCustomObject]@{ Service = 'TTS'; Port = 5002; FirewallRule = 'A11 LocalOnly TTS 5002'; ExpectedHosts = @('127.0.0.1', '::1') },
  [PSCustomObject]@{ Service = 'LLM'; Port = 4545; FirewallRule = 'A11 LocalOnly LLM 4545'; ExpectedHosts = @('127.0.0.1', '::1') },
  [PSCustomObject]@{ Service = 'AlphaOnze'; Port = 8088; FirewallRule = 'A11 LocalOnly AlphaOnze 8088'; ExpectedHosts = @('127.0.0.1', '::1') }
)
$script:BroadAllowRuleNames = @('Node.js JavaScript Runtime', 'python.exe', 'caddy.exe')
$script:CaddyRuleNames = @(
  [PSCustomObject]@{ Name = 'AlphaOnze Caddy HTTP 80'; Port = 80 },
  [PSCustomObject]@{ Name = 'AlphaOnze Caddy HTTPS 443'; Port = 443 }
)

$script:A11Root = Split-Path -Parent $PSScriptRoot
$script:WorkspaceRoot = Split-Path -Parent $script:A11Root
$script:AlphaOnzeRoot = Join-Path $script:WorkspaceRoot 'alphaonze-afk'

function Write-Section {
  param([string]$Title)
  Write-Host ''
  Write-Host "== $Title =="
}

function Get-ListeningConnections {
  param([int]$Port)

  try {
    return @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction Stop)
  } catch {
    return @()
  }
}

function Get-ProcessSummaries {
  param([int[]]$ProcessIds)

  $items = New-Object System.Collections.Generic.List[object]
  foreach ($processId in @($ProcessIds | Where-Object { $_ } | Select-Object -Unique)) {
    try {
      $proc = Get-Process -Id $processId -ErrorAction Stop
      $path = ''
      try {
        $path = [string]$proc.Path
      } catch {
        $path = ''
      }
      $items.Add([PSCustomObject]@{
          ProcessId = $proc.Id
          Name = $proc.ProcessName
          Path = $path
        })
    } catch {
      $items.Add([PSCustomObject]@{
          ProcessId = $processId
          Name = 'unknown'
          Path = ''
        })
    }
  }
  return $items.ToArray()
}

function Get-PortBindingReport {
  param([object]$Target)

  $connections = @(Get-ListeningConnections -Port $Target.Port)
  $addresses = @($connections | Select-Object -ExpandProperty LocalAddress -Unique)
  $processes = @(Get-ProcessSummaries -ProcessIds @($connections | Select-Object -ExpandProperty OwningProcess -Unique))
  $unexpected = @($addresses | Where-Object { $_ -and ($_ -notin $Target.ExpectedHosts) })

  [PSCustomObject]@{
    Service = $Target.Service
    Port = $Target.Port
    Status = if ($connections.Count -gt 0) { 'listening' } else { 'not_listening' }
    LocalAddresses = $addresses
    LoopbackOnly = ($connections.Count -eq 0) -or ($unexpected.Count -eq 0)
    UnexpectedAddresses = $unexpected
    Processes = $processes
  }
}

function Ensure-LocalOnlyFirewallRule {
  param([object]$Target)

  $existing = Get-NetFirewallRule -DisplayName $Target.FirewallRule -ErrorAction SilentlyContinue
  if ($existing) {
    Set-NetFirewallRule -DisplayName $Target.FirewallRule -Enabled True -Direction Inbound -Action Block -Profile Any | Out-Null
  } else {
    New-NetFirewallRule -DisplayName $Target.FirewallRule -Direction Inbound -Action Block -Protocol TCP -LocalPort $Target.Port -Profile Any | Out-Null
  }
}

function Get-FirewallRuleReport {
  param([object]$Target)

  $rules = @(Get-NetFirewallRule -DisplayName $Target.FirewallRule -ErrorAction SilentlyContinue)
  $portFilters = @()
  foreach ($rule in $rules) {
    $portFilters += @(Get-NetFirewallPortFilter -AssociatedNetFirewallRule $rule -ErrorAction SilentlyContinue)
  }

  [PSCustomObject]@{
    Service = $Target.Service
    Port = $Target.Port
    RuleName = $Target.FirewallRule
    Present = $rules.Count -gt 0
    Enabled = @($rules | Where-Object { $_.Enabled -eq 'True' }).Count -gt 0
    Actions = @($rules | Select-Object -ExpandProperty Action -Unique)
    Profiles = @($rules | Select-Object -ExpandProperty Profile -Unique)
    LocalPorts = @($portFilters | Select-Object -ExpandProperty LocalPort -Unique)
  }
}

function Get-BroadAllowRuleReport {
  $items = New-Object System.Collections.Generic.List[object]
  $rules = Get-NetFirewallRule -Direction Inbound -Enabled True -Action Allow -ErrorAction SilentlyContinue
  foreach ($rule in $rules) {
    $appFilter = Get-NetFirewallApplicationFilter -AssociatedNetFirewallRule $rule -ErrorAction SilentlyContinue | Select-Object -First 1
    $program = [string]$appFilter.Program
    if (-not $program -and $rule.DisplayName -notin $script:BroadAllowRuleNames) {
      continue
    }

    $programLower = $program.ToLowerInvariant()
    $matchesProgram = $program -and @('node.exe', 'python.exe', 'caddy.exe') | Where-Object { $programLower.EndsWith($_) }
    if (-not $matchesProgram -and $rule.DisplayName -notin $script:BroadAllowRuleNames) {
      continue
    }

    $portFilters = @(Get-NetFirewallPortFilter -AssociatedNetFirewallRule $rule -ErrorAction SilentlyContinue)
    $addressFilter = Get-NetFirewallAddressFilter -AssociatedNetFirewallRule $rule -ErrorAction SilentlyContinue | Select-Object -First 1
    foreach ($portFilter in $portFilters) {
      $items.Add([PSCustomObject]@{
          DisplayName = $rule.DisplayName
          Program = $program
          Profile = $rule.Profile
          Protocol = $portFilter.Protocol
          LocalPort = $portFilter.LocalPort
          RemoteAddress = @($addressFilter.RemoteAddress) -join ','
          Broad = ($portFilter.LocalPort -eq 'Any')
        })
    }
  }
  return $items.ToArray()
}

function Resolve-CaddyProgramPath {
  $paths = New-Object System.Collections.Generic.List[string]

  $firewallRules = @(Get-NetFirewallRule -DisplayName 'caddy.exe' -ErrorAction SilentlyContinue)
  foreach ($rule in $firewallRules) {
    $app = Get-NetFirewallApplicationFilter -AssociatedNetFirewallRule $rule -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($app -and $app.Program) {
      $paths.Add([string]$app.Program)
    }
  }

  $caddyProcess = Get-Process -Name 'caddy' -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($caddyProcess) {
    try {
      if ($caddyProcess.Path) {
        $paths.Add([string]$caddyProcess.Path)
      }
    } catch {
    }
  }

  $paths.Add((Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages\CaddyServer.Caddy_Microsoft.Winget.Source_8wekyb3d8bbwe\caddy.exe'))

  foreach ($candidate in @($paths | Select-Object -Unique)) {
    if ($candidate -and (Test-Path -LiteralPath $candidate)) {
      return [string]$candidate
    }
  }

  return ''
}

function Ensure-CaddyAllowRules {
  $caddyProgram = Resolve-CaddyProgramPath
  foreach ($ruleInfo in $script:CaddyRuleNames) {
    $existing = Get-NetFirewallRule -DisplayName $ruleInfo.Name -ErrorAction SilentlyContinue
    if ($existing) {
      Set-NetFirewallRule -DisplayName $ruleInfo.Name -Enabled True -Direction Inbound -Action Allow -Profile Public | Out-Null
    } elseif ($caddyProgram) {
      New-NetFirewallRule -DisplayName $ruleInfo.Name -Direction Inbound -Action Allow -Protocol TCP -LocalPort $ruleInfo.Port -Program $caddyProgram -Profile Public | Out-Null
    } else {
      New-NetFirewallRule -DisplayName $ruleInfo.Name -Direction Inbound -Action Allow -Protocol TCP -LocalPort $ruleInfo.Port -Profile Public | Out-Null
    }
  }
}

function Disable-BroadAllowRules {
  foreach ($ruleName in $script:BroadAllowRuleNames) {
    $rules = @(Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue)
    foreach ($rule in $rules) {
      $portFilters = @(Get-NetFirewallPortFilter -AssociatedNetFirewallRule $rule -ErrorAction SilentlyContinue)
      $hasBroadPort = @($portFilters | Where-Object { $_.LocalPort -eq 'Any' }).Count -gt 0
      if ($hasBroadPort) {
        Set-NetFirewallRule -InputObject $rule -Enabled False | Out-Null
      }
    }
  }
}

function Get-CaddyAllowRuleReport {
  $items = foreach ($ruleInfo in $script:CaddyRuleNames) {
    $rules = @(Get-NetFirewallRule -DisplayName $ruleInfo.Name -ErrorAction SilentlyContinue)
    $portFilters = foreach ($rule in $rules) {
      Get-NetFirewallPortFilter -AssociatedNetFirewallRule $rule -ErrorAction SilentlyContinue
    }
    $appFilters = foreach ($rule in $rules) {
      Get-NetFirewallApplicationFilter -AssociatedNetFirewallRule $rule -ErrorAction SilentlyContinue
    }
    [PSCustomObject]@{
      RuleName = $ruleInfo.Name
      Port = $ruleInfo.Port
      Present = $rules.Count -gt 0
      Enabled = @($rules | Where-Object { $_.Enabled -eq 'True' }).Count -gt 0
      Profile = @($rules | Select-Object -ExpandProperty Profile -Unique) -join ', '
      Program = @($appFilters | Select-Object -ExpandProperty Program -Unique) -join ', '
      LocalPorts = @($portFilters | Select-Object -ExpandProperty LocalPort -Unique) -join ', '
    }
  }
  return @($items)
}

function Get-PortProxyReport {
  $raw = netsh interface portproxy show all
  $lines = @($raw | Where-Object { $_ -and $_.Trim() })
  $entries = @($lines | Where-Object { $_ -match '^\s*\d' -or $_ -match '^\s*[0-9A-Fa-f\.:]+\s+\d+' })
  [PSCustomObject]@{
    Raw = $lines
    HasEntries = $entries.Count -gt 0
  }
}

function Get-CaddyFacadeReport {
  $ports = @(80, 443)
  $listeners = foreach ($port in $ports) {
    $connections = @(Get-ListeningConnections -Port $port)
    $processes = @(Get-ProcessSummaries -ProcessIds @($connections | Select-Object -ExpandProperty OwningProcess -Unique))
    [PSCustomObject]@{
      Port = $port
      Status = if ($connections.Count -gt 0) { 'listening' } else { 'not_listening' }
      LocalAddresses = @($connections | Select-Object -ExpandProperty LocalAddress -Unique)
      Processes = $processes
    }
  }

  $caddyfilePath = Join-Path $script:AlphaOnzeRoot 'Caddyfile'
  $caddyfileExists = Test-Path -LiteralPath $caddyfilePath
  $caddyfile = if ($caddyfileExists) { Get-Content -Raw $caddyfilePath } else { '' }

  [PSCustomObject]@{
    Ports = $listeners
    CaddyfilePath = $caddyfilePath
    CaddyfileExists = $caddyfileExists
    ReverseProxyTargetsLocalBackend = $caddyfile -match 'reverse_proxy\s+127\.0\.0\.1:3000'
  }
}

function Get-LanIPv4Address {
  $candidates = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object {
      $_.IPAddress -and
      $_.IPAddress -notlike '127.*' -and
      $_.IPAddress -notlike '169.254.*' -and
      $_.PrefixOrigin -ne 'WellKnown'
    } |
    Sort-Object InterfaceMetric, SkipAsSource

  $first = $candidates | Select-Object -First 1
  if ($first) {
    return [string]$first.IPAddress
  }
  return ''
}

function Test-TcpReachability {
  param(
    [string]$Address,
    [int]$Port,
    [int]$TimeoutMs = 1200
  )

  if ([string]::IsNullOrWhiteSpace($Address)) {
    return $false
  }

  $client = [System.Net.Sockets.TcpClient]::new()
  try {
    $async = $client.BeginConnect($Address, $Port, $null, $null)
    if (-not $async.AsyncWaitHandle.WaitOne($TimeoutMs, $false)) {
      return $false
    }
    $client.EndConnect($async) | Out-Null
    return $true
  } catch {
    return $false
  } finally {
    $client.Close()
  }
}

function Get-LanReachabilityReport {
  param(
    [string]$LanIp,
    [object[]]$Targets
  )

  foreach ($target in $Targets) {
    [PSCustomObject]@{
      Service = $target.Service
      Port = $target.Port
      LanIp = $LanIp
      Reachable = Test-TcpReachability -Address $LanIp -Port $target.Port
    }
  }
}

function Get-FreeboxForwardReport {
  if ($SkipFreeboxAudit) {
    return [PSCustomObject]@{
      Status = 'skipped'
      Reason = 'disabled_by_flag'
      Rules = @()
    }
  }

  $tokenPath = Join-Path $script:AlphaOnzeRoot 'runtime\freebox-alphaonze-token.json'
  if (-not (Test-Path -LiteralPath $tokenPath)) {
    return [PSCustomObject]@{
      Status = 'skipped'
      Reason = 'missing_token'
      Rules = @()
    }
  }

  try {
    $apiInfo = Invoke-RestMethod -Method GET -Uri 'http://mafreebox.freebox.fr/api_version' -TimeoutSec 5
    $major = ([string]$apiInfo.api_version).Split('.')[0]
    $base = "http://mafreebox.freebox.fr/api/v$major"
    $tokenData = Get-Content -Raw $tokenPath | ConvertFrom-Json
    $login = Invoke-RestMethod -Method GET -Uri "$base/login/" -TimeoutSec 5
    $encoding = [System.Text.Encoding]::UTF8
    $hmac = [System.Security.Cryptography.HMACSHA1]::new($encoding.GetBytes([string]$tokenData.app_token))
    try {
      $password = ($hmac.ComputeHash($encoding.GetBytes([string]$login.result.challenge)) | ForEach-Object { $_.ToString('x2') }) -join ''
    } finally {
      $hmac.Dispose()
    }
    $session = Invoke-RestMethod -Method POST -Uri "$base/login/session/" -ContentType 'application/json' -TimeoutSec 5 -Body (@{
        app_id = 'pro.funesterie.alphaonze.afk'
        app_version = '0.1.0'
        password = $password
      } | ConvertTo-Json)
    $headers = @{ 'X-Fbx-App-Auth' = [string]$session.result.session_token }
    $rules = Invoke-RestMethod -Method GET -Uri "$base/fw/redir/" -Headers $headers -TimeoutSec 5
    $watchedPorts = @($script:TargetPorts | Select-Object -ExpandProperty Port) + 80 + 443
    $matchingRules = @(
      $rules.result | Where-Object {
        $rule = $_
        $rule.ip_proto -eq 'tcp' -and
        (@($watchedPorts | Where-Object { $_ -ge [int]$rule.wan_port_start -and $_ -le [int]$rule.wan_port_end }).Count -gt 0)
      }
    )

    return [PSCustomObject]@{
      Status = 'ok'
      Reason = ''
      Rules = @($matchingRules | ForEach-Object {
          [PSCustomObject]@{
            Id = $_.id
            Enabled = $_.enabled
            Comment = $_.comment
            SourceIp = $_.src_ip
            WanPortStart = $_.wan_port_start
            WanPortEnd = $_.wan_port_end
            LanIp = $_.lan_ip
            LanPort = $_.lan_port
          }
        })
    }
  } catch {
    return [PSCustomObject]@{
      Status = 'error'
      Reason = $_.Exception.Message
      Rules = @()
    }
  }
}

if (-not $ReportOnly) {
  foreach ($target in $script:TargetPorts) {
    Ensure-LocalOnlyFirewallRule -Target $target
  }
  Ensure-CaddyAllowRules
  Disable-BroadAllowRules
}

$bindReports = @($script:TargetPorts | ForEach-Object { Get-PortBindingReport -Target $_ })
$firewallReports = @($script:TargetPorts | ForEach-Object { Get-FirewallRuleReport -Target $_ })
$broadAllowRules = @(Get-BroadAllowRuleReport)
$caddyAllowRules = @(Get-CaddyAllowRuleReport)
$portProxy = Get-PortProxyReport
$caddyFacade = Get-CaddyFacadeReport
$lanIp = Get-LanIPv4Address
$lanReachability = @(Get-LanReachabilityReport -LanIp $lanIp -Targets $script:TargetPorts)
$freeboxReport = Get-FreeboxForwardReport

$summary = [PSCustomObject]@{
  GeneratedAt = (Get-Date).ToString('o')
  Mode = if ($ReportOnly) { 'report_only' } else { 'apply_and_report' }
  Bindings = $bindReports
  FirewallRules = $firewallReports
  BroadAllowRules = $broadAllowRules
  CaddyAllowRules = $caddyAllowRules
  PortProxy = $portProxy
  CaddyFacade = $caddyFacade
  LanIp = $lanIp
  LanReachability = $lanReachability
  Freebox = $freeboxReport
}

if ($AsJson) {
  $summary | ConvertTo-Json -Depth 8
  exit 0
}

Write-Section 'Bind Verification'
$bindReports | Select-Object Service, Port, Status, LoopbackOnly, @{ Name = 'Addresses'; Expression = { ($_.LocalAddresses -join ', ') } }, @{ Name = 'Processes'; Expression = { ($_.Processes | ForEach-Object { "{0}#{1}" -f $_.Name, $_.ProcessId }) -join ', ' } } | Format-Table -AutoSize

Write-Section 'Firewall Rules'
$firewallReports | Select-Object Service, Port, RuleName, Present, Enabled, @{ Name = 'Action'; Expression = { ($_.Actions -join ', ') } }, @{ Name = 'LocalPorts'; Expression = { ($_.LocalPorts -join ', ') } } | Format-Table -AutoSize

Write-Section 'Caddy Facade'
$caddyFacade.Ports | Select-Object Port, Status, @{ Name = 'Addresses'; Expression = { ($_.LocalAddresses -join ', ') } }, @{ Name = 'Processes'; Expression = { ($_.Processes | ForEach-Object { "{0}#{1}" -f $_.Name, $_.ProcessId }) -join ', ' } } | Format-Table -AutoSize
Write-Host ("Caddyfile: {0}" -f $caddyFacade.CaddyfilePath)
Write-Host ("reverse_proxy 127.0.0.1:3000 present: {0}" -f $caddyFacade.ReverseProxyTargetsLocalBackend)
$caddyAllowRules | Select-Object RuleName, Port, Present, Enabled, Profile, Program | Format-Table -Wrap -AutoSize

Write-Section 'LAN Reachability'
$lanReachability | Select-Object Service, Port, LanIp, Reachable | Format-Table -AutoSize

Write-Section 'Broad Allow Rules'
if ($broadAllowRules.Count -gt 0) {
  $broadAllowRules | Select-Object DisplayName, Profile, Protocol, LocalPort, Broad, Program | Format-Table -Wrap -AutoSize
} else {
  Write-Host 'No broad inbound allow rules detected for node.exe, python.exe, or caddy.exe.'
}

Write-Section 'Port Proxy'
Write-Host ("Portproxy entries present: {0}" -f $portProxy.HasEntries)
foreach ($line in $portProxy.Raw) {
  Write-Host $line
}

Write-Section 'Freebox'
Write-Host ("Status: {0}" -f $freeboxReport.Status)
if ($freeboxReport.Reason) {
  Write-Host ("Reason: {0}" -f $freeboxReport.Reason)
}
if ($freeboxReport.Rules.Count -gt 0) {
  $freeboxReport.Rules | Select-Object Enabled, Comment, SourceIp, WanPortStart, WanPortEnd, LanIp, LanPort | Format-Table -AutoSize
} else {
  Write-Host 'No matching Freebox redirects returned.'
}
