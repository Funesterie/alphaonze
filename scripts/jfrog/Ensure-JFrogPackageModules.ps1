param(
  [string]$ServerId = "funesterie",
  [switch]$UpdateExisting
)

$ErrorActionPreference = "Stop"

function Invoke-JFrogJson {
  param(
    [string]$Method,
    [string]$Path,
    [object]$Body = $null
  )

  $args = @("rt", "curl", "-sS", "-X", $Method, $Path, "--server-id", $ServerId)
  $tempBody = $null
  try {
    if ($Body -ne $null) {
      $tempBody = New-TemporaryFile
      Set-Content -LiteralPath $tempBody -Value ($Body | ConvertTo-Json -Depth 20) -Encoding UTF8
      $args += @("-H", "Content-Type: application/json", "-T", $tempBody.FullName)
    }

    $output = & jf @args
    if ($LASTEXITCODE -ne 0) {
      throw "jf rt curl failed for $Method $Path"
    }
    if ($output) {
      try {
        $parsed = $output | Out-String | ConvertFrom-Json
      } catch {
        return ($output | Out-String).Trim()
      }
      if ($parsed.errors) {
        $messages = @($parsed.errors | ForEach-Object { "$($_.status) $($_.message)" }) -join "; "
        throw "Artifactory API error for $Method $Path`: $messages"
      }
      return $parsed
    }
    return $null
  } finally {
    if ($tempBody -and (Test-Path -LiteralPath $tempBody.FullName)) {
      Remove-Item -LiteralPath $tempBody.FullName -Force
    }
  }
}

function Test-RepoExists {
  param([string]$Key)

  try {
    [void](Invoke-JFrogJson -Method "GET" -Path "/api/repositories/$Key")
    return $true
  } catch {
    return $false
  }
}

function Ensure-Repo {
  param(
    [string]$Key,
    [hashtable]$Spec,
    [switch]$UpdateExisting
  )

  $exists = Test-RepoExists $Key
  if ($exists -and -not $UpdateExisting) {
    Write-Host "OK existing repo: $Key"
    return
  }

  if ($exists -and $UpdateExisting) {
    Write-Host "Ensuring repo config: $Key"
    Invoke-JFrogJson -Method "POST" -Path "/api/repositories/$Key" -Body $Spec | Out-Null
  } else {
    Write-Host "Creating repo: $Key"
    Invoke-JFrogJson -Method "PUT" -Path "/api/repositories/$Key" -Body $Spec | Out-Null
  }
}

function Ensure-Local {
  param(
    [string]$Key,
    [string]$PackageType,
    [string]$Description,
    [hashtable]$Extra = @{},
    [switch]$UpdateExisting
  )

  $spec = @{
    key = $Key
    rclass = "local"
    packageType = $PackageType
    repoLayoutRef = "simple-default"
    description = $Description
  }
  foreach ($entry in $Extra.GetEnumerator()) {
    $spec[$entry.Key] = $entry.Value
  }

  Ensure-Repo -Key $Key -Spec $spec -UpdateExisting:$UpdateExisting
}

function Ensure-Remote {
  param(
    [string]$Key,
    [string]$PackageType,
    [string]$Url,
    [string]$Description,
    [hashtable]$Extra = @{},
    [switch]$UpdateExisting
  )

  $spec = @{
    key = $Key
    rclass = "remote"
    packageType = $PackageType
    repoLayoutRef = "simple-default"
    url = $Url
    description = $Description
  }
  foreach ($entry in $Extra.GetEnumerator()) {
    $spec[$entry.Key] = $entry.Value
  }

  Ensure-Repo -Key $Key -Spec $spec -UpdateExisting:$UpdateExisting
}

function Ensure-Virtual {
  param(
    [string]$Key,
    [string]$PackageType,
    [string[]]$Repositories,
    [string]$DefaultDeploymentRepo,
    [string]$Description,
    [hashtable]$Extra = @{},
    [switch]$UpdateExisting
  )

  $spec = @{
    key = $Key
    rclass = "virtual"
    packageType = $PackageType
    repoLayoutRef = "simple-default"
    repositories = $Repositories
    description = $Description
  }
  if ($DefaultDeploymentRepo) {
    $spec.defaultDeploymentRepo = $DefaultDeploymentRepo
  }
  foreach ($entry in $Extra.GetEnumerator()) {
    $spec[$entry.Key] = $entry.Value
  }

  Ensure-Repo -Key $Key -Spec $spec -UpdateExisting:$UpdateExisting
}

