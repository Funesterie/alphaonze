param(
  [string]$RepoRoot = "D:\projets\funesterie",
  [string]$Remote = $(if ($env:A11_HETZNER_REMOTE) { $env:A11_HETZNER_REMOTE } else { "deploy@37.27.63.109" }),
  [string]$SshKey = $(if ($env:A11_HETZNER_SSH_KEY) { $env:A11_HETZNER_SSH_KEY } else { "C:\Users\cella\.ssh\codex-a11-hetzner-20260627_ed25519" }),
  [switch]$ReuseRemoteSecrets,
  [switch]$BlueGreen,
  [switch]$CleanOldBlueGreen,
  [switch]$SkipSourceUpdate,
  [string]$ReleaseStamp = "",
  [switch]$ReuseRemoteArchive,
  [switch]$SkipRuntimeAssetSync
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
if ($ReleaseStamp -and $ReleaseStamp -notmatch '^\d{8}-\d{6}$') {
  throw "ReleaseStamp invalide: format attendu yyyyMMdd-HHmmss"
}
$Stamp = if ($ReleaseStamp) { $ReleaseStamp } else { Get-Date -Format "yyyyMMdd-HHmmss" }
$TmpRoot = Join-Path $RepoRoot ".codex-tmp"
$StageRoot = Join-Path $TmpRoot "a11-prod-finland-2-$Stamp"
$Archive = Join-Path $TmpRoot "a11-prod-finland-2-$Stamp.tar.gz"
$RemoteRoot = "/home/deploy/a11-prod"
$RemoteDataRoot = "/home/deploy/a11-data"
$RemoteArchive = "$RemoteRoot/releases/$Stamp.tar.gz"
$JfrogEnv = Join-Path $RepoRoot "scripts\jfrog\jfrog.env.ps1"
$StrongSongOllamaModel = if ($env:A11_OLLAMA_STRONG_SONG_MODEL) { $env:A11_OLLAMA_STRONG_SONG_MODEL } else { "qwen2.5:32b" }

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
if ($SkipSourceUpdate) {
  Write-Host "Mise a jour source sautee a la demande; packaging depuis le workspace local." -ForegroundColor Yellow
} else {
  Invoke-SourceUpdate $RepoRoot
}
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

# ServerAlive*: sur un lien qui tombe en silence (tethering, reseau filtre), la connexion
# meurt sans que rien ne le signale et ssh attend INDEFINIMENT. Observe le 29/07/2026: un
# ssh reste 90 minutes a 0 % de CPU, le deploiement fige, et aucune logique de reprise ne
# peut se declencher puisque la commande ne rend jamais la main. Avec ces options, un pair
# muet est declare mort en ~60 s, la commande sort en erreur et l'appelant peut reessayer.
$sshBase = @(
  "-i", $SshKey,
  "-o", "BatchMode=yes",
  "-o", "StrictHostKeyChecking=accept-new",
  "-o", "ConnectTimeout=20",
  "-o", "ServerAliveInterval=15",
  "-o", "ServerAliveCountMax=4"
)

# Envoi d'un fichier par le canal stdin de ssh, jamais par scp.
#
# Mesure du 01/08/2026 depuis la meme machine et le meme lien : scp se fige ou se
# fait couper ("Connection reset by <box> port 22") alors que le meme lien fait
# passer 40 Mo par stdin de ssh sans une seule interruption. Le deploiement du
# 02/08 est mort exactement la : l'archive de 40 Mo etait passee par stdin sans
# incident, puis la copie d'un simple mp3 de reference voix, restee en scp, a ete
# reinitialisee.
#
# On ecrit d'abord dans un fichier temporaire distant, puis on renomme : un
# transfert coupe en vol ne laisse jamais un fichier a moitie ecrit en place.
function Send-FileViaSsh {
  param(
    [string[]]$SshArgs,
    [string]$RemoteHost,
    [string]$LocalPath,
    [string]$RemotePath,
    [int]$TimeoutSeconds = 0
  )

  # Delai proportionnel a la taille, pas fixe. Le forfait de 300 s tuait vivy.wav
  # (24 Mo) a cinquante secondes de la fin : a la vitesse mesuree du lien, environ
  # 70 Ko/s, ce fichier demande ~350 s. Le fichier voisin de 2 Mo passait, celui-ci
  # ne pouvait pas -- l'echec ressemblait a un probleme de fichier alors qu'il etait
  # arithmetique. On prend un plancher pessimiste de 20 Ko/s, et jamais moins de
  # 300 s pour les petits fichiers.
  if ($TimeoutSeconds -le 0) {
    $tailleOctets = 0
    try { $tailleOctets = (Get-Item -LiteralPath $LocalPath).Length } catch { }
    $TimeoutSeconds = [Math]::Max(300, [int][Math]::Ceiling($tailleOctets / 20000))
  }

  # Les chemins distants sont entoures de guillemets simples cote shell. Un nom de
  # fichier contenant une apostrophe -- "djeff-corpus-C'est chaud.mp3" existe dans la
  # bibliotheque de voix -- fermait la chaine et cassait la commande. Echappement
  # POSIX standard : ' devient '\''.
  $escapedRemote = $RemotePath.Replace("'", "'\''")
  $escapedTmp = "$RemotePath.part".Replace("'", "'\''")

  $errFile = [IO.Path]::GetTempFileName()
  $cmd = "cat > '$escapedTmp' && mv -f '$escapedTmp' '$escapedRemote'"
  $args = @($SshArgs) + @($RemoteHost, $cmd)

  $debut = Get-Date
  try {
    # Reprise sur coupure passagere. Le 02/08, apres 31 fichiers transmis dont
    # vivy.wav (24 Mo), le deploiement est mort sur un fichier de 441 octets :
    # "ssh: connect to host ... port 22: Connection timed out". Le lien avait lache
    # une seconde. Sans reprise, une seconde de reseau coute une passe entiere.
    $tentatives = 3
    for ($essai = 1; $essai -le $tentatives; $essai += 1) {
      $proc = Start-Process -FilePath "ssh" -ArgumentList $args -NoNewWindow -PassThru `
        -RedirectStandardInput $LocalPath -RedirectStandardError $errFile
      $proc | Wait-Process -Timeout $TimeoutSeconds -ErrorAction SilentlyContinue
      if (-not $proc.HasExited) {
        Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
        $global:LASTEXITCODE = 124
      } else {
        $global:LASTEXITCODE = [int]$proc.ExitCode
      }
      if ($LASTEXITCODE -eq 0) { break }
      if ($essai -lt $tentatives) {
        Write-Host ("  reprise {0}/{1} sur {2}" -f $essai, ($tentatives - 1), (Split-Path $LocalPath -Leaf)) -ForegroundColor DarkGray
        Start-Sleep -Seconds (5 * $essai)
      }
    }

    # Le flux d'erreur de ssh etait supprime sans jamais etre lu. Consequence : trois
    # pannes sans aucun rapport -- scp coupe, apostrophe non echappee, delai
    # forfaitaire trop court -- ressortaient toutes sous le meme message generique
    # "Copie reference voix ... echouee", et chacune a coute une passe de deploiement
    # entiere avant d'etre comprise. On montre desormais ce que ssh a dit.
    if ($LASTEXITCODE -ne 0) {
      $secondes = [int]((Get-Date) - $debut).TotalSeconds
      $taille = 0
      try { $taille = (Get-Item -LiteralPath $LocalPath).Length } catch { }
      $motif = if ($LASTEXITCODE -eq 124) { "delai depasse apres $TimeoutSeconds s" } else { "code $LASTEXITCODE" }
      Write-Host ("  echec envoi: {0} ({1:N0} octets, {2} s, {3})" -f (Split-Path $LocalPath -Leaf), $taille, $secondes, $motif) -ForegroundColor DarkYellow
      $detail = (Get-Content -LiteralPath $errFile -Raw -ErrorAction SilentlyContinue)
      if ($detail) { Write-Host ("  ssh a dit: " + $detail.Trim()) -ForegroundColor DarkYellow }
      else { Write-Host "  ssh n'a rien ecrit sur stderr" -ForegroundColor DarkYellow }
    }
  } finally {
    Remove-Item -LiteralPath $errFile -Force -ErrorAction SilentlyContinue
  }
}

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
  "*.safetensors", "*.ckpt", "*.pt", "*.pth", "*.onnx", "*.gguf",
  # Fichier de travail local appartenant a l'utilisateur : ne jamais le mettre
  # dans une release de production tant qu'il n'est pas explicitement integre.
  "start-gatekeeper.cjs"
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
      A11_TTS_VOICE_POLISH_ENABLED: ${A11_TTS_VOICE_POLISH_ENABLED:-true}
      A11_VOICE_CONVERSION_ENABLED: ${A11_VOICE_CONVERSION_ENABLED:-true}
      A11_VOICE_XTTS_RVC_URL: ${A11_VOICE_XTTS_RVC_URL:-http://a11-xtts-rvc:5000}
      A11_PROFILE_ENV: /app/profiles/a11.prod.env.disabled
      A11_RUNTIME_ROOT: /app/runtime
      A11_EPISODIC_MEMORY_DIR: /app/runtime/episodic-memory
      A11_LOCAL_NEO4J_URI: ${A11_LOCAL_NEO4J_URI:-bolt://a11-neo4j:7687}
      A11_LOCAL_NEO4J_USER: ${A11_LOCAL_NEO4J_USER:-neo4j}
      A11_LOCAL_NEO4J_DATABASE: ${A11_LOCAL_NEO4J_DATABASE:-neo4j}
      VIVY_GRAPH_ALLOW_PARTIAL_SYNC: ${VIVY_GRAPH_ALLOW_PARTIAL_SYNC:-1}
      A11_LLM_PROVIDER: ollama
      A11_OLLAMA_PRIMARY_MODEL: qwen2.5:32b
      A11_OLLAMA_FALLBACK_MODEL: qwen2.5:7b
      VIVY_CHAT_LOCAL_FIRST: "true"
      VIVY_OLLAMA_BASE_URL: http://a11-ollama:11434
      VIVY_CHAT_LOCAL_MODEL: qwen2.5:7b
      VIVY_CHAT_LOCAL_TIMEOUT_MS: ${VIVY_CHAT_LOCAL_TIMEOUT_MS:-90000}
      VIVY_CHAT_LOCAL_MAX_PROMPT_CHARS: ${VIVY_CHAT_LOCAL_MAX_PROMPT_CHARS:-10000}
      VIVY_CHAT_LOCAL_MAX_TOKENS: ${VIVY_CHAT_LOCAL_MAX_TOKENS:-800}
      VIVY_SONG_PROVIDER: ${VIVY_SONG_PROVIDER:-ollama}
      VIVY_XAI_MODEL: ${VIVY_XAI_MODEL:-grok-4.3}
      OLLAMA_CLOUD_ENABLED: ${OLLAMA_CLOUD_ENABLED:-1}
      OLLAMA_CLOUD_BASE_URL: ${OLLAMA_CLOUD_BASE_URL:-https://ollama.com}
      OLLAMA_CLOUD_LYRICS_MODEL: ${OLLAMA_CLOUD_LYRICS_MODEL:-gpt-oss:120b}
      OLLAMA_CLOUD_FAST_MODEL: ${OLLAMA_CLOUD_FAST_MODEL:-gpt-oss:20b}
      OLLAMA_CLOUD_CHAT_ENABLED: ${OLLAMA_CLOUD_CHAT_ENABLED:-1}
      OLLAMA_CLOUD_CHAT_MODEL: ${OLLAMA_CLOUD_CHAT_MODEL:-gpt-oss:120b}
      OLLAMA_CLOUD_CHAT_THINK_LEVEL: ${OLLAMA_CLOUD_CHAT_THINK_LEVEL:-high}
      OLLAMA_CLOUD_CHAT_TIMEOUT_MS: ${OLLAMA_CLOUD_CHAT_TIMEOUT_MS:-300000}
      OLLAMA_CLOUD_THINK_LEVEL: ${OLLAMA_CLOUD_THINK_LEVEL:-high}
      OLLAMA_CLOUD_LYRICS_TIMEOUT_MS: ${OLLAMA_CLOUD_LYRICS_TIMEOUT_MS:-360000}
      VIVY_SONG_CERBERE_FALLBACK_ENABLED: ${VIVY_SONG_CERBERE_FALLBACK_ENABLED:-1}
      VIVY_SONG_CERBERE_MODEL: ${VIVY_SONG_CERBERE_MODEL:-openai/gpt-oss-120b}
      VIVY_SONG_CERBERE_TIMEOUT_MS: ${VIVY_SONG_CERBERE_TIMEOUT_MS:-240000}
      VIVY_GROQ_RATE_LIMIT_COOLDOWN_MS: ${VIVY_GROQ_RATE_LIMIT_COOLDOWN_MS:-300000}
      VIVY_CHAT_MAX_TOKENS: ${VIVY_CHAT_MAX_TOKENS:-5000}
      VIVY_CHAT_MAX_TOKENS_SONG: ${VIVY_CHAT_MAX_TOKENS_SONG:-10000}
      VIVY_CHAT_MAX_TOKENS_SONG_CEILING: ${VIVY_CHAT_MAX_TOKENS_SONG_CEILING:-12000}
      VIVY_SONG_ALLOW_LOCAL_FALLBACK: ${VIVY_SONG_ALLOW_LOCAL_FALLBACK:-true}
      VIVY_SONG_ALLOW_LOCAL_LYRICS_FALLBACK: ${VIVY_SONG_ALLOW_LOCAL_LYRICS_FALLBACK:-true}
      VIVY_SONG_LOCAL_MODEL: ${VIVY_SONG_LOCAL_MODEL:-qwen2.5:7b}
      VIVY_NOSSEN_LOCAL_MODEL: ${VIVY_NOSSEN_LOCAL_MODEL:-qwen2.5:32b}
      VIVY_NOSSEN_LARGE_MODEL_FIRST: ${VIVY_NOSSEN_LARGE_MODEL_FIRST:-true}
      VIVY_NOSSEN_120B_MAX_PROMPT_CHARS: ${VIVY_NOSSEN_120B_MAX_PROMPT_CHARS:-22000}
      VIVY_NOSSEN_120B_MAX_TOKENS: ${VIVY_NOSSEN_120B_MAX_TOKENS:-2400}
      VIVY_NOSSEN_120B_TIMEOUT_MS: ${VIVY_NOSSEN_120B_TIMEOUT_MS:-25000}
      VIVY_NOSSEN_FAST_LOCAL_ONLY: ${VIVY_NOSSEN_FAST_LOCAL_ONLY:-true}
      VIVY_NOSSEN_ROUTE_LLM_ENABLED: ${VIVY_NOSSEN_ROUTE_LLM_ENABLED:-true}
      VIVY_NOSSEN_ROUTER_LOCAL_TIMEOUT_MS: ${VIVY_NOSSEN_ROUTER_LOCAL_TIMEOUT_MS:-20000}
      VIVY_NOSSEN_LYRICS_LOCAL_TIMEOUT_MS: ${VIVY_NOSSEN_LYRICS_LOCAL_TIMEOUT_MS:-40000}
      VIVY_NOSSEN_LOCAL_MAX_TOKENS: ${VIVY_NOSSEN_LOCAL_MAX_TOKENS:-2200}
      VIVY_NOSSEN_LLM_BUDGET_MS: ${VIVY_NOSSEN_LLM_BUDGET_MS:-80000}
      VIVY_NOSSEN_CLOUD_ATTEMPT_TIMEOUT_MS: ${VIVY_NOSSEN_CLOUD_ATTEMPT_TIMEOUT_MS:-22000}
      VIVY_NOSSEN_EMERGENCY_SONGCRAFT: ${VIVY_NOSSEN_EMERGENCY_SONGCRAFT:-true}
      VIVY_ACESTEP_LYRICS_MAX_CHARS: ${VIVY_ACESTEP_LYRICS_MAX_CHARS:-24000}
      ACESTEP_DIFFUSION_MODEL: ${ACESTEP_DIFFUSION_MODEL:-acestep_v1.5_turbo.safetensors}
      ACESTEP_TEXT_ENCODER_1: ${ACESTEP_TEXT_ENCODER_1:-qwen_0.6b_ace15.safetensors}
      ACESTEP_TEXT_ENCODER_2: ${ACESTEP_TEXT_ENCODER_2:-qwen_1.7b_ace15.safetensors}
      ACESTEP_TEXT_ENCODER_2_QWEN4: ${ACESTEP_TEXT_ENCODER_2_QWEN4:-qwen_4b_ace15.safetensors}
      ACESTEP_QWEN4_PROFILE_ENABLED: ${ACESTEP_QWEN4_PROFILE_ENABLED:-false}
      ACESTEP_VAE: ${ACESTEP_VAE:-ace_1.5_vae.safetensors}
      ACESTEP_STEPS: ${ACESTEP_STEPS:-8}
      ACESTEP_KSAMPLER_CFG: ${ACESTEP_KSAMPLER_CFG:-1}
      ACESTEP_LLM_CFG_SCALE: ${ACESTEP_LLM_CFG_SCALE:-2}
      ACESTEP_SHIFT: ${ACESTEP_SHIFT:-3}
      ACESTEP_SAMPLER: ${ACESTEP_SAMPLER:-euler}
      ACESTEP_SCHEDULER: ${ACESTEP_SCHEDULER:-simple}
      ACESTEP_DEFAULT_BPM: ${ACESTEP_DEFAULT_BPM:-120}
      ACESTEP_MAX_DURATION_SECONDS: ${ACESTEP_MAX_DURATION_SECONDS:-1000}
      ACESTEP_TIME_SIGNATURE: ${ACESTEP_TIME_SIGNATURE:-4}
      ACESTEP_LANGUAGE: ${ACESTEP_LANGUAGE:-fr}
      ACESTEP_KEYSCALE: ${ACESTEP_KEYSCALE:-C minor}
      ACESTEP_GENERATE_AUDIO_CODES: ${ACESTEP_GENERATE_AUDIO_CODES:-true}
      ACESTEP_TEMPERATURE: ${ACESTEP_TEMPERATURE:-0.85}
      ACESTEP_TOP_P: ${ACESTEP_TOP_P:-0.9}
      ACESTEP_TOP_K: ${ACESTEP_TOP_K:-0}
      ACESTEP_MIN_P: ${ACESTEP_MIN_P:-0}
      ACESTEP_MP3_QUALITY: ${ACESTEP_MP3_QUALITY:-V0}
      ACESTEP_HEALTH_ATTEMPTS: ${ACESTEP_HEALTH_ATTEMPTS:-6}
      ACESTEP_HEALTH_RETRY_MS: ${ACESTEP_HEALTH_RETRY_MS:-3000}
      VIVY_STREAM_FREESTYLE_MAX_CHARS: ${VIVY_STREAM_FREESTYLE_MAX_CHARS:-12000}
      VIVY_STREAM_FREESTYLE_MAX_TOKENS: ${VIVY_STREAM_FREESTYLE_MAX_TOKENS:-10000}
      VIVY_STREAM_COVER_ENABLED: ${VIVY_STREAM_COVER_ENABLED:-1}
      VIVY_STREAM_COVER_URL: ${VIVY_STREAM_COVER_URL:-http://127.0.0.1:3000/api/tools/generate_sd}
      VIVY_STREAM_COVER_TIMEOUT_MS: ${VIVY_STREAM_COVER_TIMEOUT_MS:-120000}
      VIVY_STREAM_CLIP_ENABLED: ${VIVY_STREAM_CLIP_ENABLED:-1}
      VIVY_STREAM_CLIP_PROVIDER: ${VIVY_STREAM_CLIP_PROVIDER:-auto}
      VIVY_STREAM_CLIP_DURATION_SECONDS: ${VIVY_STREAM_CLIP_DURATION_SECONDS:-3}
      VIVY_STREAM_CLIP_TIMEOUT_MS: ${VIVY_STREAM_CLIP_TIMEOUT_MS:-2700000}
      VIVY_STREAM_FULL_CLIP_ENABLED: ${VIVY_STREAM_FULL_CLIP_ENABLED:-1}
      VIVY_STREAM_FULL_CLIP_SOURCE_IMAGE_URL: ${VIVY_STREAM_FULL_CLIP_SOURCE_IMAGE_URL:-}
      VIVY_STREAM_DREAMCLIP_SOURCE_IMAGE_URL: ${VIVY_STREAM_DREAMCLIP_SOURCE_IMAGE_URL:-}
      VIVY_STREAM_FULL_CLIP_PROVIDER: ${VIVY_STREAM_FULL_CLIP_PROVIDER:-}
      VIVY_STREAM_FULL_CLIP_SCENES: ${VIVY_STREAM_FULL_CLIP_SCENES:-8}
      VIVY_STREAM_DREAMCLIP_SCENES: ${VIVY_STREAM_DREAMCLIP_SCENES:-8}
      VIVY_STREAM_DREAMCLIP_MAX_DURATION_SECONDS: ${VIVY_STREAM_DREAMCLIP_MAX_DURATION_SECONDS:-420}
      VIVY_STREAM_DREAMCLIP_LOOP_SECONDS: ${VIVY_STREAM_DREAMCLIP_LOOP_SECONDS:-15}
      VIVY_STREAM_DREAMCLIP_MIN_GENERATED_COVERAGE: ${VIVY_STREAM_DREAMCLIP_MIN_GENERATED_COVERAGE:-}
      VIVY_STREAM_DREAMCLIP_ALLOW_STATIC_FALLBACK: ${VIVY_STREAM_DREAMCLIP_ALLOW_STATIC_FALLBACK:-}
      VIVY_STREAM_FULL_CLIP_INSTRUMENTAL_SCENES: ${VIVY_STREAM_FULL_CLIP_INSTRUMENTAL_SCENES:-8}
      VIVY_STREAM_FULL_CLIP_UNIQUE_LOOPS: ${VIVY_STREAM_FULL_CLIP_UNIQUE_LOOPS:-5}
      VIVY_STREAM_FULL_CLIP_REUSE_CHORUS: ${VIVY_STREAM_FULL_CLIP_REUSE_CHORUS:-1}
      VIVY_STREAM_FULL_CLIP_CONCURRENCY: ${VIVY_STREAM_FULL_CLIP_CONCURRENCY:-2}
      VIVY_STREAM_FULL_CLIP_GENERATE_SCENE_LOOPS: ${VIVY_STREAM_FULL_CLIP_GENERATE_SCENE_LOOPS:-1}
      VIVY_STREAM_FULL_CLIP_LOOP_SECONDS: ${VIVY_STREAM_FULL_CLIP_LOOP_SECONDS:-8}
      VIVY_STREAM_FULL_CLIP_WIDTH: ${VIVY_STREAM_FULL_CLIP_WIDTH:-1280}
      VIVY_STREAM_FULL_CLIP_HEIGHT: ${VIVY_STREAM_FULL_CLIP_HEIGHT:-720}
      VIVY_STREAM_FULL_CLIP_FPS: ${VIVY_STREAM_FULL_CLIP_FPS:-24}
      VIVY_STREAM_FULL_CLIP_VISUAL_QA: ${VIVY_STREAM_FULL_CLIP_VISUAL_QA:-}
      A11_HF_VIDEO_PROVIDER: ${A11_HF_VIDEO_PROVIDER:-replicate}
      A11_REPLICATE_VIDEO_MODEL: ${A11_REPLICATE_VIDEO_MODEL:-wan-video/wan-2.6-i2v}
      A11_VIDEO_PROMPT_MAX_DURATION_SECONDS: ${A11_VIDEO_PROMPT_MAX_DURATION_SECONDS:-15}
      VIVY_STREAM_FULL_CLIP_CROP_SOURCE_IMAGE: ${VIVY_STREAM_FULL_CLIP_CROP_SOURCE_IMAGE:-1}
      VIVY_STREAM_FULL_CLIP_SOURCE_CROP_WIDTH_RATIO: ${VIVY_STREAM_FULL_CLIP_SOURCE_CROP_WIDTH_RATIO:-0.58}
      VIVY_STREAM_FULL_CLIP_SOURCE_CROP_X_BIAS: ${VIVY_STREAM_FULL_CLIP_SOURCE_CROP_X_BIAS:-0.62}
      VIVY_STREAM_FULL_CLIP_SOURCE_CROP_Y_BIAS: ${VIVY_STREAM_FULL_CLIP_SOURCE_CROP_Y_BIAS:-0.5}
      VIVY_STREAM_FULL_CLIP_DEMOSAIC_GRID: ${VIVY_STREAM_FULL_CLIP_DEMOSAIC_GRID:-0}
      VIVY_STREAM_FULL_CLIP_DEMOSAIC_COLUMNS: ${VIVY_STREAM_FULL_CLIP_DEMOSAIC_COLUMNS:-3}
      VIVY_STREAM_FULL_CLIP_DEMOSAIC_ROWS: ${VIVY_STREAM_FULL_CLIP_DEMOSAIC_ROWS:-3}
      VIVY_STREAM_FULL_CLIP_DEMOSAIC_ACTIVE_HEIGHT_RATIO: ${VIVY_STREAM_FULL_CLIP_DEMOSAIC_ACTIVE_HEIGHT_RATIO:-0.9}
      VIVY_STREAM_FULL_CLIP_DEMOSAIC_SEGMENT_SECONDS: ${VIVY_STREAM_FULL_CLIP_DEMOSAIC_SEGMENT_SECONDS:-1.25}
      VIVY_STREAM_FULL_CLIP_DEMOSAIC_ORDER: ${VIVY_STREAM_FULL_CLIP_DEMOSAIC_ORDER:-4,1,5,7,2,8}
      A11_TRANSLATION_MODEL: ${A11_TRANSLATION_MODEL:-qwen2.5:32b}
      LOCAL_DEFAULT_MODEL: llama3.2:3b
      A11_LLM_FALLBACK_PROVIDER: ollama
      A11_LLM_RUNTIME_FALLBACK_ORDER: ollama,ollama_cloud,openai,gemini,xai,huggingface,deepseek,together,groq,openrouter
      A11_CERBERE_LOCAL_ONLY: "false"
      A11_LOCAL_CHAT_TIMEOUT_MS: "90000"
      A11_LOCAL_SONG_TIMEOUT_MS: "180000"
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
      A11_VIDEO_COMFY_CLOUD_ENABLED: ${A11_VIDEO_COMFY_CLOUD_ENABLED:-1}
      A11_COMFY_CLOUD_API_KEY: ${A11_COMFY_CLOUD_API_KEY:-}
      A11_COMFY_CLOUD_BASE_URL: ${A11_COMFY_CLOUD_BASE_URL:-https://cloud.comfy.org}
      A11_COMFY_CLOUD_WORKFLOW_PATH: ${A11_COMFY_CLOUD_WORKFLOW_PATH:-}
      A11_COMFY_CLOUD_TIMEOUT_MS: ${A11_COMFY_CLOUD_TIMEOUT_MS:-2700000}
      A11_COMFY_CLOUD_POLL_INTERVAL_MS: ${A11_COMFY_CLOUD_POLL_INTERVAL_MS:-5000}
      A11_COMFY_CLOUD_WAN_MODEL: ${A11_COMFY_CLOUD_WAN_MODEL:-wan2.5-i2v-preview}
      A11_COMFY_CLOUD_WAN_RESOLUTION: ${A11_COMFY_CLOUD_WAN_RESOLUTION:-480P}
      A11_VIDEO_PROXY_URL: ${A11_VIDEO_PROXY_URL:-}
      A11_VIDEO_PROXY_TOKEN: ${A11_VIDEO_PROXY_TOKEN:-}
      A11_VIDEO_PROXY_PUBLIC_FILE_BASE_URL: ${A11_VIDEO_PROXY_PUBLIC_FILE_BASE_URL:-}
      A11_VIDEO_PROXY_TIMEOUT_MS: ${A11_VIDEO_PROXY_TIMEOUT_MS:-2700000}
      A11_VIDEO_ASYNC_JOB_TTL_MS: ${A11_VIDEO_ASYNC_JOB_TTL_MS:-2700000}
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

  vivy-twitch-worker:
    image: server-a11-backend:latest
    container_name: vivy-twitch-worker
    restart: unless-stopped
    command: ["npm", "run", "worker:vivy:twitch"]
    healthcheck:
      disable: true
    env_file:
      - /srv/a11/secrets/compose.env
    environment:
      TWITCH_CHANNEL: ${TWITCH_CHANNEL:-}
      TWITCH_BOT_USERNAME: ${TWITCH_BOT_USERNAME:-}
      TWITCH_OAUTH_TOKEN: ${TWITCH_OAUTH_TOKEN:-}
      TWITCH_ACCESS_TOKEN: ${TWITCH_ACCESS_TOKEN:-}
      TWITCH_CLIENT_ID: ${TWITCH_CLIENT_ID:-}
      TWITCH_REFRESH_TOKEN: ${TWITCH_REFRESH_TOKEN:-}
      VIVY_STREAM_SECRET: ${VIVY_STREAM_SECRET:?VIVY_STREAM_SECRET is required}
      VIVY_STREAM_INGEST_URL: ${VIVY_STREAM_INGEST_URL:-https://vivy.funesterie.me/api/vivy/stream/chat}
      VIVY_STREAM_RESET_URL: ${VIVY_STREAM_RESET_URL:-https://vivy.funesterie.me/api/vivy/stream/reset}
      VIVY_STREAM_STATE_URL: http://a11-backend:3000/api/vivy/stream/state
      VIVY_PUBLIC_BASE_URL: ${VIVY_PUBLIC_BASE_URL:-https://vivy.funesterie.me}
      VIVY_STREAM_COMMANDS_ONLY: ${VIVY_STREAM_COMMANDS_ONLY:-1}
      VIVY_STREAM_ANNOUNCE_INTERVAL_MS: ${VIVY_STREAM_ANNOUNCE_INTERVAL_MS:-720000}
      VIVY_STREAM_ANNOUNCE_DISABLED: ${VIVY_STREAM_ANNOUNCE_DISABLED:-0}
      VIVY_STREAM_BOT_MESSAGE_GAP_MS: ${VIVY_STREAM_BOT_MESSAGE_GAP_MS:-15000}
      VIVY_STREAM_TRACK_NOTICE_POLL_INTERVAL_MS: ${VIVY_STREAM_TRACK_NOTICE_POLL_INTERVAL_MS:-10000}
      VIVY_STREAM_RECAP_INTERVAL_MS: ${VIVY_STREAM_RECAP_INTERVAL_MS:-1680000}
      VIVY_STREAM_IDLE_JUKEBOX_DISABLED: ${VIVY_STREAM_IDLE_JUKEBOX_DISABLED:-1}
      VIVY_STREAM_COVER_ENABLED: ${VIVY_STREAM_COVER_ENABLED:-1}
      VIVY_STREAM_COVER_URL: ${VIVY_STREAM_COVER_URL:-http://127.0.0.1:3000/api/tools/generate_sd}
      VIVY_STREAM_COVER_TIMEOUT_MS: ${VIVY_STREAM_COVER_TIMEOUT_MS:-120000}
      VIVY_STREAM_CLIP_ENABLED: ${VIVY_STREAM_CLIP_ENABLED:-1}
      VIVY_STREAM_CLIP_PROVIDER: ${VIVY_STREAM_CLIP_PROVIDER:-auto}
      VIVY_STREAM_CLIP_DURATION_SECONDS: ${VIVY_STREAM_CLIP_DURATION_SECONDS:-3}
      VIVY_STREAM_CLIP_TIMEOUT_MS: ${VIVY_STREAM_CLIP_TIMEOUT_MS:-2700000}
      VIVY_STREAM_FULL_CLIP_ENABLED: ${VIVY_STREAM_FULL_CLIP_ENABLED:-1}
      VIVY_STREAM_FULL_CLIP_SOURCE_IMAGE_URL: ${VIVY_STREAM_FULL_CLIP_SOURCE_IMAGE_URL:-}
      VIVY_STREAM_DREAMCLIP_SOURCE_IMAGE_URL: ${VIVY_STREAM_DREAMCLIP_SOURCE_IMAGE_URL:-}
      VIVY_STREAM_FULL_CLIP_PROVIDER: ${VIVY_STREAM_FULL_CLIP_PROVIDER:-}
      VIVY_STREAM_FULL_CLIP_SCENES: ${VIVY_STREAM_FULL_CLIP_SCENES:-8}
      VIVY_STREAM_DREAMCLIP_SCENES: ${VIVY_STREAM_DREAMCLIP_SCENES:-8}
      VIVY_STREAM_DREAMCLIP_MAX_DURATION_SECONDS: ${VIVY_STREAM_DREAMCLIP_MAX_DURATION_SECONDS:-420}
      VIVY_STREAM_DREAMCLIP_LOOP_SECONDS: ${VIVY_STREAM_DREAMCLIP_LOOP_SECONDS:-15}
      VIVY_STREAM_DREAMCLIP_MIN_GENERATED_COVERAGE: ${VIVY_STREAM_DREAMCLIP_MIN_GENERATED_COVERAGE:-}
      VIVY_STREAM_DREAMCLIP_ALLOW_STATIC_FALLBACK: ${VIVY_STREAM_DREAMCLIP_ALLOW_STATIC_FALLBACK:-}
      VIVY_STREAM_FULL_CLIP_INSTRUMENTAL_SCENES: ${VIVY_STREAM_FULL_CLIP_INSTRUMENTAL_SCENES:-8}
      VIVY_STREAM_FULL_CLIP_UNIQUE_LOOPS: ${VIVY_STREAM_FULL_CLIP_UNIQUE_LOOPS:-5}
      VIVY_STREAM_FULL_CLIP_REUSE_CHORUS: ${VIVY_STREAM_FULL_CLIP_REUSE_CHORUS:-1}
      VIVY_STREAM_FULL_CLIP_CONCURRENCY: ${VIVY_STREAM_FULL_CLIP_CONCURRENCY:-2}
      VIVY_STREAM_FULL_CLIP_GENERATE_SCENE_LOOPS: ${VIVY_STREAM_FULL_CLIP_GENERATE_SCENE_LOOPS:-1}
      VIVY_STREAM_FULL_CLIP_LOOP_SECONDS: ${VIVY_STREAM_FULL_CLIP_LOOP_SECONDS:-8}
      VIVY_STREAM_FULL_CLIP_WIDTH: ${VIVY_STREAM_FULL_CLIP_WIDTH:-1280}
      VIVY_STREAM_FULL_CLIP_HEIGHT: ${VIVY_STREAM_FULL_CLIP_HEIGHT:-720}
      VIVY_STREAM_FULL_CLIP_FPS: ${VIVY_STREAM_FULL_CLIP_FPS:-24}
      VIVY_STREAM_FULL_CLIP_VISUAL_QA: ${VIVY_STREAM_FULL_CLIP_VISUAL_QA:-}
      A11_HF_VIDEO_PROVIDER: ${A11_HF_VIDEO_PROVIDER:-replicate}
      A11_REPLICATE_VIDEO_MODEL: ${A11_REPLICATE_VIDEO_MODEL:-wan-video/wan-2.6-i2v}
      A11_VIDEO_PROMPT_MAX_DURATION_SECONDS: ${A11_VIDEO_PROMPT_MAX_DURATION_SECONDS:-15}
      VIVY_STREAM_FULL_CLIP_CROP_SOURCE_IMAGE: ${VIVY_STREAM_FULL_CLIP_CROP_SOURCE_IMAGE:-1}
      VIVY_STREAM_FULL_CLIP_SOURCE_CROP_WIDTH_RATIO: ${VIVY_STREAM_FULL_CLIP_SOURCE_CROP_WIDTH_RATIO:-0.58}
      VIVY_STREAM_FULL_CLIP_SOURCE_CROP_X_BIAS: ${VIVY_STREAM_FULL_CLIP_SOURCE_CROP_X_BIAS:-0.62}
      VIVY_STREAM_FULL_CLIP_SOURCE_CROP_Y_BIAS: ${VIVY_STREAM_FULL_CLIP_SOURCE_CROP_Y_BIAS:-0.5}
      VIVY_STREAM_FULL_CLIP_DEMOSAIC_GRID: ${VIVY_STREAM_FULL_CLIP_DEMOSAIC_GRID:-0}
      VIVY_STREAM_FULL_CLIP_DEMOSAIC_COLUMNS: ${VIVY_STREAM_FULL_CLIP_DEMOSAIC_COLUMNS:-3}
      VIVY_STREAM_FULL_CLIP_DEMOSAIC_ROWS: ${VIVY_STREAM_FULL_CLIP_DEMOSAIC_ROWS:-3}
      VIVY_STREAM_FULL_CLIP_DEMOSAIC_ACTIVE_HEIGHT_RATIO: ${VIVY_STREAM_FULL_CLIP_DEMOSAIC_ACTIVE_HEIGHT_RATIO:-0.9}
      VIVY_STREAM_FULL_CLIP_DEMOSAIC_SEGMENT_SECONDS: ${VIVY_STREAM_FULL_CLIP_DEMOSAIC_SEGMENT_SECONDS:-1.25}
      VIVY_STREAM_FULL_CLIP_DEMOSAIC_ORDER: ${VIVY_STREAM_FULL_CLIP_DEMOSAIC_ORDER:-4,1,5,7,2,8}
      A11_VIDEO_COMFY_CLOUD_ENABLED: ${A11_VIDEO_COMFY_CLOUD_ENABLED:-1}
      A11_COMFY_CLOUD_API_KEY: ${A11_COMFY_CLOUD_API_KEY:-}
      A11_COMFY_CLOUD_BASE_URL: ${A11_COMFY_CLOUD_BASE_URL:-https://cloud.comfy.org}
      A11_COMFY_CLOUD_WORKFLOW_PATH: ${A11_COMFY_CLOUD_WORKFLOW_PATH:-}
      A11_COMFY_CLOUD_TIMEOUT_MS: ${A11_COMFY_CLOUD_TIMEOUT_MS:-2700000}
      A11_COMFY_CLOUD_POLL_INTERVAL_MS: ${A11_COMFY_CLOUD_POLL_INTERVAL_MS:-5000}
      A11_COMFY_CLOUD_WAN_MODEL: ${A11_COMFY_CLOUD_WAN_MODEL:-wan2.5-i2v-preview}
      A11_COMFY_CLOUD_WAN_RESOLUTION: ${A11_COMFY_CLOUD_WAN_RESOLUTION:-480P}
      VIVY_TWITCH_LIVE_POLL_INTERVAL_MS: ${VIVY_TWITCH_LIVE_POLL_INTERVAL_MS:-60000}
      VIVY_TWITCH_RESET_ON_OFFLINE: ${VIVY_TWITCH_RESET_ON_OFFLINE:-1}
      VIVY_TWITCH_RESET_ON_IRC_CLOSE: ${VIVY_TWITCH_RESET_ON_IRC_CLOSE:-0}
      VIVY_TWITCH_LIVE_GATE_DISABLED: ${VIVY_TWITCH_LIVE_GATE_DISABLED:-0}

  vivy-social-ingest-worker:
    image: server-a11-backend:latest
    container_name: vivy-social-ingest-worker
    restart: unless-stopped
    command: ["sh", "-lc", "if [ \"$${SOCIAL_INGEST_WORKER_ENABLED:-0}\" = \"1\" ] && [ -n \"$${SOCIAL_TOKEN_ENC_KEY:-}\" ]; then npm run worker:social:ingest:loop; elif [ \"$${SOCIAL_INGEST_WORKER_ENABLED:-0}\" = \"1\" ]; then echo '[social-ingest] disabled: SOCIAL_TOKEN_ENC_KEY missing'; tail -f /dev/null; else echo '[social-ingest] disabled'; tail -f /dev/null; fi"]
    healthcheck:
      disable: true
    env_file:
      - /srv/a11/secrets/compose.env
    environment:
      DATABASE_URL: ${DATABASE_URL:?DATABASE_URL is required}
      PGSSLMODE_DISABLE: ${PGSSLMODE_DISABLE:-1}
      SOCIAL_TOKEN_ENC_KEY: ${SOCIAL_TOKEN_ENC_KEY:-}
      SOCIAL_CONTEXT_USER_ID: ${SOCIAL_CONTEXT_USER_ID:-}
      SOCIAL_YOUTUBE_CLIENT_ID: ${SOCIAL_YOUTUBE_CLIENT_ID:-}
      SOCIAL_YOUTUBE_CLIENT_SECRET: ${SOCIAL_YOUTUBE_CLIENT_SECRET:-}
      SOCIAL_YOUTUBE_REDIRECT_URI: ${SOCIAL_YOUTUBE_REDIRECT_URI:-https://funesterie.me/api/admin/social-connect/youtube/callback}
      SOCIAL_YOUTUBE_INGEST_LIMIT: ${SOCIAL_YOUTUBE_INGEST_LIMIT:-12}
      SOCIAL_INGEST_WORKER_ENABLED: ${SOCIAL_INGEST_WORKER_ENABLED:-1}
      SOCIAL_INGEST_INTERVAL_MS: ${SOCIAL_INGEST_INTERVAL_MS:-900000}
    depends_on:
      a11-postgres:
        condition: service_healthy

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
      A11_TTS_VOICE_POLISH_ENABLED: ${A11_TTS_VOICE_POLISH_ENABLED:-true}
      A11_VOICE_CONVERSION_ENABLED: ${A11_VOICE_CONVERSION_ENABLED:-true}
      A11_VOICE_XTTS_RVC_URL: ${A11_VOICE_XTTS_RVC_URL:-http://a11-xtts-rvc:5000}
      A11_PROFILE_ENV: /app/profiles/kaen44.prod.env.disabled
      KAEN44_PROFILE_ENV: /app/profiles/kaen44.prod.env.disabled
      A11_RUNTIME_ROOT: /app/runtime
      A11_LLM_PROVIDER: ollama
      A11_OLLAMA_PRIMARY_MODEL: qwen2.5:32b
      A11_OLLAMA_FALLBACK_MODEL: qwen2.5:7b
      VIVY_CHAT_LOCAL_FIRST: "true"
      VIVY_OLLAMA_BASE_URL: http://a11-ollama:11434
      VIVY_CHAT_LOCAL_MODEL: qwen2.5:7b
      VIVY_CHAT_LOCAL_TIMEOUT_MS: ${VIVY_CHAT_LOCAL_TIMEOUT_MS:-90000}
      VIVY_CHAT_LOCAL_MAX_PROMPT_CHARS: ${VIVY_CHAT_LOCAL_MAX_PROMPT_CHARS:-10000}
      VIVY_CHAT_LOCAL_MAX_TOKENS: ${VIVY_CHAT_LOCAL_MAX_TOKENS:-800}
      A11_TRANSLATION_MODEL: ${A11_TRANSLATION_MODEL:-qwen2.5:32b}
      LOCAL_DEFAULT_MODEL: llama3.2:3b
      VIVY_SONG_PROVIDER: ${VIVY_SONG_PROVIDER:-ollama}
      OLLAMA_CLOUD_ENABLED: ${OLLAMA_CLOUD_ENABLED:-1}
      OLLAMA_CLOUD_BASE_URL: ${OLLAMA_CLOUD_BASE_URL:-https://ollama.com}
      OLLAMA_CLOUD_LYRICS_MODEL: ${OLLAMA_CLOUD_LYRICS_MODEL:-gpt-oss:120b}
      OLLAMA_CLOUD_FAST_MODEL: ${OLLAMA_CLOUD_FAST_MODEL:-gpt-oss:20b}
      OLLAMA_CLOUD_CHAT_ENABLED: ${OLLAMA_CLOUD_CHAT_ENABLED:-1}
      OLLAMA_CLOUD_CHAT_MODEL: ${OLLAMA_CLOUD_CHAT_MODEL:-gpt-oss:120b}
      OLLAMA_CLOUD_CHAT_THINK_LEVEL: ${OLLAMA_CLOUD_CHAT_THINK_LEVEL:-high}
      OLLAMA_CLOUD_CHAT_TIMEOUT_MS: ${OLLAMA_CLOUD_CHAT_TIMEOUT_MS:-300000}
      OLLAMA_CLOUD_THINK_LEVEL: ${OLLAMA_CLOUD_THINK_LEVEL:-high}
      OLLAMA_CLOUD_LYRICS_TIMEOUT_MS: ${OLLAMA_CLOUD_LYRICS_TIMEOUT_MS:-360000}
      VIVY_SONG_CERBERE_FALLBACK_ENABLED: ${VIVY_SONG_CERBERE_FALLBACK_ENABLED:-1}
      VIVY_SONG_CERBERE_MODEL: ${VIVY_SONG_CERBERE_MODEL:-openai/gpt-oss-120b}
      VIVY_SONG_CERBERE_TIMEOUT_MS: ${VIVY_SONG_CERBERE_TIMEOUT_MS:-240000}
      VIVY_GROQ_RATE_LIMIT_COOLDOWN_MS: ${VIVY_GROQ_RATE_LIMIT_COOLDOWN_MS:-300000}
      VIVY_CHAT_MAX_TOKENS: ${VIVY_CHAT_MAX_TOKENS:-5000}
      VIVY_CHAT_MAX_TOKENS_SONG: ${VIVY_CHAT_MAX_TOKENS_SONG:-10000}
      VIVY_CHAT_MAX_TOKENS_SONG_CEILING: ${VIVY_CHAT_MAX_TOKENS_SONG_CEILING:-12000}
      VIVY_SONG_ALLOW_LOCAL_FALLBACK: ${VIVY_SONG_ALLOW_LOCAL_FALLBACK:-true}
      VIVY_SONG_ALLOW_LOCAL_LYRICS_FALLBACK: ${VIVY_SONG_ALLOW_LOCAL_LYRICS_FALLBACK:-true}
      VIVY_SONG_LOCAL_MODEL: ${VIVY_SONG_LOCAL_MODEL:-qwen2.5:7b}
      VIVY_NOSSEN_LOCAL_MODEL: ${VIVY_NOSSEN_LOCAL_MODEL:-qwen2.5:32b}
      VIVY_NOSSEN_LARGE_MODEL_FIRST: ${VIVY_NOSSEN_LARGE_MODEL_FIRST:-true}
      VIVY_NOSSEN_120B_MAX_PROMPT_CHARS: ${VIVY_NOSSEN_120B_MAX_PROMPT_CHARS:-22000}
      VIVY_NOSSEN_120B_MAX_TOKENS: ${VIVY_NOSSEN_120B_MAX_TOKENS:-2400}
      VIVY_NOSSEN_120B_TIMEOUT_MS: ${VIVY_NOSSEN_120B_TIMEOUT_MS:-25000}
      VIVY_NOSSEN_FAST_LOCAL_ONLY: ${VIVY_NOSSEN_FAST_LOCAL_ONLY:-true}
      VIVY_NOSSEN_ROUTE_LLM_ENABLED: ${VIVY_NOSSEN_ROUTE_LLM_ENABLED:-true}
      VIVY_NOSSEN_ROUTER_LOCAL_TIMEOUT_MS: ${VIVY_NOSSEN_ROUTER_LOCAL_TIMEOUT_MS:-20000}
      VIVY_NOSSEN_LYRICS_LOCAL_TIMEOUT_MS: ${VIVY_NOSSEN_LYRICS_LOCAL_TIMEOUT_MS:-40000}
      VIVY_NOSSEN_LOCAL_MAX_TOKENS: ${VIVY_NOSSEN_LOCAL_MAX_TOKENS:-2200}
      VIVY_NOSSEN_LLM_BUDGET_MS: ${VIVY_NOSSEN_LLM_BUDGET_MS:-80000}
      VIVY_NOSSEN_CLOUD_ATTEMPT_TIMEOUT_MS: ${VIVY_NOSSEN_CLOUD_ATTEMPT_TIMEOUT_MS:-22000}
      VIVY_NOSSEN_EMERGENCY_SONGCRAFT: ${VIVY_NOSSEN_EMERGENCY_SONGCRAFT:-true}
      VIVY_ACESTEP_LYRICS_MAX_CHARS: ${VIVY_ACESTEP_LYRICS_MAX_CHARS:-24000}
      ACESTEP_DIFFUSION_MODEL: ${ACESTEP_DIFFUSION_MODEL:-acestep_v1.5_turbo.safetensors}
      ACESTEP_TEXT_ENCODER_1: ${ACESTEP_TEXT_ENCODER_1:-qwen_0.6b_ace15.safetensors}
      ACESTEP_TEXT_ENCODER_2: ${ACESTEP_TEXT_ENCODER_2:-qwen_1.7b_ace15.safetensors}
      ACESTEP_TEXT_ENCODER_2_QWEN4: ${ACESTEP_TEXT_ENCODER_2_QWEN4:-qwen_4b_ace15.safetensors}
      ACESTEP_QWEN4_PROFILE_ENABLED: ${ACESTEP_QWEN4_PROFILE_ENABLED:-false}
      ACESTEP_VAE: ${ACESTEP_VAE:-ace_1.5_vae.safetensors}
      ACESTEP_STEPS: ${ACESTEP_STEPS:-8}
      ACESTEP_KSAMPLER_CFG: ${ACESTEP_KSAMPLER_CFG:-1}
      ACESTEP_LLM_CFG_SCALE: ${ACESTEP_LLM_CFG_SCALE:-2}
      ACESTEP_SHIFT: ${ACESTEP_SHIFT:-3}
      ACESTEP_SAMPLER: ${ACESTEP_SAMPLER:-euler}
      ACESTEP_SCHEDULER: ${ACESTEP_SCHEDULER:-simple}
      ACESTEP_DEFAULT_BPM: ${ACESTEP_DEFAULT_BPM:-120}
      ACESTEP_MAX_DURATION_SECONDS: ${ACESTEP_MAX_DURATION_SECONDS:-1000}
      ACESTEP_TIME_SIGNATURE: ${ACESTEP_TIME_SIGNATURE:-4}
      ACESTEP_LANGUAGE: ${ACESTEP_LANGUAGE:-fr}
      ACESTEP_KEYSCALE: ${ACESTEP_KEYSCALE:-C minor}
      ACESTEP_GENERATE_AUDIO_CODES: ${ACESTEP_GENERATE_AUDIO_CODES:-true}
      ACESTEP_TEMPERATURE: ${ACESTEP_TEMPERATURE:-0.85}
      ACESTEP_TOP_P: ${ACESTEP_TOP_P:-0.9}
      ACESTEP_TOP_K: ${ACESTEP_TOP_K:-0}
      ACESTEP_MIN_P: ${ACESTEP_MIN_P:-0}
      ACESTEP_MP3_QUALITY: ${ACESTEP_MP3_QUALITY:-V0}
      ACESTEP_HEALTH_ATTEMPTS: ${ACESTEP_HEALTH_ATTEMPTS:-6}
      ACESTEP_HEALTH_RETRY_MS: ${ACESTEP_HEALTH_RETRY_MS:-3000}
      VIVY_STREAM_FREESTYLE_MAX_CHARS: ${VIVY_STREAM_FREESTYLE_MAX_CHARS:-12000}
      VIVY_STREAM_FREESTYLE_MAX_TOKENS: ${VIVY_STREAM_FREESTYLE_MAX_TOKENS:-10000}
      A11_LLM_FALLBACK_PROVIDER: ollama
      A11_LLM_RUNTIME_FALLBACK_ORDER: ollama,ollama_cloud,openai,gemini,xai,huggingface,deepseek,together,groq,openrouter
      A11_CERBERE_LOCAL_ONLY: "false"
      A11_LOCAL_CHAT_TIMEOUT_MS: "90000"
      A11_LOCAL_SONG_TIMEOUT_MS: "180000"
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
      A11_VIDEO_COMFY_CLOUD_ENABLED: ${A11_VIDEO_COMFY_CLOUD_ENABLED:-1}
      A11_COMFY_CLOUD_API_KEY: ${A11_COMFY_CLOUD_API_KEY:-}
      A11_COMFY_CLOUD_BASE_URL: ${A11_COMFY_CLOUD_BASE_URL:-https://cloud.comfy.org}
      A11_COMFY_CLOUD_WORKFLOW_PATH: ${A11_COMFY_CLOUD_WORKFLOW_PATH:-}
      A11_COMFY_CLOUD_TIMEOUT_MS: ${A11_COMFY_CLOUD_TIMEOUT_MS:-2700000}
      A11_COMFY_CLOUD_POLL_INTERVAL_MS: ${A11_COMFY_CLOUD_POLL_INTERVAL_MS:-5000}
      A11_COMFY_CLOUD_WAN_MODEL: ${A11_COMFY_CLOUD_WAN_MODEL:-wan2.5-i2v-preview}
      A11_COMFY_CLOUD_WAN_RESOLUTION: ${A11_COMFY_CLOUD_WAN_RESOLUTION:-480P}
      A11_VIDEO_PROXY_URL: ${A11_VIDEO_PROXY_URL:-}
      A11_VIDEO_PROXY_TOKEN: ${A11_VIDEO_PROXY_TOKEN:-}
      A11_VIDEO_PROXY_PUBLIC_FILE_BASE_URL: ${A11_VIDEO_PROXY_PUBLIC_FILE_BASE_URL:-}
      A11_VIDEO_PROXY_TIMEOUT_MS: ${A11_VIDEO_PROXY_TIMEOUT_MS:-2700000}
      A11_VIDEO_ASYNC_JOB_TTL_MS: ${A11_VIDEO_ASYNC_JOB_TTL_MS:-2700000}
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
  $compose = $compose.Replace("image: server-a11-backend:latest", "image: server-${A11BackendService}:latest")
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

# Filet de secours blue/green (retabli le 2026-08-08). Ce bloc n'ecrivait qu'un seul
# upstream: chaque deploiement ecrasait donc la configuration a deux couleurs ecrite a la
# main sur le serveur, et la prod repartait sans aucun repli. Si la nouvelle couleur
# tombait juste apres la bascule, plus rien ne repondait. On regenere desormais le meme
# contrat: couleur candidate en tete, couleur precedente en repli sonde par /health.
# lb_policy first garde un routage deterministe -- ce n'est pas de la repartition de
# charge, la seconde adresse ne sert que si la premiere echoue sa sonde.
# Yellow n'est deliberement jamais expose ici.
$caddyA11Upstreams = "${caddyA11BackendService}:3000"
$caddyKaen44Upstreams = "${caddyKaen44BackendService}:3001"
$caddyFallbackBlock = ""
if ($BlueGreen -and $ActiveBlueGreenColor -in @("blue", "green")) {
  $caddyA11Upstreams = "${caddyA11BackendService}:3000 a11-backend-${ActiveBlueGreenColor}:3000"
  $caddyKaen44Upstreams = "${caddyKaen44BackendService}:3001 kaen44-backend-${ActiveBlueGreenColor}:3001"
  $caddyFallbackBlock = @"

    lb_policy first
    health_uri /health
    health_interval 10s
    health_timeout 3s
"@
}

$caddy = @"
(a11_backend) {
  reverse_proxy ${caddyA11Upstreams} {
    header_up Host {host}
    header_up X-Forwarded-Proto https$caddyFallbackBlock
    lb_try_duration 45s
    lb_try_interval 250ms
  }
}

(kaen44_backend) {
  reverse_proxy ${caddyKaen44Upstreams} {
    header_up Host {host}
    header_up X-Forwarded-Proto https$caddyFallbackBlock
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
  @a11Path path /a11 /a11/* /api/admin/* /api/tools/run /api/runtime* /api/qflush/* /api/stt/* /api/tts /api/tts/* /api/vivy /api/vivy/* /api/ekko /api/ekko/* /api/double-harmonic /api/double-harmonic/*
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
  @localHealth path /health
  handle @localHealth {
    import a11_backend
  }
  respond 404
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
Import-OptionalSecretFile $envMap "SOCIAL_TOKEN_ENC_KEY" @(
  $localEnvMap["SOCIAL_TOKEN_ENC_KEY_FILE"],
  (Join-Path $localSecretRoot "social-token-enc-key.txt")
)
Import-OptionalSecretFile $envMap "SOCIAL_META_APP_ID" @(
  $localEnvMap["SOCIAL_META_APP_ID_FILE"],
  (Join-Path $localSecretRoot "social-meta-app-id.txt")
)
Import-OptionalSecretFile $envMap "SOCIAL_META_APP_SECRET" @(
  $localEnvMap["SOCIAL_META_APP_SECRET_FILE"],
  (Join-Path $localSecretRoot "social-meta-app-secret.txt")
)
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
  "A11_MCP_TOKEN", "A11_PUBLIC_MCP_TOKEN", "MCP_AUTH_TOKEN",
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
  A11_LLM_PROVIDER = "ollama"
  OLLAMA_BASE = "http://a11-ollama:11434"
  LLAMA_BASE = "http://a11-ollama:11434"
  OLLAMA_HOST = "a11-ollama"
  OLLAMA_PORT = "11434"
  A11_OLLAMA_BASE = "http://a11-ollama:11434"
  A11_OLLAMA_PRIMARY_MODEL = "qwen2.5:32b"
  A11_OLLAMA_FALLBACK_MODEL = "qwen2.5:7b"
  VIVY_CHAT_LOCAL_FIRST = "true"
  VIVY_OLLAMA_BASE_URL = "http://a11-ollama:11434"
  VIVY_CHAT_LOCAL_MODEL = "qwen2.5:7b"
  VIVY_CHAT_LOCAL_TIMEOUT_MS = "90000"
  VIVY_CHAT_LOCAL_MAX_PROMPT_CHARS = "10000"
  VIVY_CHAT_LOCAL_MAX_TOKENS = "800"
  VIVY_SONG_PROVIDER = $(if ($env:VIVY_SONG_PROVIDER) { $env:VIVY_SONG_PROVIDER } elseif ($envMap.Contains("VIVY_SONG_PROVIDER") -and -not [string]::IsNullOrWhiteSpace([string]$envMap["VIVY_SONG_PROVIDER"])) { [string]$envMap["VIVY_SONG_PROVIDER"] } else { "ollama" })
  VIVY_SONG_GROQ_MODEL = $(if ($env:VIVY_SONG_GROQ_MODEL) { $env:VIVY_SONG_GROQ_MODEL } elseif ($envMap.Contains("VIVY_SONG_GROQ_MODEL") -and -not [string]::IsNullOrWhiteSpace([string]$envMap["VIVY_SONG_GROQ_MODEL"])) { [string]$envMap["VIVY_SONG_GROQ_MODEL"] } else { "llama-3.3-70b-versatile" })
  VIVY_XAI_MODEL = $(if ($env:VIVY_XAI_MODEL) { $env:VIVY_XAI_MODEL } elseif ($envMap.Contains("VIVY_XAI_MODEL") -and -not [string]::IsNullOrWhiteSpace([string]$envMap["VIVY_XAI_MODEL"])) { [string]$envMap["VIVY_XAI_MODEL"] } else { "grok-4.3" })
  OLLAMA_CLOUD_ENABLED = "1"
  OLLAMA_CLOUD_BASE_URL = "https://ollama.com"
  OLLAMA_CLOUD_LYRICS_MODEL = "gpt-oss:120b"
  OLLAMA_CLOUD_FAST_MODEL = "gpt-oss:20b"
  OLLAMA_CLOUD_CHAT_ENABLED = "1"
  OLLAMA_CLOUD_CHAT_MODEL = "gpt-oss:120b"
  OLLAMA_CLOUD_CHAT_THINK_LEVEL = "high"
  OLLAMA_CLOUD_CHAT_TIMEOUT_MS = "300000"
  OLLAMA_CLOUD_THINK_LEVEL = "high"
  OLLAMA_CLOUD_LYRICS_TIMEOUT_MS = "360000"
  VIVY_SONG_CERBERE_FALLBACK_ENABLED = "1"
  VIVY_SONG_CERBERE_MODEL = "openai/gpt-oss-120b"
  VIVY_SONG_CERBERE_TIMEOUT_MS = "240000"
  VIVY_GROQ_RATE_LIMIT_COOLDOWN_MS = "300000"
  VIVY_CHAT_MAX_TOKENS = "5000"
  VIVY_CHAT_MAX_TOKENS_SONG = "10000"
  VIVY_CHAT_MAX_TOKENS_SONG_CEILING = "12000"
  A11_OLLAMA_STRONG_SONG_MODEL = $StrongSongOllamaModel
  VIVY_SONG_ALLOW_LOCAL_FALLBACK = "true"
  VIVY_SONG_ALLOW_LOCAL_LYRICS_FALLBACK = "true"
  VIVY_SONG_LOCAL_MODEL = "qwen2.5:7b"
  VIVY_NOSSEN_LOCAL_MODEL = "qwen2.5:32b"
  VIVY_NOSSEN_LARGE_MODEL_FIRST = "true"
  VIVY_NOSSEN_120B_MAX_PROMPT_CHARS = "22000"
  VIVY_NOSSEN_120B_MAX_TOKENS = "2400"
  # 35 s, pas 60. Le correctif 979a0d72 du 28/07 avait baisse le DEFAUT du code a
  # 35 s parce que le gros modele, essaye en premier, mangeait 60 des 80 s de
  # VIVY_NOSSEN_LLM_BUDGET_MS: les fournisseurs suivants -- ceux qui repondent --
  # se partageaient 20 s par tranches de 8 s et tombaient tous en faux 504
  # (buildVivyLlmDeadlineError pose status=504, ce ne sont pas les fournisseurs qui
  # echouent). Ce fichier reimposait 60000 a chaque deploiement, donc le correctif
  # n'a jamais pris effet en prod. Cascade encore observee le 09/08 a 07h24 et
  # 07h30, avec un 502 cote Cloudflare au bout.
  VIVY_NOSSEN_120B_TIMEOUT_MS = "25000"
  VIVY_NOSSEN_FAST_LOCAL_ONLY = "true"
  # Djeff: « c'est Vivy qui doit piloter les chanteurs et les couleurs sonores ».
  # A false, buildVivyNossenRoutingPlan renvoyait toujours son moteur de regles, qui rend
  # la meme direction pour un rock, une ballade et une techno -- d'ou la monotonie.
  VIVY_NOSSEN_ROUTE_LLM_ENABLED = "true"
  VIVY_NOSSEN_ROUTER_LOCAL_TIMEOUT_MS = "20000"
  VIVY_NOSSEN_LYRICS_LOCAL_TIMEOUT_MS = "40000"
  VIVY_NOSSEN_LOCAL_MAX_TOKENS = "2200"
  VIVY_NOSSEN_LLM_BUDGET_MS = "80000"
  VIVY_NOSSEN_CLOUD_ATTEMPT_TIMEOUT_MS = "22000"
  VIVY_NOSSEN_EMERGENCY_SONGCRAFT = "true"
  VIVY_ACESTEP_LYRICS_MAX_CHARS = "24000"
  ACESTEP_DIFFUSION_MODEL = "acestep_v1.5_turbo.safetensors"
  ACESTEP_TEXT_ENCODER_1 = "qwen_0.6b_ace15.safetensors"
  ACESTEP_TEXT_ENCODER_2 = "qwen_1.7b_ace15.safetensors"
  ACESTEP_TEXT_ENCODER_2_QWEN4 = "qwen_4b_ace15.safetensors"
  ACESTEP_QWEN4_PROFILE_ENABLED = "false"
  ACESTEP_VAE = "ace_1.5_vae.safetensors"
  ACESTEP_STEPS = "8"
  ACESTEP_KSAMPLER_CFG = "1"
  ACESTEP_LLM_CFG_SCALE = "2"
  ACESTEP_SHIFT = "3"
  ACESTEP_SAMPLER = "euler"
  ACESTEP_SCHEDULER = "simple"
  ACESTEP_DEFAULT_BPM = "120"
  ACESTEP_MAX_DURATION_SECONDS = "1000"
  ACESTEP_TIME_SIGNATURE = "4"
  ACESTEP_LANGUAGE = "fr"
  ACESTEP_KEYSCALE = "C minor"
  ACESTEP_GENERATE_AUDIO_CODES = "true"
  ACESTEP_TEMPERATURE = "0.85"
  ACESTEP_TOP_P = "0.9"
  ACESTEP_TOP_K = "0"
  ACESTEP_MIN_P = "0"
  ACESTEP_MP3_QUALITY = "V0"
  ACESTEP_HEALTH_ATTEMPTS = "6"
  ACESTEP_HEALTH_RETRY_MS = "3000"
  VIVY_STREAM_FREESTYLE_MAX_CHARS = $(if ($env:VIVY_STREAM_FREESTYLE_MAX_CHARS) { $env:VIVY_STREAM_FREESTYLE_MAX_CHARS } elseif ($envMap.Contains("VIVY_STREAM_FREESTYLE_MAX_CHARS") -and -not [string]::IsNullOrWhiteSpace([string]$envMap["VIVY_STREAM_FREESTYLE_MAX_CHARS"])) { [string]$envMap["VIVY_STREAM_FREESTYLE_MAX_CHARS"] } else { "12000" })
  VIVY_STREAM_FREESTYLE_MAX_TOKENS = $(if ($env:VIVY_STREAM_FREESTYLE_MAX_TOKENS) { $env:VIVY_STREAM_FREESTYLE_MAX_TOKENS } elseif ($envMap.Contains("VIVY_STREAM_FREESTYLE_MAX_TOKENS") -and -not [string]::IsNullOrWhiteSpace([string]$envMap["VIVY_STREAM_FREESTYLE_MAX_TOKENS"])) { [string]$envMap["VIVY_STREAM_FREESTYLE_MAX_TOKENS"] } else { "10000" })
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
  A11_TRANSLATION_MODEL = "qwen2.5:32b"
  A11_CERBERE_OPENAI_BASE_URL = "https://openrouter.ai/api/v1"
  A11_CERBERE_OPENAI_API_KEY = $(if ($mcpEnvMap.Contains("OPENROUTER_API_KEY") -and -not [string]::IsNullOrWhiteSpace($mcpEnvMap["OPENROUTER_API_KEY"])) { $mcpEnvMap["OPENROUTER_API_KEY"] } elseif ($envMap.Contains("OPENROUTER_API_KEY")) { $envMap["OPENROUTER_API_KEY"] } else { "" })
  LOCAL_DEFAULT_MODEL = "llama3.2:3b"
  A11_CERBERE_PREFER_NON_GROQ = "false"
  A11_LLM_FALLBACK_PROVIDER = "ollama"
  A11_LLM_RUNTIME_FALLBACK_ORDER = "ollama,ollama_cloud,openai,gemini,xai,huggingface,deepseek,together,groq,openrouter"
  A11_CERBERE_LOCAL_ONLY = "false"
  A11_LOCAL_CHAT_TIMEOUT_MS = "90000"
  A11_LOCAL_SONG_TIMEOUT_MS = "180000"
  A11_OLLAMA_KEEP_ALIVE = "30m"
  A11_MEMORY_LOCAL_TIMEOUT_MS = "3500"
  A11_MEMORY_REMOTE_TIMEOUT_MS = "5000"
  A11_EMBEDDING_TIMEOUT_MS = "2500"
  A11_RUNTIME_ROOT = "/app/runtime"
  A11_EPISODIC_MEMORY_DIR = "/app/runtime/episodic-memory"
  A11_RUNTIME_PROFILE = "prod"
  A11_PRODUCT = "a11"
  A11_INSTANCE_NAME = "Alpha Onze"
  VIVY_STREAM_SECRET = $(if ($env:VIVY_STREAM_SECRET) { $env:VIVY_STREAM_SECRET } elseif ($envMap.Contains("VIVY_STREAM_SECRET") -and -not [string]::IsNullOrWhiteSpace([string]$envMap["VIVY_STREAM_SECRET"])) { [string]$envMap["VIVY_STREAM_SECRET"] } else { New-HexSecret 32 })
  VIVY_STREAM_INGEST_URL = $(if ($env:VIVY_STREAM_INGEST_URL) { $env:VIVY_STREAM_INGEST_URL } elseif ($envMap.Contains("VIVY_STREAM_INGEST_URL") -and -not [string]::IsNullOrWhiteSpace([string]$envMap["VIVY_STREAM_INGEST_URL"])) { [string]$envMap["VIVY_STREAM_INGEST_URL"] } else { "https://vivy.funesterie.me/api/vivy/stream/chat" })
  VIVY_STREAM_STATE_URL = $(if ($env:VIVY_STREAM_STATE_URL) { $env:VIVY_STREAM_STATE_URL } else { "http://${A11BackendService}:3000/api/vivy/stream/state" })
  VIVY_PUBLIC_BASE_URL = $(if ($env:VIVY_PUBLIC_BASE_URL) { $env:VIVY_PUBLIC_BASE_URL } elseif ($envMap.Contains("VIVY_PUBLIC_BASE_URL") -and -not [string]::IsNullOrWhiteSpace([string]$envMap["VIVY_PUBLIC_BASE_URL"])) { [string]$envMap["VIVY_PUBLIC_BASE_URL"] } else { "https://vivy.funesterie.me" })
  SOCIAL_TOKEN_ENC_KEY = $(if ($env:SOCIAL_TOKEN_ENC_KEY) { $env:SOCIAL_TOKEN_ENC_KEY } elseif ($envMap.Contains("SOCIAL_TOKEN_ENC_KEY") -and -not [string]::IsNullOrWhiteSpace([string]$envMap["SOCIAL_TOKEN_ENC_KEY"])) { [string]$envMap["SOCIAL_TOKEN_ENC_KEY"] } else { New-HexSecret 32 })
  SOCIAL_PUBLIC_BASE_URL = $(if ($env:SOCIAL_PUBLIC_BASE_URL) { $env:SOCIAL_PUBLIC_BASE_URL } elseif ($envMap.Contains("SOCIAL_PUBLIC_BASE_URL") -and -not [string]::IsNullOrWhiteSpace([string]$envMap["SOCIAL_PUBLIC_BASE_URL"])) { [string]$envMap["SOCIAL_PUBLIC_BASE_URL"] } else { "https://funesterie.me" })
  PGSSLMODE_DISABLE = $(if ($env:PGSSLMODE_DISABLE) { $env:PGSSLMODE_DISABLE } elseif ($envMap.Contains("PGSSLMODE_DISABLE") -and -not [string]::IsNullOrWhiteSpace([string]$envMap["PGSSLMODE_DISABLE"])) { [string]$envMap["PGSSLMODE_DISABLE"] } else { "1" })
  SOCIAL_CONTEXT_USER_ID = $(if ($env:SOCIAL_CONTEXT_USER_ID) { $env:SOCIAL_CONTEXT_USER_ID } elseif ($envMap.Contains("SOCIAL_CONTEXT_USER_ID")) { [string]$envMap["SOCIAL_CONTEXT_USER_ID"] } else { "" })
  SOCIAL_YOUTUBE_CLIENT_ID = $(if ($env:SOCIAL_YOUTUBE_CLIENT_ID) { $env:SOCIAL_YOUTUBE_CLIENT_ID } elseif ($envMap.Contains("SOCIAL_YOUTUBE_CLIENT_ID") -and -not [string]::IsNullOrWhiteSpace([string]$envMap["SOCIAL_YOUTUBE_CLIENT_ID"])) { [string]$envMap["SOCIAL_YOUTUBE_CLIENT_ID"] } else { "" })
  SOCIAL_YOUTUBE_CLIENT_SECRET = $(if ($env:SOCIAL_YOUTUBE_CLIENT_SECRET) { $env:SOCIAL_YOUTUBE_CLIENT_SECRET } elseif ($envMap.Contains("SOCIAL_YOUTUBE_CLIENT_SECRET") -and -not [string]::IsNullOrWhiteSpace([string]$envMap["SOCIAL_YOUTUBE_CLIENT_SECRET"])) { [string]$envMap["SOCIAL_YOUTUBE_CLIENT_SECRET"] } else { "" })
  SOCIAL_YOUTUBE_REDIRECT_URI = $(if ($env:SOCIAL_YOUTUBE_REDIRECT_URI) { $env:SOCIAL_YOUTUBE_REDIRECT_URI } elseif ($envMap.Contains("SOCIAL_YOUTUBE_REDIRECT_URI") -and -not [string]::IsNullOrWhiteSpace([string]$envMap["SOCIAL_YOUTUBE_REDIRECT_URI"])) { [string]$envMap["SOCIAL_YOUTUBE_REDIRECT_URI"] } else { "https://funesterie.me/api/admin/social-connect/youtube/callback" })
  SOCIAL_YOUTUBE_INGEST_LIMIT = $(if ($env:SOCIAL_YOUTUBE_INGEST_LIMIT) { $env:SOCIAL_YOUTUBE_INGEST_LIMIT } elseif ($envMap.Contains("SOCIAL_YOUTUBE_INGEST_LIMIT") -and -not [string]::IsNullOrWhiteSpace([string]$envMap["SOCIAL_YOUTUBE_INGEST_LIMIT"])) { [string]$envMap["SOCIAL_YOUTUBE_INGEST_LIMIT"] } else { "12" })
  SOCIAL_META_APP_ID = $(if ($env:SOCIAL_META_APP_ID) { $env:SOCIAL_META_APP_ID } elseif ($envMap.Contains("SOCIAL_META_APP_ID") -and -not [string]::IsNullOrWhiteSpace([string]$envMap["SOCIAL_META_APP_ID"])) { [string]$envMap["SOCIAL_META_APP_ID"] } else { "" })
  SOCIAL_META_APP_SECRET = $(if ($env:SOCIAL_META_APP_SECRET) { $env:SOCIAL_META_APP_SECRET } elseif ($envMap.Contains("SOCIAL_META_APP_SECRET") -and -not [string]::IsNullOrWhiteSpace([string]$envMap["SOCIAL_META_APP_SECRET"])) { [string]$envMap["SOCIAL_META_APP_SECRET"] } else { "" })
  SOCIAL_META_REDIRECT_URI = $(if ($env:SOCIAL_META_REDIRECT_URI) { $env:SOCIAL_META_REDIRECT_URI } elseif ($envMap.Contains("SOCIAL_META_REDIRECT_URI") -and -not [string]::IsNullOrWhiteSpace([string]$envMap["SOCIAL_META_REDIRECT_URI"])) { [string]$envMap["SOCIAL_META_REDIRECT_URI"] } else { "https://funesterie.me/api/admin/social-connect/meta/callback" })
  SOCIAL_INGEST_WORKER_ENABLED = $(if ($env:SOCIAL_INGEST_WORKER_ENABLED) { $env:SOCIAL_INGEST_WORKER_ENABLED } elseif ($envMap.Contains("SOCIAL_INGEST_WORKER_ENABLED") -and -not [string]::IsNullOrWhiteSpace([string]$envMap["SOCIAL_INGEST_WORKER_ENABLED"])) { [string]$envMap["SOCIAL_INGEST_WORKER_ENABLED"] } else { "1" })
  SOCIAL_INGEST_INTERVAL_MS = $(if ($env:SOCIAL_INGEST_INTERVAL_MS) { $env:SOCIAL_INGEST_INTERVAL_MS } elseif ($envMap.Contains("SOCIAL_INGEST_INTERVAL_MS") -and -not [string]::IsNullOrWhiteSpace([string]$envMap["SOCIAL_INGEST_INTERVAL_MS"])) { [string]$envMap["SOCIAL_INGEST_INTERVAL_MS"] } else { "900000" })
  VIVY_STREAM_SOCIAL_CONTEXT_DISABLED = $(if ($env:VIVY_STREAM_SOCIAL_CONTEXT_DISABLED) { $env:VIVY_STREAM_SOCIAL_CONTEXT_DISABLED } elseif ($envMap.Contains("VIVY_STREAM_SOCIAL_CONTEXT_DISABLED") -and -not [string]::IsNullOrWhiteSpace([string]$envMap["VIVY_STREAM_SOCIAL_CONTEXT_DISABLED"])) { [string]$envMap["VIVY_STREAM_SOCIAL_CONTEXT_DISABLED"] } else { "0" })
  VIVY_STREAM_SOCIAL_CONTEXT_USER_ID = $(if ($env:VIVY_STREAM_SOCIAL_CONTEXT_USER_ID) { $env:VIVY_STREAM_SOCIAL_CONTEXT_USER_ID } elseif ($envMap.Contains("VIVY_STREAM_SOCIAL_CONTEXT_USER_ID")) { [string]$envMap["VIVY_STREAM_SOCIAL_CONTEXT_USER_ID"] } else { "" })
  A11_SOCIAL_MCP_ALLOW_ANONYMOUS = $(if ($env:A11_SOCIAL_MCP_ALLOW_ANONYMOUS) { $env:A11_SOCIAL_MCP_ALLOW_ANONYMOUS } elseif ($envMap.Contains("A11_SOCIAL_MCP_ALLOW_ANONYMOUS") -and -not [string]::IsNullOrWhiteSpace([string]$envMap["A11_SOCIAL_MCP_ALLOW_ANONYMOUS"])) { [string]$envMap["A11_SOCIAL_MCP_ALLOW_ANONYMOUS"] } else { "0" })
  VIVY_STREAM_COMMANDS_ONLY = $(if ($env:VIVY_STREAM_COMMANDS_ONLY) { $env:VIVY_STREAM_COMMANDS_ONLY } elseif ($envMap.Contains("VIVY_STREAM_COMMANDS_ONLY") -and -not [string]::IsNullOrWhiteSpace([string]$envMap["VIVY_STREAM_COMMANDS_ONLY"])) { [string]$envMap["VIVY_STREAM_COMMANDS_ONLY"] } else { "1" })
  VIVY_STREAM_ANNOUNCE_INTERVAL_MS = $(if ($env:VIVY_STREAM_ANNOUNCE_INTERVAL_MS) { $env:VIVY_STREAM_ANNOUNCE_INTERVAL_MS } elseif ($envMap.Contains("VIVY_STREAM_ANNOUNCE_INTERVAL_MS") -and -not [string]::IsNullOrWhiteSpace([string]$envMap["VIVY_STREAM_ANNOUNCE_INTERVAL_MS"])) { [string]$envMap["VIVY_STREAM_ANNOUNCE_INTERVAL_MS"] } else { "720000" })
  VIVY_STREAM_ANNOUNCE_DISABLED = $(if ($env:VIVY_STREAM_ANNOUNCE_DISABLED) { $env:VIVY_STREAM_ANNOUNCE_DISABLED } elseif ($envMap.Contains("VIVY_STREAM_ANNOUNCE_DISABLED") -and -not [string]::IsNullOrWhiteSpace([string]$envMap["VIVY_STREAM_ANNOUNCE_DISABLED"])) { [string]$envMap["VIVY_STREAM_ANNOUNCE_DISABLED"] } else { "0" })
  VIVY_STREAM_BOT_MESSAGE_GAP_MS = $(if ($env:VIVY_STREAM_BOT_MESSAGE_GAP_MS) { $env:VIVY_STREAM_BOT_MESSAGE_GAP_MS } elseif ($envMap.Contains("VIVY_STREAM_BOT_MESSAGE_GAP_MS") -and -not [string]::IsNullOrWhiteSpace([string]$envMap["VIVY_STREAM_BOT_MESSAGE_GAP_MS"])) { [string]$envMap["VIVY_STREAM_BOT_MESSAGE_GAP_MS"] } else { "15000" })
  VIVY_STREAM_COVER_ENABLED = $(if ($env:VIVY_STREAM_COVER_ENABLED) { $env:VIVY_STREAM_COVER_ENABLED } elseif ($envMap.Contains("VIVY_STREAM_COVER_ENABLED") -and -not [string]::IsNullOrWhiteSpace([string]$envMap["VIVY_STREAM_COVER_ENABLED"])) { [string]$envMap["VIVY_STREAM_COVER_ENABLED"] } else { "1" })
  VIVY_STREAM_COVER_URL = $(if ($env:VIVY_STREAM_COVER_URL) { $env:VIVY_STREAM_COVER_URL } elseif ($envMap.Contains("VIVY_STREAM_COVER_URL") -and -not [string]::IsNullOrWhiteSpace([string]$envMap["VIVY_STREAM_COVER_URL"])) { [string]$envMap["VIVY_STREAM_COVER_URL"] } else { "http://127.0.0.1:3000/api/tools/generate_sd" })
  VIVY_STREAM_COVER_TIMEOUT_MS = $(if ($env:VIVY_STREAM_COVER_TIMEOUT_MS) { $env:VIVY_STREAM_COVER_TIMEOUT_MS } elseif ($envMap.Contains("VIVY_STREAM_COVER_TIMEOUT_MS") -and -not [string]::IsNullOrWhiteSpace([string]$envMap["VIVY_STREAM_COVER_TIMEOUT_MS"])) { [string]$envMap["VIVY_STREAM_COVER_TIMEOUT_MS"] } else { "120000" })
  VIVY_STREAM_CLIP_ENABLED = $(if ($env:VIVY_STREAM_CLIP_ENABLED) { $env:VIVY_STREAM_CLIP_ENABLED } elseif ($envMap.Contains("VIVY_STREAM_CLIP_ENABLED") -and -not [string]::IsNullOrWhiteSpace([string]$envMap["VIVY_STREAM_CLIP_ENABLED"])) { [string]$envMap["VIVY_STREAM_CLIP_ENABLED"] } else { "1" })
  VIVY_STREAM_CLIP_PROVIDER = $(if ($env:VIVY_STREAM_CLIP_PROVIDER) { $env:VIVY_STREAM_CLIP_PROVIDER } elseif ($envMap.Contains("VIVY_STREAM_CLIP_PROVIDER") -and -not [string]::IsNullOrWhiteSpace([string]$envMap["VIVY_STREAM_CLIP_PROVIDER"])) { [string]$envMap["VIVY_STREAM_CLIP_PROVIDER"] } else { "auto" })
  VIVY_STREAM_CLIP_DURATION_SECONDS = $(if ($env:VIVY_STREAM_CLIP_DURATION_SECONDS) { $env:VIVY_STREAM_CLIP_DURATION_SECONDS } elseif ($envMap.Contains("VIVY_STREAM_CLIP_DURATION_SECONDS") -and -not [string]::IsNullOrWhiteSpace([string]$envMap["VIVY_STREAM_CLIP_DURATION_SECONDS"])) { [string]$envMap["VIVY_STREAM_CLIP_DURATION_SECONDS"] } else { "3" })
  VIVY_STREAM_CLIP_TIMEOUT_MS = $(if ($env:VIVY_STREAM_CLIP_TIMEOUT_MS) { $env:VIVY_STREAM_CLIP_TIMEOUT_MS } elseif ($envMap.Contains("VIVY_STREAM_CLIP_TIMEOUT_MS") -and -not [string]::IsNullOrWhiteSpace([string]$envMap["VIVY_STREAM_CLIP_TIMEOUT_MS"])) { [string]$envMap["VIVY_STREAM_CLIP_TIMEOUT_MS"] } else { "2700000" })
  VIVY_STREAM_FULL_CLIP_ENABLED = $(if ($env:VIVY_STREAM_FULL_CLIP_ENABLED) { $env:VIVY_STREAM_FULL_CLIP_ENABLED } elseif ($envMap.Contains("VIVY_STREAM_FULL_CLIP_ENABLED") -and -not [string]::IsNullOrWhiteSpace([string]$envMap["VIVY_STREAM_FULL_CLIP_ENABLED"])) { [string]$envMap["VIVY_STREAM_FULL_CLIP_ENABLED"] } else { "1" })
  VIVY_STREAM_FULL_CLIP_SCENES = $(if ($env:VIVY_STREAM_FULL_CLIP_SCENES) { $env:VIVY_STREAM_FULL_CLIP_SCENES } elseif ($envMap.Contains("VIVY_STREAM_FULL_CLIP_SCENES") -and -not [string]::IsNullOrWhiteSpace([string]$envMap["VIVY_STREAM_FULL_CLIP_SCENES"])) { [string]$envMap["VIVY_STREAM_FULL_CLIP_SCENES"] } else { "8" })
  VIVY_STREAM_FULL_CLIP_INSTRUMENTAL_SCENES = $(if ($env:VIVY_STREAM_FULL_CLIP_INSTRUMENTAL_SCENES) { $env:VIVY_STREAM_FULL_CLIP_INSTRUMENTAL_SCENES } elseif ($envMap.Contains("VIVY_STREAM_FULL_CLIP_INSTRUMENTAL_SCENES") -and -not [string]::IsNullOrWhiteSpace([string]$envMap["VIVY_STREAM_FULL_CLIP_INSTRUMENTAL_SCENES"])) { [string]$envMap["VIVY_STREAM_FULL_CLIP_INSTRUMENTAL_SCENES"] } else { "8" })
  VIVY_STREAM_FULL_CLIP_UNIQUE_LOOPS = $(if ($env:VIVY_STREAM_FULL_CLIP_UNIQUE_LOOPS) { $env:VIVY_STREAM_FULL_CLIP_UNIQUE_LOOPS } elseif ($envMap.Contains("VIVY_STREAM_FULL_CLIP_UNIQUE_LOOPS") -and -not [string]::IsNullOrWhiteSpace([string]$envMap["VIVY_STREAM_FULL_CLIP_UNIQUE_LOOPS"])) { [string]$envMap["VIVY_STREAM_FULL_CLIP_UNIQUE_LOOPS"] } else { "5" })
  VIVY_STREAM_FULL_CLIP_REUSE_CHORUS = $(if ($env:VIVY_STREAM_FULL_CLIP_REUSE_CHORUS) { $env:VIVY_STREAM_FULL_CLIP_REUSE_CHORUS } elseif ($envMap.Contains("VIVY_STREAM_FULL_CLIP_REUSE_CHORUS") -and -not [string]::IsNullOrWhiteSpace([string]$envMap["VIVY_STREAM_FULL_CLIP_REUSE_CHORUS"])) { [string]$envMap["VIVY_STREAM_FULL_CLIP_REUSE_CHORUS"] } else { "1" })
  VIVY_STREAM_FULL_CLIP_CONCURRENCY = $(if ($env:VIVY_STREAM_FULL_CLIP_CONCURRENCY) { $env:VIVY_STREAM_FULL_CLIP_CONCURRENCY } elseif ($envMap.Contains("VIVY_STREAM_FULL_CLIP_CONCURRENCY") -and -not [string]::IsNullOrWhiteSpace([string]$envMap["VIVY_STREAM_FULL_CLIP_CONCURRENCY"])) { [string]$envMap["VIVY_STREAM_FULL_CLIP_CONCURRENCY"] } else { "2" })
  VIVY_STREAM_FULL_CLIP_GENERATE_SCENE_LOOPS = $(if ($env:VIVY_STREAM_FULL_CLIP_GENERATE_SCENE_LOOPS) { $env:VIVY_STREAM_FULL_CLIP_GENERATE_SCENE_LOOPS } elseif ($envMap.Contains("VIVY_STREAM_FULL_CLIP_GENERATE_SCENE_LOOPS") -and -not [string]::IsNullOrWhiteSpace([string]$envMap["VIVY_STREAM_FULL_CLIP_GENERATE_SCENE_LOOPS"])) { [string]$envMap["VIVY_STREAM_FULL_CLIP_GENERATE_SCENE_LOOPS"] } else { "1" })
  VIVY_STREAM_FULL_CLIP_LOOP_SECONDS = $(if ($env:VIVY_STREAM_FULL_CLIP_LOOP_SECONDS) { $env:VIVY_STREAM_FULL_CLIP_LOOP_SECONDS } elseif ($envMap.Contains("VIVY_STREAM_FULL_CLIP_LOOP_SECONDS") -and -not [string]::IsNullOrWhiteSpace([string]$envMap["VIVY_STREAM_FULL_CLIP_LOOP_SECONDS"])) { [string]$envMap["VIVY_STREAM_FULL_CLIP_LOOP_SECONDS"] } else { "8" })
  VIVY_STREAM_FULL_CLIP_WIDTH = $(if ($env:VIVY_STREAM_FULL_CLIP_WIDTH) { $env:VIVY_STREAM_FULL_CLIP_WIDTH } elseif ($envMap.Contains("VIVY_STREAM_FULL_CLIP_WIDTH") -and -not [string]::IsNullOrWhiteSpace([string]$envMap["VIVY_STREAM_FULL_CLIP_WIDTH"])) { [string]$envMap["VIVY_STREAM_FULL_CLIP_WIDTH"] } else { "1280" })
  VIVY_STREAM_FULL_CLIP_HEIGHT = $(if ($env:VIVY_STREAM_FULL_CLIP_HEIGHT) { $env:VIVY_STREAM_FULL_CLIP_HEIGHT } elseif ($envMap.Contains("VIVY_STREAM_FULL_CLIP_HEIGHT") -and -not [string]::IsNullOrWhiteSpace([string]$envMap["VIVY_STREAM_FULL_CLIP_HEIGHT"])) { [string]$envMap["VIVY_STREAM_FULL_CLIP_HEIGHT"] } else { "720" })
  VIVY_STREAM_FULL_CLIP_FPS = $(if ($env:VIVY_STREAM_FULL_CLIP_FPS) { $env:VIVY_STREAM_FULL_CLIP_FPS } elseif ($envMap.Contains("VIVY_STREAM_FULL_CLIP_FPS") -and -not [string]::IsNullOrWhiteSpace([string]$envMap["VIVY_STREAM_FULL_CLIP_FPS"])) { [string]$envMap["VIVY_STREAM_FULL_CLIP_FPS"] } else { "24" })
  VIVY_STREAM_FULL_CLIP_CROP_SOURCE_IMAGE = $(if ($env:VIVY_STREAM_FULL_CLIP_CROP_SOURCE_IMAGE) { $env:VIVY_STREAM_FULL_CLIP_CROP_SOURCE_IMAGE } elseif ($envMap.Contains("VIVY_STREAM_FULL_CLIP_CROP_SOURCE_IMAGE") -and -not [string]::IsNullOrWhiteSpace([string]$envMap["VIVY_STREAM_FULL_CLIP_CROP_SOURCE_IMAGE"])) { [string]$envMap["VIVY_STREAM_FULL_CLIP_CROP_SOURCE_IMAGE"] } else { "1" })
  VIVY_STREAM_FULL_CLIP_SOURCE_CROP_WIDTH_RATIO = $(if ($env:VIVY_STREAM_FULL_CLIP_SOURCE_CROP_WIDTH_RATIO) { $env:VIVY_STREAM_FULL_CLIP_SOURCE_CROP_WIDTH_RATIO } elseif ($envMap.Contains("VIVY_STREAM_FULL_CLIP_SOURCE_CROP_WIDTH_RATIO") -and -not [string]::IsNullOrWhiteSpace([string]$envMap["VIVY_STREAM_FULL_CLIP_SOURCE_CROP_WIDTH_RATIO"])) { [string]$envMap["VIVY_STREAM_FULL_CLIP_SOURCE_CROP_WIDTH_RATIO"] } else { "0.58" })
  VIVY_STREAM_FULL_CLIP_SOURCE_CROP_X_BIAS = $(if ($env:VIVY_STREAM_FULL_CLIP_SOURCE_CROP_X_BIAS) { $env:VIVY_STREAM_FULL_CLIP_SOURCE_CROP_X_BIAS } elseif ($envMap.Contains("VIVY_STREAM_FULL_CLIP_SOURCE_CROP_X_BIAS") -and -not [string]::IsNullOrWhiteSpace([string]$envMap["VIVY_STREAM_FULL_CLIP_SOURCE_CROP_X_BIAS"])) { [string]$envMap["VIVY_STREAM_FULL_CLIP_SOURCE_CROP_X_BIAS"] } else { "0.62" })
  VIVY_STREAM_FULL_CLIP_SOURCE_CROP_Y_BIAS = $(if ($env:VIVY_STREAM_FULL_CLIP_SOURCE_CROP_Y_BIAS) { $env:VIVY_STREAM_FULL_CLIP_SOURCE_CROP_Y_BIAS } elseif ($envMap.Contains("VIVY_STREAM_FULL_CLIP_SOURCE_CROP_Y_BIAS") -and -not [string]::IsNullOrWhiteSpace([string]$envMap["VIVY_STREAM_FULL_CLIP_SOURCE_CROP_Y_BIAS"])) { [string]$envMap["VIVY_STREAM_FULL_CLIP_SOURCE_CROP_Y_BIAS"] } else { "0.5" })
  VIVY_STREAM_FULL_CLIP_DEMOSAIC_GRID = $(if ($env:VIVY_STREAM_FULL_CLIP_DEMOSAIC_GRID) { $env:VIVY_STREAM_FULL_CLIP_DEMOSAIC_GRID } elseif ($envMap.Contains("VIVY_STREAM_FULL_CLIP_DEMOSAIC_GRID") -and -not [string]::IsNullOrWhiteSpace([string]$envMap["VIVY_STREAM_FULL_CLIP_DEMOSAIC_GRID"])) { [string]$envMap["VIVY_STREAM_FULL_CLIP_DEMOSAIC_GRID"] } else { "0" })
  VIVY_STREAM_FULL_CLIP_DEMOSAIC_COLUMNS = $(if ($env:VIVY_STREAM_FULL_CLIP_DEMOSAIC_COLUMNS) { $env:VIVY_STREAM_FULL_CLIP_DEMOSAIC_COLUMNS } elseif ($envMap.Contains("VIVY_STREAM_FULL_CLIP_DEMOSAIC_COLUMNS") -and -not [string]::IsNullOrWhiteSpace([string]$envMap["VIVY_STREAM_FULL_CLIP_DEMOSAIC_COLUMNS"])) { [string]$envMap["VIVY_STREAM_FULL_CLIP_DEMOSAIC_COLUMNS"] } else { "3" })
  VIVY_STREAM_FULL_CLIP_DEMOSAIC_ROWS = $(if ($env:VIVY_STREAM_FULL_CLIP_DEMOSAIC_ROWS) { $env:VIVY_STREAM_FULL_CLIP_DEMOSAIC_ROWS } elseif ($envMap.Contains("VIVY_STREAM_FULL_CLIP_DEMOSAIC_ROWS") -and -not [string]::IsNullOrWhiteSpace([string]$envMap["VIVY_STREAM_FULL_CLIP_DEMOSAIC_ROWS"])) { [string]$envMap["VIVY_STREAM_FULL_CLIP_DEMOSAIC_ROWS"] } else { "3" })
  VIVY_STREAM_FULL_CLIP_DEMOSAIC_ACTIVE_HEIGHT_RATIO = $(if ($env:VIVY_STREAM_FULL_CLIP_DEMOSAIC_ACTIVE_HEIGHT_RATIO) { $env:VIVY_STREAM_FULL_CLIP_DEMOSAIC_ACTIVE_HEIGHT_RATIO } elseif ($envMap.Contains("VIVY_STREAM_FULL_CLIP_DEMOSAIC_ACTIVE_HEIGHT_RATIO") -and -not [string]::IsNullOrWhiteSpace([string]$envMap["VIVY_STREAM_FULL_CLIP_DEMOSAIC_ACTIVE_HEIGHT_RATIO"])) { [string]$envMap["VIVY_STREAM_FULL_CLIP_DEMOSAIC_ACTIVE_HEIGHT_RATIO"] } else { "0.9" })
  VIVY_STREAM_FULL_CLIP_DEMOSAIC_SEGMENT_SECONDS = $(if ($env:VIVY_STREAM_FULL_CLIP_DEMOSAIC_SEGMENT_SECONDS) { $env:VIVY_STREAM_FULL_CLIP_DEMOSAIC_SEGMENT_SECONDS } elseif ($envMap.Contains("VIVY_STREAM_FULL_CLIP_DEMOSAIC_SEGMENT_SECONDS") -and -not [string]::IsNullOrWhiteSpace([string]$envMap["VIVY_STREAM_FULL_CLIP_DEMOSAIC_SEGMENT_SECONDS"])) { [string]$envMap["VIVY_STREAM_FULL_CLIP_DEMOSAIC_SEGMENT_SECONDS"] } else { "1.25" })
  VIVY_STREAM_FULL_CLIP_DEMOSAIC_ORDER = $(if ($env:VIVY_STREAM_FULL_CLIP_DEMOSAIC_ORDER) { $env:VIVY_STREAM_FULL_CLIP_DEMOSAIC_ORDER } elseif ($envMap.Contains("VIVY_STREAM_FULL_CLIP_DEMOSAIC_ORDER") -and -not [string]::IsNullOrWhiteSpace([string]$envMap["VIVY_STREAM_FULL_CLIP_DEMOSAIC_ORDER"])) { [string]$envMap["VIVY_STREAM_FULL_CLIP_DEMOSAIC_ORDER"] } else { "4,1,5,7,2,8" })
  VIVY_STREAM_IDLE_JUKEBOX_DISABLED = $(if ($env:VIVY_STREAM_IDLE_JUKEBOX_DISABLED) { $env:VIVY_STREAM_IDLE_JUKEBOX_DISABLED } elseif ($envMap.Contains("VIVY_STREAM_IDLE_JUKEBOX_DISABLED") -and -not [string]::IsNullOrWhiteSpace([string]$envMap["VIVY_STREAM_IDLE_JUKEBOX_DISABLED"])) { [string]$envMap["VIVY_STREAM_IDLE_JUKEBOX_DISABLED"] } else { "1" })
  VIVY_STREAM_AUTOGENERATE_ENABLED = $(if ($env:VIVY_STREAM_AUTOGENERATE_ENABLED) { $env:VIVY_STREAM_AUTOGENERATE_ENABLED } elseif ($envMap.Contains("VIVY_STREAM_AUTOGENERATE_ENABLED") -and -not [string]::IsNullOrWhiteSpace([string]$envMap["VIVY_STREAM_AUTOGENERATE_ENABLED"])) { [string]$envMap["VIVY_STREAM_AUTOGENERATE_ENABLED"] } else { "1" })
  TWITCH_CHANNEL = $(if ($env:TWITCH_CHANNEL) { $env:TWITCH_CHANNEL } elseif ($envMap.Contains("TWITCH_CHANNEL") -and -not [string]::IsNullOrWhiteSpace([string]$envMap["TWITCH_CHANNEL"])) { [string]$envMap["TWITCH_CHANNEL"] } else { "" })
  TWITCH_BOT_USERNAME = $(if ($env:TWITCH_BOT_USERNAME) { $env:TWITCH_BOT_USERNAME } elseif ($envMap.Contains("TWITCH_BOT_USERNAME") -and -not [string]::IsNullOrWhiteSpace([string]$envMap["TWITCH_BOT_USERNAME"])) { [string]$envMap["TWITCH_BOT_USERNAME"] } else { "" })
  TWITCH_OAUTH_TOKEN = $(if ($env:TWITCH_OAUTH_TOKEN) { $env:TWITCH_OAUTH_TOKEN } elseif ($envMap.Contains("TWITCH_OAUTH_TOKEN") -and -not [string]::IsNullOrWhiteSpace([string]$envMap["TWITCH_OAUTH_TOKEN"])) { [string]$envMap["TWITCH_OAUTH_TOKEN"] } else { "" })
  TWITCH_ACCESS_TOKEN = $(if ($env:TWITCH_ACCESS_TOKEN) { $env:TWITCH_ACCESS_TOKEN } elseif ($envMap.Contains("TWITCH_ACCESS_TOKEN") -and -not [string]::IsNullOrWhiteSpace([string]$envMap["TWITCH_ACCESS_TOKEN"])) { [string]$envMap["TWITCH_ACCESS_TOKEN"] } else { "" })
  TWITCH_CLIENT_ID = $(if ($env:TWITCH_CLIENT_ID) { $env:TWITCH_CLIENT_ID } elseif ($envMap.Contains("TWITCH_CLIENT_ID") -and -not [string]::IsNullOrWhiteSpace([string]$envMap["TWITCH_CLIENT_ID"])) { [string]$envMap["TWITCH_CLIENT_ID"] } else { "" })
  TWITCH_REFRESH_TOKEN = $(if ($env:TWITCH_REFRESH_TOKEN) { $env:TWITCH_REFRESH_TOKEN } elseif ($envMap.Contains("TWITCH_REFRESH_TOKEN") -and -not [string]::IsNullOrWhiteSpace([string]$envMap["TWITCH_REFRESH_TOKEN"])) { [string]$envMap["TWITCH_REFRESH_TOKEN"] } else { "" })
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
  VIVY_MUSIC_PROVIDER = $(if ($env:VIVY_MUSIC_PROVIDER) { $env:VIVY_MUSIC_PROVIDER } else { "suno,mureka" })
  VIVY_MUREKA_API_KEY_FILE = $(if ($env:VIVY_MUREKA_API_KEY_FILE) { $env:VIVY_MUREKA_API_KEY_FILE } else { "/app/runtime/secrets/mureka_api_key" })
  VIVY_MUREKA_BASE_URL = $(if ($env:VIVY_MUREKA_BASE_URL) { $env:VIVY_MUREKA_BASE_URL } else { "https://api.mureka.ai" })
  VIVY_MUREKA_MODEL = $(if ($env:VIVY_MUREKA_MODEL) { $env:VIVY_MUREKA_MODEL } else { "mureka-9" })
  VIVY_SUNO_API_KEY_FILE = $(if ($env:VIVY_SUNO_API_KEY_FILE) { $env:VIVY_SUNO_API_KEY_FILE } else { "/app/runtime/secrets/suno_api_key" })
  VIVY_SUNO_BASE_URL = $(if ($env:VIVY_SUNO_BASE_URL) { $env:VIVY_SUNO_BASE_URL } else { "https://api.sunoapi.org/api/v1" })
  VIVY_SUNO_MODEL = $(if ($env:VIVY_SUNO_MODEL) { $env:VIVY_SUNO_MODEL } else { "V5_5" })
  VIVY_SUNO_LONG_MODEL = $(if ($env:VIVY_SUNO_LONG_MODEL) { $env:VIVY_SUNO_LONG_MODEL } else { "V5_5" })
  VIVY_SUNO_VOICE_ID = $(if ($env:VIVY_SUNO_VOICE_ID) { $env:VIVY_SUNO_VOICE_ID } elseif (-not [string]::IsNullOrWhiteSpace([string]$envMap["VIVY_SUNO_VOICE_ID"])) { [string]$envMap["VIVY_SUNO_VOICE_ID"] } else { "" })
  VIVY_SUNO_DJEFF_VOICE_ID = $(if ($env:VIVY_SUNO_DJEFF_VOICE_ID) { $env:VIVY_SUNO_DJEFF_VOICE_ID } elseif (-not [string]::IsNullOrWhiteSpace([string]$envMap["VIVY_SUNO_DJEFF_VOICE_ID"])) { [string]$envMap["VIVY_SUNO_DJEFF_VOICE_ID"] } elseif (-not [string]::IsNullOrWhiteSpace([string]$envMap["SUNO_DJEFF_VOICE_ID"])) { [string]$envMap["SUNO_DJEFF_VOICE_ID"] } elseif (-not [string]::IsNullOrWhiteSpace([string]$envMap["A11_SUNO_DJEFF_VOICE_ID"])) { [string]$envMap["A11_SUNO_DJEFF_VOICE_ID"] } else { "" })
  VIVY_SUNO_MARVIN_VOICE_ID = $(if ($env:VIVY_SUNO_MARVIN_VOICE_ID) { $env:VIVY_SUNO_MARVIN_VOICE_ID } elseif (-not [string]::IsNullOrWhiteSpace([string]$envMap["VIVY_SUNO_MARVIN_VOICE_ID"])) { [string]$envMap["VIVY_SUNO_MARVIN_VOICE_ID"] } elseif (-not [string]::IsNullOrWhiteSpace([string]$envMap["VIVY_SUNO_FRERE_VOICE_ID"])) { [string]$envMap["VIVY_SUNO_FRERE_VOICE_ID"] } elseif (-not [string]::IsNullOrWhiteSpace([string]$envMap["SUNO_MARVIN_VOICE_ID"])) { [string]$envMap["SUNO_MARVIN_VOICE_ID"] } elseif (-not [string]::IsNullOrWhiteSpace([string]$envMap["SUNO_FRERE_VOICE_ID"])) { [string]$envMap["SUNO_FRERE_VOICE_ID"] } elseif (-not [string]::IsNullOrWhiteSpace([string]$envMap["A11_SUNO_MARVIN_VOICE_ID"])) { [string]$envMap["A11_SUNO_MARVIN_VOICE_ID"] } else { "" })
  VIVY_SUNO_A11_VOICE_ID = $(if ($env:VIVY_SUNO_A11_VOICE_ID) { $env:VIVY_SUNO_A11_VOICE_ID } elseif (-not [string]::IsNullOrWhiteSpace([string]$envMap["VIVY_SUNO_A11_VOICE_ID"])) { [string]$envMap["VIVY_SUNO_A11_VOICE_ID"] } elseif (-not [string]::IsNullOrWhiteSpace([string]$envMap["SUNO_A11_VOICE_ID"])) { [string]$envMap["SUNO_A11_VOICE_ID"] } elseif (-not [string]::IsNullOrWhiteSpace([string]$envMap["A11_SUNO_A11_VOICE_ID"])) { [string]$envMap["A11_SUNO_A11_VOICE_ID"] } else { "" })
  VIVY_SUNO_K44_VOICE_ID = $(if ($env:VIVY_SUNO_K44_VOICE_ID) { $env:VIVY_SUNO_K44_VOICE_ID } elseif (-not [string]::IsNullOrWhiteSpace([string]$envMap["VIVY_SUNO_K44_VOICE_ID"])) { [string]$envMap["VIVY_SUNO_K44_VOICE_ID"] } elseif (-not [string]::IsNullOrWhiteSpace([string]$envMap["VIVY_SUNO_KAEN44_VOICE_ID"])) { [string]$envMap["VIVY_SUNO_KAEN44_VOICE_ID"] } elseif (-not [string]::IsNullOrWhiteSpace([string]$envMap["SUNO_K44_VOICE_ID"])) { [string]$envMap["SUNO_K44_VOICE_ID"] } elseif (-not [string]::IsNullOrWhiteSpace([string]$envMap["SUNO_KAEN44_VOICE_ID"])) { [string]$envMap["SUNO_KAEN44_VOICE_ID"] } elseif (-not [string]::IsNullOrWhiteSpace([string]$envMap["A11_SUNO_K44_VOICE_ID"])) { [string]$envMap["A11_SUNO_K44_VOICE_ID"] } else { "" })
  VIVY_SUNO_KAEN44_VOICE_ID = $(if ($env:VIVY_SUNO_KAEN44_VOICE_ID) { $env:VIVY_SUNO_KAEN44_VOICE_ID } elseif (-not [string]::IsNullOrWhiteSpace([string]$envMap["VIVY_SUNO_KAEN44_VOICE_ID"])) { [string]$envMap["VIVY_SUNO_KAEN44_VOICE_ID"] } elseif (-not [string]::IsNullOrWhiteSpace([string]$envMap["VIVY_SUNO_K44_VOICE_ID"])) { [string]$envMap["VIVY_SUNO_K44_VOICE_ID"] } elseif (-not [string]::IsNullOrWhiteSpace([string]$envMap["SUNO_KAEN44_VOICE_ID"])) { [string]$envMap["SUNO_KAEN44_VOICE_ID"] } elseif (-not [string]::IsNullOrWhiteSpace([string]$envMap["SUNO_K44_VOICE_ID"])) { [string]$envMap["SUNO_K44_VOICE_ID"] } elseif (-not [string]::IsNullOrWhiteSpace([string]$envMap["A11_SUNO_K44_VOICE_ID"])) { [string]$envMap["A11_SUNO_K44_VOICE_ID"] } else { "" })
  VIVY_SUNO_CALLBACK_URL = $(if ($env:VIVY_SUNO_CALLBACK_URL) { $env:VIVY_SUNO_CALLBACK_URL } else { "https://vivy.funesterie.me/api/vivy/studio/suno/callback" })
  VIVY_SUNO_CALLBACK_TOKEN = $(if ($env:VIVY_SUNO_CALLBACK_TOKEN) { $env:VIVY_SUNO_CALLBACK_TOKEN } else { "" })
  ENABLE_PIPER_HTTP = $(if ($env:ENABLE_PIPER_HTTP) { $env:ENABLE_PIPER_HTTP } else { "true" })
  A11_TTS_ALLOW_XTTS_RVC_AUTO = $(if ($env:A11_TTS_ALLOW_XTTS_RVC_AUTO) { $env:A11_TTS_ALLOW_XTTS_RVC_AUTO } else { "true" })
  A11_TTS_VOICE_POLISH_ENABLED = $(if ($env:A11_TTS_VOICE_POLISH_ENABLED) { $env:A11_TTS_VOICE_POLISH_ENABLED } else { "true" })
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
  A11_VIDEO_COMFY_CLOUD_ENABLED = $(if ($env:A11_VIDEO_COMFY_CLOUD_ENABLED) { $env:A11_VIDEO_COMFY_CLOUD_ENABLED } elseif ($envMap.Contains("A11_VIDEO_COMFY_CLOUD_ENABLED") -and -not [string]::IsNullOrWhiteSpace([string]$envMap["A11_VIDEO_COMFY_CLOUD_ENABLED"])) { [string]$envMap["A11_VIDEO_COMFY_CLOUD_ENABLED"] } else { "1" })
  A11_COMFY_CLOUD_API_KEY = $(if ($env:A11_COMFY_CLOUD_API_KEY) { $env:A11_COMFY_CLOUD_API_KEY } elseif ($envMap.Contains("A11_COMFY_CLOUD_API_KEY") -and -not [string]::IsNullOrWhiteSpace([string]$envMap["A11_COMFY_CLOUD_API_KEY"])) { [string]$envMap["A11_COMFY_CLOUD_API_KEY"] } else { "" })
  A11_COMFY_CLOUD_BASE_URL = $(if ($env:A11_COMFY_CLOUD_BASE_URL) { $env:A11_COMFY_CLOUD_BASE_URL } elseif ($envMap.Contains("A11_COMFY_CLOUD_BASE_URL") -and -not [string]::IsNullOrWhiteSpace([string]$envMap["A11_COMFY_CLOUD_BASE_URL"])) { [string]$envMap["A11_COMFY_CLOUD_BASE_URL"] } else { "https://cloud.comfy.org" })
  A11_COMFY_CLOUD_WORKFLOW_PATH = $(if ($env:A11_COMFY_CLOUD_WORKFLOW_PATH) { $env:A11_COMFY_CLOUD_WORKFLOW_PATH } elseif ($envMap.Contains("A11_COMFY_CLOUD_WORKFLOW_PATH") -and -not [string]::IsNullOrWhiteSpace([string]$envMap["A11_COMFY_CLOUD_WORKFLOW_PATH"])) { [string]$envMap["A11_COMFY_CLOUD_WORKFLOW_PATH"] } else { "" })
  A11_COMFY_CLOUD_TIMEOUT_MS = $(if ($env:A11_COMFY_CLOUD_TIMEOUT_MS) { $env:A11_COMFY_CLOUD_TIMEOUT_MS } elseif ($envMap.Contains("A11_COMFY_CLOUD_TIMEOUT_MS") -and -not [string]::IsNullOrWhiteSpace([string]$envMap["A11_COMFY_CLOUD_TIMEOUT_MS"])) { [string]$envMap["A11_COMFY_CLOUD_TIMEOUT_MS"] } else { "2700000" })
  A11_COMFY_CLOUD_POLL_INTERVAL_MS = $(if ($env:A11_COMFY_CLOUD_POLL_INTERVAL_MS) { $env:A11_COMFY_CLOUD_POLL_INTERVAL_MS } elseif ($envMap.Contains("A11_COMFY_CLOUD_POLL_INTERVAL_MS") -and -not [string]::IsNullOrWhiteSpace([string]$envMap["A11_COMFY_CLOUD_POLL_INTERVAL_MS"])) { [string]$envMap["A11_COMFY_CLOUD_POLL_INTERVAL_MS"] } else { "5000" })
  A11_COMFY_CLOUD_WAN_MODEL = $(if ($env:A11_COMFY_CLOUD_WAN_MODEL) { $env:A11_COMFY_CLOUD_WAN_MODEL } elseif ($envMap.Contains("A11_COMFY_CLOUD_WAN_MODEL") -and -not [string]::IsNullOrWhiteSpace([string]$envMap["A11_COMFY_CLOUD_WAN_MODEL"])) { [string]$envMap["A11_COMFY_CLOUD_WAN_MODEL"] } else { "wan2.5-i2v-preview" })
  A11_COMFY_CLOUD_WAN_RESOLUTION = $(if ($env:A11_COMFY_CLOUD_WAN_RESOLUTION) { $env:A11_COMFY_CLOUD_WAN_RESOLUTION } elseif ($envMap.Contains("A11_COMFY_CLOUD_WAN_RESOLUTION") -and -not [string]::IsNullOrWhiteSpace([string]$envMap["A11_COMFY_CLOUD_WAN_RESOLUTION"])) { [string]$envMap["A11_COMFY_CLOUD_WAN_RESOLUTION"] } else { "480P" })
  A11_VIDEO_PROXY_URL = $(if ($env:A11_VIDEO_PROXY_URL) { $env:A11_VIDEO_PROXY_URL } elseif ($envMap.Contains("A11_VIDEO_PROXY_URL") -and -not [string]::IsNullOrWhiteSpace([string]$envMap["A11_VIDEO_PROXY_URL"])) { [string]$envMap["A11_VIDEO_PROXY_URL"] } else { "" })
  A11_VIDEO_PROXY_TOKEN = $(if ($env:A11_VIDEO_PROXY_TOKEN) { $env:A11_VIDEO_PROXY_TOKEN } elseif ($envMap.Contains("A11_VIDEO_PROXY_TOKEN") -and -not [string]::IsNullOrWhiteSpace([string]$envMap["A11_VIDEO_PROXY_TOKEN"])) { [string]$envMap["A11_VIDEO_PROXY_TOKEN"] } else { "" })
  A11_VIDEO_PROXY_PUBLIC_FILE_BASE_URL = $(if ($env:A11_VIDEO_PROXY_PUBLIC_FILE_BASE_URL) { $env:A11_VIDEO_PROXY_PUBLIC_FILE_BASE_URL } elseif ($envMap.Contains("A11_VIDEO_PROXY_PUBLIC_FILE_BASE_URL") -and -not [string]::IsNullOrWhiteSpace([string]$envMap["A11_VIDEO_PROXY_PUBLIC_FILE_BASE_URL"])) { [string]$envMap["A11_VIDEO_PROXY_PUBLIC_FILE_BASE_URL"] } else { "" })
  A11_VIDEO_PROXY_TIMEOUT_MS = $(if ($env:A11_VIDEO_PROXY_TIMEOUT_MS) { $env:A11_VIDEO_PROXY_TIMEOUT_MS } elseif ($envMap.Contains("A11_VIDEO_PROXY_TIMEOUT_MS") -and -not [string]::IsNullOrWhiteSpace([string]$envMap["A11_VIDEO_PROXY_TIMEOUT_MS"])) { [string]$envMap["A11_VIDEO_PROXY_TIMEOUT_MS"] } else { "2700000" })
  A11_VIDEO_ASYNC_JOB_TTL_MS = $(if ($env:A11_VIDEO_ASYNC_JOB_TTL_MS) { $env:A11_VIDEO_ASYNC_JOB_TTL_MS } elseif ($envMap.Contains("A11_VIDEO_ASYNC_JOB_TTL_MS") -and -not [string]::IsNullOrWhiteSpace([string]$envMap["A11_VIDEO_ASYNC_JOB_TTL_MS"])) { [string]$envMap["A11_VIDEO_ASYNC_JOB_TTL_MS"] } else { "2700000" })
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
  Send-FileViaSsh -SshArgs $sshBase -RemoteHost $Remote -LocalPath $localSunoSecret -RemotePath $remoteSunoSecret
  if ($LASTEXITCODE -ne 0) { throw "Copie secret Suno echouee vers $remoteSunoSecret" }
  & ssh @sshBase $Remote "chmod 600 $RemoteDataRoot/runtime/secrets/suno_api_key"
  if ($LASTEXITCODE -ne 0) { throw "Permissions secret Suno echouees" }
  Write-Host "Secret Suno synchronise vers le runtime canonique." -ForegroundColor DarkCyan
}

$localMurekaSecretCandidates = @(
  $env:VIVY_MUREKA_LOCAL_API_KEY_FILE,
  (Join-Path $A11Root "runtime\secrets\mureka_api_key"),
  (Join-Path $env:USERPROFILE "OneDrive\Bureau\mureka api.txt")
) | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) }
$localMurekaSecret = $localMurekaSecretCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if ($localMurekaSecret) {
  $remoteMurekaSecret = "$RemoteDataRoot/runtime/secrets/mureka_api_key"
  Send-FileViaSsh -SshArgs $sshBase -RemoteHost $Remote -LocalPath $localMurekaSecret -RemotePath $remoteMurekaSecret
  if ($LASTEXITCODE -ne 0) { throw "Copie secret Mureka echouee vers $remoteMurekaSecret" }
  & ssh @sshBase $Remote "chmod 600 $RemoteDataRoot/runtime/secrets/mureka_api_key"
  if ($LASTEXITCODE -ne 0) { throw "Permissions secret Mureka echouees" }
  Write-Host "Secret Mureka synchronise vers le runtime canonique." -ForegroundColor DarkCyan
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

# Envoi reprenable. Sur un lien qui coupe (tethering, reseau filtre), un scp de 40 Mo
# meurt en vol et repart de zero a chaque tentative: le 29/07/2026 huit morceaux ont ete
# tronques d'affilee sans qu'aucun deploiement n'aboutisse. Ici on interroge la taille
# REELLEMENT recue et on ne renvoie que ce qui manque, par tranches. Une coupure ne coute
# plus que la tranche en cours. L'integrite est verifiee a la fin, et un prefixe corrompu
# fait repartir proprement de zero.
function Send-FileResumable {
  param(
    [string[]]$SshArgs,
    [string]$RemoteHost,
    [string]$LocalPath,
    [string]$RemotePath,
    [int]$ChunkBytes = 4194304,
    [int]$MaxStalls = 40,
    # L'archive se verifie par gzip -t. Les autres fichiers -- les references voix
    # notamment -- ne sont pas des gzip : on compare alors la taille recue.
    [switch]$NoGzipCheck,
    [string]$Etiquette = "Archive"
  )

  $localSize = (Get-Item -LiteralPath $LocalPath).Length
  $tmpChunk = Join-Path ([IO.Path]::GetTempPath()) ("a11-upload-" + [Guid]::NewGuid().ToString('N') + ".part")
  $remotePart = "$RemotePath.part"
  # Meme echappement que Send-FileViaSsh. Oubli du 02/08 : j ai corrige les
  # apostrophes dans l autre expediteur, puis bascule les fichiers voix sur
  # celui-ci, qui ne l avait pas. "djeff-corpus-C est chaud.mp3" a donc reperdu
  # 40 tranches d affilee -- le shell distant cassait sur l apostrophe, jamais le
  # lien. Echappement POSIX : une apostrophe devient quote-backslash-quote-quote.
  $remoteEsc = $RemotePath.Replace("'", "'\x27'")
  $partEsc = $remotePart.Replace("'", "'\x27'")
  $stalls = 0

  while ($true) {
    # Une reponse vide (ssh qui echoue) donnait [int64]('') -> exception, et le
    # deploiement mourait a la premiere tranche au lieu de reessayer.
    $raw = (& ssh @SshArgs $RemoteHost "stat -c '%s' '$remoteEsc' 2>/dev/null || echo 0")
    $chiffres = ("$raw").Trim() -replace '[^0-9]', ''
    if ([string]::IsNullOrWhiteSpace($chiffres)) { $chiffres = '0' }
    $offset = [int64]$chiffres
    if ($offset -gt $localSize) {
      Write-Host "Archive distante plus grande que la locale, on repart de zero." -ForegroundColor DarkYellow
      & ssh @SshArgs $RemoteHost "rm -f '$remoteEsc' '$partEsc'" | Out-Null
      continue
    }
    if ($offset -eq $localSize) { break }

    $take = [int][Math]::Min([int64]$ChunkBytes, $localSize - $offset)
    $stream = [IO.File]::OpenRead($LocalPath)
    try {
      $stream.Seek($offset, [IO.SeekOrigin]::Begin) | Out-Null
      $buffer = New-Object byte[] $take
      $read = $stream.Read($buffer, 0, $take)
    } finally { $stream.Dispose() }

    $out = [IO.File]::Create($tmpChunk)
    try { $out.Write($buffer, 0, $read) } finally { $out.Dispose() }

    $pct = [math]::Round(100 * $offset / $localSize, 1)
    Write-Host ("  envoi {0} % ({1:N0}/{2:N0} octets)" -f $pct, $offset, $localSize) -ForegroundColor DarkGray
    # Transport: stdin de ssh, PAS scp. Mesure du 01/08/2026 depuis un lien filtre:
    # scp cale en plein transfert (canal de donnees fige, aucune progression), alors que
    # le meme lien fait passer 8 Mo par stdin de ssh sans interruption (~70 Ko/s). On
    # ecrit donc la tranche directement en append sur la cible distante. Avantage
    # supplementaire: si la connexion meurt en cours de tranche, les octets deja ecrits
    # sont conserves et l'iteration suivante repart de la taille reellement recue --
    # la reprise devient octet par octet au lieu de tranche par tranche.
    $catArgs = @($SshArgs) + @($RemoteHost, "cat >> '$remoteEsc'")
    $sshErrTmp = "$tmpChunk.ssh.err"
    $sendProc = Start-Process -FilePath "ssh" -ArgumentList $catArgs -NoNewWindow -PassThru -RedirectStandardInput $tmpChunk -RedirectStandardError $sshErrTmp
    $sendProc | Wait-Process -Timeout 300 -ErrorAction SilentlyContinue
    if (-not $sendProc.HasExited) { Stop-Process -Id $sendProc.Id -Force -ErrorAction SilentlyContinue; $global:LASTEXITCODE = 124 } else { $global:LASTEXITCODE = [int]$sendProc.ExitCode }
    Remove-Item -LiteralPath $sshErrTmp -Force -ErrorAction SilentlyContinue

    $rawApres = (& ssh @SshArgs $RemoteHost "stat -c '%s' '$remoteEsc' 2>/dev/null || echo 0")
    $chiffresApres = ("$rawApres").Trim() -replace '[^0-9]', ''
    if ([string]::IsNullOrWhiteSpace($chiffresApres)) { $chiffresApres = '0' }
    $apres = [int64]$chiffresApres
    if ($apres -le $offset) {
      $stalls++
      Write-Host "  tranche perdue, nouvelle tentative ($stalls/$MaxStalls)" -ForegroundColor DarkYellow
      & ssh @SshArgs $RemoteHost "rm -f '$partEsc'" | Out-Null
      if ($stalls -ge $MaxStalls) {
        Remove-Item -LiteralPath $tmpChunk -Force -ErrorAction SilentlyContinue
        throw "Envoi interrompu: $MaxStalls tranches perdues d'affilee sur $RemotePath"
      }
    } else {
      $stalls = 0
    }
  }

  Remove-Item -LiteralPath $tmpChunk -Force -ErrorAction SilentlyContinue

  if ($NoGzipCheck) {
    # Fichier binaire quelconque: on verifie la taille recue, pas l'integrite gzip.
    $recu = (& ssh @SshArgs $RemoteHost "stat -c '%s' '$remoteEsc' 2>/dev/null || echo 0")
    $recuOctets = [int64](("$recu").Trim() -replace '[^0-9]', '')
    if ($recuOctets -ne $localSize) {
      throw "$Etiquette incomplet apres envoi: $recuOctets / $localSize octets."
    }
  } else {
    & ssh @SshArgs $RemoteHost "gzip -t '$remoteEsc'" | Out-Null
    if ($LASTEXITCODE -ne 0) {
      & ssh @SshArgs $RemoteHost "rm -f '$remoteEsc'" | Out-Null
      throw "Archive distante corrompue apres envoi (gzip -t). Relancer le deploiement."
    }
  }
  Write-Host ("$Etiquette transmis et verifie ({0:N0} octets)" -f $localSize) -ForegroundColor Green
}

if ($ReuseRemoteArchive) {
  $remoteArchiveSize = (& ssh @sshBase $Remote "test -s '$RemoteArchive' && gzip -t '$RemoteArchive' && stat -c '%s' '$RemoteArchive'").Trim()
  if ($LASTEXITCODE -ne 0 -or -not $remoteArchiveSize) {
    throw "Archive distante absente ou invalide: $RemoteArchive"
  }
  Write-Host "Archive distante valide reutilisee: $RemoteArchive ($remoteArchiveSize octets)" -ForegroundColor DarkCyan
} else {
  Send-FileResumable -SshArgs $sshBase -RemoteHost $Remote -LocalPath $Archive -RemotePath $RemoteArchive
}
if (-not $ReuseRemoteSecrets) {
  Send-FileViaSsh -SshArgs $sshBase -RemoteHost $Remote -LocalPath $SecretStage -RemotePath "$RemoteRoot/secrets/a11.env"
  if ($LASTEXITCODE -ne 0) { throw "Copie env echouee" }
  Send-FileViaSsh -SshArgs $sshBase -RemoteHost $Remote -LocalPath $BuildEnvStage -RemotePath "$RemoteRoot/secrets/build.env"
  if ($LASTEXITCODE -ne 0) { throw "Copie env build echouee" }
} else {
  & ssh @sshBase $Remote "test -s $RemoteRoot/secrets/compose.env"
  if ($LASTEXITCODE -ne 0) { throw "compose.env distant introuvable; relancer sans -ReuseRemoteSecrets depuis un magasin de secrets local valide." }
}

if ($SkipRuntimeAssetSync) {
  Write-Host "Synchronisation voix/corpus sautee; volumes runtime distants conserves." -ForegroundColor Yellow
} else {
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
    # Envoi par tranches avec reprise, comme l'archive. En un seul flux, vivy.wav
    # (24 Mo) n'arrivait jamais : le lien decrochait en route, a 97 % le 02/08 a
    # 12:47 puis a 24 % a 13:47. Ni la taille ni le delai n'etaient en cause -- la
    # connexion lachait, simplement. L'archive de 40 Mo passe depuis toujours parce
    # qu'elle est decoupee : une tranche perdue coute une tranche, pas le fichier.
    Send-FileResumable -SshArgs $sshBase -RemoteHost $Remote `
      -LocalPath $voiceReference.Path `
      -RemotePath "$RemoteDataRoot/runtime/voice-library/$($voiceReference.Name)" `
      -NoGzipCheck -Etiquette "Reference voix $($voiceReference.Label)"
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
              Send-FileViaSsh -SshArgs $sshBase -RemoteHost $Remote -LocalPath $_.FullName -RemotePath "$privateCorpusTarget/$($_.Name)"
              if ($LASTEXITCODE -ne 0) { throw "Copie corpus prive $($corpusDir.Name) echouee: $($_.Name)" }
            }
        }
      }
  } else {
    Write-Warning "Corpus prive absent localement: $PrivateCorpusRoot"
  }
}

