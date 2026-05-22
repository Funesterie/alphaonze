[CmdletBinding()]
param(
  [string]$ProjectId = $(if ($env:GOOGLE_CLOUD_PROJECT) { $env:GOOGLE_CLOUD_PROJECT } else { "alphaonze" }),
  [string]$Location = $(if ($env:GOOGLE_CLOUD_LOCATION) { $env:GOOGLE_CLOUD_LOCATION } else { "europe-west4" }),
  [string]$NpmRepository = "funesterie-npm",
  [string]$DockerRepository = "funesterie-docker",
  [string]$GenericRepository = "funesterie-generic"
)

$ErrorActionPreference = "Stop"

function Invoke-Gcloud {
  param([Parameter(Mandatory = $true)][string[]]$Args)
  & gcloud @Args
  if ($LASTEXITCODE -ne 0) {
    throw "gcloud failed: $($Args -join ' ')"
  }
}

function Ensure-Repository {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$Format,
    [Parameter(Mandatory = $true)][string]$Description
  )

  & gcloud artifacts repositories describe $Name --project $ProjectId --location $Location --format "value(name)" 2>$null
  if ($LASTEXITCODE -eq 0) {
    Write-Host "ok $Name ($Format) already exists"
    return
  }

  Write-Host "create $Name ($Format)"
  Invoke-Gcloud @(
    "artifacts", "repositories", "create", $Name,
    "--project", $ProjectId,
    "--location", $Location,
    "--repository-format", $Format,
    "--description", $Description
  )
}

Invoke-Gcloud @("services", "enable", "artifactregistry.googleapis.com", "--project", $ProjectId)

Ensure-Repository -Name $NpmRepository -Format "npm" -Description "Funesterie private npm registry"
Ensure-Repository -Name $DockerRepository -Format "docker" -Description "Funesterie private OCI and Docker images"
Ensure-Repository -Name $GenericRepository -Format "generic" -Description "Funesterie generic artifacts"

Write-Host ""
Write-Host "Google Artifact Registry is ready in $ProjectId/$Location."
