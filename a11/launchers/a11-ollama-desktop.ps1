$ErrorActionPreference = 'Stop'

function Test-OllamaReady {
  param([string]$Url)

  try {
    $webRequestParams = @{
      ErrorAction = 'Stop'
    }
    if ($PSVersionTable.PSVersion.Major -lt 6) {
      $webRequestParams.UseBasicParsing = $true
    }

    $response = Invoke-WebRequest -Uri $Url -Method Get -TimeoutSec 4 @webRequestParams
    return ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500)
  } catch {
    return $false
  }
}

function Resolve-FirstExistingPath {
  param([string[]]$Candidates)

  foreach ($candidate in @($Candidates)) {
    $raw = [string]$candidate
    if ([string]::IsNullOrWhiteSpace($raw)) {
      continue
    }

    if ($raw.Contains('\') -or $raw.Contains('/')) {
      if (Test-Path -LiteralPath $raw) {
        return [System.IO.Path]::GetFullPath($raw)
      }
      continue
    }

    try {
      return (Get-Command $raw -ErrorAction Stop).Source
    } catch {
    }
  }

  return ''
}

$launcherRoot = Split-Path -Parent $PSCommandPath
$logsDirectory = Join-Path $launcherRoot 'runtime\logs'
$ollamaBase = 'http://127.0.0.1:11434'
$ollamaHealthUrl = "$ollamaBase/api/tags"
$ollamaApp = Resolve-FirstExistingPath @(
  'C:\Users\cella\AppData\Local\Programs\Ollama\ollama app.exe'
)
$ollamaExe = Resolve-FirstExistingPath @(
  'C:\Users\cella\AppData\Local\Programs\Ollama\ollama.exe',
  'C:\Program Files\Ollama\ollama.exe',
  'ollama'
)

New-Item -ItemType Directory -Force -Path $logsDirectory | Out-Null

if (-not (Test-OllamaReady -Url $ollamaHealthUrl)) {
  if ($ollamaApp) {
    Start-Process -FilePath $ollamaApp -WorkingDirectory (Split-Path -Parent $ollamaApp) | Out-Null
    Start-Sleep -Seconds 3
  }

  if (-not (Test-OllamaReady -Url $ollamaHealthUrl)) {
    if (-not $ollamaExe) {
      throw 'Ollama introuvable. Installe Ollama ou ajuste le chemin dans a11-ollama-desktop.ps1.'
    }

    $stdoutPath = Join-Path $logsDirectory 'desktop-ollama.out.log'
    $stderrPath = Join-Path $logsDirectory 'desktop-ollama.err.log'
    Start-Process `
      -FilePath $ollamaExe `
      -WorkingDirectory (Split-Path -Parent $ollamaExe) `
      -ArgumentList 'serve' `
      -WindowStyle Hidden `
      -RedirectStandardOutput $stdoutPath `
      -RedirectStandardError $stderrPath | Out-Null
  }

  $ready = $false
  for ($attempt = 0; $attempt -lt 45; $attempt++) {
    if (Test-OllamaReady -Url $ollamaHealthUrl) {
      $ready = $true
      break
    }
    Start-Sleep -Seconds 1
  }

  if (-not $ready) {
    throw "Ollama ne repond pas sur $ollamaHealthUrl"
  }
}

& (Join-Path $launcherRoot 'a11-desktop.ps1') @args
exit $LASTEXITCODE