$remoteBuildEnvRefresh = @'
test -s __REMOTE_ROOT__/secrets/compose.env
build_env="__REMOTE_ROOT__/secrets/build.env"
a11_env="__REMOTE_ROOT__/secrets/a11.env"
compose_env="__REMOTE_ROOT__/secrets/compose.env"
for token_env in "$a11_env" "$compose_env" "$build_env"; do
  if [ -f "$token_env" ]; then
    token_env_clean="$(mktemp)"
    grep -v -E '^(A11_MCP_TOKEN|A11_PUBLIC_MCP_TOKEN|MCP_AUTH_TOKEN)=' "$token_env" > "$token_env_clean" || true
    mv "$token_env_clean" "$token_env"
    chmod 600 "$token_env"
  fi
done
tmp_build="$(mktemp)"
managed_keys='^(A11_BUILD_COMMIT|A11_BUILD_BRANCH|A11_BUILD_DATE|A11_VOICE_XTTS_RVC_FALLBACK|A11_LLM_PROVIDER|A11_OLLAMA_PRIMARY_MODEL|A11_OLLAMA_FALLBACK_MODEL|A11_OLLAMA_STRONG_SONG_MODEL|VIVY_CHAT_LOCAL_FIRST|VIVY_OLLAMA_BASE_URL|VIVY_CHAT_LOCAL_MODEL|VIVY_CHAT_LOCAL_TIMEOUT_MS|VIVY_CHAT_LOCAL_MAX_PROMPT_CHARS|VIVY_CHAT_LOCAL_MAX_TOKENS|VIVY_XAI_MODEL|OLLAMA_CLOUD_ENABLED|OLLAMA_CLOUD_BASE_URL|OLLAMA_CLOUD_LYRICS_MODEL|OLLAMA_CLOUD_FAST_MODEL|OLLAMA_CLOUD_CHAT_ENABLED|OLLAMA_CLOUD_CHAT_MODEL|OLLAMA_CLOUD_CHAT_THINK_LEVEL|OLLAMA_CLOUD_CHAT_TIMEOUT_MS|OLLAMA_CLOUD_THINK_LEVEL|OLLAMA_CLOUD_LYRICS_TIMEOUT_MS|VIVY_SONG_CERBERE_FALLBACK_ENABLED|VIVY_SONG_CERBERE_MODEL|VIVY_SONG_CERBERE_TIMEOUT_MS|VIVY_GROQ_RATE_LIMIT_COOLDOWN_MS|VIVY_CHAT_MAX_TOKENS|VIVY_CHAT_MAX_TOKENS_SONG|VIVY_CHAT_MAX_TOKENS_SONG_CEILING|VIVY_SONG_ALLOW_LOCAL_FALLBACK|VIVY_SONG_ALLOW_LOCAL_LYRICS_FALLBACK|VIVY_SONG_LOCAL_MODEL|A11_TRANSLATION_MODEL|LOCAL_DEFAULT_MODEL|A11_LLM_FALLBACK_PROVIDER|A11_LLM_RUNTIME_FALLBACK_ORDER|A11_CERBERE_LOCAL_ONLY|A11_LOCAL_CHAT_TIMEOUT_MS|A11_LOCAL_SONG_TIMEOUT_MS|A11_OLLAMA_KEEP_ALIVE|A11_MEMORY_LOCAL_TIMEOUT_MS|A11_MEMORY_REMOTE_TIMEOUT_MS|A11_EMBEDDING_TIMEOUT_MS|A11_RUNTIME_ROOT|VIVY_ELEVENLABS_MUSIC_DISABLED|VIVY_MUSIC_PROVIDER|VIVY_MUREKA_API_KEY_FILE|VIVY_MUREKA_BASE_URL|VIVY_MUREKA_MODEL|VIVY_SUNO_MODEL|VIVY_SUNO_LONG_MODEL|VIVY_SUNO_VOICE_ID|VIVY_SUNO_DJEFF_VOICE_ID|VIVY_SUNO_MARVIN_VOICE_ID|VIVY_SUNO_FRERE_VOICE_ID|SUNO_MARVIN_VOICE_ID|SUNO_FRERE_VOICE_ID|A11_SUNO_MARVIN_VOICE_ID|VIVY_SUNO_A11_VOICE_ID|VIVY_SUNO_K44_VOICE_ID|VIVY_SUNO_KAEN44_VOICE_ID|SUNO_DJEFF_VOICE_ID|SUNO_A11_VOICE_ID|SUNO_K44_VOICE_ID|SUNO_KAEN44_VOICE_ID|A11_SUNO_DJEFF_VOICE_ID|A11_SUNO_A11_VOICE_ID|A11_SUNO_K44_VOICE_ID|VIVY_STREAM_AUTOGENERATE_ENABLED|VIVY_STREAM_IDLE_JUKEBOX_DISABLED|VIVY_STREAM_STATE_URL|VIVY_PUBLIC_BASE_URL|VIVY_STREAM_BOT_MESSAGE_GAP_MS|VIVY_STREAM_COVER_ENABLED|VIVY_STREAM_COVER_URL|VIVY_STREAM_COVER_TIMEOUT_MS|VIVY_STREAM_CLIP_ENABLED|VIVY_STREAM_CLIP_PROVIDER|VIVY_STREAM_CLIP_DURATION_SECONDS|VIVY_STREAM_CLIP_TIMEOUT_MS|VIVY_STREAM_FULL_CLIP_ENABLED|VIVY_STREAM_FULL_CLIP_SOURCE_IMAGE_URL|VIVY_STREAM_DREAMCLIP_SOURCE_IMAGE_URL|VIVY_STREAM_FULL_CLIP_PROVIDER|VIVY_STREAM_FULL_CLIP_SCENES|VIVY_STREAM_DREAMCLIP_SCENES|VIVY_STREAM_DREAMCLIP_MAX_DURATION_SECONDS|VIVY_STREAM_DREAMCLIP_LOOP_SECONDS|VIVY_STREAM_DREAMCLIP_MIN_GENERATED_COVERAGE|VIVY_STREAM_DREAMCLIP_ALLOW_STATIC_FALLBACK|VIVY_STREAM_FULL_CLIP_INSTRUMENTAL_SCENES|VIVY_STREAM_FULL_CLIP_UNIQUE_LOOPS|VIVY_STREAM_FULL_CLIP_REUSE_CHORUS|VIVY_STREAM_FULL_CLIP_CONCURRENCY|VIVY_STREAM_FULL_CLIP_GENERATE_SCENE_LOOPS|VIVY_STREAM_FULL_CLIP_LOOP_SECONDS|VIVY_STREAM_FULL_CLIP_WIDTH|VIVY_STREAM_FULL_CLIP_HEIGHT|VIVY_STREAM_FULL_CLIP_FPS|VIVY_STREAM_FULL_CLIP_VISUAL_QA|A11_HF_VIDEO_PROVIDER|A11_REPLICATE_VIDEO_MODEL|A11_VIDEO_PROMPT_MAX_DURATION_SECONDS|VIVY_STREAM_FULL_CLIP_CROP_SOURCE_IMAGE|VIVY_STREAM_FULL_CLIP_SOURCE_CROP_WIDTH_RATIO|VIVY_STREAM_FULL_CLIP_SOURCE_CROP_X_BIAS|VIVY_STREAM_FULL_CLIP_SOURCE_CROP_Y_BIAS|VIVY_STREAM_FULL_CLIP_DEMOSAIC_GRID|VIVY_STREAM_FULL_CLIP_DEMOSAIC_COLUMNS|VIVY_STREAM_FULL_CLIP_DEMOSAIC_ROWS|VIVY_STREAM_FULL_CLIP_DEMOSAIC_ACTIVE_HEIGHT_RATIO|VIVY_STREAM_FULL_CLIP_DEMOSAIC_SEGMENT_SECONDS|VIVY_STREAM_FULL_CLIP_DEMOSAIC_ORDER|A11_VIDEO_PROXY_URL|A11_VIDEO_PROXY_TOKEN|A11_VIDEO_PROXY_PUBLIC_FILE_BASE_URL|A11_VIDEO_PROXY_TIMEOUT_MS|A11_VIDEO_ASYNC_JOB_TTL_MS|A11_VIDEO_COMFY_CLOUD_ENABLED|A11_VIDEO_COMFY_CLOUD_API_KEY|A11_VIDEO_COMFY_CLOUD_BASE_URL|A11_VIDEO_COMFY_CLOUD_WORKFLOW_PATH|A11_VIDEO_COMFY_CLOUD_TIMEOUT_MS|A11_VIDEO_COMFY_CLOUD_POLL_INTERVAL_MS|A11_VIDEO_COMFY_CLOUD_WAN_MODEL|A11_VIDEO_COMFY_CLOUD_WAN_RESOLUTION)='
managed_nossen_keys='^(VIVY_NOSSEN_LOCAL_MODEL|VIVY_NOSSEN_LARGE_MODEL_FIRST|VIVY_NOSSEN_120B_MAX_PROMPT_CHARS|VIVY_NOSSEN_120B_MAX_TOKENS|VIVY_NOSSEN_120B_TIMEOUT_MS|VIVY_NOSSEN_FAST_LOCAL_ONLY|VIVY_NOSSEN_ROUTE_LLM_ENABLED|VIVY_NOSSEN_ROUTER_LOCAL_TIMEOUT_MS|VIVY_NOSSEN_LYRICS_LOCAL_TIMEOUT_MS|VIVY_NOSSEN_LOCAL_MAX_TOKENS|VIVY_NOSSEN_LLM_BUDGET_MS|VIVY_NOSSEN_CLOUD_ATTEMPT_TIMEOUT_MS|VIVY_NOSSEN_EMERGENCY_SONGCRAFT|VIVY_ACESTEP_LYRICS_MAX_CHARS|ACESTEP_DIFFUSION_MODEL|ACESTEP_TEXT_ENCODER_1|ACESTEP_TEXT_ENCODER_2|ACESTEP_TEXT_ENCODER_2_QWEN4|ACESTEP_QWEN4_PROFILE_ENABLED|ACESTEP_VAE|ACESTEP_STEPS|ACESTEP_KSAMPLER_CFG|ACESTEP_CFG|ACESTEP_LLM_CFG_SCALE|ACESTEP_SHIFT|ACESTEP_SAMPLER|ACESTEP_SCHEDULER|ACESTEP_DEFAULT_BPM|ACESTEP_DEFAULT_DURATION_SECONDS|ACESTEP_MAX_DURATION_SECONDS|ACESTEP_TIME_SIGNATURE|ACESTEP_LANGUAGE|ACESTEP_KEYSCALE|ACESTEP_GENERATE_AUDIO_CODES|ACESTEP_TEMPERATURE|ACESTEP_TOP_P|ACESTEP_TOP_K|ACESTEP_MIN_P|ACESTEP_MP3_QUALITY|ACESTEP_HEALTH_ATTEMPTS|ACESTEP_HEALTH_RETRY_MS)='
vivy_stream_secret="$(awk -F= '/^VIVY_STREAM_SECRET=/{sub(/^[^=]*=/,""); print; exit}' "$compose_env" "$a11_env" "$build_env" 2>/dev/null || true)"
vivy_stream_autogenerate="$(awk -F= '/^VIVY_STREAM_AUTOGENERATE_ENABLED=/{sub(/^[^=]*=/,""); print; exit}' "$compose_env" "$a11_env" "$build_env" 2>/dev/null || true)"
if [ -z "$vivy_stream_autogenerate" ]; then
  vivy_stream_autogenerate="1"
