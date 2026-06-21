param(
  [string]$RepoRoot = "D:\projets\funesterie",
  [string]$Remote = $(if ($env:A11_HETZNER_REMOTE) { $env:A11_HETZNER_REMOTE } else { "deploy@37.27.63.109" }),
  [string]$SshKey = $(if ($env:A11_HETZNER_SSH_KEY) { $env:A11_HETZNER_SSH_KEY } else { "C:\Users\Djeff\.ssh\codex-a11-hetzner-20260602_ed25519" }),
  [switch]$ReuseRemoteSecrets,
  [switch]$BlueGreen,
  [switch]$CleanOldBlueGreen
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RepoRoot = (Resolve-Path -LiteralPath $RepoRoot).Path
$A11Root = Join-Path $RepoRoot "a11"
$ServerRoot = Join-Path $A11Root "backend\apps\server"
$VoiceRoot = Join-Path $A11Root "backend\apps\voice-module"
$VoiceBridgeRoot = Join-Path $A11Root "ops\voice"
$EkkoRoot = Join-Path $A11Root "backend\apps\ekko"
$WebDist = Join-Path $A11Root "frontend\apps\web\dist"
$EnvSource = Join-Path $ServerRoot "profiles\a11.env"
$McpEnvSource = Join-Path $RepoRoot "a11mcp\.env"
$RuntimeVoiceLibrary = Join-Path $RepoRoot "runtime\voice-library"
$RuntimeCorpusRoot = Join-Path $RepoRoot "runtime\Corpus"
$PrivateCorpusRoot = Join-Path $RuntimeCorpusRoot "private"
function Resolve-VoiceReferencePath {
  param(
    [Parameter(Mandatory = $true)][string]$FileName
  )

  $candidates = @(
    (Join-Path $RuntimeVoiceLibrary $FileName),
    (Join-Path (Join-Path $A11Root "runtime\voice-library") $FileName),
    (Join-Path (Join-Path $A11Root "backend\runtime\voice-library") $FileName)
  )
  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate) {
      return $candidate
    }
  }
  return $candidates[0]
}
$A11VoiceReference = Resolve-VoiceReferencePath "a11-official-stern-french.wav"
$VivyVoiceReference = Resolve-VoiceReferencePath "vivy.wav"
$Kaen44VoiceReference = Resolve-VoiceReferencePath "kaen44-official-french-narrator.wav"
$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$TmpRoot = Join-Path $RepoRoot ".codex-tmp"
$StageRoot = Join-Path $TmpRoot "a11-prod-finland-2-$Stamp"
$Archive = Join-Path $TmpRoot "a11-prod-finland-2-$Stamp.tar.gz"
$RemoteRoot = "/home/deploy/a11-prod"
$RemoteDataRoot = "/home/deploy/a11-data"
$RemoteArchive = "$RemoteRoot/releases/$Stamp.tar.gz"
$JfrogEnv = Join-Path $RepoRoot "scripts\jfrog\jfrog.env.ps1"

function Require-Path([string]$Path, [string]$Label) {
  if (-not (Test-Path -LiteralPath $Path)) {
    throw "$Label introuvable: $Path"
  }
}

function Invoke-RobocopyChecked([string]$Source, [string]$Destination, [string[]]$CopyArgs) {
  New-Item -ItemType Directory -Force -Path $Destination | Out-Null
  & robocopy $Source $Destination @CopyArgs | Out-Host
  $code = $LASTEXITCODE
  if ($code -ge 8) {
    throw "Robocopy a echoue avec le code $code pour $Source"
  }
  $global:LASTEXITCODE = 0
}

function New-HexSecret([int]$Length = 32) {
  $buffer = New-Object byte[] $Length
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $rng.GetBytes($buffer)
  } finally {
    if ($rng) { $rng.Dispose() }
  }
  return -join ($buffer | ForEach-Object { ([byte]$_).ToString("x2") })
}

function Remove-StagedSensitiveFiles([string]$Root) {
  if (-not (Test-Path -LiteralPath $Root)) { return }

  $patterns = @(
    ".env",
    ".env.*",
    "*.env",
    "*.env.*",
    "*.pem",
    "*.key",
    "*.pfx",
    "*.p12",
    "client_secret*.json",
    "service-account*.json",
    "*credentials*.json",
    "*token*.json"
  )

  foreach ($pattern in $patterns) {
    Get-ChildItem -LiteralPath $Root -Recurse -Force -File -Filter $pattern -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -notmatch "(?i)(^\.env\.example$|example|sample|template)" } |
      ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue }
  }
}

function Read-EnvMap([string]$Path) {
  $map = [ordered]@{}
  foreach ($line in Get-Content -LiteralPath $Path) {
    if ($line -match '^\s*$' -or $line -match '^\s*#') { continue }
    $idx = $line.IndexOf("=")
    if ($idx -lt 1) { continue }
    $key = $line.Substring(0, $idx).Trim()
    $value = $line.Substring($idx + 1)
    if ($key) { $map[$key] = $value }
  }
  return $map
}

function Write-EnvFile([System.Collections.IDictionary]$Map, [string]$Path) {
  $lines = New-Object System.Collections.Generic.List[string]
  foreach ($key in $Map.Keys) {
    $lines.Add("$key=$($Map[$key])")
  }
  $content = ($lines -join "`n") + "`n"
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $content, $utf8NoBom)
}

function Import-OptionalEnvValue(
  [System.Collections.IDictionary]$Target,
  [System.Collections.IDictionary]$Source,
  [string]$Key
) {
  if (
    $Source.Contains($Key) `
    -and -not [string]::IsNullOrWhiteSpace($Source[$Key]) `
    -and (-not $Target.Contains($Key) -or [string]::IsNullOrWhiteSpace($Target[$Key]))
  ) {
    $Target[$Key] = $Source[$Key]
    Write-Host "Env prod: $Key importe depuis le magasin local." -ForegroundColor DarkCyan
  }
}

function Import-OptionalSecretFile(
  [System.Collections.IDictionary]$Target,
  [string]$Key,
  [string[]]$CandidateFiles
) {
  if ($Target.Contains($Key) -and -not [string]::IsNullOrWhiteSpace($Target[$Key])) {
    return
  }
  foreach ($candidate in $CandidateFiles) {
    if ([string]::IsNullOrWhiteSpace($candidate)) { continue }
    if (-not (Test-Path -LiteralPath $candidate)) { continue }
    $value = (Get-Content -LiteralPath $candidate -Raw).Trim()
    if ([string]::IsNullOrWhiteSpace($value)) { continue }
    $Target[$Key] = $value
    Write-Host "Env prod: secret $Key charge depuis le magasin local." -ForegroundColor DarkCyan
    return
  }
}

function Invoke-SourceUpdate([string]$RepoRoot) {
  $updateScript = Join-Path $RepoRoot "scripts\Update-FunesterieSource.ps1"
  if (-not (Test-Path -LiteralPath $updateScript)) {
    throw "Mise a jour source impossible: helper introuvable $updateScript"
  }

  Write-Host "Mise a jour du depot source avant packaging..." -ForegroundColor Cyan
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $updateScript -RepoRoot $RepoRoot | Out-Host
  if ($LASTEXITCODE -ne 0) {
    throw "Mise a jour source echouee avec le code $LASTEXITCODE"
  }
}

function Invoke-FrontendBuild([string]$A11Root) {
  $webApp = Join-Path $A11Root "frontend\apps\web"
  Require-Path (Join-Path $webApp "package.json") "Package frontend"

  Write-Host "Build frontend web avant packaging..." -ForegroundColor Cyan
  & npm --prefix $webApp run build | Out-Host
  if ($LASTEXITCODE -ne 0) {
    throw "Build frontend web echoue avec le code $LASTEXITCODE"
  }
}

function Assert-FunesterieWebBundle([string]$DistRoot, [string]$Label) {
  Require-Path $DistRoot $Label
  $assetsRoot = Join-Path $DistRoot "assets"
  Require-Path $assetsRoot "$Label assets"

  $bundle = Get-ChildItem -LiteralPath $assetsRoot -Filter "index-*.js" -File -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
  if (-not $bundle) {
    throw "$Label invalide: aucun bundle index-*.js dans $assetsRoot"
  }

  $content = Get-Content -LiteralPath $bundle.FullName -Raw
  $requiredMarkers = @(
    "a11-menu-voice-tools",
    "a11-menu-voice-current"
  )
  foreach ($marker in $requiredMarkers) {
    if ($content -notlike "*$marker*") {
      throw "ancienne UI detectee dans $($bundle.Name): marqueur requis absent '$marker'"
    }
  }
  if ($content -like "*a11-voice-tools*") {
    throw "ancienne UI detectee dans $($bundle.Name): vieux composer Ref/A encore present"
  }

  Write-Host "Bundle web valide: $($bundle.Name) (garde anti ancienne UI OK)." -ForegroundColor Green
}

Require-Path $RepoRoot "Repo"
Invoke-SourceUpdate $RepoRoot
$BuildCommit = (& git -C $RepoRoot rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($BuildCommit)) {
  throw "Lecture du commit Git impossible"
}
$BuildBranch = (& git -C $RepoRoot rev-parse --abbrev-ref HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($BuildBranch)) {
  $BuildBranch = "unknown"
}
$BuildDateIso = (Get-Date).ToUniversalTime().ToString("o")
Require-Path $ServerRoot "Backend A11"
Require-Path $VoiceRoot "Module voix"
Require-Path $VoiceBridgeRoot "Pont voix XTTS/RVC"
Require-Path $EkkoRoot "Module Ekko"
Invoke-FrontendBuild $A11Root
Require-Path $WebDist "Frontend dist"
Assert-FunesterieWebBundle $WebDist "Frontend dist"
if (-not $ReuseRemoteSecrets) {
  Require-Path $EnvSource "Env prod source"
} else {
  Write-Host "Mode release sans copie de secrets: reutilisation de $RemoteRoot/secrets/compose.env." -ForegroundColor DarkCyan
}
Require-Path $SshKey "Cle SSH"

$sshBase = @("-i", $SshKey, "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=accept-new")

$ActiveBlueGreenColor = "none"
$DeployBlueGreenColor = "blue"
if ($BlueGreen) {
  $remoteColorProbe = @"
set -e
if [ -s $RemoteRoot/bluegreen/active-color ]; then
  cat $RemoteRoot/bluegreen/active-color
elif docker ps -a --format '{{.Names}}' | grep -qx 'a11-backend-blue'; then
  echo blue
elif docker ps -a --format '{{.Names}}' | grep -qx 'a11-backend-green'; then
  echo green
else
  echo none
fi
"@
  $remoteColorProbeEncoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($remoteColorProbe.Replace("`r`n", "`n").Replace("`r", "`n")))
  $remoteColor = & ssh @sshBase $Remote "printf '%s' '$remoteColorProbeEncoded' | base64 -d | bash" 2>$null
  $probeCode = $LASTEXITCODE
  $global:LASTEXITCODE = 0
  if ($probeCode -ne 0) {
    throw "Lecture couleur blue/green distante echouee"
  }
  $ActiveBlueGreenColor = (($remoteColor | Select-Object -First 1).ToString().Trim().ToLowerInvariant())
  if ($ActiveBlueGreenColor -eq "blue") {
    $DeployBlueGreenColor = "green"
  } elseif ($ActiveBlueGreenColor -eq "green") {
    $DeployBlueGreenColor = "blue"
  } else {
    $ActiveBlueGreenColor = "none"
    $DeployBlueGreenColor = "blue"
  }
  Write-Host "Mode blue/green: actif=$ActiveBlueGreenColor, prochain=$DeployBlueGreenColor." -ForegroundColor Cyan
}

function Read-RemoteEnvValue([string]$Key) {
  if ($Key -notmatch '^[A-Z0-9_]+$') {
    throw "Nom de variable env distant invalide"
  }
  $remoteRead = @'
key='__KEY__'
secret_file='__REMOTE_ROOT__/secrets/a11.env'
active_color="$(cat '__REMOTE_ROOT__/bluegreen/active-color' 2>/dev/null || true)"
case "$active_color" in
  blue|green)
    containers="a11-backend-${active_color} kaen44-backend-${active_color}"
    ;;
  *)
    containers="a11-backend kaen44-backend"
    ;;
esac
for container in $containers; do
  if ! docker inspect "$container" >/dev/null 2>&1; then
    continue
  fi
  value="$(docker inspect "$container" --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null | grep -m1 "^${key}=" | sed 's/^[^=]*=//' || true)"
  if [ -n "$value" ]; then
    printf '%s\n' "$value"
    exit 0
  fi
done
if [ -r "$secret_file" ]; then
  value="$(grep -m1 "^${key}=" "$secret_file" 2>/dev/null | sed 's/^[^=]*=//' || true)"
  if [ -n "$value" ]; then
    printf '%s\n' "$value"
    exit 0
  fi
