# a11-autostart-services.ps1
# Lance automatiquement Neo4j Desktop et Docker Desktop pour A11
# Peut être exécuté sans droits admin pour les services déjà installés

param(
    [switch]$NoPause,
    [switch]$SkipNeo4j,
    [switch]$SkipDocker,
    [int]$WaitTimeoutSec = 60
)

$ErrorActionPreference = 'Continue'

function Write-Info { param([string]$m) Write-Host "[A11 SERVICES] $m" }
function Write-Warn { param([string]$m) Write-Host "[A11 SERVICES] WARN: $m" -ForegroundColor Yellow }
function Write-OK { param([string]$m) Write-Host "[A11 SERVICES] OK: $m" -ForegroundColor Green }
function Write-Fail { param([string]$m) Write-Host "[A11 SERVICES] FAIL: $m" -ForegroundColor Red }

function Get-ListeningPid {
    param([int]$Port)
    try {
        $c = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction Stop | Select-Object -First 1
        if ($c) { return [int]$c.OwningProcess }
    }
    catch {}
    return $null
}

function Wait-Port {
    param([int]$Port, [int]$TimeoutSec = 30, [string]$Label = "port $Port")
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    Write-Info "Attente de $Label..."
    while ((Get-Date) -lt $deadline) {
        if (Get-ListeningPid -Port $Port) { return $true }
        Start-Sleep -Milliseconds 800
    }
    return $false
}

# ─────────────────────────────────────────────
# NEO4J DESKTOP
# ─────────────────────────────────────────────
function Start-Neo4jDesktop {
    if ($SkipNeo4j) { Write-Warn "Neo4j ignoré (SkipNeo4j)"; return }

    # Vérifier si Neo4j Bolt est déjà actif
    if (Get-ListeningPid -Port 7687) {
        Write-OK "Neo4j déjà actif sur bolt://localhost:7687"
        return
    }

    Write-Info "Démarrage de Neo4j Desktop..."

    # Chercher l'exécutable Neo4j Desktop
    $neo4jExePaths = @(
        "C:\Users\$env:USERNAME\.Neo4jDesktop2\Neo4j Desktop.exe",
        "C:\Users\$env:USERNAME\AppData\Local\Programs\Neo4j Desktop\Neo4j Desktop.exe",
        "$env:LOCALAPPDATA\Programs\Neo4j Desktop\Neo4j Desktop.exe",
        "D:\projets\funesterie\Neo4j Desktop 2\Neo4j Desktop.exe",
        "$env:ProgramFiles\Neo4j Desktop\Neo4j Desktop.exe"
    )

    $neo4jExe = $neo4jExePaths | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1

    if (-not $neo4jExe) {
        Write-Warn "Neo4j Desktop introuvable. Vérifiez l'installation."
        Write-Warn "Chemins testés: $($neo4jExePaths -join ', ')"
        return
    }

    Write-Info "Neo4j Desktop trouvé: $neo4jExe"

    # Lancer Neo4j Desktop
    try {
        Start-Process -FilePath $neo4jExe -WindowStyle Minimized -ErrorAction Stop
        Write-Info "Neo4j Desktop lancé, attente du port Bolt (7687)..."

        if (Wait-Port -Port 7687 -TimeoutSec $WaitTimeoutSec -Label "Neo4j Bolt") {
            Write-OK "Neo4j prêt sur bolt://localhost:7687"
        }
        else {
            Write-Warn "Neo4j Desktop lancé mais le port 7687 ne répond pas encore."
            Write-Warn "Démarrez manuellement la base 'a11-knowledge-graph' dans Neo4j Desktop."
        }
    }
    catch {
        Write-Fail "Impossible de lancer Neo4j Desktop: $($_.Exception.Message)"
    }
}

