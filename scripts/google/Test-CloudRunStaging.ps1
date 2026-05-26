[CmdletBinding()]
param(
  [string]$ProjectId = $(if ($env:GOOGLE_CLOUD_PROJECT) { $env:GOOGLE_CLOUD_PROJECT } else { "alphaonze" }),
  [string]$Region = $(if ($env:GAR_LOCATION) { $env:GAR_LOCATION } else { "europe-west4" }),
  [string]$ServiceName = "a11-backend-staging",
  [string]$Path = "/health",
  [switch]$SkipUnauthenticatedCheck
)

$ErrorActionPreference = "Stop"

function Test-CommandAvailable([string]$Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Missing required command: $Name"
  }
}

Test-CommandAvailable "gcloud"

$service = & gcloud run services describe $ServiceName `
  --project=$ProjectId `
  --region=$Region `
  --platform=managed `
  --format=json | ConvertFrom-Json

$url = [string]$service.status.url
if ([string]::IsNullOrWhiteSpace($url)) {
  throw "Cloud Run service has no URL: $ServiceName"
}

$target = $url.TrimEnd("/") + $Path

if (-not $SkipUnauthenticatedCheck) {
  try {
    $unauth = Invoke-WebRequest -Uri $target -UseBasicParsing -TimeoutSec 30
    Write-Host "Unauthenticated request returned $($unauth.StatusCode)."
  } catch {
    $status = $null
    if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
      $status = [int]$_.Exception.Response.StatusCode
    }
    if ($status -ne 403 -and $status -ne 401) {
      throw "Expected unauthenticated request to be blocked, got: $($_.Exception.Message)"
    }
    Write-Host "Unauthenticated request blocked as expected ($status)."
  }
}

$token = & gcloud auth print-identity-token
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($token)) {
  throw "Could not get local identity token for Cloud Run smoke test."
}

$response = Invoke-WebRequest `
  -Uri $target `
  -Headers @{ Authorization = "Bearer $token" } `
  -UseBasicParsing `
  -TimeoutSec 60

[pscustomobject]@{
  service = $ServiceName
  revision = [string]$service.status.latestReadyRevisionName
  url = $url
  path = $Path
  statusCode = $response.StatusCode
  body = $response.Content
} | ConvertTo-Json -Depth 4
