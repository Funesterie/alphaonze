$ErrorActionPreference = 'Stop'

$launcherScriptPath = Join-Path $PSScriptRoot '..\a11-local.ps1'
$launcherSource = Get-Content -Path $launcherScriptPath -Raw
$trimmedSource = [regex]::Replace(
  $launcherSource,
  '(?ms)^\$launcherDirectory = Split-Path -Parent \$PSCommandPath.*$',
  ''
)

. ([scriptblock]::Create($trimmedSource))

$launcherDirectory = Split-Path -Parent $launcherScriptPath
$config = @{
  A11_ENABLE_BACKEND = '1'
  A11_ENABLE_TTS = '0'
  A11_ENABLE_LLM = '1'
  A11_ENABLE_QFLUSH = '0'
  A11_CHAT_PROVIDER_MODE = 'local'
  A11_LLM_FALLBACK_PROVIDER = 'openai'
  OPENAI_API_KEY = 'sk-test-openai'
  OPENAI_BASE_URL = 'https://api.openai.com/v1'
  OPENAI_MODEL = 'gpt-4o-mini'
}

$bundle = Build-ServiceDefinitions `
  -Config $config `
  -LauncherDirectory $launcherDirectory `
  -NodeCommand 'node' `
  -NpmCommand 'npm' `
  -PythonCommand 'python' `
  -UiMode 'embedded' `
  -LocalApiUrl 'http://127.0.0.1:3000' `
  -LocalUiUrl 'http://127.0.0.1:3000' `
  -LocalTtsUrl 'http://127.0.0.1:5002' `
  -LocalLlmUrl 'http://127.0.0.1:4545' `
  -LocalQflushUrl 'http://127.0.0.1:43421' `
  -PublicApiUrl 'https://alphaonze.funesterie.pro' `
  -WebDistDirectory (Join-Path $launcherDirectory '..\frontend\apps\web\dist')

$llmService = $bundle.Services | Where-Object { $_.Key -eq 'llm' } | Select-Object -First 1
if (-not $llmService) {
  throw 'LLM service definition was not created.'
}

if ($llmService.Environment.OPENAI_API_KEY -ne 'sk-test-openai') {
  throw "Expected llm OPENAI_API_KEY to be propagated, got '$($llmService.Environment.OPENAI_API_KEY)'."
}

if ($llmService.Environment.OPENAI_BASE_URL -ne 'https://api.openai.com/v1') {
  throw "Expected llm OPENAI_BASE_URL to be propagated, got '$($llmService.Environment.OPENAI_BASE_URL)'."
}

if ($llmService.Environment.OPENAI_MODEL -ne 'gpt-4o-mini') {
  throw "Expected llm OPENAI_MODEL to be propagated, got '$($llmService.Environment.OPENAI_MODEL)'."
}

Write-Host 'LLM OpenAI fallback environment propagation OK.'