fi
vivy_stream_idle_jukebox_disabled="$(awk -F= '/^VIVY_STREAM_IDLE_JUKEBOX_DISABLED=/{sub(/^[^=]*=/,""); print; exit}' "$compose_env" "$a11_env" "$build_env" 2>/dev/null || true)"
if [ -z "$vivy_stream_idle_jukebox_disabled" ]; then
  vivy_stream_idle_jukebox_disabled="1"
fi
read_first_env_value() {
  awk -v k="$1" -F= '$1 == k { sub(/^[^=]*=/, ""); print; exit }' "$compose_env" "$a11_env" "$build_env" 2>/dev/null || true
}
scentgate_signal_secret="$(read_first_env_value A11_SCENTGATE_SIGNAL_SECRET)"
suno_voice_id="$(read_first_env_value VIVY_SUNO_VOICE_ID)"
suno_djeff_voice_id="$(read_first_env_value VIVY_SUNO_DJEFF_VOICE_ID)"
[ -n "$suno_djeff_voice_id" ] || suno_djeff_voice_id="$(read_first_env_value SUNO_DJEFF_VOICE_ID)"
[ -n "$suno_djeff_voice_id" ] || suno_djeff_voice_id="$(read_first_env_value A11_SUNO_DJEFF_VOICE_ID)"
suno_marvin_voice_id="$(read_first_env_value VIVY_SUNO_MARVIN_VOICE_ID)"
[ -n "$suno_marvin_voice_id" ] || suno_marvin_voice_id="$(read_first_env_value VIVY_SUNO_FRERE_VOICE_ID)"
[ -n "$suno_marvin_voice_id" ] || suno_marvin_voice_id="$(read_first_env_value SUNO_MARVIN_VOICE_ID)"
[ -n "$suno_marvin_voice_id" ] || suno_marvin_voice_id="$(read_first_env_value SUNO_FRERE_VOICE_ID)"
[ -n "$suno_marvin_voice_id" ] || suno_marvin_voice_id="$(read_first_env_value A11_SUNO_MARVIN_VOICE_ID)"
suno_a11_voice_id="$(read_first_env_value VIVY_SUNO_A11_VOICE_ID)"
[ -n "$suno_a11_voice_id" ] || suno_a11_voice_id="$(read_first_env_value SUNO_A11_VOICE_ID)"
[ -n "$suno_a11_voice_id" ] || suno_a11_voice_id="$(read_first_env_value A11_SUNO_A11_VOICE_ID)"
suno_k44_voice_id="$(read_first_env_value VIVY_SUNO_K44_VOICE_ID)"
[ -n "$suno_k44_voice_id" ] || suno_k44_voice_id="$(read_first_env_value VIVY_SUNO_KAEN44_VOICE_ID)"
[ -n "$suno_k44_voice_id" ] || suno_k44_voice_id="$(read_first_env_value SUNO_K44_VOICE_ID)"
[ -n "$suno_k44_voice_id" ] || suno_k44_voice_id="$(read_first_env_value SUNO_KAEN44_VOICE_ID)"
[ -n "$suno_k44_voice_id" ] || suno_k44_voice_id="$(read_first_env_value A11_SUNO_K44_VOICE_ID)"
ensure_full_throttle_scene_count() {
  value="$1"
  case "$value" in
    ''|*[!0-9]*) echo "8" ;;
    *) if [ "$value" -lt 8 ]; then echo "8"; else echo "$value"; fi ;;
  esac
}
vivy_stream_full_clip_scenes="$(read_first_env_value VIVY_STREAM_FULL_CLIP_SCENES)"
[ -n "$vivy_stream_full_clip_scenes" ] || vivy_stream_full_clip_scenes="8"
vivy_stream_full_clip_scenes="$(ensure_full_throttle_scene_count "$vivy_stream_full_clip_scenes")"
vivy_stream_full_clip_source_image_url="$(read_first_env_value VIVY_STREAM_FULL_CLIP_SOURCE_IMAGE_URL)"
vivy_stream_dreamclip_source_image_url="$(read_first_env_value VIVY_STREAM_DREAMCLIP_SOURCE_IMAGE_URL)"
vivy_stream_full_clip_provider="$(read_first_env_value VIVY_STREAM_FULL_CLIP_PROVIDER)"
vivy_stream_dreamclip_scenes="$(read_first_env_value VIVY_STREAM_DREAMCLIP_SCENES)"
[ -n "$vivy_stream_dreamclip_scenes" ] || vivy_stream_dreamclip_scenes="8"
vivy_stream_dreamclip_scenes="$(ensure_full_throttle_scene_count "$vivy_stream_dreamclip_scenes")"
vivy_stream_dreamclip_max_duration_seconds="$(read_first_env_value VIVY_STREAM_DREAMCLIP_MAX_DURATION_SECONDS)"
[ -n "$vivy_stream_dreamclip_max_duration_seconds" ] || vivy_stream_dreamclip_max_duration_seconds="420"
vivy_stream_dreamclip_loop_seconds="$(read_first_env_value VIVY_STREAM_DREAMCLIP_LOOP_SECONDS)"
[ -n "$vivy_stream_dreamclip_loop_seconds" ] || vivy_stream_dreamclip_loop_seconds="15"
vivy_stream_dreamclip_min_generated_coverage="$(read_first_env_value VIVY_STREAM_DREAMCLIP_MIN_GENERATED_COVERAGE)"
vivy_stream_dreamclip_allow_static_fallback="$(read_first_env_value VIVY_STREAM_DREAMCLIP_ALLOW_STATIC_FALLBACK)"
vivy_stream_full_clip_instrumental_scenes="$(read_first_env_value VIVY_STREAM_FULL_CLIP_INSTRUMENTAL_SCENES)"
[ -n "$vivy_stream_full_clip_instrumental_scenes" ] || vivy_stream_full_clip_instrumental_scenes="8"
vivy_stream_full_clip_instrumental_scenes="$(ensure_full_throttle_scene_count "$vivy_stream_full_clip_instrumental_scenes")"
vivy_stream_full_clip_unique_loops="$(read_first_env_value VIVY_STREAM_FULL_CLIP_UNIQUE_LOOPS)"
[ -n "$vivy_stream_full_clip_unique_loops" ] || vivy_stream_full_clip_unique_loops="5"
vivy_stream_full_clip_reuse_chorus="$(read_first_env_value VIVY_STREAM_FULL_CLIP_REUSE_CHORUS)"
[ -n "$vivy_stream_full_clip_reuse_chorus" ] || vivy_stream_full_clip_reuse_chorus="1"
vivy_stream_full_clip_concurrency="$(read_first_env_value VIVY_STREAM_FULL_CLIP_CONCURRENCY)"
[ -n "$vivy_stream_full_clip_concurrency" ] || vivy_stream_full_clip_concurrency="2"
vivy_stream_full_clip_generate_scene_loops="$(read_first_env_value VIVY_STREAM_FULL_CLIP_GENERATE_SCENE_LOOPS)"
[ -n "$vivy_stream_full_clip_generate_scene_loops" ] || vivy_stream_full_clip_generate_scene_loops="1"
vivy_stream_full_clip_loop_seconds="$(read_first_env_value VIVY_STREAM_FULL_CLIP_LOOP_SECONDS)"
[ -n "$vivy_stream_full_clip_loop_seconds" ] || vivy_stream_full_clip_loop_seconds="8"
vivy_stream_full_clip_width="$(read_first_env_value VIVY_STREAM_FULL_CLIP_WIDTH)"
[ -n "$vivy_stream_full_clip_width" ] || vivy_stream_full_clip_width="1280"
vivy_stream_full_clip_height="$(read_first_env_value VIVY_STREAM_FULL_CLIP_HEIGHT)"
[ -n "$vivy_stream_full_clip_height" ] || vivy_stream_full_clip_height="720"
vivy_stream_full_clip_fps="$(read_first_env_value VIVY_STREAM_FULL_CLIP_FPS)"
[ -n "$vivy_stream_full_clip_fps" ] || vivy_stream_full_clip_fps="24"
vivy_stream_full_clip_visual_qa="$(read_first_env_value VIVY_STREAM_FULL_CLIP_VISUAL_QA)"
a11_hf_video_provider="$(read_first_env_value A11_HF_VIDEO_PROVIDER)"
[ -n "$a11_hf_video_provider" ] || a11_hf_video_provider="replicate"
a11_replicate_video_model="$(read_first_env_value A11_REPLICATE_VIDEO_MODEL)"
[ -n "$a11_replicate_video_model" ] || a11_replicate_video_model="wan-video/wan-2.6-i2v"
vivy_stream_full_clip_crop_source_image="$(read_first_env_value VIVY_STREAM_FULL_CLIP_CROP_SOURCE_IMAGE)"
[ -n "$vivy_stream_full_clip_crop_source_image" ] || vivy_stream_full_clip_crop_source_image="1"
vivy_stream_full_clip_source_crop_width_ratio="$(read_first_env_value VIVY_STREAM_FULL_CLIP_SOURCE_CROP_WIDTH_RATIO)"
[ -n "$vivy_stream_full_clip_source_crop_width_ratio" ] || vivy_stream_full_clip_source_crop_width_ratio="0.58"
vivy_stream_full_clip_source_crop_x_bias="$(read_first_env_value VIVY_STREAM_FULL_CLIP_SOURCE_CROP_X_BIAS)"
[ -n "$vivy_stream_full_clip_source_crop_x_bias" ] || vivy_stream_full_clip_source_crop_x_bias="0.62"
vivy_stream_full_clip_source_crop_y_bias="$(read_first_env_value VIVY_STREAM_FULL_CLIP_SOURCE_CROP_Y_BIAS)"
[ -n "$vivy_stream_full_clip_source_crop_y_bias" ] || vivy_stream_full_clip_source_crop_y_bias="0.5"
vivy_stream_full_clip_demosaic_grid="$(read_first_env_value VIVY_STREAM_FULL_CLIP_DEMOSAIC_GRID)"
[ -n "$vivy_stream_full_clip_demosaic_grid" ] || vivy_stream_full_clip_demosaic_grid="0"
vivy_stream_full_clip_demosaic_columns="$(read_first_env_value VIVY_STREAM_FULL_CLIP_DEMOSAIC_COLUMNS)"
[ -n "$vivy_stream_full_clip_demosaic_columns" ] || vivy_stream_full_clip_demosaic_columns="3"
vivy_stream_full_clip_demosaic_rows="$(read_first_env_value VIVY_STREAM_FULL_CLIP_DEMOSAIC_ROWS)"
[ -n "$vivy_stream_full_clip_demosaic_rows" ] || vivy_stream_full_clip_demosaic_rows="3"
vivy_stream_full_clip_demosaic_active_height_ratio="$(read_first_env_value VIVY_STREAM_FULL_CLIP_DEMOSAIC_ACTIVE_HEIGHT_RATIO)"
[ -n "$vivy_stream_full_clip_demosaic_active_height_ratio" ] || vivy_stream_full_clip_demosaic_active_height_ratio="0.9"
vivy_stream_full_clip_demosaic_segment_seconds="$(read_first_env_value VIVY_STREAM_FULL_CLIP_DEMOSAIC_SEGMENT_SECONDS)"
[ -n "$vivy_stream_full_clip_demosaic_segment_seconds" ] || vivy_stream_full_clip_demosaic_segment_seconds="1.25"
vivy_stream_full_clip_demosaic_order="$(read_first_env_value VIVY_STREAM_FULL_CLIP_DEMOSAIC_ORDER)"
[ -n "$vivy_stream_full_clip_demosaic_order" ] || vivy_stream_full_clip_demosaic_order="4,1,5,7,2,8"
preserved_env="$(mktemp)"
for key in TWITCH_CHANNEL TWITCH_BOT_USERNAME TWITCH_OAUTH_TOKEN TWITCH_ACCESS_TOKEN TWITCH_CLIENT_ID TWITCH_REFRESH_TOKEN VIVY_STREAM_INGEST_URL VIVY_STREAM_RESET_URL VIVY_STREAM_STATE_URL VIVY_PUBLIC_BASE_URL VIVY_STREAM_COMMANDS_ONLY VIVY_STREAM_ANNOUNCE_INTERVAL_MS VIVY_STREAM_ANNOUNCE_DISABLED VIVY_STREAM_BOT_MESSAGE_GAP_MS VIVY_STREAM_AUTOGENERATE_ENABLED VIVY_STREAM_IDLE_JUKEBOX_DISABLED VIVY_STREAM_COVER_ENABLED VIVY_STREAM_COVER_URL VIVY_STREAM_COVER_TIMEOUT_MS VIVY_STREAM_CLIP_ENABLED VIVY_STREAM_CLIP_PROVIDER VIVY_STREAM_CLIP_DURATION_SECONDS VIVY_STREAM_CLIP_TIMEOUT_MS VIVY_STREAM_FULL_CLIP_ENABLED VIVY_STREAM_FULL_CLIP_SOURCE_IMAGE_URL VIVY_STREAM_DREAMCLIP_SOURCE_IMAGE_URL VIVY_STREAM_FULL_CLIP_PROVIDER VIVY_STREAM_FULL_CLIP_SCENES VIVY_STREAM_DREAMCLIP_SCENES VIVY_STREAM_DREAMCLIP_MAX_DURATION_SECONDS VIVY_STREAM_DREAMCLIP_LOOP_SECONDS VIVY_STREAM_DREAMCLIP_MIN_GENERATED_COVERAGE VIVY_STREAM_DREAMCLIP_ALLOW_STATIC_FALLBACK VIVY_STREAM_FULL_CLIP_INSTRUMENTAL_SCENES VIVY_STREAM_FULL_CLIP_UNIQUE_LOOPS VIVY_STREAM_FULL_CLIP_REUSE_CHORUS VIVY_STREAM_FULL_CLIP_CONCURRENCY VIVY_STREAM_FULL_CLIP_GENERATE_SCENE_LOOPS VIVY_STREAM_FULL_CLIP_LOOP_SECONDS VIVY_STREAM_FULL_CLIP_WIDTH VIVY_STREAM_FULL_CLIP_HEIGHT VIVY_STREAM_FULL_CLIP_FPS VIVY_STREAM_FULL_CLIP_VISUAL_QA A11_HF_VIDEO_PROVIDER A11_REPLICATE_VIDEO_MODEL VIVY_STREAM_FULL_CLIP_CROP_SOURCE_IMAGE VIVY_STREAM_FULL_CLIP_SOURCE_CROP_WIDTH_RATIO VIVY_STREAM_FULL_CLIP_SOURCE_CROP_X_BIAS VIVY_STREAM_FULL_CLIP_SOURCE_CROP_Y_BIAS VIVY_STREAM_FULL_CLIP_DEMOSAIC_GRID VIVY_STREAM_FULL_CLIP_DEMOSAIC_COLUMNS VIVY_STREAM_FULL_CLIP_DEMOSAIC_ROWS VIVY_STREAM_FULL_CLIP_DEMOSAIC_ACTIVE_HEIGHT_RATIO VIVY_STREAM_FULL_CLIP_DEMOSAIC_SEGMENT_SECONDS VIVY_STREAM_FULL_CLIP_DEMOSAIC_ORDER A11_VIDEO_PROXY_URL A11_VIDEO_PROXY_TOKEN A11_VIDEO_PROXY_PUBLIC_FILE_BASE_URL A11_VIDEO_PROXY_TIMEOUT_MS A11_VIDEO_ASYNC_JOB_TTL_MS A11_VIDEO_COMFY_CLOUD_ENABLED A11_COMFY_CLOUD_API_KEY A11_COMFY_CLOUD_BASE_URL A11_COMFY_CLOUD_WORKFLOW_PATH A11_COMFY_CLOUD_TIMEOUT_MS A11_COMFY_CLOUD_POLL_INTERVAL_MS A11_COMFY_CLOUD_WAN_MODEL A11_COMFY_CLOUD_WAN_RESOLUTION VIVY_STREAM_TRACK_NOTICE_POLL_INTERVAL_MS VIVY_STREAM_RECAP_INTERVAL_MS VIVY_TWITCH_LIVE_POLL_INTERVAL_MS VIVY_TWITCH_RESET_ON_OFFLINE VIVY_TWITCH_RESET_ON_IRC_CLOSE VIVY_TWITCH_LIVE_GATE_DISABLED; do
  value="$(awk -v k="$key" -F= '$1 == k { sub(/^[^=]*=/, ""); print; exit }' "$compose_env" "$a11_env" "$build_env" 2>/dev/null || true)"
  if [ -n "$value" ]; then
    printf '%s=%s\n' "$key" "$value" >> "$preserved_env"
  fi