function Ensure-Module {
  param(
    [string]$Name,
    [string]$PackageType,
    [string]$RemoteUrl,
    [switch]$UpdateExisting
  )

  $local = "funesterie-$Name-local"
  $remote = "$Name-remote"
  $virtual = "funesterie-$Name"

  $localExtra = @{}
  $remoteExtra = @{}
  $virtualExtra = @{}
  $forceUpdate = $UpdateExisting.IsPresent

  if ($Name -eq "nuget") {
    $remoteExtra.downloadContextPath = "api/v2/package"
  }

  if ($Name -eq "cargo") {
    $localExtra.cargoInternalIndex = $true
    $remoteExtra.cargoInternalIndex = $true
    $virtualExtra.cargoInternalIndex = $true
    $forceUpdate = $true
  }

  Ensure-Local -Key $local -PackageType $PackageType -Description "Funesterie private $Name packages" -Extra $localExtra -UpdateExisting:$forceUpdate
  if ($RemoteUrl) {
    Ensure-Remote -Key $remote -PackageType $PackageType -Url $RemoteUrl -Description "Proxy for public $Name packages" -Extra $remoteExtra -UpdateExisting:$forceUpdate
    Ensure-Virtual -Key $virtual -PackageType $PackageType -Repositories @($local, $remote) -DefaultDeploymentRepo $local -Description "Funesterie $Name virtual repository" -Extra $virtualExtra -UpdateExisting:$forceUpdate
  } else {
    Ensure-Virtual -Key $virtual -PackageType $PackageType -Repositories @($local) -DefaultDeploymentRepo $local -Description "Funesterie $Name virtual repository" -Extra $virtualExtra -UpdateExisting:$forceUpdate
  }
}

Write-Host "Checking JFrog CLI server: $ServerId"
[void](Invoke-JFrogJson -Method "GET" -Path "/api/system/version")
Write-Host "Authenticated Artifactory API access OK."

$modules = @(
  @{ Name = "npm"; PackageType = "npm"; RemoteUrl = "https://registry.npmjs.org/" },
  @{ Name = "generic"; PackageType = "generic"; RemoteUrl = $null },
  @{ Name = "docker"; PackageType = "docker"; RemoteUrl = "https://registry-1.docker.io/" },
  @{ Name = "maven"; PackageType = "maven"; RemoteUrl = "https://repo1.maven.org/maven2/" },
  @{ Name = "pypi"; PackageType = "pypi"; RemoteUrl = "https://pypi.org/" },
  @{ Name = "nuget"; PackageType = "nuget"; RemoteUrl = "https://nuget.org" },
  @{ Name = "go"; PackageType = "go"; RemoteUrl = "https://proxy.golang.org/" },
  @{ Name = "cargo"; PackageType = "cargo"; RemoteUrl = "https://index.crates.io/" },
  @{ Name = "conan"; PackageType = "conan"; RemoteUrl = "https://center.conan.io/" },
  @{ Name = "helm"; PackageType = "helm"; RemoteUrl = "https://charts.helm.sh/stable" },
  @{ Name = "terraform"; PackageType = "terraform"; RemoteUrl = "https://registry.terraform.io/" }
)

$errors = @()
foreach ($module in $modules) {
  try {
    Ensure-Module -Name $module.Name -PackageType $module.PackageType -RemoteUrl $module.RemoteUrl -UpdateExisting:$UpdateExisting
  } catch {
    $errors += "$($module.Name): $($_.Exception.Message)"
    Write-Warning "Skipped $($module.Name): $($_.Exception.Message)"
  }
}

if ($errors.Count -gt 0) {
  Write-Warning "Some package modules could not be provisioned:"
  $errors | ForEach-Object { Write-Warning " - $_" }
}

Write-Host "JFrog package module provisioning complete."
