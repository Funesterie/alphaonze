param(
  [string]$InstallDir = "D:\agent-bus\voice\XTTS-RVC-UI",
  [switch]$InstallOnly,
  [switch]$SkipInstall,
  [switch]$Visible,
  [ValidateSet("auto", "cuda", "cpu")]
  [string]$Device = "auto"
)

$ErrorActionPreference = "Stop"

$repoUrl = "https://github.com/Vali-98/XTTS-RVC-UI.git"
$pythonVersion = "3.11"
$venvDir = Join-Path $InstallDir ".venv311"
$venvPython = Join-Path $venvDir "Scripts\python.exe"

function Invoke-Checked {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments
  )
  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed with exit code ${LASTEXITCODE}: $FilePath $($Arguments -join ' ')"
  }
}

function Write-Step {
  param([string]$Message)
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Resolve-Python311 {
  $uv = Get-Command uv -ErrorAction SilentlyContinue
  if ($uv) {
    Invoke-Checked uv python install $pythonVersion
    $candidate = & uv python find $pythonVersion
    if ($LASTEXITCODE -eq 0 -and $candidate -and (Test-Path -LiteralPath $candidate)) {
      return $candidate.Trim()
    }
  }

  $py = Get-Command py -ErrorAction SilentlyContinue
  if ($py) {
    $oldPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    $candidate = & py -3.11 -c "import sys; print(sys.executable)" 2>$null
    $code = $LASTEXITCODE
    $ErrorActionPreference = $oldPreference
    if ($code -eq 0 -and $candidate -and (Test-Path -LiteralPath $candidate)) {
      return $candidate.Trim()
    }
  }

  throw "Python 3.11 is required for the modern XTTS/RVC dependency stack. Install it or install uv."
}

function Copy-VoiceIfPresent {
  param(
    [string[]]$Candidates,
    [string]$TargetName
  )

  $targetDir = Join-Path $InstallDir "voices"
  New-Item -ItemType Directory -Force -Path $targetDir | Out-Null
  $target = Join-Path $targetDir $TargetName
  foreach ($candidate in $Candidates) {
    if ($candidate -and (Test-Path -LiteralPath $candidate)) {
      if (-not (Test-Path -LiteralPath $target)) {
        Copy-Item -LiteralPath $candidate -Destination $target
        Write-Host "Copied voice sample: $TargetName"
      }
      return
    }
  }
  Write-Host "Voice sample missing, add manually: $target" -ForegroundColor Yellow
}

function Repair-XttsRvcUiApp {
  $appPath = Join-Path $InstallDir "app.py"
  if (-not (Test-Path -LiteralPath $appPath)) {
    return
  }

  $content = Get-Content -LiteralPath $appPath -Raw
  $oldDevice = 'device = "cuda:0" if torch.cuda.is_available() else "cpu"'
  $newDevice = 'device = os.environ.get("A11_XTTS_RVC_DEVICE") or ("cuda:0" if torch.cuda.is_available() else "cpu")'
  if ($content.Contains($oldDevice)) {
    $content = $content.Replace($oldDevice, $newDevice)
    Write-Host "Patched XTTS-RVC-UI device selection."
  }

  $oldRunTts = @'
def runtts(rvc, voice, text, pitch_change, index_rate, language):
    audio = tts.tts_to_file(text=text, speaker_wav="./voices/" + voice, language=language, file_path="./output.wav")
    voice_change(rvc, pitch_change, index_rate)
    return ["./output.wav" , "./outputrvc.wav"]
'@
  $newRunTts = @'
def runtts(rvc, voice, text, pitch_change, index_rate, language):
    audio = tts.tts_to_file(text=text, speaker_wav="./voices/" + voice, language=language, file_path="./output.wav")
    rvc_path = "./rvcs/" + rvc if rvc else ""
    if rvc_path and os.path.isfile(rvc_path):
        voice_change(rvc, pitch_change, index_rate)
        return ["./output.wav" , "./outputrvc.wav"]
    print("RVC model missing, returning XTTS-only output.")
    return ["./output.wav" , "./output.wav"]
'@
  if ($content.Contains($oldRunTts)) {
    $content = $content.Replace($oldRunTts, $newRunTts)
    Write-Host "Patched XTTS-RVC-UI XTTS-only fallback."
  }

  $oldLaunch = 'interface.launch(server_name="0.0.0.0", server_port=5000, quiet=True)'
  $newLaunch = 'interface.launch(server_name="127.0.0.1", server_port=5000, quiet=True, share=False, show_error=True)'
  if ($content.Contains($oldLaunch)) {
    $content = $content.Replace($oldLaunch, $newLaunch)
    Write-Host "Patched XTTS-RVC-UI Gradio launch for local Windows startup."
  }
  Set-Content -LiteralPath $appPath -Value $content -Encoding UTF8
}

function Resolve-XttsDevice {
  param([string]$Python)
  if ($Device -eq "cpu") { return "cpu" }
  if ($Device -eq "cuda") { return "cuda:0" }
  $probe = @'
import sys
try:
    import torch
    if torch.cuda.is_available():
        x = torch.ones((1,), device="cuda")
        torch.cuda.synchronize()
        print("cuda")
    else:
        print("cpu")
except Exception:
    print("cpu")
'@
  $resolved = ($probe | & $Python -).Trim().Split("`n")[-1].Trim().ToLowerInvariant()
  if ($resolved -eq "cuda") { return "cuda:0" }
  return "cpu"
}

Write-Step "Preparing XTTS-RVC-UI in $InstallDir"
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $InstallDir) | Out-Null