done
if [ -s "$build_env" ]; then
  grep -v -E "$managed_keys" "$build_env" | grep -v -E "$managed_nossen_keys" > "$tmp_build" || true
fi
printf 'A11_BUILD_COMMIT=%s\n' '__BUILD_COMMIT__' >> "$tmp_build"
printf 'A11_BUILD_BRANCH=%s\n' '__BUILD_BRANCH__' >> "$tmp_build"
printf 'A11_BUILD_DATE=%s\n' '__BUILD_DATE__' >> "$tmp_build"
printf 'A11_VOICE_XTTS_RVC_FALLBACK=false\n' >> "$tmp_build"
printf 'A11_LLM_PROVIDER=ollama\n' >> "$tmp_build"
printf 'A11_OLLAMA_PRIMARY_MODEL=qwen2.5:32b\n' >> "$tmp_build"
printf 'A11_OLLAMA_FALLBACK_MODEL=qwen2.5:7b\n' >> "$tmp_build"
printf 'VIVY_CHAT_LOCAL_FIRST=true\n' >> "$tmp_build"
printf 'VIVY_OLLAMA_BASE_URL=http://a11-ollama:11434\n' >> "$tmp_build"
printf 'VIVY_CHAT_LOCAL_MODEL=qwen2.5:7b\n' >> "$tmp_build"
printf 'VIVY_CHAT_LOCAL_TIMEOUT_MS=90000\n' >> "$tmp_build"
printf 'VIVY_CHAT_LOCAL_MAX_PROMPT_CHARS=10000\n' >> "$tmp_build"
printf 'VIVY_CHAT_LOCAL_MAX_TOKENS=800\n' >> "$tmp_build"
printf 'VIVY_XAI_MODEL=grok-4.3\n' >> "$tmp_build"
printf 'OLLAMA_CLOUD_ENABLED=1\n' >> "$tmp_build"
printf 'OLLAMA_CLOUD_BASE_URL=https://ollama.com\n' >> "$tmp_build"
printf 'OLLAMA_CLOUD_LYRICS_MODEL=gpt-oss:120b\n' >> "$tmp_build"
printf 'OLLAMA_CLOUD_FAST_MODEL=gpt-oss:20b\n' >> "$tmp_build"
printf 'OLLAMA_CLOUD_CHAT_ENABLED=1\n' >> "$tmp_build"
printf 'OLLAMA_CLOUD_CHAT_MODEL=gpt-oss:120b\n' >> "$tmp_build"
printf 'OLLAMA_CLOUD_CHAT_THINK_LEVEL=high\n' >> "$tmp_build"
printf 'OLLAMA_CLOUD_CHAT_TIMEOUT_MS=300000\n' >> "$tmp_build"
ollama_cloud_think_level="$(awk -F= '$1 == "OLLAMA_CLOUD_THINK_LEVEL" { sub(/^[^=]*=/, ""); print; exit }' "$a11_env" 2>/dev/null || true)"
if [ -z "$ollama_cloud_think_level" ]; then ollama_cloud_think_level="high"; fi
printf 'OLLAMA_CLOUD_THINK_LEVEL=%s\n' "$ollama_cloud_think_level" >> "$tmp_build"
printf 'OLLAMA_CLOUD_LYRICS_TIMEOUT_MS=360000\n' >> "$tmp_build"
printf 'VIVY_SONG_CERBERE_FALLBACK_ENABLED=1\n' >> "$tmp_build"
vivy_song_cerbere_model="$(awk -F= '$1 == "VIVY_SONG_CERBERE_MODEL" { sub(/^[^=]*=/, ""); print; exit }' "$a11_env" 2>/dev/null || true)"
case "$vivy_song_cerbere_model" in
  ""|"anthropic/claude-sonnet-4.5") vivy_song_cerbere_model="openai/gpt-oss-120b" ;;
