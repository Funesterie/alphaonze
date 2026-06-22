param(
  [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path,
  [string]$Plan = '',
  [switch]$Registry,
  [switch]$Strict,
  [switch]$Json
)

$ErrorActionPreference = 'Stop'

function Get-PackageIndex {
  param([Parameter(Mandatory)][string]$IndexPath)

  $script = 'const value = require(process.argv[1]); process.stdout.write(JSON.stringify(value));'
  $raw = & node -e $script $IndexPath
  if ($LASTEXITCODE -ne 0) {
    throw "Unable to load package index: $IndexPath"
  }
  return $raw | ConvertFrom-Json
}

function Test-ExactVersion {
  param([AllowNull()][string]$Version)
  return [bool]($Version -match '^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$')
}

function Get-InternalRanges {
  param(
    [Parameter(Mandatory)][string]$PackageName,
    [AllowNull()]$Dependencies
  )

  $ranges = @()
  if ($Dependencies) {
    $Dependencies.PSObject.Properties | ForEach-Object {
      $dependencyName = $_.Name
      $declared = [string]$_.Value
      if (($dependencyName -like '@nossen/*' -or $dependencyName -like '@funeste/*') -and -not (Test-ExactVersion $declared)) {
        $ranges += [pscustomobject][ordered]@{
          package = $PackageName
          dependency = $dependencyName
          declared = $declared
        }
      }
    }
  }
  return @($ranges | Sort-Object package, dependency)
}

$plannedTargets = @{}
if ($Plan) {
  $planPath = if ([System.IO.Path]::IsPathRooted($Plan)) { $Plan } else { Join-Path $RepoRoot $Plan }
  if (-not (Test-Path -LiteralPath $planPath)) {
    throw "Missing release plan: $planPath"
  }
  $releasePlan = Get-Content -Raw -LiteralPath $planPath | ConvertFrom-Json
  foreach ($sectionName in @('publicTargets', 'metaTargets')) {
    $section = $releasePlan.$sectionName
    if ($section) {
      $section.PSObject.Properties | ForEach-Object { $plannedTargets[$_.Name] = [string]$_.Value }
    }
  }
  if ($releasePlan.publicRebases) {
    $releasePlan.publicRebases.PSObject.Properties | ForEach-Object {
      $plannedTargets[$_.Name] = [string]$_.Value.target
    }
  }
}

$packageDefinitions = @(
  [pscustomobject]@{
    manifest = Join-Path $RepoRoot 'packages\npm-meta\nossen-all-in-one\package.json'
    index = Join-Path $RepoRoot 'packages\npm-meta\nossen-all-in-one\index.cjs'
    listProperty = 'packages'
  },
  [pscustomobject]@{
    manifest = Join-Path $RepoRoot 'packages\npm-meta\funeste-all-in-one-nossen\package.json'
    index = Join-Path $RepoRoot 'packages\npm-meta\funeste-all-in-one-nossen\index.cjs'
    listProperty = 'privatePackages'
  }
)

$registryCache = @{}
$strictFailed = $false
$result = foreach ($definition in $packageDefinitions) {
  if (-not (Test-Path -LiteralPath $definition.manifest)) {
    throw "Missing package manifest: $($definition.manifest)"
  }
  if (-not (Test-Path -LiteralPath $definition.index)) {
    throw "Missing package index: $($definition.index)"
  }

  $manifest = Get-Content -Raw -LiteralPath $definition.manifest | ConvertFrom-Json
  $index = Get-PackageIndex -IndexPath $definition.index
  $indexedPackages = @($index.($definition.listProperty))
  if ($index.publicMetaPackage) {
    $indexedPackages += [string]$index.publicMetaPackage
  }

  $declaredNames = @($manifest.dependencies.PSObject.Properties.Name | Sort-Object)
  $missingFromIndex = @($declaredNames | Where-Object { $_ -notin $indexedPackages })
  $extraInIndex = @($indexedPackages | Where-Object { $_ -notin $declaredNames } | Sort-Object)
  $errors = @()
  if ($missingFromIndex.Count -gt 0) {
    $errors += "missing from index: $($missingFromIndex -join ', ')"
  }
  if ($extraInIndex.Count -gt 0) {
    $errors += "extra in index: $($extraInIndex -join ', ')"
  }

  $deps = @()
  $latest = [ordered]@{}
  $outdated = @()
  $nonExactInternalDependencies = @(Get-InternalRanges -PackageName $manifest.name -Dependencies $manifest.dependencies)
  $registryOk = $null
  if ($Registry) { $registryOk = $true }

  foreach ($property in @($manifest.dependencies.PSObject.Properties | Sort-Object Name)) {
    $dependencyName = $property.Name
    $declaredVersion = [string]$property.Value
    $lookupOk = $null
    $registryVersion = $null
    $lookupError = $null
    $registryDependencies = $null

    if ($Registry) {
      if (-not $registryCache.ContainsKey($dependencyName)) {
        $raw = & npm.cmd view $dependencyName version dependencies --json 2>$null
        if ($LASTEXITCODE -ne 0) {
          $registryCache[$dependencyName] = [pscustomobject]@{
            ok = $false
            error = "registry lookup failed: $dependencyName"
            version = $null
            dependencies = $null
          }
        } else {
          try {
            $view = $raw | ConvertFrom-Json
            $viewVersion = if ($view.version -is [array]) { [string]$view.version[-1] } else { [string]$view.version }
            $registryCache[$dependencyName] = [pscustomobject]@{
              ok = $true
              error = $null
              version = $viewVersion
              dependencies = $view.dependencies
            }
          } catch {
            $registryCache[$dependencyName] = [pscustomobject]@{
              ok = $false
              error = "invalid registry response: $dependencyName"
              version = $null
              dependencies = $null
            }
          }
        }
      }

      $lookup = $registryCache[$dependencyName]
      $lookupOk = [bool]$lookup.ok
      $lookupError = $lookup.error
      $registryVersion = $lookup.version
      $registryDependencies = $lookup.dependencies
      if (-not $lookupOk) {
        $registryOk = $false
        $errors += $lookupError
      }
      $nonExactInternalDependencies += @(Get-InternalRanges -PackageName $dependencyName -Dependencies $registryDependencies)
    }

    $latest[$dependencyName] = $registryVersion
    $expectedVersion = if ($plannedTargets.ContainsKey($dependencyName)) { $plannedTargets[$dependencyName] } else { $registryVersion }
    $isOutdated = [bool]($expectedVersion -and $declaredVersion -ne $expectedVersion)
    if ($isOutdated) {
      $outdated += [pscustomobject][ordered]@{
        name = $dependencyName
        declared = $declaredVersion
        latest = $registryVersion
        expected = $expectedVersion
      }
    }

    $deps += [pscustomobject][ordered]@{
      name = $dependencyName
      version = $declaredVersion
      scope = if ($dependencyName -like '@funeste/*') { 'private' } elseif ($dependencyName -like '@nossen/*') { 'public' } else { 'public-legacy' }
      latest = $registryVersion
      expected = $expectedVersion
      outdated = $isOutdated
      registryOk = $lookupOk
      errors = @($lookupError | Where-Object { $_ })
    }
  }

  $nonExactInternalDependencies = @($nonExactInternalDependencies | Sort-Object package, dependency -Unique)
  if ($nonExactInternalDependencies.Count -gt 0) {
    $errors += "non-exact internal dependencies: $($nonExactInternalDependencies.Count)"
  }

  $plannedMetaVersion = if ($plannedTargets.ContainsKey($manifest.name)) { $plannedTargets[$manifest.name] } else { $null }
  if ($plannedMetaVersion -and [string]$manifest.version -ne $plannedMetaVersion) {
    $errors += "meta version differs from plan: $($manifest.version) != $plannedMetaVersion"
  }

  if ($Strict -and ($errors.Count -gt 0 -or $outdated.Count -gt 0)) {
    $strictFailed = $true
  }

  [pscustomobject][ordered]@{
    package = $manifest.name
    version = $manifest.version
    plannedVersion = $plannedMetaVersion
    dependencyCount = $deps.Count
    dependencies = $deps
    latest = [pscustomobject]$latest
    outdated = @($outdated)
    nonExactInternalDependencies = @($nonExactInternalDependencies)
    registryOk = $registryOk
    indexParity = [pscustomobject][ordered]@{
      missingFromIndex = @($missingFromIndex)
      extraInIndex = @($extraInIndex)
    }
    errors = @($errors | Sort-Object -Unique)
  }
}

if ($Json) {
  $result | ConvertTo-Json -Depth 12
} else {
  foreach ($item in $result) {
    Write-Host ("{0}@{1} - {2} dependencies" -f $item.package, $item.version, $item.dependencyCount)
    $item.dependencies | Format-Table name, version, latest, expected, outdated, registryOk -AutoSize
    if ($item.errors.Count -gt 0) {
      $item.errors | ForEach-Object { Write-Warning $_ }
    }
  }
}

if ($Strict -and $strictFailed) {
  exit 1
}
