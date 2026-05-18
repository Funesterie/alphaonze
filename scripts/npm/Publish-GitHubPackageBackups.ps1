param(
  [string]$PackageRoot = "D:\projets\funesterie\a11\backend\apps\server\node_modules\@nossen",
  [string]$Scope = "@funesterie",
  [string]$Registry = "https://npm.pkg.github.com",
  [string]$RepositoryUrl = "git+https://github.com/Funesterie/alphaonze.git",
  [string]$WorkRoot = "$env:TEMP\funesterie-github-package-backups",
  [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$licenseText = @"
Funesterie Restricted Backup License

Copyright (c) Funesterie and contributors.

This package is a backup distribution of internal Funesterie runtime modules.
It is provided only for authorized Funesterie development, deployment,
continuity, and disaster-recovery workflows.

Without explicit written permission from Funesterie, you may not:
- redistribute this package or derived artifacts;
- sell, sublicense, host, or mirror this package for third parties;
- use Funesterie names, marks, characters, agent identities, or visual systems
  outside Funesterie-controlled projects;
- reverse engineer private runtime behavior for competitive or abusive use.

Authorized internal use may install, inspect, build, patch, and deploy the
package for Funesterie systems. Secrets, credentials, and private user data
must never be embedded in redistributed artifacts.
"@

function Convert-VersionRangeToBackupScope {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$Range
  )

  if ($Name -notlike "@nossen/*") {
    return $Range
  }

  $unscoped = $Name.Substring("@nossen/".Length)
  return "npm:$Scope/$unscoped@$Range"
}

function Rewrite-DependencyObject {
  param($DependencyObject)

  if ($null -eq $DependencyObject) {
    return $null
  }

  $rewritten = [ordered]@{}
  foreach ($prop in $DependencyObject.PSObject.Properties) {
    $name = [string]$prop.Name
    $value = [string]$prop.Value
    if ($name -like "@nossen/*") {
      $unscoped = $name.Substring("@nossen/".Length)
      $rewritten["$Scope/$unscoped"] = $value
    } else {
      $rewritten[$name] = Convert-VersionRangeToBackupScope -Name $name -Range $value
    }
  }
  return $rewritten
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

if (-not (Test-Path -LiteralPath $PackageRoot)) {
  throw "Package root not found: $PackageRoot"
}

Remove-Item -LiteralPath $WorkRoot -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $WorkRoot | Out-Null

$packages = Get-ChildItem -LiteralPath $PackageRoot -Directory | Sort-Object Name
$results = New-Object System.Collections.Generic.List[object]

foreach ($packageDir in $packages) {
  $packageJsonPath = Join-Path $packageDir.FullName "package.json"
  if (-not (Test-Path -LiteralPath $packageJsonPath)) {
    continue
  }

  $originalJson = Get-Content -LiteralPath $packageJsonPath -Raw | ConvertFrom-Json
  $unscopedName = $packageDir.Name.ToLowerInvariant()
  $backupName = "$Scope/$unscopedName"
  $targetDir = Join-Path $WorkRoot $unscopedName

  Copy-Item -LiteralPath $packageDir.FullName -Destination $targetDir -Recurse -Force
  Remove-Item -LiteralPath (Join-Path $targetDir "node_modules") -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath (Join-Path $targetDir ".git") -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath (Join-Path $targetDir ".npmrc") -Force -ErrorAction SilentlyContinue

  $jsonPath = Join-Path $targetDir "package.json"
  $json = Get-Content -LiteralPath $jsonPath -Raw | ConvertFrom-Json

  Set-JsonProperty -Object $json -Name "name" -Value $backupName
  Set-JsonProperty -Object $json -Name "license" -Value "SEE LICENSE IN LICENSE-FUNESTERIE.txt"
  Set-JsonProperty -Object $json -Name "publishConfig" -Value ([ordered]@{ registry = $Registry })
  Set-JsonProperty -Object $json -Name "repository" -Value ([ordered]@{
    type = "git"
    url = $RepositoryUrl
  })
  Set-JsonProperty -Object $json -Name "funesterieBackup" -Value ([ordered]@{
    sourceName = $originalJson.name
    sourceVersion = $originalJson.version
    sourceScope = "@nossen"
    backupScope = $Scope
    generatedAt = (Get-Date).ToUniversalTime().ToString("o")
  })

  foreach ($depField in @("dependencies", "optionalDependencies", "peerDependencies", "devDependencies")) {
    if ($json.PSObject.Properties.Name -contains $depField) {
      Set-JsonProperty -Object $json -Name $depField -Value (Rewrite-DependencyObject -DependencyObject $json.$depField)
    }
  }

  if ($json.PSObject.Properties.Name -contains "files" -and $null -ne $json.files) {
    $files = @($json.files)
    if ($files -notcontains "LICENSE-FUNESTERIE.txt") {
      $files += "LICENSE-FUNESTERIE.txt"
    }
    Set-JsonProperty -Object $json -Name "files" -Value $files
  }

  Set-Content -LiteralPath (Join-Path $targetDir "LICENSE-FUNESTERIE.txt") -Value $licenseText -Encoding UTF8
  $json | ConvertTo-Json -Depth 50 | Set-Content -LiteralPath $jsonPath -Encoding UTF8

  Push-Location $targetDir
  try {
    $npmArgs = @("publish", "--registry=$Registry", "--ignore-scripts")
    if ($DryRun) {
      $npmArgs += "--dry-run"
    }
    & npm @npmArgs
    $exit = $LASTEXITCODE
  } finally {
    Pop-Location
  }

  $status = if ($exit -eq 0) { if ($DryRun) { "dry-run-ok" } else { "published" } } else { "failed" }
  $results.Add([ordered]@{
    package = $backupName
    version = $originalJson.version
    status = $status
    stagingPath = $targetDir
  }) | Out-Null

  if ($exit -ne 0) {
    throw "npm publish failed for $backupName"
  }
}

$reportPath = Join-Path $WorkRoot "publish-report.json"
$results | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $reportPath -Encoding UTF8
Write-Host "Report: $reportPath"
$results | Format-Table -AutoSize
