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

$summary = @()

foreach ($entry in $packages) {
  $packageDir = Join-Path $repoRoot $entry.path
  $packageJsonPath = Join-Path $packageDir "package.json"

  if (-not (Test-Path -LiteralPath $packageJsonPath)) {
    throw "Missing package.json for $($entry.name) at $packageJsonPath"
  }

  $packageJson = Get-Content -Raw -LiteralPath $packageJsonPath | ConvertFrom-Json
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
