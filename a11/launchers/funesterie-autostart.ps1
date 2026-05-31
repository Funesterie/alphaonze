Set-StrictMode -Version Latest
$ErrorActionPreference = "Continue"

$RepoRoot = "D:\projets\funesterie"
$A11Root = Join-Path $RepoRoot "a11"
$A11McpRoot = Join-Path $RepoRoot "a11mcp"
$ServerRoot = Join-Path $A11Root "backend\apps\server"
$FrontendRoot = Join-Path $A11Root "frontend\apps\web"
$LogRoot = Join-Path $A11Root "logs\autostart"
$StartedAt = Get-Date -Format "yyyyMMdd-HHmmss"
$LogFile = Join-Path $LogRoot "funesterie-autostart-$StartedAt.log"

New-Item -ItemType Directory -Force -Path $LogRoot | Out-Null

function Write-Step {
  param([string]$Message)
  $line = "[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $Message
  Write-Host $line
  Add-Content -LiteralPath $LogFile -Value $line -Encoding UTF8
}

function Invoke-SourceUpdate {
  $updateScript = Join-Path $RepoRoot "scripts\Update-FunesterieSource.ps1"
  if (-not (Test-Path -LiteralPath $updateScript)) {
    Write-Step "Mise a jour source ignoree: helper introuvable $updateScript"
    return
  }

  Write-Step "Verification des mises a jour source..."
  try {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $updateScript -RepoRoot $RepoRoot 2>&1 |
      ForEach-Object { Write-Step "source-update: $_" }
    if ($LASTEXITCODE -ne 0) {
      Write-Step "Mise a jour source terminee avec code $LASTEXITCODE."
    }
  } catch {
    Write-Step "Mise a jour source impossible: $($_.Exception.Message)"
  }
}

function Test-HttpOk {
  param(
    [string]$Url,
    [int]$TimeoutSec = 6
  )
  try {
    $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec $TimeoutSec
    return [int]$response.StatusCode -ge 200 -and [int]$response.StatusCode -lt 300
  } catch {
    return $false
  }
}

function Test-AnyHttpOk {
  param(
    [string[]]$Urls,
    [int]$TimeoutSec = 6
  )

  foreach ($url in $Urls) {
    if (Test-HttpOk $url $TimeoutSec) {
      return $url
    }
  }
  return $null
}

function Start-PodmanMachineIfNeeded {
  if ($env:A11_START_PODMAN -ne "1") {
    Write-Step "Podman startup ignore: Docker/Node fallback actif (A11_START_PODMAN=1 pour legacy)."
    return
  }

  if (-not (Get-Command podman -ErrorAction SilentlyContinue)) {
    Write-Step "Podman introuvable dans le PATH."
    return
  }

  $bridgeScript = Join-Path $A11Root "launchers\Start-PodmanWslBridge.ps1"
  if (Test-Path -LiteralPath $bridgeScript) {
    try {
      Write-Step "Verification du pont Podman WSL..."
      & powershell -NoProfile -ExecutionPolicy Bypass -File $bridgeScript -Quiet 2>&1 | ForEach-Object { Write-Step "podman-wsl: $_" }
    } catch {
      Write-Step "Pont Podman WSL: $($_.Exception.Message)"
    }
  }

  try {
    $info = & podman info --format json 2>$null
    if ($LASTEXITCODE -eq 0 -and $info) {
      Write-Step "Podman repond deja."
      return
    }
  } catch {}

  try {
    Write-Step "Demarrage de la machine Podman..."
    & podman machine start 2>&1 | ForEach-Object { Write-Step "podman: $_" }
    Start-Sleep -Seconds 8
  } catch {
    Write-Step "Podman machine start: $($_.Exception.Message)"
  }
}

function Start-ContainerIfPresent {
  param([string]$Name)
  try {
    $exists = & podman container exists $Name
    if ($LASTEXITCODE -ne 0) { return }
    $running = (& podman inspect -f "{{.State.Running}}" $Name 2>$null).Trim()
    if ($running -eq "true") {
      Write-Step "Container $Name deja actif."
      return
    }
    Write-Step "Demarrage container $Name..."
    & podman start $Name 2>&1 | ForEach-Object { Write-Step "podman: $_" }
  } catch {
    Write-Step "Container ${Name}: $($_.Exception.Message)"
  }
}

