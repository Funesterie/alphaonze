[CmdletBinding()]
param(
  [switch]$DryRun,
  [switch]$Publish,
  [switch]$NoBuild,
  [string]$PackageId,
  [string]$ManifestPath = $(Join-Path $PSScriptRoot "github-packages.manifest.json"),
  [string]$NpmrcPath = ".npmrc.github",
  [string]$Registry,
  [string]$Tag,
  [string]$TokenEnv = "NODE_AUTH_TOKEN",
  [switch]$UseExternalNpmAuth,
  [string]$SummaryTitle = "GitHub Packages summary"
)

$ErrorActionPreference = "Stop"

function Resolve-RepoRoot {
  $root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
  return $root.Path
}

function Resolve-ToolName([string]$Name) {
  if ($env:OS -eq "Windows_NT") {
    if ($Name -eq "npm") { return "npm.cmd" }
    if ($Name -eq "tar") { return "$env:SystemRoot\System32\tar.exe" }
  }
  return $Name
}

function Invoke-Tool {
  param(
    [Parameter(Mandatory = $true)][object[]]$Command,
    [Parameter(Mandatory = $true)][string]$WorkingDirectory
  )

  if ($Command.Count -lt 1) {
    throw "Invalid empty command."
  }

  $tool = Resolve-ToolName ([string]$Command[0])
  $args = @()
  if ($Command.Count -gt 1) {
    $args = @($Command[1..($Command.Count - 1)] | ForEach-Object { [string]$_ })
  }

  Push-Location $WorkingDirectory
  try {
    Write-Host "> $tool $($args -join ' ')"
    & $tool @args
    if ($LASTEXITCODE -ne 0) {
      throw "Command failed with exit code ${LASTEXITCODE}: $tool $($args -join ' ')"
    }
  } finally {
    Pop-Location
  }
}

function Read-JsonFile([string]$Path) {
  return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
}

function Write-JsonFile {
  param(
    [Parameter(Mandatory = $true)]$Value,
    [Parameter(Mandatory = $true)][string]$Path
  )
  $Value | ConvertTo-Json -Depth 80 | Set-Content -LiteralPath $Path -Encoding utf8
}

function Test-NpmPackageVersionExists {
  param(
    [Parameter(Mandatory = $true)][string]$PackageSpec,
    [Parameter(Mandatory = $true)][string]$Registry,
    [Parameter(Mandatory = $true)][string]$NpmrcPath,
    [Parameter(Mandatory = $true)][string]$WorkingDirectory
  )

  $tool = Resolve-ToolName "npm"
  Push-Location $WorkingDirectory
  try {
    $null = & $tool view $PackageSpec version --registry $Registry --userconfig $NpmrcPath --json 2>$null
    return $LASTEXITCODE -eq 0
  } finally {
    Pop-Location
  }
}

if ($Publish -and $DryRun) {
  throw "Use either -DryRun or -Publish, not both."
}
if (-not $Publish) {
  $DryRun = $true
}

$repoRoot = Resolve-RepoRoot
if (-not [System.IO.Path]::IsPathRooted($ManifestPath)) {
  $ManifestPath = Join-Path $repoRoot $ManifestPath
}
if (-not [System.IO.Path]::IsPathRooted($NpmrcPath)) {
  $NpmrcPath = Join-Path $repoRoot $NpmrcPath
}

$manifest = Read-JsonFile $ManifestPath
if (-not $Registry) {
  $Registry = if ($manifest.registry) { [string]$manifest.registry } else { "https://npm.pkg.github.com" }
}
if (-not $Tag) {
  $Tag = if ($manifest.defaultTag) { [string]$manifest.defaultTag } else { "internal" }
}

if ($Publish -and -not $UseExternalNpmAuth) {
  $tokenValue = [Environment]::GetEnvironmentVariable($TokenEnv)
  if ([string]::IsNullOrWhiteSpace($tokenValue)) {
    throw "Publishing requires `$env:$TokenEnv. Run scripts/github/Write-GitHubNpmrc.ps1 first, then set $TokenEnv."
  }
}
if ($Publish) {
  if (-not (Test-Path -LiteralPath $NpmrcPath)) {
    throw "Missing npm userconfig: $NpmrcPath."
  }
}

