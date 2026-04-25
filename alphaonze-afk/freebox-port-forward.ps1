param(
  [string]$LanIp = "192.168.1.2",
  [int]$WanPort = 80,
  [int]$LanPort = 8088,
  [string]$Comment = "AlphaOnze AFK"
)

$ErrorActionPreference = "Stop"

$appId = "pro.funesterie.alphaonze.afk"
$appName = "AlphaOnze AFK"
$appVersion = "0.1.0"
$root = $PSScriptRoot
$runtimeDir = Join-Path $root "runtime"
$tokenPath = Join-Path $runtimeDir "freebox-alphaonze-token.json"

New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null

function Invoke-Freebox {
  param(
    [Parameter(Mandatory = $true)][string]$Method,
    [Parameter(Mandatory = $true)][string]$Uri,
    [object]$Body,
    [hashtable]$Headers
  )

  $params = @{
    Method = $Method
    Uri = $Uri
    TimeoutSec = 15
  }

  if ($Headers) {
    $params.Headers = $Headers
  }

  if ($null -ne $Body) {
    $params.ContentType = "application/json"
    $params.Body = ($Body | ConvertTo-Json -Depth 12)
  }

  Invoke-RestMethod @params
}

function Get-HmacSha1Hex {
  param(
    [Parameter(Mandatory = $true)][string]$Key,
    [Parameter(Mandatory = $true)][string]$Message
  )

  $encoding = [System.Text.Encoding]::UTF8
  $hmac = [System.Security.Cryptography.HMACSHA1]::new($encoding.GetBytes($Key))
  try {
    ($hmac.ComputeHash($encoding.GetBytes($Message)) | ForEach-Object { $_.ToString("x2") }) -join ""
  } finally {
    $hmac.Dispose()
  }
}

function Get-FreeboxAppToken {
  if (Test-Path $tokenPath) {
    $saved = Get-Content -Raw $tokenPath | ConvertFrom-Json
    if ($saved.app_token) {
      return [string]$saved.app_token
    }
  }

  $deviceName = if ($env:COMPUTERNAME) { $env:COMPUTERNAME } else { "Windows PC" }
  $authorize = Invoke-Freebox -Method POST -Uri "$script:apiBase/login/authorize/" -Body @{
    app_id = $appId
    app_name = $appName
    app_version = $appVersion
    device_name = $deviceName
  }

  if (-not $authorize.success) {
    throw "Freebox authorization request failed."
  }

  $appToken = [string]$authorize.result.app_token
  $trackId = [int]$authorize.result.track_id
  Write-Host "Demande envoyee a la Freebox. Valide l'application '$appName' sur l'ecran de la Freebox."

  $deadline = (Get-Date).AddSeconds(120)
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 2
    $track = Invoke-Freebox -Method GET -Uri "$script:apiBase/login/authorize/$trackId"
    $status = [string]$track.result.status
    Write-Host "Statut Freebox: $status"

    if ($status -eq "granted") {
      @{
        app_id = $appId
        app_name = $appName
        app_token = $appToken
        created_at = (Get-Date).ToString("o")
      } | ConvertTo-Json -Depth 4 | Set-Content -Encoding UTF8 -Path $tokenPath

      return $appToken
    }

    if ($status -in @("denied", "timeout", "unknown")) {
      throw "Freebox authorization status: $status"
    }
  }

  throw "Freebox authorization timed out."
}

function Open-FreeboxSession {
  param([Parameter(Mandatory = $true)][string]$AppToken)

  $login = Invoke-Freebox -Method GET -Uri "$script:apiBase/login/"
  $password = Get-HmacSha1Hex -Key $AppToken -Message ([string]$login.result.challenge)
  $session = Invoke-Freebox -Method POST -Uri "$script:apiBase/login/session/" -Body @{
    app_id = $appId
    app_version = $appVersion
    password = $password
  }

  if (-not $session.success) {
    throw "Freebox session failed."
  }

  [string]$session.result.session_token
}

function Ensure-PortForward {
  param(
    [Parameter(Mandatory = $true)][hashtable]$Headers,
    [Parameter(Mandatory = $true)][int]$ExternalPort,
    [Parameter(Mandatory = $true)][string]$TargetIp,
    [Parameter(Mandatory = $true)][int]$TargetPort,
    [Parameter(Mandatory = $true)][string]$RuleComment
  )

  $list = Invoke-Freebox -Method GET -Uri "$script:apiBase/fw/redir/" -Headers $Headers
  if (-not $list.success) {
    throw "Could not read Freebox port forwarding rules."
  }

  $matching = @($list.result | Where-Object {
    $_.ip_proto -eq "tcp" -and
    [int]$_.wan_port_start -le $ExternalPort -and
    [int]$_.wan_port_end -ge $ExternalPort
  })

  foreach ($rule in $matching) {
    $ours = (
      [string]$rule.comment -eq $RuleComment -or
      ([string]$rule.lan_ip -eq $TargetIp -and [int]$rule.lan_port -eq $TargetPort)
    )

    if (-not $ours) {
      throw "TCP port $ExternalPort is already forwarded to $($rule.lan_ip):$($rule.lan_port) with comment '$($rule.comment)'. Refusing to overwrite it."
    }

    $updated = Invoke-Freebox -Method PUT -Uri "$script:apiBase/fw/redir/$($rule.id)" -Headers $Headers -Body @{
      enabled = $true
      ip_proto = "tcp"
      wan_port_start = $ExternalPort
      wan_port_end = $ExternalPort
      lan_ip = $TargetIp
      lan_port = $TargetPort
      src_ip = "0.0.0.0"
      comment = $RuleComment
    }

    if (-not $updated.success) {
      throw "Could not update Freebox rule $($rule.id)."
    }

    return $updated.result
  }

  $created = Invoke-Freebox -Method POST -Uri "$script:apiBase/fw/redir/" -Headers $Headers -Body @{
    enabled = $true
    ip_proto = "tcp"
    wan_port_start = $ExternalPort
    wan_port_end = $ExternalPort
    lan_ip = $TargetIp
    lan_port = $TargetPort
    src_ip = "0.0.0.0"
    comment = $RuleComment
  }

  if (-not $created.success) {
    throw "Could not create Freebox port forwarding rule."
  }

  $created.result
}

$apiInfo = Invoke-Freebox -Method GET -Uri "http://mafreebox.freebox.fr/api_version"
$majorVersion = ([string]$apiInfo.api_version).Split(".")[0]
$script:apiBase = "http://mafreebox.freebox.fr/api/v$majorVersion"

Write-Host "Freebox: $($apiInfo.box_model_name), API v$($apiInfo.api_version)"
$appToken = Get-FreeboxAppToken
$sessionToken = Open-FreeboxSession -AppToken $appToken
$headers = @{ "X-Fbx-App-Auth" = $sessionToken }
$rule = Ensure-PortForward -Headers $headers -ExternalPort $WanPort -TargetIp $LanIp -TargetPort $LanPort -RuleComment $Comment

Write-Host "Redirection active: TCP $WanPort -> $LanIp`:$LanPort ($($rule.comment))"