fi
exit 44
'@
  $remoteRead = $remoteRead.Replace('__KEY__', $Key).Replace('__REMOTE_ROOT__', $RemoteRoot)
  $remoteReadEncoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($remoteRead.Replace("`r`n", "`n").Replace("`r", "`n")))
  $value = & ssh @sshBase $Remote "printf '%s' '$remoteReadEncoded' | base64 -d | bash" 2>$null
  $code = $LASTEXITCODE
  $global:LASTEXITCODE = 0
  if ($code -eq 44) { return $null }
  if ($code -ne 0) { throw "Lecture env distant echouee pour $Key" }
  if (-not $value) { return $null }
  return (($value | Select-Object -First 1).ToString().Trim())
}

$useJfrogNpm = [string]$env:A11_DEPLOY_USE_JFROG_NPM
if ($useJfrogNpm.Trim().ToLowerInvariant() -eq "true" -and (Test-Path -LiteralPath $JfrogEnv)) {
  . $JfrogEnv
}
if (-not (Get-Command tar.exe -ErrorAction SilentlyContinue)) {
  throw "tar.exe introuvable"
}

New-Item -ItemType Directory -Force -Path $TmpRoot | Out-Null
if (Test-Path -LiteralPath $StageRoot) {
  Remove-Item -LiteralPath $StageRoot -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $StageRoot | Out-Null

$ServerStage = Join-Path $StageRoot "server"
$VoiceStage = Join-Path $StageRoot "voice-module"
$VoiceBridgeStage = Join-Path $StageRoot "xtts-rvc-bridge"
$EkkoStage = Join-Path $StageRoot "ekko"
$WebStage = Join-Path $StageRoot "web\dist"
$BlueGreenSuffix = if ($BlueGreen) { "-$DeployBlueGreenColor" } else { "" }
$A11BackendService = "a11-backend$BlueGreenSuffix"
$Kaen44BackendService = "kaen44-backend$BlueGreenSuffix"

$serverExDirs = @(
  "node_modules", ".git", "logs", "runtime", "tmp", ".qflush", "test-results",
  "coverage", ".nyc_output", ".vite", "dist", "build", "cache", ".cache", "profiles",
  "venv", ".venv", "__pycache__", "models", "model", "checkpoints", "checkpoint",
  "outputs", "output", "downloads", "download", "datasets", "dataset", "hf-cache",
  ".huggingface", ".torch", "wandb", "assets-cache", "media-cache"
)
$serverExFiles = @(
  ".env", ".env.*", "*.env", "*.env.*", "a11.env", "kaen44.env",
  "*.pem", "*.key", "*.p12", "*.bak", "*.log", "*.sqlite", "*.db",
  "tasks.json",
  "*.zip", "*.7z", "*.rar", "*.tar", "*.gz", "*.tgz",
  "*.mp4", "*.mov", "*.mkv", "*.avi", "*.webm",
  "*.wav", "*.flac", "*.mp3", "*.ogg",
  "*.iso", "*.img", "*.vhd", "*.vhdx",
  "*.safetensors", "*.ckpt", "*.pt", "*.pth", "*.onnx", "*.gguf"
)
$voiceExDirs = @(
  "venv", ".venv", "__pycache__", "node_modules", ".git", "logs", "runtime", "tmp",
  "dist", "build", "models", "model", "checkpoints", "checkpoint", "outputs", "output",
  "downloads", "download", "datasets", "dataset", "hf-cache", ".huggingface", ".torch",
  "wandb", "assets-cache", "media-cache"
)

$voiceExFiles = $serverExFiles
$ekkoExDirs = @(
  "venv", ".venv", "__pycache__", ".pytest_cache", ".git", "logs", "runtime", "tmp",
  "models", "model", "checkpoints", "checkpoint", "outputs", "output", "downloads",
  "download", "datasets", "dataset", "hf-cache", ".huggingface", ".torch"
)
$ekkoExFiles = @(
  ".env", ".env.*", "*.env", "*.env.*", "*.pyc", "*.pyo", "*.log",
  "*.wav", "*.flac", "*.mp3", "*.ogg", "*.mp4", "*.mov", "*.mkv", "*.avi", "*.webm",
  "*.safetensors", "*.ckpt", "*.pt", "*.pth", "*.onnx", "*.gguf"
)

$serverCopyArgs = @("/MIR", "/XD") + $serverExDirs + @("/XF") + $serverExFiles
$voiceCopyArgs = @("/MIR", "/XD") + $voiceExDirs + @("/XF") + $voiceExFiles
$ekkoCopyArgs = @("/MIR", "/XD") + $ekkoExDirs + @("/XF") + $ekkoExFiles
Invoke-RobocopyChecked $ServerRoot $ServerStage $serverCopyArgs
Invoke-RobocopyChecked $VoiceRoot $VoiceStage $voiceCopyArgs
Invoke-RobocopyChecked $VoiceBridgeRoot $VoiceBridgeStage @(
  "/MIR",
  "/XD", ".git", ".venv", "venv", "__pycache__", "models", "model", "rvcs", "voices", "outputs", "logs", "tmp",
  "/XF", ".env", ".env.*", "*.env", "*.env.*", "*.wav", "*.mp3", "*.flac", "*.ogg", "*.pth", "*.pt", "*.onnx", "*.index", "*.log"
)
Invoke-RobocopyChecked $EkkoRoot $EkkoStage $ekkoCopyArgs
Invoke-RobocopyChecked $WebDist $WebStage @("/MIR")
Remove-StagedSensitiveFiles $ServerStage
Remove-StagedSensitiveFiles $VoiceStage
Remove-StagedSensitiveFiles $VoiceBridgeStage
Remove-StagedSensitiveFiles $EkkoStage
Remove-StagedSensitiveFiles $WebStage
Assert-FunesterieWebBundle $WebStage "Stage web"

$compose = @'
services:
  a11-postgres:
    image: postgres:16-alpine
    container_name: a11-postgres
    restart: unless-stopped
    environment:
      POSTGRES_DB: ${POSTGRES_DB:-a11}
      POSTGRES_USER: ${POSTGRES_USER:-a11}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}
    volumes:
      - /srv/a11-data/a11/postgres:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-a11} -d ${POSTGRES_DB:-a11}"]
      interval: 10s
      timeout: 5s
      retries: 10

  a11-redis:
    image: redis:7-alpine
    container_name: a11-redis
    restart: unless-stopped
    command: ["redis-server", "--appendonly", "yes"]
    volumes:
      - /srv/a11-data/a11/redis:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 10

  a11-stt-whisper:
    image: hwdsl2/whisper-server:latest
    container_name: a11-stt-whisper
    restart: unless-stopped
    environment:
      WHISPER_MODEL: ${A11_STT_LOCAL_MODEL:-base}
      WHISPER_LANGUAGE: ${A11_STT_LANGUAGE:-fr}
      WHISPER_DEVICE: ${A11_STT_FAST_WHISPER_DEVICE:-cpu}
      WHISPER_COMPUTE_TYPE: ${A11_STT_FAST_WHISPER_COMPUTE_TYPE:-int8}
      WHISPER_THREADS: ${A11_STT_FAST_WHISPER_THREADS:-4}
    volumes:
      - /srv/a11-data/a11/stt/whisper:/var/lib/whisper
    expose:
      - "9000"
    healthcheck:
      test: ["CMD-SHELL", "python -c \"import urllib.request; urllib.request.urlopen('http://127.0.0.1:9000/health', timeout=5).read()\""]
      interval: 30s
      timeout: 10s
      start_period: 90s
      retries: 10

  a11-xtts-rvc:
    build:
      context: ../xtts-rvc-bridge
      dockerfile: Dockerfile.xtts-rvc
    container_name: a11-xtts-rvc
    restart: unless-stopped
    environment:
      A11_XTTS_RVC_ROOT: /app
      A11_XTTS_RVC_HOST: 0.0.0.0
      A11_XTTS_RVC_PORT: "5000"
      A11_XTTS_RVC_DEVICE: ${A11_XTTS_RVC_DEVICE:-cpu}
      A11_XTTS_RVC_LANGUAGE: ${A11_VOICE_XTTS_RVC_LANGUAGE:-fr}
      A11_XTTS_RVC_TORCH_THREADS: ${A11_XTTS_RVC_TORCH_THREADS:-2}
    volumes:
      - /srv/a11-data/a11/xtts-rvc/models:/app/models
      - /srv/a11-data/a11/xtts-rvc/rvcs:/app/rvcs
      - /srv/a11-data/a11/runtime/voice-library:/app/voices:ro
      - /srv/a11-data/a11/xtts-rvc/outputs:/app/outputs
    expose:
      - "5000"
    healthcheck:
      test: ["CMD-SHELL", "python -c \"import urllib.request; urllib.request.urlopen('http://127.0.0.1:5000/health', timeout=5).read()\""]
      interval: 30s
      timeout: 10s
      start_period: 60s
      retries: 5

  a11-voice:
    build:
      context: ../voice-module
    container_name: a11-voice
    restart: unless-stopped
    environment:
      PORT: 5002
      A11_VOICE_OUT_DIR: /app/out
      A11_VOICE_CONVERTER_PROVIDER: ${A11_VOICE_CONVERTER_PROVIDER:-xtts-rvc,ffmpeg-morph}
      A11_VOICE_XTTS_RVC_URL: ${A11_VOICE_XTTS_RVC_URL:-http://a11-xtts-rvc:5000}
      A11_VOICE_XTTS_RVC_PROTOCOL: ${A11_VOICE_XTTS_RVC_PROTOCOL:-a11}
      A11_VOICE_XTTS_RVC_LANGUAGE: ${A11_VOICE_XTTS_RVC_LANGUAGE:-fr}
      A11_VOICE_XTTS_RVC_TIMEOUT_SECONDS: ${A11_VOICE_XTTS_RVC_TIMEOUT_SECONDS:-240}
      A11_VOICE_XTTS_RVC_FALLBACK: ${A11_VOICE_XTTS_RVC_FALLBACK:-false}
      A11_RUNTIME_ROOT: /app/runtime
      A11_VOICE_REFERENCE_LIBRARY_DIR: /app/voices
      A11_VOICE_REFERENCE_LIBRARY_DIRS: /app/voices
      A11_PIPER_MODEL_DIRS: /app/extra-models;/app/models
    volumes:
      - /srv/a11-data/a11/voice-out:/app/out
      - /srv/a11-data/a11/runtime:/app/runtime:ro
      - /srv/a11-data/a11/runtime/voice-library:/app/voices:ro
      - /srv/a11-data/a11/tts:/app/extra-models:ro
    depends_on:
      a11-xtts-rvc:
        condition: service_healthy
    expose:
      - "5002"

  a11-ekko:
    build:
      context: ../ekko
    container_name: a11-ekko
    restart: unless-stopped
    command: ["python", "main.py", "--config", "ekko.config.prod.json", "--host", "0.0.0.0", "--port", "5012"]
    env_file:
      - /srv/a11/secrets/a11.env
    environment:
      EKKO_TOKEN: ${EKKO_TOKEN:?EKKO_TOKEN is required}
      EKKO_IVY_ENDPOINT: http://a11-backend:3000/api/ekko/ingest
      EKKO_SERVER_HOST: 0.0.0.0
      EKKO_SERVER_PORT: "5012"
    expose:
      - "5012"
    healthcheck:
      test: ["CMD-SHELL", "python -c \"import urllib.request; urllib.request.urlopen('http://127.0.0.1:5012/health', timeout=3).read()\""]
      interval: 30s
      timeout: 5s
      start_period: 20s
      retries: 5

  a11-backend:
    build:
      context: .
      args:
        JFROG_NPM_AUTH_TOKEN: ${JFROG_NPM_AUTH_TOKEN:-}
        JFROG_NPM_REGISTRY: ${JFROG_NPM_REGISTRY:-https://trialhnuk69.jfrog.io/artifactory/api/npm/funesterie-npm/}
        A11_INSTALL_JANUS: ${A11_INSTALL_JANUS:-1}
        A11_JANUS_TORCH_INDEX_URL: ${A11_JANUS_TORCH_INDEX_URL:-https://download.pytorch.org/whl/cpu}
        A11_JANUS_TORCH_PACKAGES: ${A11_JANUS_TORCH_PACKAGES:-torch torchvision torchaudio}
    container_name: a11-backend
    restart: unless-stopped
    command: ["npm", "run", "start:a11"]
    env_file:
      - /srv/a11/secrets/compose.env
    environment:
      A11_WEB_DIST_DIR: /web/dist
      TTS_URL: ${TTS_URL:-http://a11-voice:5002}
      VOICE_MODULE_URL: ${VOICE_MODULE_URL:-http://a11-voice:5002}
      A11_VOICE_MODULE_URL: ${A11_VOICE_MODULE_URL:-http://a11-voice:5002}
      ENABLE_PIPER_HTTP: ${ENABLE_PIPER_HTTP:-true}
      A11_TTS_ALLOW_XTTS_RVC_AUTO: ${A11_TTS_ALLOW_XTTS_RVC_AUTO:-true}
      A11_VOICE_CONVERSION_ENABLED: ${A11_VOICE_CONVERSION_ENABLED:-true}
      A11_VOICE_XTTS_RVC_URL: ${A11_VOICE_XTTS_RVC_URL:-http://a11-xtts-rvc:5000}
      A11_PROFILE_ENV: /app/profiles/a11.prod.env.disabled
      A11_RUNTIME_ROOT: /app/runtime
      A11_LLM_PROVIDER: groq
      A11_OLLAMA_PRIMARY_MODEL: llama3.2:3b
      A11_OLLAMA_FALLBACK_MODEL: llama3.2:3b
      A11_TRANSLATION_MODEL: llama3.2:3b
      LOCAL_DEFAULT_MODEL: llama3.2:3b
      A11_LLM_FALLBACK_PROVIDER: ollama
      A11_LLM_RUNTIME_FALLBACK_ORDER: ollama,openai,gemini,xai,huggingface,deepseek,together
      A11_CERBERE_LOCAL_ONLY: "false"
      A11_LOCAL_CHAT_TIMEOUT_MS: "45000"
      A11_VIDEO_PROMPT_GROQ_ENABLED: ${A11_VIDEO_PROMPT_GROQ_ENABLED:-1}
      A11_VIDEO_PROMPT_BUILDER_LLM: ${A11_VIDEO_PROMPT_BUILDER_LLM:-1}
      A11_OLLAMA_KEEP_ALIVE: "30m"
      A11_MEMORY_LOCAL_TIMEOUT_MS: "3500"
      A11_MEMORY_REMOTE_TIMEOUT_MS: "5000"
      A11_EMBEDDING_TIMEOUT_MS: "2500"
      A11_VISION_PROVIDER: janus
      A11_JANUS_ENABLED: "true"
      A11_JANUS_PYTHON_PATH: /opt/janus-venv/bin/python
      A11_JANUS_MODEL_ID: deepseek-ai/Janus-Pro-1B
      A11_JANUS_DEVICE: ${A11_JANUS_DEVICE:-cpu}
      A11_JANUS_TORCH_DTYPE: ${A11_JANUS_TORCH_DTYPE:-auto}
      A11_JANUS_PREFER_LATEST: ${A11_JANUS_PREFER_LATEST:-false}
      A11_JANUS_TIMEOUT_MS: ${A11_JANUS_TIMEOUT_MS:-180000}
      JWT_SECRET: ${JWT_SECRET:?JWT_SECRET is required}
      OAUTH_JWT_SECRET: ${JWT_SECRET:?JWT_SECRET is required}
      R2_ENDPOINT: ${R2_ENDPOINT:-}
      R2_BUCKET: ${R2_BUCKET:-}
      R2_BUCKET_NAME: ${R2_BUCKET_NAME:-}
      R2_BUCKET_ID: ${R2_BUCKET_ID:-}
      R2_PUBLIC_BASE_URL: ${R2_PUBLIC_BASE_URL:-}
      A11_R2_PUBLIC_BASE_URL: ${A11_R2_PUBLIC_BASE_URL:-}
      R2_PUBLIC_URL: ${R2_PUBLIC_URL:-}
      R2_ACCESS_KEY: ${R2_ACCESS_KEY:-}
      R2_ACCESS_KEY_ID: ${R2_ACCESS_KEY_ID:-}
      R2_SECRET_KEY: ${R2_SECRET_KEY:-}
      R2_SECRET_ACCESS_KEY: ${R2_SECRET_ACCESS_KEY:-}
      A11_TTS_LOCAL_GPU_WORKER_ENABLED: ${A11_TTS_LOCAL_GPU_WORKER_ENABLED:-false}
      A11_LOCAL_GPU_WORKER_TOKEN_FILE: ${A11_LOCAL_GPU_WORKER_TOKEN_FILE:-/app/runtime/secrets/local_gpu_worker_token}
      A11_LOCAL_GPU_WORKER_FALLBACK_MS: ${A11_LOCAL_GPU_WORKER_FALLBACK_MS:-45000}
      A11_LOCAL_GPU_WORKER_LEASE_MS: ${A11_LOCAL_GPU_WORKER_LEASE_MS:-360000}
      A11_LOCAL_GPU_WORKER_MAX_ACTIVE: ${A11_LOCAL_GPU_WORKER_MAX_ACTIVE:-1}
      A11_LOCAL_GPU_WORKER_MAX_LEASE_EXPIRIES: ${A11_LOCAL_GPU_WORKER_MAX_LEASE_EXPIRIES:-1}
      A11_TTS_ASYNC_QUEUE_MAX: ${A11_TTS_ASYNC_QUEUE_MAX:-50}
      A11_MATCH_ARENA_ENABLED: ${A11_MATCH_ARENA_ENABLED:-true}
      A11_MATCH_ARENA_WORKER_TOKEN_FILE: ${A11_MATCH_ARENA_WORKER_TOKEN_FILE:-/app/runtime/secrets/match_arena_worker_token}
      A11_VIDEO_PROXY_URL: ${A11_VIDEO_PROXY_URL:-}
      A11_VIDEO_PROXY_TOKEN: ${A11_VIDEO_PROXY_TOKEN:-}
      A11_VIDEO_PROXY_PUBLIC_FILE_BASE_URL: ${A11_VIDEO_PROXY_PUBLIC_FILE_BASE_URL:-}
      A11_VIDEO_PROXY_TIMEOUT_MS: ${A11_VIDEO_PROXY_TIMEOUT_MS:-600000}
    depends_on:
      a11-postgres:
        condition: service_healthy
      a11-redis:
        condition: service_healthy
      a11-stt-whisper:
        condition: service_healthy
      a11-voice:
        condition: service_started
    volumes:
      - /srv/a11-data/a11/logs:/app/logs
      - /srv/a11-data/a11/runtime:/app/runtime
      - /srv/a11-data/a11/uploads:/app/runtime/files/uploads
      - /home/deploy/a11-data/tts:/data/tts:ro
      - /srv/a11/current/web/dist:/web/dist:ro
    expose:
      - "3000"
    healthcheck:
      test: ["CMD-SHELL", "curl -fsS http://localhost:3000/health || exit 1"]
      interval: 30s
      timeout: 10s
      start_period: 60s
      retries: 5

  kaen44-backend:
    build:
      context: .
      args:
        JFROG_NPM_AUTH_TOKEN: ${JFROG_NPM_AUTH_TOKEN:-}
        JFROG_NPM_REGISTRY: ${JFROG_NPM_REGISTRY:-https://trialhnuk69.jfrog.io/artifactory/api/npm/funesterie-npm/}
        A11_INSTALL_JANUS: ${A11_INSTALL_JANUS:-1}
        A11_JANUS_TORCH_INDEX_URL: ${A11_JANUS_TORCH_INDEX_URL:-https://download.pytorch.org/whl/cpu}
        A11_JANUS_TORCH_PACKAGES: ${A11_JANUS_TORCH_PACKAGES:-torch torchvision torchaudio}
    container_name: kaen44-backend
    restart: unless-stopped
    command: ["npm", "run", "start:kaen44"]
    env_file:
      - /srv/a11/secrets/compose.env
    environment:
      PORT: "3001"
      A11_WEB_DIST_DIR: /web/dist
      TTS_URL: ${TTS_URL:-http://a11-voice:5002}
      VOICE_MODULE_URL: ${VOICE_MODULE_URL:-http://a11-voice:5002}
      A11_VOICE_MODULE_URL: ${A11_VOICE_MODULE_URL:-http://a11-voice:5002}
      ENABLE_PIPER_HTTP: ${ENABLE_PIPER_HTTP:-true}
      A11_TTS_ALLOW_XTTS_RVC_AUTO: ${A11_TTS_ALLOW_XTTS_RVC_AUTO:-true}
      A11_VOICE_CONVERSION_ENABLED: ${A11_VOICE_CONVERSION_ENABLED:-true}
      A11_VOICE_XTTS_RVC_URL: ${A11_VOICE_XTTS_RVC_URL:-http://a11-xtts-rvc:5000}
      A11_PROFILE_ENV: /app/profiles/kaen44.prod.env.disabled
      KAEN44_PROFILE_ENV: /app/profiles/kaen44.prod.env.disabled
      A11_RUNTIME_ROOT: /app/runtime
      A11_LLM_PROVIDER: groq
      A11_OLLAMA_PRIMARY_MODEL: llama3.2:3b
      A11_OLLAMA_FALLBACK_MODEL: llama3.2:3b
      A11_TRANSLATION_MODEL: llama3.2:3b
      LOCAL_DEFAULT_MODEL: llama3.2:3b
      A11_LLM_FALLBACK_PROVIDER: ollama
      A11_LLM_RUNTIME_FALLBACK_ORDER: ollama,openai,gemini,xai,huggingface,deepseek,together
      A11_CERBERE_LOCAL_ONLY: "false"
      A11_LOCAL_CHAT_TIMEOUT_MS: "45000"
      A11_VIDEO_PROMPT_GROQ_ENABLED: ${A11_VIDEO_PROMPT_GROQ_ENABLED:-1}
      A11_VIDEO_PROMPT_BUILDER_LLM: ${A11_VIDEO_PROMPT_BUILDER_LLM:-1}
      A11_OLLAMA_KEEP_ALIVE: "30m"
      A11_MEMORY_LOCAL_TIMEOUT_MS: "3500"
      A11_MEMORY_REMOTE_TIMEOUT_MS: "5000"
      A11_EMBEDDING_TIMEOUT_MS: "2500"
      A11_VISION_PROVIDER: janus
      A11_JANUS_ENABLED: "true"
      A11_JANUS_PYTHON_PATH: /opt/janus-venv/bin/python
      A11_JANUS_MODEL_ID: deepseek-ai/Janus-Pro-1B
      A11_JANUS_DEVICE: ${A11_JANUS_DEVICE:-cpu}
      A11_JANUS_TORCH_DTYPE: ${A11_JANUS_TORCH_DTYPE:-auto}
      A11_JANUS_PREFER_LATEST: ${A11_JANUS_PREFER_LATEST:-false}
      A11_JANUS_TIMEOUT_MS: ${A11_JANUS_TIMEOUT_MS:-180000}
      JWT_SECRET: ${JWT_SECRET:?JWT_SECRET is required}
      OAUTH_JWT_SECRET: ${JWT_SECRET:?JWT_SECRET is required}
      R2_ENDPOINT: ${R2_ENDPOINT:-}
      R2_BUCKET: ${R2_BUCKET:-}
      R2_BUCKET_NAME: ${R2_BUCKET_NAME:-}
      R2_BUCKET_ID: ${R2_BUCKET_ID:-}
      R2_PUBLIC_BASE_URL: ${R2_PUBLIC_BASE_URL:-}
      A11_R2_PUBLIC_BASE_URL: ${A11_R2_PUBLIC_BASE_URL:-}
      R2_PUBLIC_URL: ${R2_PUBLIC_URL:-}
      R2_ACCESS_KEY: ${R2_ACCESS_KEY:-}
      R2_ACCESS_KEY_ID: ${R2_ACCESS_KEY_ID:-}
      R2_SECRET_KEY: ${R2_SECRET_KEY:-}
      R2_SECRET_ACCESS_KEY: ${R2_SECRET_ACCESS_KEY:-}
      A11_TTS_LOCAL_GPU_WORKER_ENABLED: ${A11_TTS_LOCAL_GPU_WORKER_ENABLED:-false}
      A11_LOCAL_GPU_WORKER_TOKEN_FILE: ${A11_LOCAL_GPU_WORKER_TOKEN_FILE:-/app/runtime/secrets/local_gpu_worker_token}
      A11_LOCAL_GPU_WORKER_FALLBACK_MS: ${A11_LOCAL_GPU_WORKER_FALLBACK_MS:-45000}
      A11_LOCAL_GPU_WORKER_LEASE_MS: ${A11_LOCAL_GPU_WORKER_LEASE_MS:-360000}
      A11_LOCAL_GPU_WORKER_MAX_ACTIVE: ${A11_LOCAL_GPU_WORKER_MAX_ACTIVE:-1}
      A11_LOCAL_GPU_WORKER_MAX_LEASE_EXPIRIES: ${A11_LOCAL_GPU_WORKER_MAX_LEASE_EXPIRIES:-1}
      A11_TTS_ASYNC_QUEUE_MAX: ${A11_TTS_ASYNC_QUEUE_MAX:-50}
      A11_MATCH_ARENA_ENABLED: ${A11_MATCH_ARENA_ENABLED:-true}
      A11_MATCH_ARENA_WORKER_TOKEN_FILE: ${A11_MATCH_ARENA_WORKER_TOKEN_FILE:-/app/runtime/secrets/match_arena_worker_token}
      A11_VIDEO_PROXY_URL: ${A11_VIDEO_PROXY_URL:-}
      A11_VIDEO_PROXY_TOKEN: ${A11_VIDEO_PROXY_TOKEN:-}
      A11_VIDEO_PROXY_PUBLIC_FILE_BASE_URL: ${A11_VIDEO_PROXY_PUBLIC_FILE_BASE_URL:-}
      A11_VIDEO_PROXY_TIMEOUT_MS: ${A11_VIDEO_PROXY_TIMEOUT_MS:-600000}
      A11_PRODUCT: kaen44
      A11_INSTANCE_NAME: Kaen44
      A11_RUNTIME_PROFILE: kaen44
      A11_PUBLIC_HOST: k44.funesterie.me
      A11_SD_PROXY_URL: http://a11-backend:3000/api/tools/generate_sd
      A11_SD_PUBLIC_FILE_BASE_URL: https://a11.funesterie.me/files
      PUBLIC_APP_URL: https://k44.funesterie.me
      FRONT_URL: https://k44.funesterie.me
      APP_URL: https://k44.funesterie.me
      API_URL: https://k44.funesterie.me
      PUBLIC_API_URL: https://k44.funesterie.me
      GOOGLE_CALLBACK_URL: https://funesterie.me/api/auth/google/callback
      A11_GOOGLE_CALLBACK_URL: https://funesterie.me/api/auth/google/callback
      SERVE_STATIC: "true"
      KAEN44_MODE: "1"
      A11_ALLOW_DEV_ROUTES: "false"
      A11_ENABLE_LEGACY_WORD_INTENT_DETECTORS: "false"
      A11_RESPONDER_MODE: "off"
    depends_on:
      a11-postgres:
        condition: service_healthy
      a11-redis:
        condition: service_healthy
      a11-stt-whisper:
        condition: service_healthy
      a11-voice:
        condition: service_started
    volumes:
      - /srv/a11-data/a11/kaen44-logs:/app/logs
      - /srv/a11-data/a11/runtime:/app/runtime
      - /srv/a11-data/a11/uploads:/app/runtime/files/uploads
      - /home/deploy/a11-data/tts:/data/tts:ro
      - /srv/a11/current/web/dist:/web/dist:ro
    expose:
      - "3001"
    healthcheck:
      test: ["CMD-SHELL", "curl -fsS http://localhost:3001/health || exit 1"]
      interval: 30s
      timeout: 10s
      start_period: 60s
      retries: 5

  a11-caddy:
    image: caddy:2-alpine
    container_name: a11-caddy
    restart: unless-stopped
    depends_on:
      - a11-backend
      - kaen44-backend
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - /srv/a11/current/Caddyfile:/etc/caddy/Caddyfile:ro
      - /srv/a11-data/a11/caddy-data:/data
      - /srv/a11-data/a11/caddy-config:/config
'@
$buildInfoComposeEnv = "      A11_BUILD_COMMIT: `"$BuildCommit`"`n      A11_BUILD_BRANCH: `"$BuildBranch`"`n      A11_BUILD_DATE: `"$BuildDateIso`"`n"
$compose = $compose.Replace("      A11_WEB_DIST_DIR: /web/dist", $buildInfoComposeEnv + "      A11_WEB_DIST_DIR: /web/dist")
if ($BlueGreen) {
  $compose = $compose.Replace("  a11-backend:`r`n", "  ${A11BackendService}:`r`n")
  $compose = $compose.Replace("  a11-backend:`n", "  ${A11BackendService}:`n")
  $compose = $compose.Replace("  kaen44-backend:`r`n", "  ${Kaen44BackendService}:`r`n")
  $compose = $compose.Replace("  kaen44-backend:`n", "  ${Kaen44BackendService}:`n")
  $compose = $compose.Replace("container_name: a11-backend", "container_name: $A11BackendService")
  $compose = $compose.Replace("container_name: kaen44-backend", "container_name: $Kaen44BackendService")
  $compose = $compose.Replace("http://a11-backend:3000", "http://${A11BackendService}:3000")
  $compose = $compose.Replace("http://kaen44-backend:3001", "http://${Kaen44BackendService}:3001")
  $compose = $compose.Replace("      - a11-backend", "      - $A11BackendService")
  $compose = $compose.Replace("      - kaen44-backend", "      - $Kaen44BackendService")
}
$compose = $compose.Replace("/srv/a11-data/a11", $RemoteDataRoot)
$compose = $compose.Replace("/srv/a11", $RemoteRoot)
Set-Content -LiteralPath (Join-Path $ServerStage "docker-compose.prod.yml") -Value $compose -Encoding UTF8

$caddyA11BackendService = $A11BackendService
$caddyKaen44BackendService = $Kaen44BackendService
$caddy = @"
(a11_backend) {
  reverse_proxy ${caddyA11BackendService}:3000 {
    header_up Host {host}
    header_up X-Forwarded-Host {host}
    header_up X-Forwarded-Proto https
    lb_try_duration 45s
    lb_try_interval 250ms
  }
}

(kaen44_backend) {
  reverse_proxy ${caddyKaen44BackendService}:3001 {
    header_up Host {host}
    header_up X-Forwarded-Host {host}
    header_up X-Forwarded-Proto https
    lb_try_duration 45s
    lb_try_interval 250ms
  }
}

(microsoft_identity_association) {
  @microsoftIdentity path /.well-known/microsoft-identity-association.json
  handle @microsoftIdentity {
    header Content-Type application/json
    respond "{\"associatedApplications\":[{\"applicationId\":\"fe326a74-f7bd-46c4-95bb-d0f448eb6c42\"}]}" 200
  }
}

http://funesterie.me, http://www.funesterie.me, http://k44.funesterie.me, http://kaen44.funesterie.me, http://kaen44-hetzner-test.funesterie.me, http://vivy.funesterie.me, http://music.funesterie.me {
  encode zstd gzip
  import microsoft_identity_association
  @a11Path path /a11 /a11/* /api/admin/* /api/tools/run /api/runtime* /api/qflush/* /api/stt/* /api/ekko /api/ekko/* /api/double-harmonic /api/double-harmonic/*
  @a11PaymentApi path /api/paypal /api/paypal/* /api/subscription /api/subscription/* /subscription/success /subscription/cancel
  handle @a11Path {
    import a11_backend
  }
  handle @a11PaymentApi {
    import a11_backend
  }
  handle {
    import kaen44_backend
  }
}

http://a11.funesterie.me, http://api.funesterie.me, http://cp.funesterie.me {
  encode zstd gzip
  import microsoft_identity_association
  import a11_backend
}

:80 {
  import microsoft_identity_association
  import a11_backend
}
"@
Set-Content -LiteralPath (Join-Path $StageRoot "Caddyfile") -Value $caddy -Encoding UTF8

if ($ReuseRemoteSecrets) {
  $SecretStage = $null
  $BuildEnvStage = $null
} else {
$envMap = Read-EnvMap $EnvSource
$mcpEnvMap = if (Test-Path -LiteralPath $McpEnvSource) { Read-EnvMap $McpEnvSource } else { [ordered]@{} }
$localEnvSource = Join-Path $ServerRoot ".env.local"
$localEnvMap = if (Test-Path -LiteralPath $localEnvSource) { Read-EnvMap $localEnvSource } else { [ordered]@{} }
$localSecretRoot = Join-Path $env:USERPROFILE ".funesterie\secrets"
Import-OptionalSecretFile $envMap "A11_ELEVENLABS_API_KEY" @(
  $env:A11_ELEVENLABS_API_KEY_FILE,
  $localEnvMap["A11_ELEVENLABS_API_KEY_FILE"],
  $localEnvMap["VIVY_ELEVENLABS_API_KEY_FILE"],
  (Join-Path $env:USERPROFILE "Desktop\key\keyelevenlabs.txt"),
  (Join-Path $localSecretRoot "elevenlabs-api-key.txt")
)
$optionalFinanceEnvKeys = @(
  "QONTO_API_BASE_URL",
  "QONTO_API_LOGIN",
  "QONTO_EXCLUDED_BANK_ACCOUNT_IDS",
  "MOLLIE_API_BASE_URL",
  "MOLLIE_PUBLIC_BASE_URL",
  "MOLLIE_WEBHOOK_URL",
  "MOLLIE_ALLOW_PAYMENT_CREATE",
  "STRIPE_SECRET_KEY",
  "STRIPE_PUBLISHABLE_KEY",
  "STRIPE_PRICE_ID",
  "STRIPE_PREMIUM_PRICE_ID",
  "STRIPE_FOUNDER_PRICE_ID",
  "STRIPE_WEBHOOK_SECRET",
  "PAYPAL_CLIENT_ID",
  "PAYPAL_CLIENT_SECRET",
  "PAYPAL_WEBHOOK_ID",
  "PAYPAL_RECEIVER_EMAIL"
)
foreach ($key in $optionalFinanceEnvKeys) {
  Import-OptionalEnvValue $envMap $localEnvMap $key
}
Import-OptionalSecretFile $envMap "QONTO_SECRET_KEY" @(
  $localEnvMap["QONTO_SECRET_KEY_FILE"],
  $localEnvMap["QONTO_API_SECRET_KEY_FILE"],
  $localEnvMap["QONTO_API_KEY_FILE"],
  (Join-Path $localSecretRoot "qonto-secret-key.txt")
)
Import-OptionalSecretFile $envMap "MOLLIE_API_KEY" @(
  $localEnvMap["MOLLIE_API_KEY_FILE"],
  $localEnvMap["MOLLIE_SECRET_KEY_FILE"],
  (Join-Path $localSecretRoot "mollie-api-key.txt")
)
$localOnlySecretFileKeys = @(
  "QONTO_SECRET_KEY_FILE",
  "QONTO_API_SECRET_KEY_FILE",
  "QONTO_API_KEY_FILE",
  "MOLLIE_API_KEY_FILE",
  "MOLLIE_SECRET_KEY_FILE",
  "A11_ELEVENLABS_API_KEY_FILE",
  "VIVY_ELEVENLABS_API_KEY_FILE"
)
foreach ($key in $localOnlySecretFileKeys) {
  if ($envMap.Contains($key)) { $envMap.Remove($key) }
}
$mcpBridgeEnvKeys = @(
  "R2_ENDPOINT",
  "R2_BUCKET",
  "R2_BUCKET_NAME",
  "R2_BUCKET_ID",
  "R2_PUBLIC_BASE_URL",
  "A11_R2_PUBLIC_BASE_URL",
  "R2_PUBLIC_URL",
  "R2_ACCESS_KEY",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_KEY",
  "R2_SECRET_ACCESS_KEY"
)
foreach ($key in $mcpBridgeEnvKeys) {
  if (
    $mcpEnvMap.Contains($key) `
    -and -not [string]::IsNullOrWhiteSpace($mcpEnvMap[$key]) `
    -and (-not $envMap.Contains($key) -or [string]::IsNullOrWhiteSpace($envMap[$key]))
  ) {
    $envMap[$key] = $mcpEnvMap[$key]
  }
}
$removeKeys = @(
  "POSTGRES_DB", "POSTGRES_USER", "POSTGRES_PASSWORD", "DATABASE_URL", "REDIS_URL",
  "QFLUSH_REDIS_URL", "QFLUSH_URL", "QFLUSH_REMOTE_URL", "QFLUSH_BASE_URL",
  "QFLUSH_ENDPOINT", "QFLUSH_PUBLIC_URL", "PUBLIC_QFLUSH_URL", "QFLUSH_HEALTH_URL",
  "PUBLIC_APP_URL", "FRONTEND_URL", "PUBLIC_FRONTEND_URL", "FRONT_URL", "APP_URL", "API_URL", "PUBLIC_API_URL",
  "A11_SERVER_URL", "A11_PUBLIC_HOST", "GOOGLE_CALLBACK_URL", "A11_GOOGLE_CALLBACK_URL",
  "MICROSOFT_REDIRECT_URI", "MICROSOFT_CALLBACK_URL", "AZURE_REDIRECT_URI",
  "A11_SESSION_COOKIE_SAMESITE", "A11_SESSION_COOKIE_DOMAIN", "NEZ_SECURITY_MODE", "A11_ENABLE_QFLUSH",
  "QFLUSH_CHAT_FLOW", "A11_QFLUSH_CHAT_FLOW", "A11_QFLUSH_USE_DRAGON",
  "A11_RUNTIME_PROFILE", "A11_PRODUCT", "A11_INSTANCE_NAME", "SERVE_STATIC",
  "A11_WEB_DIST_DIR", "TTS_URL", "VOICE_MODULE_URL", "A11_VOICE_MODULE_URL",
  "A11_USAGE_GUARD_ADMIN_EMAIL", "DEFAULT_ADMIN_USERNAME", "DEFAULT_ADMIN_PASSWORD",
  "A11_PROFILE_ENV", "KAEN44_PROFILE_ENV", "KAEN44_MODE", "A11_RESPONDER_MODE",
  "A11_ALLOW_DEV_ROUTES", "A11_ENABLE_LEGACY_WORD_INTENT_DETECTORS",
  "NODE_ENV", "PORT", "HOST_SERVER"
)
foreach ($key in $removeKeys) {
  if ($envMap.Contains($key)) { $envMap.Remove($key) }
}

$existingPgPass = $null
$existingDatabaseUrl = Read-RemoteEnvValue "DATABASE_URL"
if (-not [string]::IsNullOrWhiteSpace($existingDatabaseUrl)) {
  try {
    $databaseUri = [Uri]$existingDatabaseUrl
    $userInfo = [string]$databaseUri.UserInfo
    $separatorIndex = $userInfo.IndexOf(':')
    if ($separatorIndex -ge 0 -and $separatorIndex -lt ($userInfo.Length - 1)) {
      $existingPgPass = [Uri]::UnescapeDataString($userInfo.Substring($separatorIndex + 1))
    }
  } catch {
    $existingPgPass = $null
  }
}
if ([string]::IsNullOrWhiteSpace($existingPgPass)) {
  $existingPgPass = Read-RemoteEnvValue "POSTGRES_PASSWORD"
}
$existingAdminPass = Read-RemoteEnvValue "DEFAULT_ADMIN_PASSWORD"
$existingMcpToken = Read-RemoteEnvValue "A11_MCP_TOKEN"
$existingEkkoToken = Read-RemoteEnvValue "EKKO_TOKEN"
$existingJwtSecret = Read-RemoteEnvValue "JWT_SECRET"
$pgPass = if ([string]::IsNullOrWhiteSpace($existingPgPass)) { New-HexSecret 32 } else { $existingPgPass }
$adminPass = if ([string]::IsNullOrWhiteSpace($existingAdminPass)) { New-HexSecret 24 } else { $existingAdminPass }
$jwtSecret = if (-not [string]::IsNullOrWhiteSpace($env:JWT_SECRET)) {
  $env:JWT_SECRET
} elseif ($envMap.Contains("JWT_SECRET") -and -not [string]::IsNullOrWhiteSpace($envMap["JWT_SECRET"])) {
  $envMap["JWT_SECRET"]
} elseif ($mcpEnvMap.Contains("OAUTH_JWT_SECRET") -and -not [string]::IsNullOrWhiteSpace($mcpEnvMap["OAUTH_JWT_SECRET"])) {
  $mcpEnvMap["OAUTH_JWT_SECRET"]
} elseif (-not [string]::IsNullOrWhiteSpace($existingJwtSecret)) {
  $existingJwtSecret
} else {
  New-HexSecret 32
}
$mcpToken = if (-not [string]::IsNullOrWhiteSpace($env:A11_MCP_TOKEN)) {
  $env:A11_MCP_TOKEN
} elseif (-not [string]::IsNullOrWhiteSpace($env:MCP_AUTH_TOKEN)) {
  $env:MCP_AUTH_TOKEN
} elseif ($mcpEnvMap.Contains("MCP_AUTH_TOKEN") -and -not [string]::IsNullOrWhiteSpace($mcpEnvMap["MCP_AUTH_TOKEN"])) {
  $mcpEnvMap["MCP_AUTH_TOKEN"]
} elseif (-not [string]::IsNullOrWhiteSpace($existingMcpToken)) {
  $existingMcpToken
} else {
  ""
}
$ekkoToken = if (-not [string]::IsNullOrWhiteSpace($env:EKKO_TOKEN)) {
  $env:EKKO_TOKEN
} elseif (-not [string]::IsNullOrWhiteSpace($existingEkkoToken)) {
  $existingEkkoToken
} else {
  New-HexSecret 32
}
$pgPassEncoded = [System.Uri]::EscapeDataString($pgPass)
if (-not [string]::IsNullOrWhiteSpace($existingPgPass)) {
  Write-Host "Secret Postgres distant reutilise." -ForegroundColor DarkCyan
}
if (-not [string]::IsNullOrWhiteSpace($existingAdminPass)) {
  Write-Host "Mot de passe admin distant reutilise." -ForegroundColor DarkCyan
}
if (-not [string]::IsNullOrWhiteSpace($mcpToken)) {
  Write-Host "Token MCP A11/K44 disponible pour le relais." -ForegroundColor DarkCyan
}
if (-not [string]::IsNullOrWhiteSpace($existingEkkoToken)) {
  Write-Host "Secret Ekko distant reutilise." -ForegroundColor DarkCyan
}
$envMap["JWT_SECRET"] = $jwtSecret
$overrides = [ordered]@{
  NODE_ENV = "production"
  PORT = "3000"
  HOST_SERVER = "0.0.0.0"
  POSTGRES_DB = "a11"
  POSTGRES_USER = "a11"
  POSTGRES_PASSWORD = $pgPass
  DATABASE_URL = "postgresql://a11:" + $pgPass + "@a11-postgres:5432/a11"
  REDIS_URL = "redis://a11-redis:6379"
  QFLUSH_REDIS_URL = "redis://a11-redis:6379"
  QFLUSH_URL = ""
  QFLUSH_REMOTE_URL = ""
  QFLUSH_BASE_URL = ""
  QFLUSH_ENDPOINT = ""
  QFLUSH_PUBLIC_URL = ""
  PUBLIC_QFLUSH_URL = ""
  QFLUSH_HEALTH_URL = ""
  PUBLIC_APP_URL = "https://a11.funesterie.me"
  FRONTEND_URL = "https://a11.funesterie.me"
  PUBLIC_FRONTEND_URL = "https://a11.funesterie.me"
  FRONT_URL = "https://a11.funesterie.me"
  APP_URL = "https://a11.funesterie.me"
  API_URL = "https://a11.funesterie.me"
  PUBLIC_API_URL = "https://a11.funesterie.me"
  A11_SERVER_URL = "https://a11.funesterie.me"
  A11_PUBLIC_HOST = "a11.funesterie.me"
  STRIPE_PRICE_ID = "price_1TdqwVHkqLcMgv54LWqd5jEb"
  STRIPE_PREMIUM_PRICE_ID = "price_1TdqwVHkqLcMgv54LWqd5jEb"
  STRIPE_FOUNDER_PRICE_ID = "price_1TdqwWHkqLcMgv54ZFUAbVFl"
  STRIPE_WEBHOOK_URL = "https://a11.funesterie.me/api/subscription/webhook"
  STRIPE_SUCCESS_URL = "https://funesterie.me/subscription/success"
  STRIPE_CANCEL_URL = "https://funesterie.me/subscription/cancel"
  STRIPE_PORTAL_RETURN_URL = "https://funesterie.me/compte/"
  PAYPAL_ENV = "live"
  PAYPAL_PUBLIC_BASE_URL = "https://funesterie.me"
  PAYPAL_WEBHOOK_URL = "https://a11.funesterie.me/api/paypal/webhook"
  A11_MCP_URL = "https://mcp.funesterie.me/mcp"
  FUNESTERIE_MCP_URL = "https://mcp.funesterie.me/mcp"
  A11_PUBLIC_MCP_UPSTREAM_URL = "https://mcp.funesterie.me/mcp"
  GOOGLE_CALLBACK_URL = "https://funesterie.me/api/auth/google/callback"
  A11_GOOGLE_CALLBACK_URL = "https://funesterie.me/api/auth/google/callback"
  MICROSOFT_REDIRECT_URI = "https://funesterie.me/api/auth/microsoft/callback"
  MICROSOFT_CALLBACK_URL = "https://funesterie.me/api/auth/microsoft/callback"
  AZURE_REDIRECT_URI = "https://funesterie.me/api/auth/microsoft/callback"
  A11_SESSION_COOKIE_SAMESITE = "lax"
  A11_SESSION_COOKIE_DOMAIN = ".funesterie.me"
  NEZ_SECURITY_MODE = "strict"
  A11_ENABLE_QFLUSH = "1"
  QFLUSH_CHAT_FLOW = "a11.chat.v1"
  A11_QFLUSH_CHAT_FLOW = "a11.chat.v1"
  A11_QFLUSH_USE_DRAGON = "false"
  A11_IMAGE_PROVIDER_ORDER = "replicate,pollinations,hf,openai,sd"
  A11_ENABLE_HF_IMAGE = "true"
  A11_HF_IMAGE_STEPS = "4"
  A11_ENABLE_HF_VIDEO = "true"
  A11_HF_VIDEO_PROVIDER = "replicate"
  A11_HF_VIDEO_MODEL = "Wan-AI/Wan2.2-TI2V-5B"
  A11_HF_VIDEO_FRAMES = "81"
  A11_HF_VIDEO_STEPS = "4"
  A11_HF_VIDEO_TIMEOUT_MS = "600000"
  A11_VIDEO_ALLOW_SYNTHETIC_FALLBACK = "false"
  A11_VIDEO_SYNTHETIC_FALLBACK = "false"
  A11_ENABLE_REPLICATE_IMAGE = "true"
  A11_REPLICATE_IMAGE_MODEL = "black-forest-labs/flux-schnell"
  A11_REPLICATE_IMAGE_STEPS = "4"
  A11_ENABLE_OPENAI_IMAGE = "true"
  A11_OPENAI_IMAGE_MODEL = "gpt-image-1-mini"
  A11_ENABLE_POLLINATIONS_IMAGE = "true"
  A11_POLLINATIONS_IMAGE_MODEL = "flux"
  A11_POLLINATIONS_REFERRER = "funesterie-a11"
  OPENAI_BASE_URL = "https://openrouter.ai/api/v1"
  OPENAI_MODEL = "meta-llama/llama-3.3-70b-instruct"
  A11_OPENAI_MODEL = "meta-llama/llama-3.3-70b-instruct"
  A11_LLM_PROVIDER = "groq"
  OLLAMA_BASE = "http://a11-ollama:11434"
  LLAMA_BASE = "http://a11-ollama:11434"
  OLLAMA_HOST = "a11-ollama"
  OLLAMA_PORT = "11434"
  A11_OLLAMA_BASE = "http://a11-ollama:11434"
  A11_OLLAMA_PRIMARY_MODEL = "llama3.2:3b"
  A11_OLLAMA_FALLBACK_MODEL = "llama3.2:3b"
  A11_ENABLE_EMBEDDINGS = "true"
  A11_EMBEDDING_BASE_URL = "http://a11-ollama:11434"
  A11_EMBEDDING_MODEL = "nomic-embed-text"
  A11_STT_PROVIDER = $(if ($env:A11_STT_PROVIDER) { $env:A11_STT_PROVIDER } else { "auto" })
  A11_STT_FAST_WHISPER_ENABLED = $(if ($env:A11_STT_FAST_WHISPER_ENABLED) { $env:A11_STT_FAST_WHISPER_ENABLED } else { "true" })
  A11_STT_FAST_WHISPER_BASE_URL = $(if ($env:A11_STT_FAST_WHISPER_BASE_URL) { $env:A11_STT_FAST_WHISPER_BASE_URL } else { "http://a11-stt-whisper:9000" })
  A11_STT_FAST_WHISPER_MODEL = $(if ($env:A11_STT_FAST_WHISPER_MODEL) { $env:A11_STT_FAST_WHISPER_MODEL } else { "whisper-1" })
  A11_STT_OLLAMA_ENABLED = $(if ($env:A11_STT_OLLAMA_ENABLED) { $env:A11_STT_OLLAMA_ENABLED } else { "false" })
  A11_STT_OLLAMA_BASE = "http://a11-ollama:11434"
  A11_STT_OLLAMA_MODEL = $(if ($env:A11_STT_OLLAMA_MODEL) { $env:A11_STT_OLLAMA_MODEL } else { "whisper" })
  A11_STT_OPENAI_API_KEY = $(if ($env:A11_STT_OPENAI_API_KEY) { $env:A11_STT_OPENAI_API_KEY } else { "" })
  A11_STT_OPENAI_BASE_URL = $(if ($env:A11_STT_OPENAI_BASE_URL) { $env:A11_STT_OPENAI_BASE_URL } else { "https://api.openai.com/v1" })
  A11_STT_OPENAI_MODEL = $(if ($env:A11_STT_OPENAI_MODEL) { $env:A11_STT_OPENAI_MODEL } else { "whisper-1" })
  A11_STT_ALLOW_OPENAI_COMPATIBLE = $(if ($env:A11_STT_ALLOW_OPENAI_COMPATIBLE) { $env:A11_STT_ALLOW_OPENAI_COMPATIBLE } else { "false" })
  A11_STT_ALLOW_OPENAI_FALLBACK = $(if ($env:A11_STT_ALLOW_OPENAI_FALLBACK) { $env:A11_STT_ALLOW_OPENAI_FALLBACK } else { "false" })
  A11_TRANSLATION_BASE_URL = "http://a11-ollama:11434"
  A11_TRANSLATION_MODEL = "llama3.2:3b"
  A11_CERBERE_OPENAI_BASE_URL = "https://openrouter.ai/api/v1"
  A11_CERBERE_OPENAI_API_KEY = $(if ($mcpEnvMap.Contains("OPENROUTER_API_KEY") -and -not [string]::IsNullOrWhiteSpace($mcpEnvMap["OPENROUTER_API_KEY"])) { $mcpEnvMap["OPENROUTER_API_KEY"] } elseif ($envMap.Contains("OPENROUTER_API_KEY")) { $envMap["OPENROUTER_API_KEY"] } else { "" })
  LOCAL_DEFAULT_MODEL = "llama3.2:3b"
  A11_CERBERE_PREFER_NON_GROQ = "false"
  A11_LLM_FALLBACK_PROVIDER = "ollama"
  A11_LLM_RUNTIME_FALLBACK_ORDER = "ollama,openai,gemini,xai,huggingface,deepseek,together"
  A11_CERBERE_LOCAL_ONLY = "false"
  A11_LOCAL_CHAT_TIMEOUT_MS = "45000"
  A11_OLLAMA_KEEP_ALIVE = "30m"
  A11_MEMORY_LOCAL_TIMEOUT_MS = "3500"
  A11_MEMORY_REMOTE_TIMEOUT_MS = "5000"
  A11_EMBEDDING_TIMEOUT_MS = "2500"
  A11_RUNTIME_ROOT = "/app/runtime"
  A11_RUNTIME_PROFILE = "prod"
  A11_PRODUCT = "a11"
  A11_INSTANCE_NAME = "Alpha Onze"
  SERVE_STATIC = "true"
  A11_WEB_DIST_DIR = "/web/dist"
  TTS_URL = "http://a11-voice:5002"
  VOICE_MODULE_URL = "http://a11-voice:5002"
  A11_VOICE_MODULE_URL = "http://a11-voice:5002"
  A11_CARTESIA_TTS_DISABLED = $(if ($env:A11_CARTESIA_TTS_DISABLED) { $env:A11_CARTESIA_TTS_DISABLED } else { "false" })
  CARTESIA_TTS_DISABLED = $(if ($env:CARTESIA_TTS_DISABLED) { $env:CARTESIA_TTS_DISABLED } else { "false" })
  A11_CARTESIA_TTS_ENABLED = $(if ($env:A11_CARTESIA_TTS_ENABLED) { $env:A11_CARTESIA_TTS_ENABLED } else { "true" })
  A11_ELEVENLABS_TTS_DISABLED = $(if ($env:A11_ELEVENLABS_TTS_DISABLED) { $env:A11_ELEVENLABS_TTS_DISABLED } else { "false" })
  ELEVENLABS_TTS_DISABLED = $(if ($env:ELEVENLABS_TTS_DISABLED) { $env:ELEVENLABS_TTS_DISABLED } else { "false" })
  A11_ELEVENLABS_TTS_ENABLED = $(if ($env:A11_ELEVENLABS_TTS_ENABLED) { $env:A11_ELEVENLABS_TTS_ENABLED } else { "true" })
  # Music stays opt-in in application code; this only permits the explicit
  # founder preview requested from the checked Studio control.
  VIVY_ELEVENLABS_MUSIC_DISABLED = "false"
  A11_CARTESIA_API_KEY_FILE = $(if ($env:A11_CARTESIA_API_KEY_FILE) { $env:A11_CARTESIA_API_KEY_FILE } else { "/app/runtime/secrets/cartesia_api_key" })
  A11_ELEVENLABS_API_KEY_FILE = $(if ($env:A11_ELEVENLABS_API_KEY_FILE) { $env:A11_ELEVENLABS_API_KEY_FILE } else { "/app/runtime/secrets/elevenlabs_api_key" })
  VIVY_ELEVENLABS_API_KEY_FILE = $(if ($env:VIVY_ELEVENLABS_API_KEY_FILE) { $env:VIVY_ELEVENLABS_API_KEY_FILE } else { "/app/runtime/secrets/elevenlabs_api_key" })
  A11_ELEVENLABS_A11_VOICE_ID = $(if ($env:A11_ELEVENLABS_A11_VOICE_ID) { $env:A11_ELEVENLABS_A11_VOICE_ID } elseif (-not [string]::IsNullOrWhiteSpace([string]$envMap["A11_ELEVENLABS_A11_VOICE_ID"])) { [string]$envMap["A11_ELEVENLABS_A11_VOICE_ID"] } else { "pNInz6obpgDQGcFmaJgB" })
  A11_ELEVENLABS_DJEFF_VOICE_ID = $(if ($env:A11_ELEVENLABS_DJEFF_VOICE_ID) { $env:A11_ELEVENLABS_DJEFF_VOICE_ID } elseif (-not [string]::IsNullOrWhiteSpace([string]$envMap["A11_ELEVENLABS_DJEFF_VOICE_ID"])) { [string]$envMap["A11_ELEVENLABS_DJEFF_VOICE_ID"] } else { "" })
  A11_ELEVENLABS_K44_VOICE_ID = $(if ($env:A11_ELEVENLABS_K44_VOICE_ID) { $env:A11_ELEVENLABS_K44_VOICE_ID } elseif (-not [string]::IsNullOrWhiteSpace([string]$envMap["A11_ELEVENLABS_K44_VOICE_ID"])) { [string]$envMap["A11_ELEVENLABS_K44_VOICE_ID"] } elseif ($env:A11_ELEVENLABS_KAEN44_VOICE_ID) { $env:A11_ELEVENLABS_KAEN44_VOICE_ID } elseif (-not [string]::IsNullOrWhiteSpace([string]$envMap["A11_ELEVENLABS_KAEN44_VOICE_ID"])) { [string]$envMap["A11_ELEVENLABS_KAEN44_VOICE_ID"] } else { "EXAVITQu4vr4xnSDxMaL" })
  A11_ELEVENLABS_KAEN44_VOICE_ID = $(if ($env:A11_ELEVENLABS_KAEN44_VOICE_ID) { $env:A11_ELEVENLABS_KAEN44_VOICE_ID } elseif (-not [string]::IsNullOrWhiteSpace([string]$envMap["A11_ELEVENLABS_KAEN44_VOICE_ID"])) { [string]$envMap["A11_ELEVENLABS_KAEN44_VOICE_ID"] } elseif ($env:A11_ELEVENLABS_K44_VOICE_ID) { $env:A11_ELEVENLABS_K44_VOICE_ID } elseif (-not [string]::IsNullOrWhiteSpace([string]$envMap["A11_ELEVENLABS_K44_VOICE_ID"])) { [string]$envMap["A11_ELEVENLABS_K44_VOICE_ID"] } else { "EXAVITQu4vr4xnSDxMaL" })
  A11_ELEVENLABS_VIVY_VOICE_ID = $(if ($env:A11_ELEVENLABS_VIVY_VOICE_ID) { $env:A11_ELEVENLABS_VIVY_VOICE_ID } elseif (-not [string]::IsNullOrWhiteSpace([string]$envMap["A11_ELEVENLABS_VIVY_VOICE_ID"])) { [string]$envMap["A11_ELEVENLABS_VIVY_VOICE_ID"] } else { "21m00Tcm4TlvDq8ikWAM" })
  VIVY_ELEVENLABS_MUSIC_MODEL = $(if ($env:VIVY_ELEVENLABS_MUSIC_MODEL) { $env:VIVY_ELEVENLABS_MUSIC_MODEL } else { "" })
  VIVY_MUSIC_PROVIDER = $(if ($env:VIVY_MUSIC_PROVIDER) { $env:VIVY_MUSIC_PROVIDER } else { "suno" })
  VIVY_SUNO_API_KEY_FILE = $(if ($env:VIVY_SUNO_API_KEY_FILE) { $env:VIVY_SUNO_API_KEY_FILE } else { "/app/runtime/secrets/suno_api_key" })
  VIVY_SUNO_BASE_URL = $(if ($env:VIVY_SUNO_BASE_URL) { $env:VIVY_SUNO_BASE_URL } else { "https://api.sunoapi.org/api/v1" })
  VIVY_SUNO_MODEL = $(if ($env:VIVY_SUNO_MODEL) { $env:VIVY_SUNO_MODEL } else { "V4_5" })
  VIVY_SUNO_CALLBACK_URL = $(if ($env:VIVY_SUNO_CALLBACK_URL) { $env:VIVY_SUNO_CALLBACK_URL } else { "https://vivy.funesterie.me/api/vivy/studio/suno/callback" })
  VIVY_SUNO_CALLBACK_TOKEN = $(if ($env:VIVY_SUNO_CALLBACK_TOKEN) { $env:VIVY_SUNO_CALLBACK_TOKEN } else { "" })
  ENABLE_PIPER_HTTP = $(if ($env:ENABLE_PIPER_HTTP) { $env:ENABLE_PIPER_HTTP } else { "true" })
  A11_TTS_ALLOW_XTTS_RVC_AUTO = $(if ($env:A11_TTS_ALLOW_XTTS_RVC_AUTO) { $env:A11_TTS_ALLOW_XTTS_RVC_AUTO } else { "true" })
  A11_VOICE_CONVERSION_ENABLED = $(if ($env:A11_VOICE_CONVERSION_ENABLED) { $env:A11_VOICE_CONVERSION_ENABLED } else { "true" })
  A11_VOICE_CONVERTER_PROVIDER = $(if ($env:A11_VOICE_CONVERTER_PROVIDER) { $env:A11_VOICE_CONVERTER_PROVIDER } else { "xtts-rvc,ffmpeg-morph" })
  A11_VOICE_XTTS_RVC_URL = $(if ($env:A11_VOICE_XTTS_RVC_URL) { $env:A11_VOICE_XTTS_RVC_URL } else { "http://a11-xtts-rvc:5000" })
  A11_VOICE_XTTS_RVC_PROTOCOL = $(if ($env:A11_VOICE_XTTS_RVC_PROTOCOL) { $env:A11_VOICE_XTTS_RVC_PROTOCOL } else { "a11" })
  A11_VOICE_XTTS_RVC_LANGUAGE = $(if ($env:A11_VOICE_XTTS_RVC_LANGUAGE) { $env:A11_VOICE_XTTS_RVC_LANGUAGE } else { "fr" })
  A11_VOICE_XTTS_RVC_TIMEOUT_SECONDS = $(if ($env:A11_VOICE_XTTS_RVC_TIMEOUT_SECONDS) { $env:A11_VOICE_XTTS_RVC_TIMEOUT_SECONDS } else { "240" })
  A11_VOICE_XTTS_RVC_FALLBACK = $(if ($env:A11_VOICE_XTTS_RVC_FALLBACK) { $env:A11_VOICE_XTTS_RVC_FALLBACK } else { "false" })
  A11_TTS_LOCAL_GPU_WORKER_ENABLED = $(if ($env:A11_TTS_LOCAL_GPU_WORKER_ENABLED) { $env:A11_TTS_LOCAL_GPU_WORKER_ENABLED } else { "false" })
  A11_LOCAL_GPU_WORKER_TOKEN_FILE = $(if ($env:A11_LOCAL_GPU_WORKER_TOKEN_FILE) { $env:A11_LOCAL_GPU_WORKER_TOKEN_FILE } else { "/app/runtime/secrets/local_gpu_worker_token" })
  A11_LOCAL_GPU_WORKER_FALLBACK_MS = $(if ($env:A11_LOCAL_GPU_WORKER_FALLBACK_MS) { $env:A11_LOCAL_GPU_WORKER_FALLBACK_MS } else { "45000" })
  A11_LOCAL_GPU_WORKER_LEASE_MS = $(if ($env:A11_LOCAL_GPU_WORKER_LEASE_MS) { $env:A11_LOCAL_GPU_WORKER_LEASE_MS } else { "360000" })
  A11_LOCAL_GPU_WORKER_MAX_ACTIVE = $(if ($env:A11_LOCAL_GPU_WORKER_MAX_ACTIVE) { $env:A11_LOCAL_GPU_WORKER_MAX_ACTIVE } else { "1" })
  A11_LOCAL_GPU_WORKER_MAX_LEASE_EXPIRIES = $(if ($env:A11_LOCAL_GPU_WORKER_MAX_LEASE_EXPIRIES) { $env:A11_LOCAL_GPU_WORKER_MAX_LEASE_EXPIRIES } else { "1" })
  A11_TTS_ASYNC_QUEUE_MAX = $(if ($env:A11_TTS_ASYNC_QUEUE_MAX) { $env:A11_TTS_ASYNC_QUEUE_MAX } else { "50" })
  A11_MATCH_ARENA_ENABLED = $(if ($env:A11_MATCH_ARENA_ENABLED) { $env:A11_MATCH_ARENA_ENABLED } else { "true" })
  A11_MATCH_ARENA_WORKER_TOKEN_FILE = $(if ($env:A11_MATCH_ARENA_WORKER_TOKEN_FILE) { $env:A11_MATCH_ARENA_WORKER_TOKEN_FILE } else { "/app/runtime/secrets/match_arena_worker_token" })
  A11_VIDEO_PROXY_URL = $(if ($env:A11_VIDEO_PROXY_URL) { $env:A11_VIDEO_PROXY_URL } else { "" })
  A11_VIDEO_PROXY_TOKEN = $(if ($env:A11_VIDEO_PROXY_TOKEN) { $env:A11_VIDEO_PROXY_TOKEN } else { "" })
  A11_VIDEO_PROXY_PUBLIC_FILE_BASE_URL = $(if ($env:A11_VIDEO_PROXY_PUBLIC_FILE_BASE_URL) { $env:A11_VIDEO_PROXY_PUBLIC_FILE_BASE_URL } else { "" })
  A11_VIDEO_PROXY_TIMEOUT_MS = $(if ($env:A11_VIDEO_PROXY_TIMEOUT_MS) { $env:A11_VIDEO_PROXY_TIMEOUT_MS } else { "600000" })
  VIVY_ALEXA_TRACK_URL = "https://files.funesterie.me/public/vivy/2026-05-14/6e66f829-2c46-4254-95c8-4757a75ca07d-vivy-reference-short.mp3"
  VIVY_ALEXA_TRACK_TITLE = "Vivy Reference"
  VIVY_ALEXA_TRACK_ARTIST = "Funesterie"
  VIVY_ALEXA_TRACK_SOURCE = "r2-public"
  A11_VISION_PROVIDER = "janus"
  A11_JANUS_ENABLED = "true"
  A11_JANUS_PYTHON_PATH = "/opt/janus-venv/bin/python"
  A11_JANUS_MODEL_ID = "deepseek-ai/Janus-Pro-1B"
  A11_JANUS_DEVICE = "cpu"
  A11_JANUS_TORCH_DTYPE = "auto"
  A11_JANUS_PREFER_LATEST = "false"
  A11_JANUS_TIMEOUT_MS = "180000"
  A11_VIDEO_USE_JANUS_FRAME_ANALYSIS = "true"
  A11_VIDEO_REALITY_CHECK = "true"
  A11_VIDEO_REALITY_CHECK_FRAME_COUNT = "3"
  EKKO_TOKEN = $ekkoToken
  A11_EKKO_CONTROL_URL = "http://a11-ekko:5012"
  A11_USAGE_GUARD_ADMIN_EMAIL = "funeste38@gmail.com"
  DEFAULT_ADMIN_USERNAME = "Djeff"
  DEFAULT_ADMIN_PASSWORD = $adminPass
  A11_PROFILE_ENV = "/app/profiles/a11.prod.env.disabled"
}
foreach ($key in $overrides.Keys) {
  $envMap[$key] = $overrides[$key]
}
if (-not [string]::IsNullOrWhiteSpace($mcpToken)) {
  $envMap["A11_MCP_TOKEN"] = $mcpToken
  $envMap["A11_PUBLIC_MCP_TOKEN"] = $mcpToken
}
$SecretStage = Join-Path $StageRoot "a11.env"
Write-EnvFile $envMap $SecretStage

$BuildEnvStage = Join-Path $StageRoot "build.env"
$buildEnvMap = [ordered]@{
  JFROG_NPM_REGISTRY = $(if ($env:JFROG_NPM_REGISTRY) { $env:JFROG_NPM_REGISTRY } else { "https://trialhnuk69.jfrog.io/artifactory/api/npm/funesterie-npm/" })
  JFROG_NPM_AUTH_TOKEN = $env:JFROG_NPM_AUTH_TOKEN
  A11_INSTALL_JANUS = $(if ($env:A11_INSTALL_JANUS) { $env:A11_INSTALL_JANUS } else { "1" })
  A11_JANUS_TORCH_INDEX_URL = $(if ($env:A11_JANUS_TORCH_INDEX_URL) { $env:A11_JANUS_TORCH_INDEX_URL } else { "https://download.pytorch.org/whl/cpu" })
  A11_JANUS_TORCH_PACKAGES = $(if ($env:A11_JANUS_TORCH_PACKAGES) { $env:A11_JANUS_TORCH_PACKAGES } else { "" })
  A11_BUILD_COMMIT = $BuildCommit
  A11_BUILD_BRANCH = $BuildBranch
  A11_BUILD_DATE = $BuildDateIso
}
Write-EnvFile $buildEnvMap $BuildEnvStage
}

if (Test-Path -LiteralPath $Archive) {
  Remove-Item -LiteralPath $Archive -Force
}
& tar.exe -czf $Archive -C $StageRoot server voice-module xtts-rvc-bridge ekko web Caddyfile
if ($LASTEXITCODE -ne 0) { throw "Creation archive echouee" }
$archiveSizeMb = [Math]::Round((Get-Item -LiteralPath $Archive).Length / 1MB, 2)
Write-Host "Archive creee: $Archive ($archiveSizeMb MB)" -ForegroundColor DarkCyan

$remotePrepare = @"
set -e
mkdir -p $RemoteRoot/secrets $RemoteRoot/releases $RemoteDataRoot/postgres $RemoteDataRoot/redis $RemoteDataRoot/logs $RemoteDataRoot/runtime $RemoteDataRoot/runtime/secrets $RemoteDataRoot/runtime/voice-library $RemoteDataRoot/uploads $RemoteDataRoot/tts $RemoteDataRoot/stt/whisper $RemoteDataRoot/voice-out $RemoteDataRoot/xtts-rvc/models $RemoteDataRoot/xtts-rvc/rvcs $RemoteDataRoot/xtts-rvc/outputs $RemoteDataRoot/kaen44-logs $RemoteDataRoot/caddy-data $RemoteDataRoot/caddy-config
chmod 700 $RemoteRoot/secrets
if [ -d $RemoteDataRoot/kaen44-runtime ]; then
  cp -an $RemoteDataRoot/kaen44-runtime/. $RemoteDataRoot/runtime/ 2>/dev/null || true
fi
if [ -d $RemoteDataRoot/kaen44-uploads ]; then
  cp -an $RemoteDataRoot/kaen44-uploads/. $RemoteDataRoot/uploads/ 2>/dev/null || true
fi
"@
$remotePrepareEncoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($remotePrepare.Replace("`r`n", "`n").Replace("`r", "`n")))
& ssh @sshBase $Remote "printf '%s' '$remotePrepareEncoded' | base64 -d | bash"
if ($LASTEXITCODE -ne 0) { throw "Preparation distante echouee" }

$localSunoSecret = if ($env:VIVY_SUNO_LOCAL_API_KEY_FILE) {
  $env:VIVY_SUNO_LOCAL_API_KEY_FILE
} else {
  Join-Path $A11Root "runtime\secrets\suno_api_key"
}
if (Test-Path -LiteralPath $localSunoSecret) {
  $remoteSunoSecret = "$RemoteDataRoot/runtime/secrets/suno_api_key"
  & scp @sshBase $localSunoSecret "${Remote}:$remoteSunoSecret"
  if ($LASTEXITCODE -ne 0) { throw "Copie secret Suno echouee vers $remoteSunoSecret" }
  & ssh @sshBase $Remote "chmod 600 $RemoteDataRoot/runtime/secrets/suno_api_key"
  if ($LASTEXITCODE -ne 0) { throw "Permissions secret Suno echouees" }
  Write-Host "Secret Suno synchronise vers le runtime canonique." -ForegroundColor DarkCyan
}

$piperVoiceDownload = @"
set -e
mkdir -p $RemoteDataRoot/tts
download_voice() {
  url="`$1"
  out="`$2"
  if [ ! -s "`$out" ]; then
    curl -fL --retry 3 --retry-delay 2 -o "`$out" "`$url"
  fi
}
download_voice "https://huggingface.co/rhasspy/piper-voices/resolve/main/fr/fr_FR/upmc/medium/fr_FR-upmc-medium.onnx" "$RemoteDataRoot/tts/fr_FR-upmc-medium.onnx"
download_voice "https://huggingface.co/rhasspy/piper-voices/resolve/main/fr/fr_FR/upmc/medium/fr_FR-upmc-medium.onnx.json" "$RemoteDataRoot/tts/fr_FR-upmc-medium.onnx.json"
download_voice "https://huggingface.co/rhasspy/piper-voices/resolve/main/fr/fr_FR/tom/medium/fr_FR-tom-medium.onnx" "$RemoteDataRoot/tts/fr_FR-tom-medium.onnx"
download_voice "https://huggingface.co/rhasspy/piper-voices/resolve/main/fr/fr_FR/tom/medium/fr_FR-tom-medium.onnx.json" "$RemoteDataRoot/tts/fr_FR-tom-medium.onnx.json"
"@
$piperVoiceDownloadEncoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($piperVoiceDownload.Replace("`r`n", "`n").Replace("`r", "`n")))
& ssh @sshBase $Remote "printf '%s' '$piperVoiceDownloadEncoded' | base64 -d | bash"
if ($LASTEXITCODE -ne 0) { throw "Telechargement voix Piper distantes echoue" }

& scp @sshBase $Archive "${Remote}:$RemoteArchive"
if ($LASTEXITCODE -ne 0) { throw "Copie archive echouee" }
if (-not $ReuseRemoteSecrets) {
  & scp @sshBase $SecretStage "${Remote}:$RemoteRoot/secrets/a11.env"
  if ($LASTEXITCODE -ne 0) { throw "Copie env echouee" }
  & scp @sshBase $BuildEnvStage "${Remote}:$RemoteRoot/secrets/build.env"
  if ($LASTEXITCODE -ne 0) { throw "Copie env build echouee" }
} else {
  & ssh @sshBase $Remote "test -s $RemoteRoot/secrets/compose.env"
  if ($LASTEXITCODE -ne 0) { throw "compose.env distant introuvable; relancer sans -ReuseRemoteSecrets depuis un magasin de secrets local valide." }
}

$voiceReferenceCopies = @(
  @{ Path = $A11VoiceReference; Name = "a11-official-stern-french.wav"; Label = "A11 official stern French" },
  @{ Path = $VivyVoiceReference; Name = "vivy-official-french-conversational.wav"; Label = "Vivy official French conversational" },
  @{ Path = $Kaen44VoiceReference; Name = "kaen44-official-french-narrator.wav"; Label = "Kaen44 official French narrator" }
)
$voiceReferenceCopiesByName = @{}
foreach ($voiceReference in $voiceReferenceCopies) {
  if (-not $voiceReferenceCopiesByName.ContainsKey($voiceReference.Name)) {
    $voiceReferenceCopiesByName[$voiceReference.Name] = $voiceReference
  }
}
if (Test-Path -LiteralPath $RuntimeVoiceLibrary) {
  Get-ChildItem -LiteralPath $RuntimeVoiceLibrary -File |
    Where-Object { $_.Extension -match '^\.(wav|wave|mp3|ogg|webm|m4a|flac)$' } |
    ForEach-Object {
      if (-not $voiceReferenceCopiesByName.ContainsKey($_.Name)) {
        $voiceReferenceCopiesByName[$_.Name] = @{
          Path = $_.FullName
          Name = $_.Name
          Label = "Voice library $($_.Name)"
        }
      }
    }
}
$voiceReferenceCopies = $voiceReferenceCopiesByName.Values | Sort-Object Name
foreach ($voiceReference in $voiceReferenceCopies) {
  if (-not (Test-Path -LiteralPath $voiceReference.Path)) {
    Write-Warning "Reference voix absente: $($voiceReference.Label) ($($voiceReference.Path))"
    continue
  }
  & scp @sshBase $voiceReference.Path "${Remote}:$RemoteDataRoot/runtime/voice-library/$($voiceReference.Name)"
  if ($LASTEXITCODE -ne 0) { throw "Copie reference voix $($voiceReference.Label) echouee" }
}

if (Test-Path -LiteralPath $PrivateCorpusRoot) {
  Get-ChildItem -LiteralPath $PrivateCorpusRoot -Directory |
    ForEach-Object {
      $corpusDir = $_
      $privateCorpusTargets = @(
        "$RemoteDataRoot/runtime/Corpus/private/$($corpusDir.Name)"
      )
      foreach ($privateCorpusTarget in $privateCorpusTargets) {
        & ssh @sshBase $Remote "mkdir -p '$privateCorpusTarget'"
        if ($LASTEXITCODE -ne 0) { throw "Creation dossier corpus prive echouee: $privateCorpusTarget" }
        Get-ChildItem -LiteralPath $corpusDir.FullName -File |
          ForEach-Object {
            & scp @sshBase $_.FullName "${Remote}:$privateCorpusTarget/$($_.Name)"
            if ($LASTEXITCODE -ne 0) { throw "Copie corpus prive $($corpusDir.Name) echouee: $($_.Name)" }
          }
      }
    }
} else {
  Write-Warning "Corpus prive absent localement: $PrivateCorpusRoot"
}

$remoteBuildEnvRefresh = @'
test -s __REMOTE_ROOT__/secrets/compose.env
build_env="__REMOTE_ROOT__/secrets/build.env"
a11_env="__REMOTE_ROOT__/secrets/a11.env"
compose_env="__REMOTE_ROOT__/secrets/compose.env"
tmp_build="$(mktemp)"
managed_keys='^(A11_BUILD_COMMIT|A11_BUILD_BRANCH|A11_BUILD_DATE|A11_VOICE_XTTS_RVC_FALLBACK|A11_LLM_PROVIDER|A11_OLLAMA_PRIMARY_MODEL|A11_OLLAMA_FALLBACK_MODEL|A11_TRANSLATION_MODEL|LOCAL_DEFAULT_MODEL|A11_LLM_FALLBACK_PROVIDER|A11_LLM_RUNTIME_FALLBACK_ORDER|A11_CERBERE_LOCAL_ONLY|A11_LOCAL_CHAT_TIMEOUT_MS|A11_OLLAMA_KEEP_ALIVE|A11_MEMORY_LOCAL_TIMEOUT_MS|A11_MEMORY_REMOTE_TIMEOUT_MS|A11_EMBEDDING_TIMEOUT_MS|A11_RUNTIME_ROOT)='
if [ -s "$build_env" ]; then
  grep -v -E "$managed_keys" "$build_env" > "$tmp_build" || true
fi
printf 'A11_BUILD_COMMIT=%s\n' '__BUILD_COMMIT__' >> "$tmp_build"
printf 'A11_BUILD_BRANCH=%s\n' '__BUILD_BRANCH__' >> "$tmp_build"
printf 'A11_BUILD_DATE=%s\n' '__BUILD_DATE__' >> "$tmp_build"
printf 'A11_VOICE_XTTS_RVC_FALLBACK=false\n' >> "$tmp_build"
printf 'A11_LLM_PROVIDER=groq\n' >> "$tmp_build"
printf 'A11_OLLAMA_PRIMARY_MODEL=llama3.2:3b\n' >> "$tmp_build"
printf 'A11_OLLAMA_FALLBACK_MODEL=llama3.2:3b\n' >> "$tmp_build"
printf 'A11_TRANSLATION_MODEL=llama3.2:3b\n' >> "$tmp_build"
printf 'LOCAL_DEFAULT_MODEL=llama3.2:3b\n' >> "$tmp_build"
printf 'A11_LLM_FALLBACK_PROVIDER=ollama\n' >> "$tmp_build"
printf 'A11_LLM_RUNTIME_FALLBACK_ORDER=ollama,openai,gemini,xai,huggingface,deepseek,together\n' >> "$tmp_build"
printf 'A11_CERBERE_LOCAL_ONLY=false\n' >> "$tmp_build"
printf 'A11_LOCAL_CHAT_TIMEOUT_MS=45000\n' >> "$tmp_build"
printf 'A11_OLLAMA_KEEP_ALIVE=30m\n' >> "$tmp_build"
printf 'A11_MEMORY_LOCAL_TIMEOUT_MS=3500\n' >> "$tmp_build"
printf 'A11_MEMORY_REMOTE_TIMEOUT_MS=5000\n' >> "$tmp_build"
printf 'A11_EMBEDDING_TIMEOUT_MS=2500\n' >> "$tmp_build"
printf 'A11_RUNTIME_ROOT=/app/runtime\n' >> "$tmp_build"
mv "$tmp_build" "$build_env"
chmod 600 "$build_env"
if [ -s "$a11_env" ]; then
  tmp_compose="$(mktemp)"
  grep -v -E "$managed_keys" "$a11_env" > "$tmp_compose" || true
  cat "$build_env" >> "$tmp_compose"
  mv "$tmp_compose" "$compose_env"
else
  tmp_compose="$(mktemp)"
  grep -v -E "$managed_keys" "$compose_env" > "$tmp_compose" || true
  cat "$build_env" >> "$tmp_compose"
  mv "$tmp_compose" "$compose_env"
fi
chmod 600 "$compose_env"
'@
$remoteBuildEnvRefresh = $remoteBuildEnvRefresh.
  Replace('__REMOTE_ROOT__', $RemoteRoot).
  Replace('__BUILD_COMMIT__', $BuildCommit).
  Replace('__BUILD_BRANCH__', $BuildBranch).
  Replace('__BUILD_DATE__', $BuildDateIso)

$remoteSecretStep = if ($ReuseRemoteSecrets) {
  $remoteBuildEnvRefresh
} else {
  @"
chmod 600 $RemoteRoot/secrets/a11.env
chmod 600 $RemoteRoot/secrets/build.env
cat $RemoteRoot/secrets/a11.env $RemoteRoot/secrets/build.env > $RemoteRoot/secrets/compose.env
chmod 600 $RemoteRoot/secrets/compose.env
"@
}

$remoteOllamaStep = @'
mkdir -p /srv/a11-data/ollama
ensure_server_default_network() {
  if docker network inspect server_default >/tmp/server-default-network.json 2>/dev/null; then
    compose_project="$(docker network inspect server_default --format '{{ index .Labels "com.docker.compose.project" }}' 2>/dev/null || true)"
    compose_network="$(docker network inspect server_default --format '{{ index .Labels "com.docker.compose.network" }}' 2>/dev/null || true)"
    if [ "$compose_project" != "server" ] || [ "$compose_network" != "default" ]; then
      docker rm -f a11-ollama >/dev/null 2>&1 || true
      docker network rm server_default >/dev/null 2>&1 || true
    fi
  fi
  docker network inspect server_default >/dev/null 2>&1 || docker network create \
    --label com.docker.compose.project=server \
    --label com.docker.compose.network=default \
    server_default >/dev/null
}
ensure_server_default_network
if docker inspect a11-ollama >/dev/null 2>&1; then
  docker start a11-ollama >/dev/null 2>&1 || true
else
  docker pull ollama/ollama:latest
  docker run -d \
    --name a11-ollama \
    --restart unless-stopped \
    --network server_default \
    --network-alias a11-ollama \
    -p 127.0.0.1:11434:11434 \
    -v /srv/a11-data/ollama:/root/.ollama \
    -e OLLAMA_HOST=0.0.0.0:11434 \
    -e OLLAMA_KEEP_ALIVE=30m \
    ollama/ollama:latest >/dev/null
fi
if ! docker inspect a11-ollama --format '{{json .NetworkSettings.Networks}}' | grep -q '"server_default"'; then
  docker network connect --alias a11-ollama server_default a11-ollama >/dev/null 2>&1 || true
fi
docker update --restart unless-stopped a11-ollama >/dev/null
docker exec a11-ollama sh -lc 'mkdir -p /root/.ollama; if [ ! -s /root/.ollama/id_ed25519.pub ]; then ollama signin >/dev/null 2>&1 || true; fi'
docker exec a11-ollama sh -lc 'ollama list | awk "NR>1 {print \$1}" | grep -qx nomic-embed-text || ollama pull nomic-embed-text >/dev/null 2>&1 || true'
docker exec a11-ollama sh -lc 'ollama list | awk "NR>1 {print \$1}" | grep -qx llama3.2:3b || ollama pull llama3.2:3b >/dev/null 2>&1 || true'
'@

$remoteComposeOwnershipStep = @'
compose_file="${compose_file:-__REMOTE_ROOT__/current/server/docker-compose.prod.yml}"
compose_project="${COMPOSE_PROJECT_NAME:-$(basename "$(dirname "$compose_file")")}"
ensure_compose_named_container_owner() {
  service="$1"
  container="$2"
  if ! docker inspect "$container" >/dev/null 2>&1; then
    return 0
  fi

  existing_project="$(docker inspect "$container" --format '{{ index .Config.Labels "com.docker.compose.project" }}' 2>/dev/null || true)"
  existing_service="$(docker inspect "$container" --format '{{ index .Config.Labels "com.docker.compose.service" }}' 2>/dev/null || true)"
  if [ "$existing_project" = "$compose_project" ] && [ "$existing_service" = "$service" ]; then
    return 0
  fi

  echo "__A11_COMPOSE_CONTAINER_CONFLICT__ $container existing_project=${existing_project:-none} existing_service=${existing_service:-none}; recreating via compose"
  docker rm -f "$container" >/dev/null
}

# STT is stateless apart from its bind-mounted cache; older manual containers may
# miss Compose labels and block blue/green deploys because container_name is fixed.
ensure_compose_named_container_owner "a11-stt-whisper" "a11-stt-whisper"
'@
$remoteComposeOwnershipStep = $remoteComposeOwnershipStep.Replace('__REMOTE_ROOT__', $RemoteRoot)

if ($BlueGreen) {
  $cleanOldFlag = if ($CleanOldBlueGreen) { "1" } else { "0" }
  $remoteDeploy = @"
set -euo pipefail
release=$RemoteRoot/releases/$Stamp
compose_file=$RemoteRoot/current/server/docker-compose.prod.yml
a11_service=$A11BackendService
k44_service=$Kaen44BackendService
next_color=$DeployBlueGreenColor
old_color=$ActiveBlueGreenColor
clean_old=$cleanOldFlag
mkdir -p "`$release" $RemoteRoot/bluegreen
tar -xzf $RemoteArchive -C "`$release"
ln -sfn "`$release" $RemoteRoot/current
$remoteSecretStep
$remoteOllamaStep
$remoteComposeOwnershipStep
docker compose -f "`$compose_file" --env-file $RemoteRoot/secrets/compose.env up -d --build a11-postgres a11-redis a11-stt-whisper a11-xtts-rvc a11-voice
docker compose -f "`$compose_file" --env-file $RemoteRoot/secrets/compose.env up -d --build --force-recreate a11-ekko "`$a11_service" "`$k44_service"
echo "__BLUEGREEN_HEALTH__"
for i in `$(seq 1 45); do
  if docker exec "`$a11_service" curl -fsS http://127.0.0.1:3000/health >/tmp/a11-bg-health-a11 2>/dev/null \
    && docker exec "`$k44_service" curl -fsS http://127.0.0.1:3001/health >/tmp/a11-bg-health-k44 2>/dev/null; then
    cat /tmp/a11-bg-health-a11
    cat /tmp/a11-bg-health-k44
    break
  fi
  if [ "`$i" = "45" ]; then
    echo "Blue/green healthcheck failed for `$a11_service / `$k44_service" >&2
    docker compose -f "`$compose_file" --env-file $RemoteRoot/secrets/compose.env ps
    exit 42
  fi
  sleep 2
done
docker compose -f "`$compose_file" --env-file $RemoteRoot/secrets/compose.env up -d --no-deps --force-recreate a11-caddy
echo "`$next_color" > $RemoteRoot/bluegreen/active-color
docker compose -f "`$compose_file" --env-file $RemoteRoot/secrets/compose.env ps
if [ "`$clean_old" = "1" ] && [ "`$old_color" != "none" ] && [ "`$old_color" != "`$next_color" ]; then
  docker rm -f "a11-backend-`$old_color" "kaen44-backend-`$old_color" 2>/dev/null || true
fi
echo "__A11_HEALTH__"
for i in `$(seq 1 30); do
  if curl -fsS http://127.0.0.1/health 2>/dev/null; then
    break
  fi
  sleep 2
done
"@
} else {
  $remoteDeploy = @"
set -euo pipefail
release=$RemoteRoot/releases/$Stamp
mkdir -p "`$release"
tar -xzf $RemoteArchive -C "`$release"
ln -sfn "`$release" $RemoteRoot/current
$remoteSecretStep
$remoteOllamaStep
$remoteComposeOwnershipStep
docker compose -f $RemoteRoot/current/server/docker-compose.prod.yml --env-file $RemoteRoot/secrets/compose.env up -d --build --force-recreate
docker compose -f $RemoteRoot/current/server/docker-compose.prod.yml --env-file $RemoteRoot/secrets/compose.env ps
echo "__A11_HEALTH__"
for i in `$(seq 1 30); do
  if curl -fsS http://127.0.0.1/health 2>/dev/null; then
    break
  fi
  sleep 2
done
echo "__A11_PRUNE__"
docker builder prune --all --force --filter until=24h 2>/dev/null || true
ls -1d $RemoteRoot/releases/20[0-9][0-9][0-9][0-9][0-9][0-9]-[0-9]* 2>/dev/null | sort | head -n -3 | xargs -r rm -rf || true
rm -f $RemoteRoot/releases/*.tar.gz $RemoteRoot/releases/*.tgz || true
echo "__A11_PRUNE_DONE__"
"@
}
$remoteDeployEncoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($remoteDeploy.Replace("`r`n", "`n").Replace("`r", "`n")))
& ssh @sshBase $Remote "printf '%s' '$remoteDeployEncoded' | base64 -d | bash"
if ($LASTEXITCODE -ne 0) { throw "Deploiement distant echoue" }

if ($BlueGreen) {
  Write-Host "Deploy A11 prod Finlande termine: $Remote / release $Stamp / blue-green=$DeployBlueGreenColor" -ForegroundColor Green
} else {
  Write-Host "Deploy A11 prod Finlande termine: $Remote / release $Stamp" -ForegroundColor Green
}

