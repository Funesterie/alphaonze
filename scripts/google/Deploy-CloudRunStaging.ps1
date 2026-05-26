[CmdletBinding()]
param(
  [string]$ProjectId = $(if ($env:GOOGLE_CLOUD_PROJECT) { $env:GOOGLE_CLOUD_PROJECT } else { "alphaonze" }),
  [string]$Region = $(if ($env:GAR_LOCATION) { $env:GAR_LOCATION } else { "europe-west4" }),
  [string]$ServiceName = "a11-backend-staging",
  [string]$Image = "europe-west4-docker.pkg.dev/alphaonze/funesterie-docker/a11-backend:staging-current",
  [string]$ServiceAccount = "funesterie-run-staging@alphaonze.iam.gserviceaccount.com",
  [int]$Port = 3000,
  [int]$MaxInstances = 1,
  [int]$Concurrency = 20,
  [string]$Memory = "1Gi",
  [string]$Cpu = "1",
  [string[]]$EnvVars = @("NODE_ENV=production", "HOST_SERVER=0.0.0.0"),
  [switch]$AllowUnauthenticated
)

$ErrorActionPreference = "Stop"

function Test-CommandAvailable([string]$Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Missing required command: $Name"
  }
}

Test-CommandAvailable "gcloud"

$authFlag = if ($AllowUnauthenticated) { "--allow-unauthenticated" } else { "--no-allow-unauthenticated" }
$envArg = $EnvVars -join ","
$labels = "app=funesterie,component=a11-backend,env=staging,managed-by=codex"

$deployArgs = @(
  "run", "deploy", $ServiceName,
  "--project=$ProjectId",
  "--region=$Region",
  "--platform=managed",
  "--image=$Image",
  "--port=$Port",
  "--memory=$Memory",
  "--cpu=$Cpu",
  "--min-instances=0",
  "--max-instances=$MaxInstances",
  "--concurrency=$Concurrency",
  "--timeout=300",
  "--service-account=$ServiceAccount",
  "--set-env-vars", $envArg,
  "--labels", $labels,
  $authFlag
)

Write-Host "Deploying Cloud Run staging service $ServiceName in $ProjectId/$Region."
Write-Host "Image: $Image"
Write-Host "Public access: $([bool]$AllowUnauthenticated)"

& gcloud @deployArgs
if ($LASTEXITCODE -ne 0) {
  throw "Cloud Run deployment failed with exit code $LASTEXITCODE."
}

& gcloud run services describe $ServiceName `
  --project=$ProjectId `
  --region=$Region `
  --platform=managed `
  --format="table(metadata.name,status.latestReadyRevisionName,status.url)"