$packages = @($manifest.packages)
if ($PackageId) {
  $packages = @($packages | Where-Object { [string]$_.id -eq $PackageId })
  if ($packages.Count -eq 0) {
    throw "No package with id '$PackageId' in $ManifestPath."
  }
}

$results = New-Object System.Collections.Generic.List[object]

foreach ($pkg in $packages) {
  $id = [string]$pkg.id
  if ($pkg.enabled -eq $false) {
    Write-Host "skip ${id}: disabled"
    $results.Add([pscustomobject]@{ id = $id; status = "disabled" })
    continue
  }

  $source = [string]$pkg.source
  $sourcePath = Join-Path $repoRoot $source
  if (-not (Test-Path -LiteralPath $sourcePath)) {
    Write-Warning "skip ${id}: source not found ($source)"
    $results.Add([pscustomobject]@{ id = $id; status = "missing"; source = $source })
    continue
  }

  $sourcePackageJsonPath = Join-Path $sourcePath "package.json"
  if (-not (Test-Path -LiteralPath $sourcePackageJsonPath)) {
    Write-Warning "skip ${id}: package.json not found in $source"
    $results.Add([pscustomobject]@{ id = $id; status = "missing-package-json"; source = $source })
    continue
  }

  if (-not $NoBuild) {
    $restoreCommand = if ($pkg.restoreCommand) { $pkg.restoreCommand } else { $pkg.installCommand }
    if ($restoreCommand) {
      Invoke-Tool -Command @($restoreCommand) -WorkingDirectory $sourcePath
    }
    if ($pkg.buildCommand) {
      Invoke-Tool -Command @($pkg.buildCommand) -WorkingDirectory $sourcePath
    }
  }

  foreach ($relativeRequiredFile in @($pkg.requiredFiles)) {
    $requiredFile = Join-Path $sourcePath ([string]$relativeRequiredFile)
    if (-not (Test-Path -LiteralPath $requiredFile)) {
      throw "Package $id is missing required file: $relativeRequiredFile"
    }
  }

  if ($pkg.smokeCommand) {
    Invoke-Tool -Command @($pkg.smokeCommand) -WorkingDirectory $sourcePath
  }

  $workRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("funesterie-ghpkg-" + $id + "-" + [Guid]::NewGuid().ToString("N"))
  $null = New-Item -ItemType Directory -Path $workRoot -Force
  try {
    $packJson = & (Resolve-ToolName "npm") pack --pack-destination $workRoot --json --ignore-scripts $sourcePath
    if ($LASTEXITCODE -ne 0) {
      throw "npm pack failed for $id"
    }
    $packInfo = $packJson | ConvertFrom-Json
    $tarball = Join-Path $workRoot ([string]$packInfo[0].filename)
    if (-not (Test-Path -LiteralPath $tarball)) {
      $tarball = [string]$packInfo[0].filename
    }

    $extractRoot = Join-Path $workRoot "extract"
    $null = New-Item -ItemType Directory -Path $extractRoot -Force
    & (Resolve-ToolName "tar") -xzf $tarball -C $extractRoot
    if ($LASTEXITCODE -ne 0) {
      throw "tar extraction failed for $tarball"
    }

    $packageRoot = Join-Path $extractRoot "package"
    $packageJsonPath = Join-Path $packageRoot "package.json"
    $packageJson = Read-JsonFile $packageJsonPath
    $packageJson.name = [string]$pkg.publishedName
    if ($pkg.publishedVersion) {
      $packageJson.version = [string]$pkg.publishedVersion
    }
    if (-not $packageJson.publishConfig) {
      $packageJson | Add-Member -NotePropertyName publishConfig -NotePropertyValue ([pscustomobject]@{})
    }
    $packageJson.publishConfig | Add-Member -Force -NotePropertyName registry -NotePropertyValue $Registry
    if ($pkg.access) {
      $packageJson.publishConfig | Add-Member -Force -NotePropertyName access -NotePropertyValue ([string]$pkg.access)
    } else {
      $packageJson.publishConfig.PSObject.Properties.Remove("access")
    }
    if ($packageJson.scripts) {
      $packageJson.scripts.PSObject.Properties.Remove("prepare")
      $packageJson.scripts.PSObject.Properties.Remove("prepublishOnly")
      $packageJson.scripts.PSObject.Properties.Remove("postpack")
    }
    foreach ($dependencyName in @($pkg.removeDependencies)) {
      $dependencyKey = [string]$dependencyName
      if (-not [string]::IsNullOrWhiteSpace($dependencyKey) -and $packageJson.dependencies) {
        $packageJson.dependencies.PSObject.Properties.Remove($dependencyKey)
      }
    }
    if ($pkg.optionalPeerDependencies) {
      if (-not $packageJson.peerDependencies) {
        $packageJson | Add-Member -NotePropertyName peerDependencies -NotePropertyValue ([pscustomobject]@{})
      }
      if (-not $packageJson.peerDependenciesMeta) {
        $packageJson | Add-Member -NotePropertyName peerDependenciesMeta -NotePropertyValue ([pscustomobject]@{})
      }
      foreach ($peer in $pkg.optionalPeerDependencies.PSObject.Properties) {
        $packageJson.peerDependencies | Add-Member -Force -NotePropertyName $peer.Name -NotePropertyValue ([string]$peer.Value)
        $packageJson.peerDependenciesMeta | Add-Member -Force -NotePropertyName $peer.Name -NotePropertyValue ([pscustomobject]@{
          optional = $true
        })
      }
    }
    $packageJson | Add-Member -Force -NotePropertyName funesterieMirror -NotePropertyValue ([pscustomobject]@{
      sourceName = (Read-JsonFile $sourcePackageJsonPath).name
      sourcePath = $source
      generatedBy = "scripts/github/Publish-GitHubPackages.ps1"
    })
    Write-JsonFile -Value $packageJson -Path $packageJsonPath

    $effectiveTag = if ($pkg.npmTag) { [string]$pkg.npmTag } else { $Tag }
    $allTags = @($effectiveTag)
    foreach ($extraTag in @($pkg.distTags)) {
      $tagValue = [string]$extraTag
      if (-not [string]::IsNullOrWhiteSpace($tagValue)) {
        $allTags += $tagValue
      }
    }
    $allTags = @($allTags | Select-Object -Unique)
    if ($DryRun) {
      Invoke-Tool -Command @("npm", "pack", "--dry-run", "--json", "--ignore-scripts") -WorkingDirectory $packageRoot
      $results.Add([pscustomobject]@{
        id = $id
        status = "dry-run-ok"
        name = $packageJson.name
        version = $packageJson.version
        tags = ($allTags -join ",")
      })
    } else {
      $packageSpec = "$($packageJson.name)@$($packageJson.version)"
      $status = "published"
      if (Test-NpmPackageVersionExists -PackageSpec $packageSpec -Registry $Registry -NpmrcPath $NpmrcPath -WorkingDirectory $packageRoot) {
        Write-Host "$packageSpec already exists in $Registry; syncing dist-tags only."
        $status = "tagged-existing"
      } else {
        Invoke-Tool -Command @(
          "npm",
          "publish",
          "--registry", $Registry,
          "--userconfig", $NpmrcPath,
          "--tag", $effectiveTag,
          "--ignore-scripts"
        ) -WorkingDirectory $packageRoot
      }
      foreach ($tagName in @($allTags)) {
        try {
          Invoke-Tool -Command @(
            "npm",
            "dist-tag",
            "add",
            $packageSpec,
            $tagName,
            "--registry", $Registry,
            "--userconfig", $NpmrcPath
          ) -WorkingDirectory $packageRoot
        } catch {
          Write-Warning "dist-tag '$tagName' skipped for $packageSpec (registry may not support tag updates): $_"
        }
      }
      $results.Add([pscustomobject]@{
        id = $id
        status = $status
        name = $packageJson.name
        version = $packageJson.version
        tags = ($allTags -join ",")
      })
    }
  } finally {
    if ($workRoot -and (Test-Path -LiteralPath $workRoot)) {
      Remove-Item -LiteralPath $workRoot -Recurse -Force
    }
  }
}

Write-Host ""
Write-Host "${SummaryTitle}:"
$results | Format-Table -AutoSize