# ─────────────────────────────────────────────
# DOCKER DESKTOP
# ─────────────────────────────────────────────
function Start-DockerDesktop {
    if ($SkipDocker) { Write-Warn "Docker ignoré (SkipDocker)"; return }

    # Vérifier si Docker est déjà actif
    $dockerRunning = $false
    try {
        $result = & docker info 2>&1
        if ($LASTEXITCODE -eq 0) { $dockerRunning = $true }
    }
    catch {}

    if ($dockerRunning) {
        Write-OK "Docker Desktop déjà actif"
        return
    }

    Write-Info "Démarrage de Docker Desktop..."

    # Chercher l'exécutable Docker Desktop
    $dockerExePaths = @(
        "$env:ProgramFiles\Docker\Docker\Docker Desktop.exe",
        "${env:ProgramFiles(x86)}\Docker\Docker\Docker Desktop.exe",
        "$env:LOCALAPPDATA\Docker\Docker Desktop.exe",
        "C:\Program Files\Docker\Docker\Docker Desktop.exe"
    )

    $dockerExe = $dockerExePaths | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1

    if (-not $dockerExe) {
        Write-Warn "Docker Desktop introuvable."
        Write-Warn "Installez Docker Desktop depuis: https://www.docker.com/products/docker-desktop/"
        Write-Warn "Ou lancez l'installateur: D:\projets\funesterie\Docker Desktop Installer.exe"
        return
    }

    Write-Info "Docker Desktop trouvé: $dockerExe"

    try {
        Start-Process -FilePath $dockerExe -WindowStyle Minimized -ErrorAction Stop
        Write-Info "Docker Desktop lancé, attente du daemon..."

        $deadline = (Get-Date).AddSeconds($WaitTimeoutSec)
        while ((Get-Date) -lt $deadline) {
            try {
                $result = & docker info 2>&1
                if ($LASTEXITCODE -eq 0) {
                    Write-OK "Docker Desktop prêt"
                    return
                }
            }
            catch {}
            Start-Sleep -Seconds 2
        }

        Write-Warn "Docker Desktop lancé mais le daemon ne répond pas encore."
    }
    catch {
        Write-Fail "Impossible de lancer Docker Desktop: $($_.Exception.Message)"
    }
}

# ─────────────────────────────────────────────
# OLLAMA
# ─────────────────────────────────────────────
function Start-OllamaIfNeeded {
    if (Get-ListeningPid -Port 11434) {
        Write-OK "Ollama déjà actif sur port 11434"
        return
    }

    Write-Info "Démarrage d'Ollama..."

    $ollamaPaths = @(
        "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe",
        "$env:LOCALAPPDATA\Ollama\ollama.exe",
        "C:\Program Files\Ollama\ollama.exe"
    )

    $ollamaExe = $ollamaPaths | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
    if (-not $ollamaExe) {
        $ollamaExe = (Get-Command ollama -ErrorAction SilentlyContinue)?.Source
    }

    if (-not $ollamaExe) {
        Write-Warn "Ollama introuvable. Installez depuis: https://ollama.ai"
        return
    }

    $logDir = "D:\projets\funesterie\a11\runtime\logs"
    if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }

    Start-Process -FilePath $ollamaExe -ArgumentList "serve" `
        -RedirectStandardOutput "$logDir\ollama.out.log" `
        -RedirectStandardError "$logDir\ollama.err.log" `
        -WindowStyle Hidden -PassThru | Out-Null

    if (Wait-Port -Port 11434 -TimeoutSec 20 -Label "Ollama") {
        Write-OK "Ollama prêt sur port 11434"
    }
    else {
        Write-Warn "Ollama lancé mais ne répond pas encore."
    }
}

# ─────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────
Write-Info "=== Démarrage automatique des services A11 ==="
Write-Info "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
Write-Info ""

Start-OllamaIfNeeded
Start-Neo4jDesktop
Start-DockerDesktop

Write-Info ""
Write-Info "=== État des services ==="

$services = @(
    @{ Name = "Ollama"; Port = 11434; Label = "LLM local" },
    @{ Name = "Neo4j"; Port = 7687; Label = "Knowledge Graph" },
    @{ Name = "A11 Backend"; Port = 3000; Label = "Backend API" }
)

foreach ($svc in $services) {
    $svcPid = Get-ListeningPid -Port $svc.Port
    if ($svcPid) {
        Write-OK "$($svc.Name) ($($svc.Label)) — port $($svc.Port) — PID $svcPid"
    }
    else {
        Write-Warn "$($svc.Name) ($($svc.Label)) — port $($svc.Port) — INACTIF"
    }
}

# Docker
try {
    $dockerInfo = & docker info 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-OK "Docker Desktop — actif"
    }
    else {
        Write-Warn "Docker Desktop — inactif"
    }
}
catch {
    Write-Warn "Docker Desktop — non installé"
}

Write-Info ""
Write-Info "=== Terminé ==="

if (-not $NoPause) {
    Write-Host ""
    Read-Host "Appuyez sur Entrée pour fermer"
}
