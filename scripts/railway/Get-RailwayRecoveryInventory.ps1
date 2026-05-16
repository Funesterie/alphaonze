#!/usr/bin/env pwsh
param(
  [string]$Root = '',
  [string]$OutFile = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not $Root) {
  $Root = (Resolve-Path -Path (Join-Path $PSScriptRoot '..\..')).ProviderPath
}

$secretNamePattern = '(?i)(TOKEN|SECRET|KEY|PASSWORD|PASSWD|DATABASE_URL|REDIS_URL|PGHOST|PGPORT|PGUSER|PGPASSWORD|PGDATABASE|JWT|COOKIE|OAUTH|CLIENT_SECRET|PRIVATE)'
$envFiles = Get-ChildItem -Path $Root -Recurse -File -Force -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -notmatch '\\node_modules\\|\\.git\\|\\dist\\|\\__pycache__\\' -and $_.Name -match '^\.env(\..*)?$|\.env\.example$|env\.example$|\.env\..*\.example$' }

$names = [ordered]@{}
foreach ($file in $envFiles) {
  $lines = Get-Content -Path $file.FullName -ErrorAction SilentlyContinue
  foreach ($line in $lines) {
    if ($line -match '^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=') {
      $name = $Matches[1]
      if (-not $names.Contains($name)) {
        $names[$name] = [ordered]@{ name=$name; files=@(); secretish=($name -match $secretNamePattern) }
      }
      $rel = Resolve-Path -Path $file.FullName -Relative
      if ($names[$name].files -notcontains $rel) { $names[$name].files += $rel }
    }
  }
}

$railwayFiles = Get-ChildItem -Path $Root -Recurse -File -Force -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -notmatch '\\node_modules\\|\\.git\\|\\dist\\' -and ($_.Name -match 'railway\.(json|toml)$' -or $_.Name -eq 'nixpacks.toml' -or $_.Name -eq 'Dockerfile') } |
  ForEach-Object { Resolve-Path -Path $_.FullName -Relative }

$result = [ordered]@{
  generatedAt = (Get-Date).ToString('o')
  root = $Root
  note = 'Names only. Values are intentionally never read or printed.'
  railwayFiles = @($railwayFiles)
  variableNames = @($names.Values | Sort-Object name)
}

$json = $result | ConvertTo-Json -Depth 8
if ($OutFile) {
  $parent = Split-Path -Parent $OutFile
  if ($parent) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
  Set-Content -Path $OutFile -Value $json -Encoding utf8
}
$json