esac
printf 'VIVY_SONG_CERBERE_MODEL=%s\n' "$vivy_song_cerbere_model" >> "$tmp_build"
printf 'VIVY_SONG_CERBERE_TIMEOUT_MS=240000\n' >> "$tmp_build"
printf 'VIVY_GROQ_RATE_LIMIT_COOLDOWN_MS=300000\n' >> "$tmp_build"
printf 'VIVY_CHAT_MAX_TOKENS=5000\n' >> "$tmp_build"
printf 'VIVY_CHAT_MAX_TOKENS_SONG=10000\n' >> "$tmp_build"
printf 'VIVY_CHAT_MAX_TOKENS_SONG_CEILING=12000\n' >> "$tmp_build"
printf 'A11_OLLAMA_STRONG_SONG_MODEL=__STRONG_SONG_MODEL__\n' >> "$tmp_build"
printf 'VIVY_SONG_ALLOW_LOCAL_FALLBACK=true\n' >> "$tmp_build"
printf 'VIVY_SONG_ALLOW_LOCAL_LYRICS_FALLBACK=true\n' >> "$tmp_build"
printf 'VIVY_SONG_LOCAL_MODEL=qwen2.5:7b\n' >> "$tmp_build"
printf 'VIVY_NOSSEN_LOCAL_MODEL=qwen2.5:32b\n' >> "$tmp_build"
printf 'VIVY_NOSSEN_LARGE_MODEL_FIRST=true\n' >> "$tmp_build"
printf 'VIVY_NOSSEN_120B_MAX_PROMPT_CHARS=22000\n' >> "$tmp_build"
printf 'VIVY_NOSSEN_120B_MAX_TOKENS=2400\n' >> "$tmp_build"
printf 'VIVY_NOSSEN_120B_TIMEOUT_MS=25000\n' >> "$tmp_build"
printf 'VIVY_NOSSEN_FAST_LOCAL_ONLY=true\n' >> "$tmp_build"
printf 'VIVY_NOSSEN_ROUTE_LLM_ENABLED=true\n' >> "$tmp_build"
printf 'VIVY_NOSSEN_ROUTER_LOCAL_TIMEOUT_MS=20000\n' >> "$tmp_build"
printf 'VIVY_NOSSEN_LYRICS_LOCAL_TIMEOUT_MS=40000\n' >> "$tmp_build"
printf 'VIVY_NOSSEN_LOCAL_MAX_TOKENS=2200\n' >> "$tmp_build"
printf 'VIVY_NOSSEN_LLM_BUDGET_MS=80000\n' >> "$tmp_build"
printf 'VIVY_NOSSEN_CLOUD_ATTEMPT_TIMEOUT_MS=22000\n' >> "$tmp_build"
printf 'VIVY_NOSSEN_EMERGENCY_SONGCRAFT=true\n' >> "$tmp_build"
printf 'VIVY_ACESTEP_LYRICS_MAX_CHARS=24000\n' >> "$tmp_build"
printf 'ACESTEP_DIFFUSION_MODEL=acestep_v1.5_turbo.safetensors\n' >> "$tmp_build"
printf 'ACESTEP_TEXT_ENCODER_1=qwen_0.6b_ace15.safetensors\n' >> "$tmp_build"
printf 'ACESTEP_TEXT_ENCODER_2=qwen_1.7b_ace15.safetensors\n' >> "$tmp_build"
printf 'ACESTEP_TEXT_ENCODER_2_QWEN4=qwen_4b_ace15.safetensors\n' >> "$tmp_build"
printf 'ACESTEP_QWEN4_PROFILE_ENABLED=false\n' >> "$tmp_build"
printf 'ACESTEP_VAE=ace_1.5_vae.safetensors\n' >> "$tmp_build"
printf 'ACESTEP_STEPS=8\n' >> "$tmp_build"
printf 'ACESTEP_KSAMPLER_CFG=1\n' >> "$tmp_build"
printf 'ACESTEP_LLM_CFG_SCALE=2\n' >> "$tmp_build"
printf 'ACESTEP_SHIFT=3\n' >> "$tmp_build"
printf 'ACESTEP_SAMPLER=euler\n' >> "$tmp_build"
printf 'ACESTEP_SCHEDULER=simple\n' >> "$tmp_build"
printf 'ACESTEP_DEFAULT_BPM=120\n' >> "$tmp_build"
printf 'ACESTEP_MAX_DURATION_SECONDS=1000\n' >> "$tmp_build"
printf 'ACESTEP_TIME_SIGNATURE=4\n' >> "$tmp_build"
printf 'ACESTEP_LANGUAGE=fr\n' >> "$tmp_build"
printf 'ACESTEP_KEYSCALE=C minor\n' >> "$tmp_build"
printf 'ACESTEP_GENERATE_AUDIO_CODES=true\n' >> "$tmp_build"
printf 'ACESTEP_TEMPERATURE=0.85\n' >> "$tmp_build"
printf 'ACESTEP_TOP_P=0.9\n' >> "$tmp_build"
printf 'ACESTEP_TOP_K=0\n' >> "$tmp_build"
printf 'ACESTEP_MIN_P=0\n' >> "$tmp_build"
printf 'ACESTEP_MP3_QUALITY=V0\n' >> "$tmp_build"
printf 'ACESTEP_HEALTH_ATTEMPTS=6\n' >> "$tmp_build"
printf 'ACESTEP_HEALTH_RETRY_MS=3000\n' >> "$tmp_build"
printf 'A11_TRANSLATION_MODEL=qwen2.5:32b\n' >> "$tmp_build"
printf 'LOCAL_DEFAULT_MODEL=llama3.2:3b\n' >> "$tmp_build"
printf 'A11_LLM_FALLBACK_PROVIDER=ollama\n' >> "$tmp_build"
printf 'A11_LLM_RUNTIME_FALLBACK_ORDER=ollama,ollama_cloud,openai,gemini,xai,huggingface,deepseek,together,groq,openrouter\n' >> "$tmp_build"
printf 'A11_CERBERE_LOCAL_ONLY=false\n' >> "$tmp_build"
printf 'A11_LOCAL_CHAT_TIMEOUT_MS=90000\n' >> "$tmp_build"
printf 'A11_LOCAL_SONG_TIMEOUT_MS=180000\n' >> "$tmp_build"
printf 'A11_OLLAMA_KEEP_ALIVE=30m\n' >> "$tmp_build"
printf 'A11_MEMORY_LOCAL_TIMEOUT_MS=3500\n' >> "$tmp_build"
printf 'A11_MEMORY_REMOTE_TIMEOUT_MS=5000\n' >> "$tmp_build"
printf 'A11_EMBEDDING_TIMEOUT_MS=2500\n' >> "$tmp_build"
printf 'A11_RUNTIME_ROOT=/app/runtime\n' >> "$tmp_build"
printf 'A11_EPISODIC_MEMORY_DIR=/app/runtime/episodic-memory\n' >> "$tmp_build"
printf 'VIVY_ELEVENLABS_MUSIC_DISABLED=false\n' >> "$tmp_build"
printf 'VIVY_MUSIC_PROVIDER=suno,mureka\n' >> "$tmp_build"
printf 'VIVY_MUREKA_API_KEY_FILE=/app/runtime/secrets/mureka_api_key\n' >> "$tmp_build"
printf 'VIVY_MUREKA_BASE_URL=https://api.mureka.ai\n' >> "$tmp_build"
printf 'VIVY_MUREKA_MODEL=mureka-9\n' >> "$tmp_build"
printf 'VIVY_SUNO_MODEL=V5_5\n' >> "$tmp_build"
printf 'VIVY_SUNO_LONG_MODEL=V5_5\n' >> "$tmp_build"
if [ -n "$suno_voice_id" ]; then printf 'VIVY_SUNO_VOICE_ID=%s\n' "$suno_voice_id" >> "$tmp_build"; fi
if [ -n "$suno_djeff_voice_id" ]; then printf 'VIVY_SUNO_DJEFF_VOICE_ID=%s\n' "$suno_djeff_voice_id" >> "$tmp_build"; fi
if [ -n "$suno_marvin_voice_id" ]; then printf 'VIVY_SUNO_MARVIN_VOICE_ID=%s\n' "$suno_marvin_voice_id" >> "$tmp_build"; fi
if [ -n "$suno_a11_voice_id" ]; then printf 'VIVY_SUNO_A11_VOICE_ID=%s\n' "$suno_a11_voice_id" >> "$tmp_build"; fi
if [ -n "$suno_k44_voice_id" ]; then
  printf 'VIVY_SUNO_K44_VOICE_ID=%s\n' "$suno_k44_voice_id" >> "$tmp_build"
  printf 'VIVY_SUNO_KAEN44_VOICE_ID=%s\n' "$suno_k44_voice_id" >> "$tmp_build"