function Start-A11BackendIfNeeded {
  if (Test-HttpOk "http://127.0.0.1:3000/health") {
    Write-Step "A11 local deja OK sur 3000."
    return
  }
  if (-not (Test-Path -LiteralPath (Join-Path $ServerRoot "server.cjs"))) {
    Write-Step "Backend A11 introuvable: $ServerRoot"
    return
  }

  $stdout = Join-Path $LogRoot "a11-backend.stdout.log"
  $stderr = Join-Path $LogRoot "a11-backend.stderr.log"
  Write-Step "Demarrage backend A11 local..."
  Start-Process -FilePath "node" `
    -ArgumentList "server.cjs" `
    -WorkingDirectory $ServerRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput $stdout `
    -RedirectStandardError $stderr | Out-Null

  for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Seconds 1
    if (Test-HttpOk "http://127.0.0.1:3000/health") {
      Write-Step "A11 local OK."
      return
    }
  }
  Write-Step "A11 local pas encore pret, logs: $stdout / $stderr"
}

function Start-Kaen44BackendIfNeeded {
  if (Test-HttpOk "http://127.0.0.1:3001/health") {
    Write-Step "Kaen44 local deja OK sur 3001."
    return
  }
  if (-not (Test-Path -LiteralPath (Join-Path $ServerRoot "server-kaen44.cjs"))) {
    Write-Step "Backend Kaen44 introuvable: $ServerRoot"
    return
  }

  $stdout = Join-Path $LogRoot "kaen44-backend.stdout.log"
  $stderr = Join-Path $LogRoot "kaen44-backend.stderr.log"
  Write-Step "Demarrage backend Kaen44 local..."
  Start-Process -FilePath "npm.cmd" `
    -ArgumentList @("run", "start:kaen44") `
    -WorkingDirectory $ServerRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput $stdout `
    -RedirectStandardError $stderr | Out-Null

  for ($i = 0; $i -lt 25; $i++) {
    Start-Sleep -Seconds 1
    if (Test-HttpOk "http://127.0.0.1:3001/health") {
      Write-Step "Kaen44 local OK."
      return
    }
  }
  Write-Step "Kaen44 local pas encore pret, logs: $stdout / $stderr"
}

