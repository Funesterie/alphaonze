$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot

$checks = @(
  @{ Label = 'bridge'; Path = Join-Path $root 'llm\backend\bridge_server.py' },
  @{ Label = 'model llama'; Path = Join-Path $root 'llm\models\Llama-3.2-3B-Instruct-Q4_K_M.gguf' },
  @{ Label = 'model claire'; Path = Join-Path $root 'llm\models\claire-7b-0.1.Q4_K_M.gguf' },
  @{ Label = 'llama-server'; Path = Join-Path $root 'llm\server\llama-server.exe' },
  @{ Label = 'ggml-cuda'; Path = Join-Path $root 'llm\server\ggml-cuda.dll' },
  @{ Label = 'ngrok'; Path = Join-Path $root 'llm\ngrok.exe' },
  @{ Label = 'llama.cpp'; Path = Join-Path $root 'llama.cpp' }
)

$missing = @()

Write-Host '[a11llm] Verification des assets locaux'
Write-Host ('[a11llm] Racine: {0}' -f $root)

foreach ($check in $checks) {
  if (Test-Path $check.Path) {
    Write-Host ('[OK]  {0} -> {1}' -f $check.Label, $check.Path)
  } else {
    Write-Host ('[MISS] {0} -> {1}' -f $check.Label, $check.Path) -ForegroundColor Yellow
    $missing += $check.Label
  }
}

if ($missing.Count -gt 0) {
  Write-Host ''
  Write-Host ('[a11llm] Assets manquants: {0}' -f ($missing -join ', ')) -ForegroundColor Yellow
  exit 1
}

Write-Host ''
Write-Host '[a11llm] Tous les assets critiques sont presents.' -ForegroundColor Green
