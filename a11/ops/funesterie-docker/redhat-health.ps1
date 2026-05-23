param(
  [switch]$Json,
  [string]$SecretPath = "$env:USERPROFILE\.funesterie\secrets\redhat-offline-token.dpapi.txt"
)

$ErrorActionPreference = 'Stop'

function Read-FunesterieDpapiSecret {
  param([Parameter(Mandatory = $true)][string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) {
    return $null
  }

  $raw = (Get-Content -LiteralPath $Path -Raw).Trim()
  if ([string]::IsNullOrWhiteSpace($raw)) {
    return $null
  }

  try {
    $secure = $raw | ConvertTo-SecureString
  } catch {
    return $null
  }

  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  }
}

function Get-RedHatAccessToken {
  param([Parameter(Mandatory = $true)][string]$OfflineToken)

  Invoke-RestMethod `
    -Method Post `
    -Uri 'https://sso.redhat.com/auth/realms/redhat-external/protocol/openid-connect/token' `
    -Body @{
      grant_type = 'refresh_token'
      client_id = 'rhsm-api'
      refresh_token = $OfflineToken
    } `
    -ContentType 'application/x-www-form-urlencoded' `
    -TimeoutSec 30
}

$offlineToken = Read-FunesterieDpapiSecret -Path $SecretPath
$redHat = [ordered]@{
  tokenStored = [bool]$offlineToken
  accessTokenOk = $false
  simpleContentAccess = $null
  simpleContentAccessCapable = $null
  registryLoggedInAs = $null
  registryReady = $false
  note = $null
  secretPrinted = $false
}

if ($offlineToken) {
  try {
    $tokenResponse = Get-RedHatAccessToken -OfflineToken $offlineToken
    $redHat.accessTokenOk = [bool]$tokenResponse.access_token

    if ($tokenResponse.access_token) {
      $headers = @{ Authorization = "Bearer $($tokenResponse.access_token)" }
      $org = Invoke-RestMethod `
        -Method Get `
        -Uri 'https://api.access.redhat.com/management/v1/organization?include=systemPurposeAttributes' `
        -Headers $headers `
        -TimeoutSec 30

      $redHat.simpleContentAccess = $org.body.simpleContentAccess
      $redHat.simpleContentAccessCapable = $org.body.simpleContentAccessCapable
    }
  } catch {
    $redHat.note = "Red Hat API check failed: $($_.Exception.Message)"
  }
} else {
  $redHat.note = "No DPAPI Red Hat offline token found at $SecretPath"
}

try {
  $login = (podman login --get-login registry.redhat.io 2>$null | Out-String).Trim()
  if (-not [string]::IsNullOrWhiteSpace($login)) {
    $redHat.registryLoggedInAs = $login
    $redHat.registryReady = $true
  }
} catch {}

if (-not $redHat.registryReady -and -not $redHat.note) {
  $redHat.note = 'SCA can be enabled while registry.redhat.io still needs a Red Hat Registry Service Account login.'
}

if ($Json) {
  $redHat | ConvertTo-Json -Depth 5
  exit 0
}

[pscustomobject]$redHat | Format-List