function Start-FrontendIfNeeded {
  if (Test-HttpOk "http://127.0.0.1:5173/") {
    Write-Step "Frontend local deja OK sur 5173."
    return
  }
  if (-not (Test-Path -LiteralPath (Join-Path $FrontendRoot "package.json"))) {
    Write-Step "Frontend introuvable: $FrontendRoot"
    return
  }

  $stdout = Join-Path $LogRoot "frontend.stdout.log"
  $stderr = Join-Path $LogRoot "frontend.stderr.log"
  Write-Step "Demarrage frontend local..."
  Start-Process -FilePath "npm.cmd" `
    -ArgumentList @("run", "dev", "--", "--host", "127.0.0.1", "--port", "5173") `
    -WorkingDirectory $FrontendRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput $stdout `
    -RedirectStandardError $stderr | Out-Null

  for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Seconds 1
    if (Test-HttpOk "http://127.0.0.1:5173/") {
      Write-Step "Frontend local OK."
      return
    }
  }
  Write-Step "Frontend local pas encore pret, logs: $stdout / $stderr"
}

function Sync-CodexNeo4j {
  $script = Join-Path $ServerRoot "scripts\ensure-codex-neo4j-sync.ps1"
  if (-not (Test-Path -LiteralPath $script)) {
    Write-Step "Sync Codex/Neo4j introuvable: $script"
    return
  }

  $directSyncScript = Join-Path $ServerRoot "scripts\sync-codex-vs-neo4j.cjs"
  $localBolt = $false
  try {
    $probe = Test-NetConnection 127.0.0.1 -Port 17687 -WarningAction SilentlyContinue
    $localBolt = [bool]$probe.TcpTestSucceeded
  } catch {
    $localBolt = $false
  }

  if ($localBolt -and (Test-Path -LiteralPath $directSyncScript)) {
    Write-Step "Neo4j local deja disponible; synchronisation Codex directe..."
    $env:NEO4J_URI = "bolt://127.0.0.1:17687"
    $env:NEO4J_DATABASE = "neo4j"
    if (-not $env:CODEX_SYNC_RUN_ID) {
      $env:CODEX_SYNC_RUN_ID = "codex-vs-sync-$(Get-Date -Format 'yyyyMMddHHmmss')"
    }
    if (-not $env:CODEX_SYNC_UPDATED_AT) {
      $env:CODEX_SYNC_UPDATED_AT = (Get-Date).ToString("o")
    }

    & node $directSyncScript 2>&1 | ForEach-Object { Write-Step "neo4j-sync: $_" }

    $agentMcpScript = Join-Path $ServerRoot "scripts\sync-agent-mcp-links.cjs"
    if (Test-Path -LiteralPath $agentMcpScript) {
      Write-Step "Liens agents/MCP..."
      & node $agentMcpScript 2>&1 | ForEach-Object { Write-Step "neo4j-sync: $_" }
    }
    return
  }

  Write-Step "Synchronisation Codex/Neo4j via Podman..."
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $script 2>&1 |
    ForEach-Object { Write-Step "neo4j-sync: $_" }
}

function Invoke-ServerNpmScript {
  param(
    [string]$ScriptName,
    [string]$Label
  )

  if (-not (Test-Path -LiteralPath (Join-Path $ServerRoot "package.json"))) {
    Write-Step "Package serveur introuvable: $ServerRoot"
    return $false
  }

  Write-Step "$Label..."
  try {
    & npm.cmd --prefix $ServerRoot run $ScriptName 2>&1 |
      ForEach-Object { Write-Step "${ScriptName}: $_" }
    if ($LASTEXITCODE -eq 0) {
      Write-Step "$Label OK."
      return $true
    }
    Write-Step "$Label termine avec code $LASTEXITCODE."
    return $false
  } catch {
    Write-Step "$Label impossible: $($_.Exception.Message)"
    return $false
  }
}

function Sync-A11MemoryRouter {
  Write-Step "Verification routeur memoire Neo4j..."
  [void](Invoke-ServerNpmScript -ScriptName "memory:status" -Label "Memoire A11 status")

  Write-Step "Synchronisation memoire Aura vers Neo4j Podman..."
  [void](Invoke-ServerNpmScript -ScriptName "memory:sync-local" -Label "Memoire A11 sync-local")

  if (Test-Path -LiteralPath "E:\") {
    Write-Step "Backup memoire Seagate detecte sur E:."
    [void](Invoke-ServerNpmScript -ScriptName "memory:backup-seagate" -Label "Memoire A11 backup Seagate")
  } else {
    Write-Step "Backup Seagate ignore: lecteur E: non present."
  }
}

function Start-A11Mcp {
  $script = Join-Path $A11McpRoot "scripts\Start-A11Mcp.ps1"

  if (Test-HttpOk "http://127.0.0.1:8787/health") {
    Write-Step "A11 MCP local deja OK sur 8787."
  } else {
    if ($env:A11_MCP_USE_PODMAN -eq "1" -and (Test-Path -LiteralPath $script)) {
      Write-Step "Demarrage A11 MCP + tunnel Cloudflare..."
      & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $script -WithTunnel 2>&1 |
        ForEach-Object { Write-Step "a11mcp: $_" }
    } elseif ($env:A11_MCP_USE_PODMAN -eq "1") {
      Write-Step "Start-A11Mcp introuvable: $script"
    } else {
      Write-Step "A11 MCP Podman ignore; fallback Node local privilegie."
    }
  }

  if (-not (Test-HttpOk "http://127.0.0.1:8787/health")) {
    $fallbackScript = Join-Path $A11McpRoot "scripts\Start-A11McpPublicFallback.ps1"
    if (Test-Path -LiteralPath $fallbackScript) {
      Write-Step "A11 MCP Podman indisponible; fallback Node local sur 8787..."
      & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $fallbackScript 2>&1 |
        ForEach-Object { Write-Step "a11mcp-fallback: $_" }
    } else {
      Write-Step "Fallback A11 MCP introuvable: $fallbackScript"
    }
  }

  if (Test-HttpOk "http://127.0.0.1:8787/health") {
    Write-Step "A11 MCP local OK."
  } else {
    Write-Step "A11 MCP local non joignable apres demarrage."
  }
}

function Start-EkkoIfNeeded {
  $ekkoScript = Join-Path $A11Root "launchers\start-ekko.ps1"
  if (-not (Test-Path -LiteralPath $ekkoScript)) {
    Write-Step "Ekko launcher introuvable: $ekkoScript"
    return
  }

  # Deja actif ?
  $running = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine -match "ekko\.config" } |
    Select-Object -First 1
  if ($running) {
    Write-Step "Ekko deja actif pid=$($running.ProcessId)."
    return
  }

  Write-Step "Demarrage Ekko..."
  try {
    $stdout = Join-Path $LogRoot "ekko-launch.stdout.log"
    $stderr = Join-Path $LogRoot "ekko-launch.stderr.log"
    $proc = Start-Process -FilePath "powershell.exe" `
      -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$ekkoScript`"" `
      -WindowStyle Hidden `
      -RedirectStandardOutput $stdout `
      -RedirectStandardError $stderr `
      -PassThru
    Start-Sleep -Seconds 4

    $running = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
      Where-Object { $_.CommandLine -and $_.CommandLine -match "ekko\.config" } |
      Select-Object -First 1
    if ($running) {
      Write-Step "Ekko OK pid=$($running.ProcessId), launcher pid=$($proc.Id)."
    } elseif ($proc.HasExited) {
      Write-Step "Ekko launcher termine code=$($proc.ExitCode), logs: $stdout / $stderr"
    } else {
      Write-Step "Ekko launcher encore actif pid=$($proc.Id), logs: $stdout / $stderr"
    }
  } catch {
    Write-Step "Ekko start error: $($_.Exception.Message)"
  }
}

function Start-RomStationBridge {
  $script = Join-Path $A11McpRoot "scripts\Start-KiroRomStationBridge.ps1"
  if (-not (Test-Path -LiteralPath $script)) {
    Write-Step "Bridge RomStation introuvable: $script"
    return
  }

  $escapedScript = [Regex]::Escape($script)
  $existing = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine -match $escapedScript } |
    Select-Object -First 1
  if ($existing) {
    Write-Step "Bridge RomStation/Qflush deja actif pid=$($existing.ProcessId)."
    return
  }

  $stdout = Join-Path $LogRoot "romstation-bridge.stdout.log"
  $stderr = Join-Path $LogRoot "romstation-bridge.stderr.log"
  Write-Step "Demarrage watchers RomStation/Qflush en tache detachee..."
  $proc = Start-Process -FilePath "powershell.exe" `
    -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$script`"" `
    -WindowStyle Hidden `
    -RedirectStandardOutput $stdout `
    -RedirectStandardError $stderr `
    -PassThru
  Start-Sleep -Seconds 5
  Write-Step "Bridge RomStation lance pid=$($proc.Id), logs: $stdout / $stderr"
}

function Test-McpToolList {
  param([string]$Url)
  try {
    $body = '{"jsonrpc":"2.0","id":"autostart","method":"tools/list","params":{}}'
    $response = Invoke-WebRequest -Uri $Url -Method POST -UseBasicParsing -TimeoutSec 15 -Headers @{
      Accept = "application/json, text/event-stream"
      "Content-Type" = "application/json"
    } -Body $body
    $text = [string]$response.Content
    if ($text -match '^event:') {
      $json = (($text -split "`n") | Where-Object { $_ -like 'data:*' } | Select-Object -First 1).Substring(5).Trim()
    } else {
      $json = $text
    }
    $data = $json | ConvertFrom-Json
    $names = @($data.result.tools | ForEach-Object { $_.name })
    Write-Step ("MCP tools {0}: count={1} romstation={2}" -f $Url, $names.Count, ($names -contains "romstation_state"))
  } catch {
    Write-Step "MCP tools check failed for $Url : $($_.Exception.Message)"
  }
}

