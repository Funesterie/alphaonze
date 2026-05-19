param(
  [string]$RepoRoot = "D:\projets\funesterie"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RepoRoot = (Resolve-Path -LiteralPath $RepoRoot).Path
$A11Root = Join-Path $RepoRoot "a11"
$ServerRoot = Join-Path $A11Root "backend\apps\server"
$VoiceRoot = Join-Path $A11Root "backend\apps\voice-module"
$EkkoRoot = Join-Path $A11Root "backend\apps\ekko"
$WebDist = Join-Path $A11Root "frontend\apps\web\dist"
$EnvSource = Join-Path $ServerRoot "profiles\a11.env"
$McpEnvSource = Join-Path $RepoRoot "a11mcp\.env"
$VivyVoiceReference = Join-Path $VoiceRoot "samples\vivy-adaptive.wav"
if (-not (Test-Path -LiteralPath $VivyVoiceReference)) {
  $VivyVoiceReference = Join-Path $VoiceRoot "samples\a11-voice-adaptive.wav"
}
$Remote = "deploy@62.238.43.32"
$SshKey = "C:\Users\Djeff\.ssh\codex_a11_hetzner_20260511"
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

Require-Path $RepoRoot "Repo"
Invoke-SourceUpdate $RepoRoot
Require-Path $ServerRoot "Backend A11"
Require-Path $VoiceRoot "Module voix"
Require-Path $EkkoRoot "Module Ekko"
Require-Path $WebDist "Frontend dist"
Require-Path $EnvSource "Env prod source"
Require-Path $SshKey "Cle SSH"

$sshBase = @("-i", $SshKey, "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=accept-new")

function Read-RemoteEnvValue([string]$Key) {
  $remoteCmd = "if [ ! -f $RemoteRoot/secrets/a11.env ]; then exit 44; fi; grep -m1 '^$Key=' $RemoteRoot/secrets/a11.env | sed 's/^[^=]*=//' || true"
  $value = & ssh @sshBase $Remote $remoteCmd 2>$null
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
$EkkoStage = Join-Path $StageRoot "ekko"
$WebStage = Join-Path $StageRoot "web\dist"

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
Invoke-RobocopyChecked $EkkoRoot $EkkoStage $ekkoCopyArgs
Invoke-RobocopyChecked $WebDist $WebStage @("/MIR")
Remove-StagedSensitiveFiles $ServerStage
Remove-StagedSensitiveFiles $VoiceStage
Remove-StagedSensitiveFiles $EkkoStage
Remove-StagedSensitiveFiles $WebStage

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

  a11-voice:
    build:
      context: ../voice-module
    container_name: a11-voice
    restart: unless-stopped
    environment:
      PORT: 5002
      A11_VOICE_OUT_DIR: /app/out
    volumes:
      - /srv/a11-data/a11/voice-out:/app/out
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
      - /srv/a11/secrets/a11.env
    environment:
      A11_WEB_DIST_DIR: /web/dist
      A11_PROFILE_ENV: /app/profiles/a11.prod.env.disabled
      A11_VISION_PROVIDER: janus
      A11_JANUS_ENABLED: "true"
      A11_JANUS_PYTHON_PATH: /opt/janus-venv/bin/python
      A11_JANUS_MODEL_ID: deepseek-ai/Janus-Pro-1B
      A11_JANUS_DEVICE: ${A11_JANUS_DEVICE:-cpu}
      A11_JANUS_TORCH_DTYPE: ${A11_JANUS_TORCH_DTYPE:-auto}
      A11_JANUS_PREFER_LATEST: ${A11_JANUS_PREFER_LATEST:-false}
      A11_JANUS_TIMEOUT_MS: ${A11_JANUS_TIMEOUT_MS:-180000}
    depends_on:
      a11-postgres:
        condition: service_healthy
      a11-redis:
        condition: service_healthy
      a11-voice:
        condition: service_started
    volumes:
      - /srv/a11-data/a11/logs:/app/logs
      - /srv/a11-data/a11/runtime:/app/runtime
      - /srv/a11-data/a11/uploads:/app/runtime/files/uploads
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
      - /srv/a11/secrets/a11.env
    environment:
      PORT: "3001"
      A11_WEB_DIST_DIR: /web/dist
      A11_PROFILE_ENV: /app/profiles/kaen44.prod.env.disabled
      KAEN44_PROFILE_ENV: /app/profiles/kaen44.prod.env.disabled
      A11_VISION_PROVIDER: janus
      A11_JANUS_ENABLED: "true"
      A11_JANUS_PYTHON_PATH: /opt/janus-venv/bin/python
      A11_JANUS_MODEL_ID: deepseek-ai/Janus-Pro-1B
      A11_JANUS_DEVICE: ${A11_JANUS_DEVICE:-cpu}
      A11_JANUS_TORCH_DTYPE: ${A11_JANUS_TORCH_DTYPE:-auto}
      A11_JANUS_PREFER_LATEST: ${A11_JANUS_PREFER_LATEST:-false}
      A11_JANUS_TIMEOUT_MS: ${A11_JANUS_TIMEOUT_MS:-180000}
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
      GOOGLE_CALLBACK_URL: https://k44.funesterie.me/api/auth/google/callback
      A11_GOOGLE_CALLBACK_URL: https://k44.funesterie.me/api/auth/google/callback
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
      a11-voice:
        condition: service_started
    volumes:
      - /srv/a11-data/a11/kaen44-logs:/app/logs
      - /srv/a11-data/a11/kaen44-runtime:/app/runtime
      - /srv/a11-data/a11/kaen44-uploads:/app/runtime/files/uploads
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
$compose = $compose.Replace("/srv/a11-data/a11", $RemoteDataRoot)
$compose = $compose.Replace("/srv/a11", $RemoteRoot)
Set-Content -LiteralPath (Join-Path $ServerStage "docker-compose.prod.yml") -Value $compose -Encoding UTF8

$caddy = @'
http://funesterie.me, http://www.funesterie.me, http://k44.funesterie.me, http://kaen44.funesterie.me, http://vivy.funesterie.me {
  encode zstd gzip
  @a11Path path /a11 /a11/*
  handle @a11Path {
    reverse_proxy a11-backend:3000
  }
  handle {
    reverse_proxy kaen44-backend:3001
  }
}

https://funesterie.me, https://www.funesterie.me, https://k44.funesterie.me, https://kaen44.funesterie.me, https://vivy.funesterie.me {
  encode zstd gzip
  @a11Path path /a11 /a11/*
  handle @a11Path {
    reverse_proxy a11-backend:3000
  }
  handle {
    reverse_proxy kaen44-backend:3001
  }
}

http://a11.funesterie.me {
  encode zstd gzip
  reverse_proxy a11-backend:3000
}

https://a11.funesterie.me {
  encode zstd gzip
  reverse_proxy a11-backend:3000
}

:80 {
  reverse_proxy a11-backend:3000
}
'@
Set-Content -LiteralPath (Join-Path $StageRoot "Caddyfile") -Value $caddy -Encoding UTF8

$envMap = Read-EnvMap $EnvSource
$mcpEnvMap = if (Test-Path -LiteralPath $McpEnvSource) { Read-EnvMap $McpEnvSource } else { [ordered]@{} }
$removeKeys = @(
  "POSTGRES_DB", "POSTGRES_USER", "POSTGRES_PASSWORD", "DATABASE_URL", "REDIS_URL",
  "QFLUSH_REDIS_URL", "QFLUSH_URL", "QFLUSH_REMOTE_URL", "QFLUSH_BASE_URL",
  "QFLUSH_ENDPOINT", "QFLUSH_PUBLIC_URL", "PUBLIC_QFLUSH_URL", "QFLUSH_HEALTH_URL",
  "PUBLIC_APP_URL", "FRONTEND_URL", "PUBLIC_FRONTEND_URL", "FRONT_URL", "APP_URL", "API_URL", "PUBLIC_API_URL",
  "A11_SERVER_URL", "A11_PUBLIC_HOST", "GOOGLE_CALLBACK_URL", "A11_GOOGLE_CALLBACK_URL",
  "MICROSOFT_REDIRECT_URI", "MICROSOFT_CALLBACK_URL", "AZURE_REDIRECT_URI",
  "A11_SESSION_COOKIE_SAMESITE", "NEZ_SECURITY_MODE", "A11_ENABLE_QFLUSH",
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

$existingPgPass = Read-RemoteEnvValue "POSTGRES_PASSWORD"
$existingAdminPass = Read-RemoteEnvValue "DEFAULT_ADMIN_PASSWORD"
$existingMcpToken = Read-RemoteEnvValue "A11_MCP_TOKEN"
$existingEkkoToken = Read-RemoteEnvValue "EKKO_TOKEN"
$pgPass = if ([string]::IsNullOrWhiteSpace($existingPgPass)) { New-HexSecret 32 } else { $existingPgPass }
$adminPass = if ([string]::IsNullOrWhiteSpace($existingAdminPass)) { New-HexSecret 24 } else { $existingAdminPass }
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
$overrides = [ordered]@{
  NODE_ENV = "production"
  PORT = "3000"
  HOST_SERVER = "0.0.0.0"
  POSTGRES_DB = "a11"
  POSTGRES_USER = "a11"
  POSTGRES_PASSWORD = $pgPass
  DATABASE_URL = "postgresql://a11:$pgPassEncoded@a11-postgres:5432/a11"
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
  A11_MCP_URL = "https://mcp.funesterie.me/mcp"
  FUNESTERIE_MCP_URL = "https://mcp.funesterie.me/mcp"
  A11_PUBLIC_MCP_UPSTREAM_URL = "https://mcp.funesterie.me/mcp"
  GOOGLE_CALLBACK_URL = "https://a11.funesterie.me/api/auth/google/callback"
  A11_GOOGLE_CALLBACK_URL = "https://a11.funesterie.me/api/auth/google/callback"
  A11_SESSION_COOKIE_SAMESITE = "lax"
  NEZ_SECURITY_MODE = "strict"
  A11_ENABLE_QFLUSH = "1"
  QFLUSH_CHAT_FLOW = "a11.chat.v1"
  A11_QFLUSH_CHAT_FLOW = "a11.chat.v1"
  A11_QFLUSH_USE_DRAGON = "false"
  A11_IMAGE_PROVIDER_ORDER = "sd,hf,replicate,openai,pollinations"
  A11_ENABLE_HF_IMAGE = "true"
  A11_HF_IMAGE_STEPS = "4"
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
  A11_CERBERE_PREFER_NON_GROQ = "false"
  A11_LLM_FALLBACK_PROVIDER = "openrouter"
  A11_LLM_RUNTIME_FALLBACK_ORDER = "openrouter,groq,openai,together,xai,huggingface,ollama,deepseek"
  A11_RUNTIME_PROFILE = "prod"
  A11_PRODUCT = "a11"
  A11_INSTANCE_NAME = "Alpha Onze"
  SERVE_STATIC = "true"
  A11_WEB_DIST_DIR = "/web/dist"
  TTS_URL = "http://a11-voice:5002"
  VOICE_MODULE_URL = "http://a11-voice:5002"
  A11_VOICE_MODULE_URL = "http://a11-voice:5002"
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
  A11_USAGE_GUARD_ADMIN_EMAIL = "cellaurojeffrey@gmail.com"
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
}
Write-EnvFile $buildEnvMap $BuildEnvStage

if (Test-Path -LiteralPath $Archive) {
  Remove-Item -LiteralPath $Archive -Force
}
& tar.exe -czf $Archive -C $StageRoot server voice-module ekko web Caddyfile
if ($LASTEXITCODE -ne 0) { throw "Creation archive echouee" }
$archiveSizeMb = [Math]::Round((Get-Item -LiteralPath $Archive).Length / 1MB, 2)
Write-Host "Archive creee: $Archive ($archiveSizeMb MB)" -ForegroundColor DarkCyan

$remotePrepare = "mkdir -p $RemoteRoot/secrets $RemoteRoot/releases $RemoteDataRoot/postgres $RemoteDataRoot/redis $RemoteDataRoot/logs $RemoteDataRoot/runtime $RemoteDataRoot/runtime/voice-library $RemoteDataRoot/uploads $RemoteDataRoot/voice-out $RemoteDataRoot/kaen44-logs $RemoteDataRoot/kaen44-runtime $RemoteDataRoot/kaen44-runtime/voice-library $RemoteDataRoot/kaen44-uploads $RemoteDataRoot/caddy-data $RemoteDataRoot/caddy-config && chmod 700 $RemoteRoot/secrets"
& ssh @sshBase $Remote $remotePrepare
if ($LASTEXITCODE -ne 0) { throw "Preparation distante echouee" }

& scp @sshBase $Archive "${Remote}:$RemoteArchive"
if ($LASTEXITCODE -ne 0) { throw "Copie archive echouee" }
& scp @sshBase $SecretStage "${Remote}:$RemoteRoot/secrets/a11.env"
if ($LASTEXITCODE -ne 0) { throw "Copie env echouee" }
& scp @sshBase $BuildEnvStage "${Remote}:$RemoteRoot/secrets/build.env"
if ($LASTEXITCODE -ne 0) { throw "Copie env build echouee" }

if (Test-Path -LiteralPath $VivyVoiceReference) {
  & scp @sshBase $VivyVoiceReference "${Remote}:$RemoteDataRoot/runtime/voice-library/vivy-adaptive.wav"
  if ($LASTEXITCODE -ne 0) { throw "Copie reference voix Vivy A11 echouee" }
  & scp @sshBase $VivyVoiceReference "${Remote}:$RemoteDataRoot/kaen44-runtime/voice-library/vivy-adaptive.wav"
  if ($LASTEXITCODE -ne 0) { throw "Copie reference voix Vivy K44 echouee" }
}

$remoteDeploy = @"
set -euo pipefail
release=$RemoteRoot/releases/$Stamp
mkdir -p "`$release"
tar -xzf $RemoteArchive -C "`$release"
ln -sfn "`$release" $RemoteRoot/current
chmod 600 $RemoteRoot/secrets/a11.env
chmod 600 $RemoteRoot/secrets/build.env
cat $RemoteRoot/secrets/a11.env $RemoteRoot/secrets/build.env > $RemoteRoot/secrets/compose.env
chmod 600 $RemoteRoot/secrets/compose.env
docker compose -f $RemoteRoot/current/server/docker-compose.prod.yml --env-file $RemoteRoot/secrets/compose.env up -d --build --force-recreate
docker compose -f $RemoteRoot/current/server/docker-compose.prod.yml --env-file $RemoteRoot/secrets/compose.env ps
echo "__A11_HEALTH__"
for i in `$(seq 1 30); do
  if curl -fsS http://127.0.0.1/health; then
    break
  fi
  sleep 2
done
"@
$remoteDeployEncoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($remoteDeploy.Replace("`r`n", "`n").Replace("`r", "`n")))
& ssh @sshBase $Remote "printf '%s' '$remoteDeployEncoded' | base64 -d | bash"
if ($LASTEXITCODE -ne 0) { throw "Deploiement distant echoue" }

Write-Host "Deploy A11 prod Finlande termine: $Remote / release $Stamp" -ForegroundColor Green