fi
printf 'VIVY_STREAM_AUTOGENERATE_ENABLED=%s\n' "$vivy_stream_autogenerate" >> "$tmp_build"
printf 'VIVY_STREAM_IDLE_JUKEBOX_DISABLED=%s\n' "$vivy_stream_idle_jukebox_disabled" >> "$tmp_build"
printf 'VIVY_STREAM_STATE_URL=http://__A11_BACKEND_SERVICE__:3000/api/vivy/stream/state\n' >> "$tmp_build"
printf 'VIVY_PUBLIC_BASE_URL=https://vivy.funesterie.me\n' >> "$tmp_build"
printf 'VIVY_STREAM_BOT_MESSAGE_GAP_MS=15000\n' >> "$tmp_build"
printf 'VIVY_STREAM_COVER_ENABLED=1\n' >> "$tmp_build"
printf 'VIVY_STREAM_COVER_URL=http://127.0.0.1:3000/api/tools/generate_sd\n' >> "$tmp_build"
printf 'VIVY_STREAM_COVER_TIMEOUT_MS=120000\n' >> "$tmp_build"
printf 'VIVY_STREAM_CLIP_ENABLED=1\n' >> "$tmp_build"
printf 'VIVY_STREAM_CLIP_PROVIDER=auto\n' >> "$tmp_build"
printf 'VIVY_STREAM_CLIP_DURATION_SECONDS=3\n' >> "$tmp_build"
printf 'VIVY_STREAM_CLIP_TIMEOUT_MS=2700000\n' >> "$tmp_build"
printf 'VIVY_STREAM_FULL_CLIP_ENABLED=1\n' >> "$tmp_build"
printf 'VIVY_STREAM_FULL_CLIP_SOURCE_IMAGE_URL=%s\n' "$vivy_stream_full_clip_source_image_url" >> "$tmp_build"
printf 'VIVY_STREAM_DREAMCLIP_SOURCE_IMAGE_URL=%s\n' "$vivy_stream_dreamclip_source_image_url" >> "$tmp_build"
printf 'VIVY_STREAM_FULL_CLIP_PROVIDER=%s\n' "$vivy_stream_full_clip_provider" >> "$tmp_build"
printf 'VIVY_STREAM_FULL_CLIP_SCENES=%s\n' "$vivy_stream_full_clip_scenes" >> "$tmp_build"
printf 'VIVY_STREAM_DREAMCLIP_SCENES=%s\n' "$vivy_stream_dreamclip_scenes" >> "$tmp_build"
printf 'VIVY_STREAM_DREAMCLIP_MAX_DURATION_SECONDS=%s\n' "$vivy_stream_dreamclip_max_duration_seconds" >> "$tmp_build"
printf 'VIVY_STREAM_DREAMCLIP_LOOP_SECONDS=%s\n' "$vivy_stream_dreamclip_loop_seconds" >> "$tmp_build"
printf 'VIVY_STREAM_DREAMCLIP_MIN_GENERATED_COVERAGE=%s\n' "$vivy_stream_dreamclip_min_generated_coverage" >> "$tmp_build"
printf 'VIVY_STREAM_DREAMCLIP_ALLOW_STATIC_FALLBACK=%s\n' "$vivy_stream_dreamclip_allow_static_fallback" >> "$tmp_build"
printf 'VIVY_STREAM_FULL_CLIP_INSTRUMENTAL_SCENES=%s\n' "$vivy_stream_full_clip_instrumental_scenes" >> "$tmp_build"
printf 'VIVY_STREAM_FULL_CLIP_UNIQUE_LOOPS=%s\n' "$vivy_stream_full_clip_unique_loops" >> "$tmp_build"
printf 'VIVY_STREAM_FULL_CLIP_REUSE_CHORUS=%s\n' "$vivy_stream_full_clip_reuse_chorus" >> "$tmp_build"
printf 'VIVY_STREAM_FULL_CLIP_CONCURRENCY=%s\n' "$vivy_stream_full_clip_concurrency" >> "$tmp_build"
printf 'VIVY_STREAM_FULL_CLIP_GENERATE_SCENE_LOOPS=%s\n' "$vivy_stream_full_clip_generate_scene_loops" >> "$tmp_build"
printf 'VIVY_STREAM_FULL_CLIP_LOOP_SECONDS=%s\n' "$vivy_stream_full_clip_loop_seconds" >> "$tmp_build"
printf 'VIVY_STREAM_FULL_CLIP_WIDTH=%s\n' "$vivy_stream_full_clip_width" >> "$tmp_build"
printf 'VIVY_STREAM_FULL_CLIP_HEIGHT=%s\n' "$vivy_stream_full_clip_height" >> "$tmp_build"
printf 'VIVY_STREAM_FULL_CLIP_FPS=%s\n' "$vivy_stream_full_clip_fps" >> "$tmp_build"
printf 'VIVY_STREAM_FULL_CLIP_VISUAL_QA=%s\n' "$vivy_stream_full_clip_visual_qa" >> "$tmp_build"
printf 'A11_HF_VIDEO_PROVIDER=%s\n' "$a11_hf_video_provider" >> "$tmp_build"
printf 'A11_REPLICATE_VIDEO_MODEL=%s\n' "$a11_replicate_video_model" >> "$tmp_build"
printf 'A11_VIDEO_PROMPT_MAX_DURATION_SECONDS=15\n' >> "$tmp_build"
printf 'VIVY_STREAM_FULL_CLIP_CROP_SOURCE_IMAGE=%s\n' "$vivy_stream_full_clip_crop_source_image" >> "$tmp_build"
printf 'VIVY_STREAM_FULL_CLIP_SOURCE_CROP_WIDTH_RATIO=%s\n' "$vivy_stream_full_clip_source_crop_width_ratio" >> "$tmp_build"
printf 'VIVY_STREAM_FULL_CLIP_SOURCE_CROP_X_BIAS=%s\n' "$vivy_stream_full_clip_source_crop_x_bias" >> "$tmp_build"
printf 'VIVY_STREAM_FULL_CLIP_SOURCE_CROP_Y_BIAS=%s\n' "$vivy_stream_full_clip_source_crop_y_bias" >> "$tmp_build"
printf 'VIVY_STREAM_FULL_CLIP_DEMOSAIC_GRID=%s\n' "$vivy_stream_full_clip_demosaic_grid" >> "$tmp_build"
printf 'VIVY_STREAM_FULL_CLIP_DEMOSAIC_COLUMNS=%s\n' "$vivy_stream_full_clip_demosaic_columns" >> "$tmp_build"
printf 'VIVY_STREAM_FULL_CLIP_DEMOSAIC_ROWS=%s\n' "$vivy_stream_full_clip_demosaic_rows" >> "$tmp_build"
printf 'VIVY_STREAM_FULL_CLIP_DEMOSAIC_ACTIVE_HEIGHT_RATIO=%s\n' "$vivy_stream_full_clip_demosaic_active_height_ratio" >> "$tmp_build"
printf 'VIVY_STREAM_FULL_CLIP_DEMOSAIC_SEGMENT_SECONDS=%s\n' "$vivy_stream_full_clip_demosaic_segment_seconds" >> "$tmp_build"
printf 'VIVY_STREAM_FULL_CLIP_DEMOSAIC_ORDER=%s\n' "$vivy_stream_full_clip_demosaic_order" >> "$tmp_build"
printf 'A11_VIDEO_COMFY_CLOUD_ENABLED=1\n' >> "$tmp_build"
printf 'A11_COMFY_CLOUD_BASE_URL=https://cloud.comfy.org\n' >> "$tmp_build"
printf 'A11_COMFY_CLOUD_TIMEOUT_MS=2700000\n' >> "$tmp_build"
printf 'A11_VIDEO_PROXY_TIMEOUT_MS=2700000\n' >> "$tmp_build"
printf 'A11_VIDEO_ASYNC_JOB_TTL_MS=2700000\n' >> "$tmp_build"
printf 'A11_COMFY_CLOUD_POLL_INTERVAL_MS=5000\n' >> "$tmp_build"
printf 'A11_COMFY_CLOUD_WAN_MODEL=wan2.5-i2v-preview\n' >> "$tmp_build"
printf 'A11_COMFY_CLOUD_WAN_RESOLUTION=480P\n' >> "$tmp_build"
mv "$tmp_build" "$build_env"
chmod 600 "$build_env"
if [ -s "$a11_env" ]; then
  tmp_compose="$(mktemp)"
  grep -v -E "$managed_keys" "$a11_env" | grep -v -E "$managed_nossen_keys" > "$tmp_compose" || true
  cat "$build_env" >> "$tmp_compose"
  mv "$tmp_compose" "$compose_env"
