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

function Convert-FundingEntry {
  param($Entry)

  if ($null -eq $Entry -or [string]::IsNullOrWhiteSpace([string]$Entry.url)) {
    return $null
  }

  [ordered]@{
    type = if ($Entry.type) { [string]$Entry.type } else { "custom" }
    url = [string]$Entry.url
  }
}

$defaultFunding = @(
  [ordered]@{
    type = "paypal"
    url = "https://paypal.me/funeste38"
  },
  [ordered]@{
    type = "custom"
    url = "https://funesterie.me/assets/wero-jeffrey-cellauro.png"
  }
)
$funding = @()
if ($manifest.PSObject.Properties.Name -contains "funding" -and $null -ne $manifest.funding) {
  foreach ($entry in @($manifest.funding)) {
    $converted = Convert-FundingEntry -Entry $entry
    if ($null -ne $converted) {
      $funding += $converted
    }
  }
}
if ($funding.Count -eq 0) {
  $funding = $defaultFunding
}

$defaultDonations = [ordered]@{
  policy = "voluntary"
  amount = "user-choice"
  email = "funeste38@gmail.com"
  wero = "+33783463761"
  weroDisplay = "+33 7 83 46 37 61"
  weroQr = "https://funesterie.me/assets/wero-jeffrey-cellauro.png"
  paypal = "https://paypal.me/funeste38"
  contact = "https://funesterie.me/contact/"
}
$donations = if ($manifest.PSObject.Properties.Name -contains "donations" -and $null -ne $manifest.donations) {
  $manifest.donations
} else {
  $defaultDonations
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
    [Parameter(Mandatory = $true)]$Funding,
    [Parameter(Mandatory = $true)]$Donations
  )

  $json = Get-Content -Raw -LiteralPath $PackageJsonPath | ConvertFrom-Json

  $currentFundingJson = if ($json.PSObject.Properties.Name -contains "funding") {
    $json.funding | ConvertTo-Json -Depth 80 -Compress
  } else {
    ""
  }
  $targetFundingJson = $Funding | ConvertTo-Json -Depth 80 -Compress
  $currentDonationsJson = if ($json.PSObject.Properties.Name -contains "donations") {
    $json.donations | ConvertTo-Json -Depth 80 -Compress
  } else {
    ""
  }
  $targetDonationsJson = $Donations | ConvertTo-Json -Depth 80 -Compress

  if ($currentFundingJson -ne $targetFundingJson -or $currentDonationsJson -ne $targetDonationsJson) {
    Set-JsonProperty -Object $json -Name "funding" -Value ([object[]]$Funding)
    Set-JsonProperty -Object $json -Name "donations" -Value $Donations
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

  $packageJson = Ensure-PackageFunding -PackageJsonPath $packageJsonPath -Funding $funding -Donations $donations
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