if (-not (Test-Path -LiteralPath $InstallDir)) {
  Invoke-Checked git clone $repoUrl $InstallDir
} elseif (Test-Path -LiteralPath (Join-Path $InstallDir ".git")) {
  Invoke-Checked git -C $InstallDir pull --ff-only
} else {
  throw "InstallDir exists but is not a git repository: $InstallDir"
}

New-Item -ItemType Directory -Force -Path (Join-Path $InstallDir "models\xtts") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $InstallDir "rvcs") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $InstallDir "voices") | Out-Null
$voicesDir = Join-Path $InstallDir "voices"
$personaManifest = Join-Path $InstallDir "rvcs\funesterie-personas.json"
if (-not (Test-Path -LiteralPath $personaManifest)) {
  @'
{
  "a11-official-stern-french": {
    "persona": "a11",
    "voice": "a11-official-stern-french.wav",
    "rvc": "a11-official-stern-french.pth",
    "index": "a11-official-stern-french.index"
  },
  "a11-voix-de-lait": {
    "persona": "a11",
    "voice": "a11-voix-de-lait.wav",
    "rvc": "",
    "index": ""
  },
  "kaen44-official-french-narrator": {
    "persona": "kaen44",
    "voice": "kaen44-official-french-narrator.wav",
    "rvc": "kaen44-official-french-narrator.pth",
    "index": "kaen44-official-french-narrator.index"
  },
  "vivy": {
    "persona": "vivy",
    "voice": "vivy.wav",
    "rvc": "vivy.pth",
    "index": "vivy.index"
  },
  "djeff-rap": {
    "persona": "djeff",
    "voice": "djeff-rap.wav",
    "rvc": "djeff-rap.pth",
    "index": "djeff-rap.index"
  }
}
'@ | Set-Content -LiteralPath $personaManifest -Encoding ASCII
}

try {
  $manifestJson = Get-Content -LiteralPath $personaManifest -Raw | ConvertFrom-Json -AsHashtable
  $legacyStyleKeys = @("termi" + "nator", "don" + "na")
  foreach ($legacyStyleKey in $legacyStyleKeys) {
    if ($manifestJson.ContainsKey($legacyStyleKey)) {
      $manifestJson.Remove($legacyStyleKey)
    }
  }
  $officialEntries = @{
    "a11-official-stern-french" = @{
      persona = "a11"
      voice = "a11-official-stern-french.wav"
      rvc = "a11-official-stern-french.pth"
      index = "a11-official-stern-french.index"
    }
    "a11-voix-de-lait" = @{
      persona = "a11"
      voice = "a11-voix-de-lait.wav"
      rvc = ""
      index = ""
    }
    "kaen44-official-french-narrator" = @{
      persona = "kaen44"
      voice = "kaen44-official-french-narrator.wav"
      rvc = "kaen44-official-french-narrator.pth"
      index = "kaen44-official-french-narrator.index"
    }
  }
  foreach ($entryName in $officialEntries.Keys) {
    if (-not $manifestJson.ContainsKey($entryName)) {
      $manifestJson[$entryName] = $officialEntries[$entryName]
    }
  }
  if (-not $manifestJson.ContainsKey("djeff-rap")) {
    $manifestJson["djeff-rap"] = @{
      persona = "djeff"
      voice = "djeff-rap.wav"
      rvc = "djeff-rap.pth"
      index = "djeff-rap.index"
    }
  }
  $manifestJson | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $personaManifest -Encoding ASCII
  Write-Host "Patched persona manifest: official Funesterie voices."
} catch {
  Write-Host "Persona manifest could not be patched automatically: $($_.Exception.Message)" -ForegroundColor Yellow
}

if (-not $SkipInstall) {
  Write-Step "Creating Python 3.11 virtual environment"
  $pythonExe = Resolve-Python311
  if (-not (Test-Path -LiteralPath $venvPython)) {
    Invoke-Checked $pythonExe -m venv $venvDir
  }

  Write-Step "Installing Python dependencies"
  Invoke-Checked $venvPython -m pip install "pip<24.1" "setuptools<70" wheel
  Invoke-Checked $venvPython -m pip install torch==2.11.0 torchaudio==2.11.0

  $requirements = Join-Path $PSScriptRoot "requirements.xtts-rvc.txt"
  if (-not (Test-Path -LiteralPath $requirements)) {
    $requirements = Join-Path $InstallDir "requirements.txt"
  }
  $patchedRequirements = Join-Path $InstallDir "requirements.funesterie.txt"
  # Python 3.11 lets TTS 0.22.x use modern numpy. Prefer the Funesterie
  # requirements file so upstream Python 3.10 pins cannot fail before overrides.
  Get-Content -LiteralPath $requirements |
    Set-Content -LiteralPath $patchedRequirements -Encoding ASCII
  Invoke-Checked $venvPython -m pip install -r $patchedRequirements
}