else
  tmp_compose="$(mktemp)"
  grep -v -E "$managed_keys" "$compose_env" | grep -v -E "$managed_nossen_keys" > "$tmp_compose" || true
  cat "$build_env" >> "$tmp_compose"
  mv "$tmp_compose" "$compose_env"
fi
if ! grep -q '^VIVY_STREAM_SECRET=' "$compose_env"; then
  if [ -z "$vivy_stream_secret" ]; then
    vivy_stream_secret="$(openssl rand -hex 32)"
  fi
  printf 'VIVY_STREAM_SECRET=%s\n' "$vivy_stream_secret" >> "$compose_env"
fi
if ! grep -q '^A11_SCENTGATE_SIGNAL_SECRET=' "$compose_env"; then
  if [ -z "$scentgate_signal_secret" ]; then
    scentgate_signal_secret="$(openssl rand -hex 32)"
  fi
  printf 'A11_SCENTGATE_SIGNAL_SECRET=%s\n' "$scentgate_signal_secret" >> "$compose_env"
fi
if [ -s "$preserved_env" ]; then
  while IFS= read -r line; do
    key="${line%%=*}"
    if [ -n "$key" ]; then
      if ! grep -q "^$key=" "$compose_env"; then
        printf '%s\n' "$line" >> "$compose_env"
      elif grep -q "^$key=$" "$compose_env"; then
        tmp_compose_fix="$(mktemp)"
        grep -v "^$key=" "$compose_env" > "$tmp_compose_fix" || true
        mv "$tmp_compose_fix" "$compose_env"
        printf '%s\n' "$line" >> "$compose_env"
      fi
    fi
  done < "$preserved_env"
