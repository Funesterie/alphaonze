param(
  [string]$BaseUrl = "https://a11.funesterie.me"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$BaseUrl = $BaseUrl.TrimEnd("/")

function Invoke-A11Json([string]$Path) {
  $uri = "$BaseUrl$Path"
  $response = Invoke-WebRequest -UseBasicParsing -Uri $uri -TimeoutSec 30
  if ($response.StatusCode -lt 200 -or $response.StatusCode -ge 300) {
    throw "Unexpected status $($response.StatusCode) for $uri"
  }
  return $response.Content | ConvertFrom-Json
}

$status = Invoke-A11Json "/api/status"
$status | ConvertTo-Json -Depth 10
Write-Host ""

$qflush = $status.integrations.qflush
$remoteUrl = ""
if ($null -ne $qflush -and $null -ne $qflush.remoteUrl) {
  $remoteUrl = [string]$qflush.remoteUrl
}
if (-not [string]::IsNullOrWhiteSpace($remoteUrl)) {
  (Invoke-WebRequest -UseBasicParsing -Uri (($remoteUrl.TrimEnd("/")) + "/health") -TimeoutSec 30).Content
} else {
  $qflushStatus = Invoke-A11Json "/api/qflush/status"
  if (-not $qflushStatus.ok -or -not $qflushStatus.qflushAvailable) {
    throw "Qflush local status is not available."
  }
  $qflushStatus | ConvertTo-Json -Depth 8
}