Repair-XttsRvcUiApp

$bridgeSource = Join-Path $PSScriptRoot "funesterie_xtts_rvc_api.py"
if (Test-Path -LiteralPath $bridgeSource) {
  Copy-Item -LiteralPath $bridgeSource -Destination (Join-Path $InstallDir "funesterie_xtts_rvc_api.py") -Force
}

Write-Step "Copying known Funesterie voice samples"
$runtimeRoots = @(
  "D:\projets\funesterie\a11\backend\runtime",
  "D:\projets\funesterie\runtime"
)
function Join-ExistingRuntime {
  param([string]$RelativePath)
  foreach ($root in $runtimeRoots) {
    $candidate = Join-Path $root $RelativePath
    if (Test-Path -LiteralPath $candidate) {
      return $candidate
    }
  }
  return $null
}
Copy-VoiceIfPresent -Candidates @(
  (Join-ExistingRuntime "voice-library\a11-official-stern-french.wav"),
  (Join-ExistingRuntime "voice-library\A11 ref.wav")
) -TargetName "a11-official-stern-french.wav"
Copy-VoiceIfPresent -Candidates @(
  (Join-ExistingRuntime "voice-library\kaen44-official-french-narrator.wav"),
  (Join-ExistingRuntime "voice-library\K44 Ref.wav")
) -TargetName "kaen44-official-french-narrator.wav"
Copy-VoiceIfPresent -Candidates @(
  (Join-ExistingRuntime "voice-library\vivy.wav"),
  (Join-ExistingRuntime "sfx\vivy.wav")
) -TargetName "vivy.wav"
Copy-VoiceIfPresent -Candidates @(
  (Join-ExistingRuntime "voice-library\djeff-rap.wav")
) -TargetName "djeff-rap.wav"
foreach ($runtimeRoot in $runtimeRoots) {
  $library = Join-Path $runtimeRoot "voice-library"
  if (Test-Path -LiteralPath $library) {
    Get-ChildItem -LiteralPath $library -File |
      Where-Object { $_.Extension -match '^\.(wav|wave|mp3|ogg|webm|m4a|flac)$' } |
      ForEach-Object {
        Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $voicesDir $_.Name) -Force
      }
  }
}

Write-Host ""
Write-Host "RVC models expected in:" -ForegroundColor Green
Write-Host "  $(Join-Path $InstallDir "rvcs\a11-official-stern-french.pth")"
Write-Host "  $(Join-Path $InstallDir "rvcs\kaen44-official-french-narrator.pth")"
Write-Host "  $(Join-Path $InstallDir "rvcs\vivy.pth")"
Write-Host "  $(Join-Path $InstallDir "rvcs\djeff-rap.pth")"
Write-Host "Optional matching .index files can be placed next to them."
Write-Host "Persona manifest: $personaManifest"
Write-Host ""
Write-Host "A11/compose env to use:" -ForegroundColor Green
Write-Host '  A11_VOICE_CONVERTER_PROVIDER=xtts-rvc,ffmpeg-morph'
Write-Host '  A11_VOICE_XTTS_RVC_URL=http://host.docker.internal:5000'
Write-Host '  A11_VOICE_XTTS_RVC_PROTOCOL=a11'

if ($InstallOnly) {
  Write-Host ""
  Write-Host "InstallOnly requested. XTTS-RVC-UI was not started."
  exit 0
}

Write-Step "Starting Funesterie XTTS/RVC bridge"
$logDir = Join-Path $InstallDir "logs"
$logPath = Join-Path $logDir "xtts-rvc-bridge.log"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$resolvedDevice = Resolve-XttsDevice -Python $venvPython
$envBlock = @"
`$env:A11_XTTS_RVC_DEVICE='$resolvedDevice'
`$env:A11_XTTS_RVC_HOST='127.0.0.1'
`$env:A11_XTTS_RVC_PORT='5000'
`$env:A11_XTTS_RVC_ROOT='$InstallDir'
`$env:TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD='1'
Set-Location -LiteralPath '$InstallDir'
& '$venvPython' funesterie_xtts_rvc_api.py *>> '$logPath'
"@

$windowStyle = if ($Visible) { "Normal" } else { "Hidden" }
Start-Process -FilePath "powershell.exe" -WindowStyle $windowStyle -ArgumentList @(
  "-NoProfile",
  "-ExecutionPolicy",
  "Bypass",
  "-Command",
  $envBlock
)

Write-Host "Funesterie XTTS/RVC bridge starting on http://127.0.0.1:5000 ($resolvedDevice)"
Write-Host "Log: $logPath"
