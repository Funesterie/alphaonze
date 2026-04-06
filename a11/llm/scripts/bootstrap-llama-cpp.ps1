$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$target = Join-Path $root 'llama.cpp'
$legacyTarget = Join-Path (Join-Path (Split-Path -Parent $root) 'a11llm') 'llama.cpp'
$repoUrl = 'https://github.com/ggerganov/llama.cpp'

if (Test-Path $target) {
  Write-Host ('[llm] llama.cpp deja present: {0}' -f $target)
  exit 0
}

if (Test-Path $legacyTarget) {
  Write-Host ('[llm] llama.cpp present dans le cache legacy: {0}' -f $legacyTarget)
  exit 0
}

git clone $repoUrl $target

Write-Host ('[llm] Clone termine: {0}' -f $target) -ForegroundColor Green
