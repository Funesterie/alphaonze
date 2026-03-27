$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$target = Join-Path $root 'llama.cpp'
$repoUrl = 'https://github.com/ggerganov/llama.cpp'

if (Test-Path $target) {
  Write-Host ('[a11llm] llama.cpp deja present: {0}' -f $target)
  exit 0
}

git clone $repoUrl $target

Write-Host ('[a11llm] Clone termine: {0}' -f $target) -ForegroundColor Green
