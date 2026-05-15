param(
  [string]$Url = "https://trialhnuk69.jfrog.io/",
  [string]$AccessToken = $env:JFROG_ACCESS_TOKEN,
  [string]$LocalRepo = "funesterie-npm-local",
  [string]$RemoteRepo = "npmjs-remote",
  [string]$VirtualRepo = "funesterie-npm"
)

$ErrorActionPreference = "Stop"

function Get-ArtifactoryBaseUrl {
  param([string]$PlatformUrl)

  $trimmed = $PlatformUrl.TrimEnd("/")
  if ($trimmed -match "/artifactory$") {
    return $trimmed
  }

  return "$trimmed/artifactory"
}

function Invoke-ArtifactoryJson {
  param(
    [string]$Method,
    [string]$Path,
    [object]$Body = $null
  )

  $headers = @{
    Authorization = "Bearer $AccessToken"
  }
  $uri = "$script:ArtifactoryBase$Path"
  $invokeParams = @{
    Method = $Method
    Uri = $uri
    Headers = $headers
    TimeoutSec = 30
  }
  if ($Body -ne $null) {
    $invokeParams.ContentType = "application/json"
    $invokeParams.Body = ($Body | ConvertTo-Json -Depth 20)
  }

  Invoke-RestMethod @invokeParams
}

function Test-RepoExists {
  param([string]$Key)

  try {
    [void](Invoke-ArtifactoryJson -Method "GET" -Path "/api/repositories/$Key")
    return $true
  } catch {
    if ($_.Exception.Response -and ([int]$_.Exception.Response.StatusCode -eq 404 -or [int]$_.Exception.Response.StatusCode -eq 400)) {
      return $false
    }
    throw
  }
}

function Ensure-Repo {
  param(
    [string]$Key,
    [object]$Spec
  )

  if (Test-RepoExists $Key) {
    Write-Host "OK existing repo: $Key"
    return
  }

  Write-Host "Creating repo: $Key"
  Invoke-ArtifactoryJson -Method "PUT" -Path "/api/repositories/$Key" -Body $Spec | Out-Null
}

if (-not $AccessToken) {
  throw "Missing JFROG_ACCESS_TOKEN. Load scripts/jfrog/jfrog.env.ps1 or pass -AccessToken."
}

$script:ArtifactoryBase = Get-ArtifactoryBaseUrl $Url
Write-Host "Using Artifactory API: $script:ArtifactoryBase"
Invoke-ArtifactoryJson -Method "GET" -Path "/api/system/version" | Out-Null
Write-Host "Authenticated Artifactory API access OK."

Ensure-Repo -Key $LocalRepo -Spec @{
  key = $LocalRepo
  rclass = "local"
  packageType = "npm"
  repoLayoutRef = "npm-default"
  description = "Funesterie private npm packages"
}

Ensure-Repo -Key $RemoteRepo -Spec @{
  key = $RemoteRepo
  rclass = "remote"
  packageType = "npm"
  repoLayoutRef = "npm-default"
  description = "Proxy for npmjs.org"
  url = "https://registry.npmjs.org/"
}

Ensure-Repo -Key $VirtualRepo -Spec @{
  key = $VirtualRepo
  rclass = "virtual"
  packageType = "npm"
  repoLayoutRef = "npm-default"
  description = "Funesterie npm virtual repository"
  repositories = @($LocalRepo, $RemoteRepo)
  defaultDeploymentRepo = $LocalRepo
}

Write-Host "JFrog npm repositories are ready."
Write-Host "Registry: $script:ArtifactoryBase/api/npm/$VirtualRepo/"
