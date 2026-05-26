param(
  [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path,
  [switch]$Json
)

$ErrorActionPreference = 'Stop'

$packages = @(
  Join-Path $RepoRoot 'packages\npm-meta\nossen-all-in-one\package.json'
  Join-Path $RepoRoot 'packages\npm-meta\funeste-all-in-one-nossen\package.json'
)

$result = foreach ($packagePath in $packages) {
  if (-not (Test-Path -LiteralPath $packagePath)) {
    throw "Missing package manifest: $packagePath"
  }

  $manifest = Get-Content -Raw -LiteralPath $packagePath | ConvertFrom-Json
  $deps = @()

  if ($manifest.dependencies) {
    $manifest.dependencies.PSObject.Properties |
      Sort-Object Name |
      ForEach-Object {
        $deps += [pscustomobject]@{
          name = $_.Name
          version = [string]$_.Value
          scope = if ($_.Name -like '@funeste/*') { 'private' } elseif ($_.Name -like '@nossen/*') { 'public' } else { 'public-legacy' }
        }
      }
  }

  [pscustomobject]@{
    package = $manifest.name
    version = $manifest.version
    dependencyCount = $deps.Count
    dependencies = $deps
  }
}

if ($Json) {
  $result | ConvertTo-Json -Depth 6
  exit 0
}

foreach ($item in $result) {
  Write-Host ("{0}@{1} - {2} dependencies" -f $item.package, $item.version, $item.dependencyCount)
  $item.dependencies | Format-Table -AutoSize
}