Write-Step "=== Funesterie autostart ==="
Invoke-SourceUpdate
Start-PodmanMachineIfNeeded
if ($env:A11_START_LEGACY_NEO4J_SYNC -eq "1") {
  Start-ContainerIfPresent "a11-neo4j-sync"
} else {
  Write-Step "Neo4j local dedie utilise; ancien conteneur a11-neo4j-sync ignore."
}
Start-A11Mcp
Start-A11BackendIfNeeded
Start-Kaen44BackendIfNeeded
Start-FrontendIfNeeded
Start-EkkoIfNeeded
Sync-CodexNeo4j
Sync-A11MemoryRouter
Start-RomStationBridge

if (Test-HttpOk "http://127.0.0.1:8787/health" 5) {
  Write-Step "MCP local health OK: http://127.0.0.1:8787"
} else {
  Write-Step "MCP local health non joignable."
}

if (Test-HttpOk "http://127.0.0.1:3000/health" 5) {
  Write-Step "A11 local health OK: http://127.0.0.1:3000"
} else {
  Write-Step "A11 local health non joignable."
}

if (Test-HttpOk "http://127.0.0.1:3001/health" 5) {
  Write-Step "Kaen44 local health OK: http://127.0.0.1:3001"
} else {
  Write-Step "Kaen44 local health non joignable."
}

if (Test-HttpOk "http://127.0.0.1:5173/" 5) {
  Write-Step "Frontend local OK: http://127.0.0.1:5173"
} else {
  Write-Step "Frontend local non joignable."
}

if (Test-HttpOk "https://mcp.funesterie.me/health" 10) {
  Write-Step "MCP public OK: https://mcp.funesterie.me"
} else {
  Write-Step "MCP public pas encore joignable."
}

$a11ProdHealth = Test-AnyHttpOk @("https://a11.funesterie.me/health", "https://a11.funesterie.me/api/health") 10
if ($a11ProdHealth) {
  Write-Step "A11 prod OK: $a11ProdHealth"
} else {
  Write-Step "A11 prod pas encore joignable."
}

$k44ProdHealth = Test-AnyHttpOk @("https://k44.funesterie.me/health", "https://k44.funesterie.me/api/health") 10
if ($k44ProdHealth) {
  Write-Step "Kaen44 prod OK: $k44ProdHealth"
} else {
  Write-Step "Kaen44 prod pas encore joignable."
}

Write-Step "=== Funesterie autostart termine ==="
