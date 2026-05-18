param(
  [switch]$NoOpen
)

$ErrorActionPreference = 'Stop'

function Test-HttpReady {
  param(
    [Parameter(Mandatory = $true)][string]$Url,
    [int]$TimeoutSec = 6
  )

  try {
    $params = @{
      Uri = $Url
      Method = 'Get'
      TimeoutSec = $TimeoutSec
      ErrorAction = 'Stop'
    }
    if ($PSVersionTable.PSVersion.Major -lt 6) {
      $params.UseBasicParsing = $true
    }
    $response = Invoke-WebRequest @params
    return $response.StatusCode -ge 200 -and $response.StatusCode -lt 500
  } catch {
    return $false
  }
}

$frontendUrl = 'https://a11.funesterie.me'
$apiUrl = 'https://a11.funesterie.me/health'

$frontendOk = Test-HttpReady -Url $frontendUrl
$apiOk = Test-HttpReady -Url $apiUrl
$frontendStatus = if ($frontendOk) { 'OK' } else { 'KO' }
$apiStatus = if ($apiOk) { 'OK' } else { 'KO' }

Write-Host "[A11 ONLINE] Frontend : $frontendUrl -> $frontendStatus"
Write-Host "[A11 ONLINE] Backend  : $apiUrl -> $apiStatus"

if (-not $NoOpen) {
  Start-Process $frontendUrl | Out-Null
}

if (-not $frontendOk -or -not $apiOk) {
  exit 1
}

exit 0
