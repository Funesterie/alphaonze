[CmdletBinding()]
param(
  [string]$ProjectId = $(if ($env:GOOGLE_CLOUD_PROJECT) { $env:GOOGLE_CLOUD_PROJECT } else { "alphaonze" }),
  [string]$Location = $(if ($env:GAR_LOCATION) { $env:GAR_LOCATION } else { "europe-west4" })
)

$ErrorActionPreference = "Stop"

gcloud artifacts repositories list `
  --project $ProjectId `
  --location $Location `
  --format "table(name,format,mode,description)"
