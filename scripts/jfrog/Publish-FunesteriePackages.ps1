[CmdletBinding()]
param(
  [string]$ManifestPath,
  [string]$Registry = $env:JFROG_NPM_REGISTRY,
  [string]$Npmrc,
  [switch]$Publish,
  [switch]$SkipBuild,
  [switch]$IncludeExperimental,
  [switch]$RunLifecycleScripts
)

$ErrorActionPreference = "Stop"

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptRoot "..\..")

if ([string]::IsNullOrWhiteSpace($ManifestPath)) {
  $ManifestPath = Join-Path $scriptRoot "funesterie-packages.json"
}

if ([string]::IsNullOrWhiteSpace($Npmrc)) {
  $Npmrc = Join-Path $repoRoot ".npmrc.jfrog"
}

function Invoke-NpmCommand {
  param(
    [string]$WorkingDirectory,
    [string[]]$Arguments
  )

  Push-Location $WorkingDirectory
  try {
    Write-Host "npm $($Arguments -join ' ')" -ForegroundColor DarkCyan
    & npm @Arguments
    if ($LASTEXITCODE -ne 0) {
      throw "npm command failed with exit code $LASTEXITCODE in $WorkingDirectory"
    }
  }
  finally {
    Pop-Location
  }
}

function Test-NpmPackageVersionExists {
  param(
    [string]$Name,
    [string]$Version
  )

  if (-not $Publish) {
    return $false
  }

  $packageSpec = "$Name@$Version"
  & cmd.exe /d /s /c "npm view ""$packageSpec"" version --registry ""$Registry"" --userconfig ""$Npmrc"" >NUL 2>NUL"

  return $LASTEXITCODE -eq 0
}

$manifest = Get-Content -Raw -LiteralPath $ManifestPath | ConvertFrom-Json
$funding = if ($manifest.funding -and $manifest.funding.url) {
  [ordered]@{
    type = if ($manifest.funding.type) { [string]$manifest.funding.type } else { "custom" }
    url = [string]$manifest.funding.url
  }
} else {
  [ordered]@{
    type = "custom"
    url = "https://paypal.me/funeste38"
  }
}
$packages = @($manifest.packages | Where-Object {
  $_.publish -eq $true -or ($IncludeExperimental -and $_.publish -ne $true)
})

if ($packages.Count -eq 0) {
  throw "No packages selected from $ManifestPath."
}

if ($Publish) {
  if ([string]::IsNullOrWhiteSpace($Registry)) {
    throw "JFROG_NPM_REGISTRY is required in publish mode."
  }
  if ([string]::IsNullOrWhiteSpace($env:JFROG_NPM_AUTH_TOKEN)) {
    throw "JFROG_NPM_AUTH_TOKEN is required in publish mode."
  }
  if (-not (Test-Path -LiteralPath $Npmrc)) {
    throw "$Npmrc is missing. Run scripts/jfrog/Write-JFrogNpmrc.ps1 first."
  }
}

function Set-JsonProperty {
  param(
    [Parameter(Mandatory = $true)]$Object,
    [Parameter(Mandatory = $true)][string]$Name,
    $Value
  )

  if ($Object.PSObject.Properties.Name -contains $Name) {
    $Object.$Name = $Value
  } else {
    $Object | Add-Member -NotePropertyName $Name -NotePropertyValue $Value
  }
}

function Ensure-PackageFunding {
  param(
    [Parameter(Mandatory = $true)][string]$PackageJsonPath,
    [Parameter(Mandatory = $true)]$Funding
  )

  $json = Get-Content -Raw -LiteralPath $PackageJsonPath | ConvertFrom-Json
  $currentUrl = if ($json.funding -and $json.funding.url) { [string]$json.funding.url } else { "" }
  $currentType = if ($json.funding -and $json.funding.type) { [string]$json.funding.type } else { "" }
  if ($currentUrl -ne [string]$Funding.url -or $currentType -ne [string]$Funding.type) {
    Set-JsonProperty -Object $json -Name "funding" -Value $Funding
    $json | ConvertTo-Json -Depth 80 | Set-Content -LiteralPath $PackageJsonPath -Encoding UTF8
  }
  return $json
}

$summary = @()

foreach ($entry in $packages) {
  $packageDir = Join-Path $repoRoot $entry.path
  $packageJsonPath = Join-Path $packageDir "package.json"

  if (-not (Test-Path -LiteralPath $packageJsonPath)) {
    throw "Missing package.json for $($entry.name) at $packageJsonPath"
  }

  $packageJson = Ensure-PackageFunding -PackageJsonPath $packageJsonPath -Funding $funding
  if ($packageJson.name -ne $entry.name) {
    throw "Manifest name mismatch for $($entry.path): expected $($entry.name), found $($packageJson.name)"
  }

  if ($packageJson.private -eq $true) {
    throw "$($packageJson.name) has private=true and cannot be published by npm."
  }

  Write-Host ""
  Write-Host "== $($packageJson.name)@$($packageJson.version) ==" -ForegroundColor Green

  if (Test-NpmPackageVersionExists -Name $packageJson.name -Version $packageJson.version) {
    Write-Host "Skipping already published version: $($packageJson.name)@$($packageJson.version)" -ForegroundColor Yellow
    $summary += [pscustomobject]@{
      Name = $packageJson.name
      Version = $packageJson.version
      Path = $entry.path
      Status = "already-published"
    }
    continue
  }

  if (-not $SkipBuild -and $packageJson.scripts -and $packageJson.scripts.build) {
    Invoke-NpmCommand -WorkingDirectory $packageDir -Arguments @("run", "build")
  }

  if ($Publish) {
    $publishArgs = @(
      "publish",
      "--registry", $Registry,
      "--userconfig", $Npmrc,
      "--tag", "internal"
    )
    if (-not $RunLifecycleScripts) {
      $publishArgs += "--ignore-scripts"
    }
    Invoke-NpmCommand -WorkingDirectory $packageDir -Arguments $publishArgs
    $status = "published"
  }
  else {
    $packArgs = @("pack", "--dry-run")
    if (-not $RunLifecycleScripts) {
      $packArgs += "--ignore-scripts"
    }
    if (Test-Path -LiteralPath $Npmrc) {
      $packArgs += @("--userconfig", $Npmrc)
    }
    Invoke-NpmCommand -WorkingDirectory $packageDir -Arguments $packArgs
    $status = "dry-run"
  }

  $summary += [pscustomobject]@{
    Name = $packageJson.name
    Version = $packageJson.version
    Path = $entry.path
    Status = $status
  }
}

Write-Host ""
Write-Host "Summary" -ForegroundColor Cyan
$summary | Format-Table -AutoSize

if (-not $Publish) {
  Write-Host ""
  Write-Host "Dry-run complete. Re-run with -Publish only after JFrog registry and token are ready."
}