fi
rm -f "$preserved_env"
chmod 600 "$compose_env"
'@
$remoteBuildEnvRefresh = $remoteBuildEnvRefresh.
  Replace('__REMOTE_ROOT__', $RemoteRoot).
  Replace('__BUILD_COMMIT__', $BuildCommit).
  Replace('__BUILD_BRANCH__', $BuildBranch).
  Replace('__BUILD_DATE__', $BuildDateIso).
  Replace('__A11_BACKEND_SERVICE__', $A11BackendService).
  Replace('__STRONG_SONG_MODEL__', $StrongSongOllamaModel)

$remoteSecretStep = if ($ReuseRemoteSecrets) {
  $remoteBuildEnvRefresh
} else {
  @"
chmod 600 $RemoteRoot/secrets/a11.env
chmod 600 $RemoteRoot/secrets/build.env
test -s $RemoteRoot/secrets/compose.env || cat $RemoteRoot/secrets/a11.env $RemoteRoot/secrets/build.env > $RemoteRoot/secrets/compose.env
$remoteBuildEnvRefresh
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
docker exec a11-ollama sh -lc 'ollama show nomic-embed-text >/dev/null 2>&1 || ollama pull nomic-embed-text >/dev/null 2>&1 || true'
docker exec a11-ollama sh -lc 'ollama show llama3.2:3b >/dev/null 2>&1 || ollama pull llama3.2:3b >/dev/null 2>&1 || true'
compose_env="${compose_env:-__REMOTE_ROOT__/secrets/compose.env}"
if [ -s "$compose_env" ]; then
  strong_song_model="$(awk -F= '/^VIVY_SONG_LOCAL_MODEL=/{print $2; exit}' "$compose_env" 2>/dev/null | tr -d '\r' | sed 's/^"//; s/"$//' || true)"
else
  strong_song_model=""
fi
strong_song_model="${strong_song_model:-qwen2.5:32b}"
docker exec a11-ollama sh -lc 'ollama show "$0" >/dev/null 2>&1 || ollama pull "$0"' "$strong_song_model"
'@
$remoteOllamaStep = $remoteOllamaStep.Replace('__REMOTE_ROOT__', $RemoteRoot)

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
trap 'echo "__A11_DEPLOY_FAILED__ line=`$LINENO command=`$BASH_COMMAND" >&2' ERR
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
docker run --rm -v $RemoteRoot/current:/srv/a11/current caddy:2-alpine caddy fmt --overwrite /srv/a11/current/Caddyfile
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
docker compose -f "`$compose_file" --env-file $RemoteRoot/secrets/compose.env up -d --no-deps --force-recreate vivy-twitch-worker vivy-social-ingest-worker
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
trap 'echo "__A11_DEPLOY_FAILED__ line=`$LINENO command=`$BASH_COMMAND" >&2' ERR
release=$RemoteRoot/releases/$Stamp
mkdir -p "`$release"
tar -xzf $RemoteArchive -C "`$release"
ln -sfn "`$release" $RemoteRoot/current
docker run --rm -v $RemoteRoot/current:/srv/a11/current caddy:2-alpine caddy fmt --overwrite /srv/a11/current/Caddyfile
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
$localRemoteDeployScript = Join-Path $TmpRoot "a11-remote-deploy-$Stamp.sh"
$remoteDeployScript = "/tmp/a11-remote-deploy-$Stamp.sh"
[IO.File]::WriteAllText(
  $localRemoteDeployScript,
  $remoteDeploy.Replace("`r`n", "`n").Replace("`r", "`n"),
  [Text.UTF8Encoding]::new($false)
)
Send-FileViaSsh -SshArgs $sshBase -RemoteHost $Remote -LocalPath $localRemoteDeployScript -RemotePath $remoteDeployScript
if ($LASTEXITCODE -ne 0) { throw "Copie script de deploiement distant echouee" }
$remoteDeployRunCommand = "chmod 700 '$remoteDeployScript' && bash '$remoteDeployScript'; rc=`$?; rm -f '$remoteDeployScript'; exit `$rc"
& ssh @sshBase $Remote $remoteDeployRunCommand
if ($LASTEXITCODE -ne 0) { throw "Deploiement distant echoue" }
Remove-Item -LiteralPath $localRemoteDeployScript -Force -ErrorAction SilentlyContinue

if ($BlueGreen) {
  Write-Host "Deploy A11 prod Finlande termine: $Remote / release $Stamp / blue-green=$DeployBlueGreenColor" -ForegroundColor Green
} else {
  Write-Host "Deploy A11 prod Finlande termine: $Remote / release $Stamp" -ForegroundColor Green
}
