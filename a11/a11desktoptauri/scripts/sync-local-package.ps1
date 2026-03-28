param(
  [switch]$SkipUiBuild,
  [switch]$LiteInstaller
)

$ErrorActionPreference = 'Stop'

function Get-DesktopConfig {
  param(
    [Parameter(Mandatory = $true)]
    [string]$ProjectRoot
  )

  $configPath = Join-Path $ProjectRoot 'desktop.config.json'
  if (-not (Test-Path $configPath)) {
    throw "Desktop config introuvable: $configPath"
  }

  return Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
}

function Remove-PackagingJunk {
  param(
    [Parameter(Mandatory = $true)]
    [string]$RootPath
  )

  if (-not (Test-Path $RootPath)) {
    return
  }

  $directoryNames = @(
    '.vs',
    '.github',
    '__pycache__',
    '.pytest_cache',
    '.mypy_cache'
  )

  $fileNames = @(
    'Thumbs.db',
    '.DS_Store'
  )

  $fileExtensions = @(
    '.pyc',
    '.pyo'
  )

  Get-ChildItem -LiteralPath $RootPath -Recurse -Force -Directory -ErrorAction SilentlyContinue |
    Where-Object {
      $directoryNames -contains $_.Name -or
      $_.FullName -like '*\CopilotSnapshots\*' -or
      $_.Name -eq 'CopilotSnapshots'
    } |
    Sort-Object FullName -Descending |
    ForEach-Object {
      Remove-Item -LiteralPath $_.FullName -Recurse -Force -ErrorAction SilentlyContinue
    }

  Get-ChildItem -LiteralPath $RootPath -Recurse -Force -File -ErrorAction SilentlyContinue |
    Where-Object {
      $fileNames -contains $_.Name -or
      $fileExtensions -contains $_.Extension
    } |
    ForEach-Object {
      Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue
    }
}

function Trim-DesktopRuntime {
  param(
    [Parameter(Mandatory = $true)]
    [string]$RootPath,
    [switch]$LiteInstaller
  )

  if (-not (Test-Path $RootPath)) {
    return
  }

  $pathsToRemove = @(
    (Join-Path $RootPath 'llm\llama.cpp'),
    (Join-Path $RootPath 'llm\llm\models\claire-7b-0.1.Q4_K_M.gguf'),
    (Join-Path $RootPath 'llm\llm\ngrok.exe'),
    (Join-Path $RootPath 'tts\fr_FR-gilles-low.onnx'),
    (Join-Path $RootPath 'tts\fr_FR-gilles-low.onnx.json'),
    (Join-Path $RootPath 'tts\model.onnx'),
    (Join-Path $RootPath 'tts\ngrok.exe'),
    (Join-Path $RootPath 'tts\piper')
  )

  foreach ($candidate in $pathsToRemove) {
    if (Test-Path $candidate) {
      Remove-Item -LiteralPath $candidate -Recurse -Force -ErrorAction SilentlyContinue
    }
  }

  $fileCleanup = @(
    (Join-Path $RootPath 'backend\tts\fr_FR-siwis-medium.onnx'),
    (Join-Path $RootPath 'backend\tts\fr_FR-siwis-medium.onnx.json')
  )

  foreach ($candidate in $fileCleanup) {
    if (Test-Path $candidate) {
      Remove-Item -LiteralPath $candidate -Force -ErrorAction SilentlyContinue
    }
  }

  if ($LiteInstaller) {
    $liteOnlyCleanup = @(
      (Join-Path $RootPath 'llm\llm\models\Llama-3.2-3B-Instruct-Q4_K_M.gguf')
    )

    foreach ($candidate in $liteOnlyCleanup) {
      if (Test-Path $candidate) {
        Remove-Item -LiteralPath $candidate -Force -ErrorAction SilentlyContinue
      }
    }
  }
}

function Set-Or-AddConfigValue {
  param(
    [Parameter(Mandatory = $true)]
    [AllowEmptyCollection()]
    [AllowEmptyString()]
    [string[]]$Lines,
    [Parameter(Mandatory = $true)]
    [string]$Key,
    [Parameter(Mandatory = $true)]
    [AllowEmptyString()]
    [string]$Value
  )

  $prefix = "$Key="
  for ($i = 0; $i -lt $Lines.Count; $i++) {
    if ($Lines[$i] -like "$prefix*") {
      $Lines[$i] = "$prefix$Value"
      return $Lines
    }
  }

  return @($Lines + "$prefix$Value")
}

