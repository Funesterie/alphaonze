$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$legacyRoot = Join-Path (Split-Path -Parent $root) 'a11llm'

$checks = @(
  @{ Label = 'bridge'; Paths = @( (Join-Path $root 'llm\backend\bridge_server.py') ) },
  @{ Label = 'model llama'; Paths = @( (Join-Path $root 'llm\models\Llama-3.2-3B-Instruct-Q4_K_M.gguf'), (Join-Path $legacyRoot 'llm\models\Llama-3.2-3B-Instruct-Q4_K_M.gguf') ) },
  @{ Label = 'model claire'; Paths = @( (Join-Path $root 'llm\models\claire-7b-0.1.Q4_K_M.gguf'), (Join-Path $legacyRoot 'llm\models\claire-7b-0.1.Q4_K_M.gguf') ) },
  @{ Label = 'llama-server'; Paths = @( (Join-Path $root 'llm\server\llama-server.exe'), (Join-Path $legacyRoot 'llm\server\llama-server.exe') ) },
  @{ Label = 'ggml-cuda'; Paths = @( (Join-Path $root 'llm\server\ggml-cuda.dll'), (Join-Path $legacyRoot 'llm\server\ggml-cuda.dll') ) },
  @{ Label = 'ngrok'; Paths = @( (Join-Path $root 'llm\ngrok.exe'), (Join-Path $legacyRoot 'llm\ngrok.exe') ) },
  @{ Label = 'llama.cpp'; Paths = @( (Join-Path $root 'llama.cpp'), (Join-Path $legacyRoot 'llama.cpp') ) }
)

$missing = @()

Write-Host '[llm] Verification des assets locaux'
Write-Host ('[llm] Racine canonique: {0}' -f $root)
Write-Host ('[llm] Racine legacy toleree: {0}' -f $legacyRoot)

foreach ($check in $checks) {
  $foundPath = $check.Paths | Where-Object { Test-Path $_ } | Select-Object -First 1
  if ($foundPath) {
    Write-Host ('[OK]  {0} -> {1}' -f $check.Label, $foundPath)
  } else {
    Write-Host ('[MISS] {0} -> {1}' -f $check.Label, ($check.Paths -join ' | ')) -ForegroundColor Yellow
    $missing += $check.Label
  }
}

if ($missing.Count -gt 0) {
  Write-Host ''
  Write-Host ('[llm] Assets manquants: {0}' -f ($missing -join ', ')) -ForegroundColor Yellow
  exit 1
}

Write-Host ''
Write-Host '[llm] Tous les assets critiques sont presents.' -ForegroundColor Green