function Update-LiteInstallerConfig {
  param(
    [Parameter(Mandatory = $true)]
    [string]$ConfigPath,
    [Parameter(Mandatory = $true)]
    [string]$DefaultModelName,
    [string]$DefaultModelId = '',
    [string]$DefaultModelUrl = ''
  )

  if (-not (Test-Path $ConfigPath)) {
    throw "Config lite introuvable: $ConfigPath"
  }

  $lines = @(Get-Content -LiteralPath $ConfigPath)
  $lines = Set-Or-AddConfigValue -Lines $lines -Key 'A11_ENABLE_LLM' -Value '0'
  $lines = Set-Or-AddConfigValue -Lines $lines -Key 'A11_ENABLE_QFLUSH' -Value '1'
  $lines = Set-Or-AddConfigValue -Lines $lines -Key 'A11_LLM_MODEL' -Value ("models\" + $DefaultModelName)
  $lines = Set-Or-AddConfigValue -Lines $lines -Key 'A11_LLM_MODEL_CATALOG_ID' -Value $DefaultModelId
  $lines = Set-Or-AddConfigValue -Lines $lines -Key 'A11_INSTALLER_LITE' -Value '1'
  $lines = Set-Or-AddConfigValue -Lines $lines -Key 'A11_CHAT_PROVIDER_MODE' -Value 'local'
  $lines = Set-Or-AddConfigValue -Lines $lines -Key 'A11_LLM_MODEL_URL' -Value $DefaultModelUrl
  $lines = Set-Or-AddConfigValue -Lines $lines -Key 'A11_REMOTE_PROVIDER_ID' -Value ''
  $lines = Set-Or-AddConfigValue -Lines $lines -Key 'OPENAI_BASE_URL' -Value ''
  $lines = Set-Or-AddConfigValue -Lines $lines -Key 'OPENAI_MODEL' -Value ''
  $lines = Set-Or-AddConfigValue -Lines $lines -Key 'OPENAI_API_KEY' -Value ''

  $modelsDir = Join-Path (Split-Path -Parent $ConfigPath | Split-Path -Parent) 'models'
  New-Item -ItemType Directory -Force -Path $modelsDir | Out-Null

  $lines | Set-Content -LiteralPath $ConfigPath -Encoding UTF8
}

$projectRoot = Split-Path -Parent $PSScriptRoot
$desktopConfig = Get-DesktopConfig -ProjectRoot $projectRoot
$launcherRoot = [System.IO.Path]::GetFullPath((Join-Path $projectRoot '..\launchers'))
$launcherScript = Join-Path $launcherRoot 'a11-local.ps1'
$sourceRoot = Join-Path $launcherRoot 'dist\a11-local'
$targetRoot = Join-Path $projectRoot 'resources\a11-local'

if (-not (Test-Path $launcherScript)) {
  throw "Launcher source introuvable: $launcherScript"
}

$packageArgs = @(
  '-NoProfile',
  '-ExecutionPolicy', 'Bypass',
  '-File', $launcherScript,
  'package',
  '-Force'
)

if ($SkipUiBuild) {
  $packageArgs += '-SkipUiBuild'
}

& powershell.exe @packageArgs
if ($LASTEXITCODE -ne 0) {
  throw "Le packaging A11 local a echoue."
}

if (-not (Test-Path $sourceRoot)) {
  throw "Staging package introuvable apres packaging: $sourceRoot"
}

if (Test-Path $targetRoot) {
  Remove-Item -LiteralPath $targetRoot -Recurse -Force
}

New-Item -ItemType Directory -Force -Path $targetRoot | Out-Null

$excludeRuntime = Join-Path $sourceRoot 'launcher\runtime'
$args = @($sourceRoot, $targetRoot, '/E', '/R:1', '/W:1', '/NFL', '/NDL', '/NJH', '/NJS', '/NP')
if (Test-Path $excludeRuntime) {
  $args += '/XD'
  $args += $excludeRuntime
}

& robocopy @args | Out-Null
$exitCode = $LASTEXITCODE
if ($exitCode -gt 7) {
  throw "robocopy a echoue pour la sync desktop (exit $exitCode)."
}

Remove-PackagingJunk -RootPath $targetRoot
Trim-DesktopRuntime -RootPath $targetRoot -LiteInstaller:$LiteInstaller

if ($LiteInstaller) {
  $defaultModelId = [string]$desktopConfig.installerLite.defaultModelId
  $defaultModelName = [string]$desktopConfig.installerLite.defaultModelFileName
  $defaultModelUrl = [string]$desktopConfig.installerLite.defaultModelUrl
  Update-LiteInstallerConfig `
    -ConfigPath (Join-Path $targetRoot 'launcher\config\a11-local.env') `
    -DefaultModelName $defaultModelName `
    -DefaultModelId $defaultModelId `
    -DefaultModelUrl $defaultModelUrl
}

Write-Host "[A11 DESKTOP] resources pretes: $targetRoot"
