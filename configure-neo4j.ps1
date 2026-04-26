# Script de configuration Neo4j Desktop pour A11
# Configure la licence, SSH, et les paramètres de connexion

param(
    [string]$Neo4jDesktopPath = "D:\projets\funesterie\Neo4j Desktop 2",
    [string]$DatabaseName = "a11-knowledge-graph",
    [switch]$EnableSSH = $false,
    [int]$SSHPort = 22,
    [string]$SSHUser = $env:USERNAME
)

Write-Host "=== Configuration Neo4j Desktop pour A11 ===" -ForegroundColor Cyan

# Chemins importants
$neo4jExe = Join-Path $Neo4jDesktopPath "Neo4j Desktop.exe"
$appDataPath = Join-Path $env:LOCALAPPDATA "Neo4j\Relate\Data"
$dbmsPath = Join-Path $appDataPath "dbmss"

Write-Host "`nVérification de l'installation..." -ForegroundColor Yellow

if (-not (Test-Path $neo4jExe)) {
    Write-Host "ERREUR: Neo4j Desktop non trouvé à $neo4jExe" -ForegroundColor Red
    Write-Host "Exécutez d'abord: .\install-neo4j-desktop.ps1" -ForegroundColor Yellow
    exit 1
}

Write-Host "✓ Neo4j Desktop trouvé" -ForegroundColor Green

# Configuration de la licence
Write-Host "`n=== Configuration Licence ===" -ForegroundColor Cyan
Write-Host "Neo4j Desktop Community Edition est gratuit pour:" -ForegroundColor White
Write-Host "  - Usage personnel" -ForegroundColor Gray
Write-Host "  - Développement local" -ForegroundColor Gray
Write-Host "  - Projets open source" -ForegroundColor Gray
Write-Host "`nPas de clé de licence requise pour Community Edition." -ForegroundColor Green

# Configuration SSH
if ($EnableSSH) {
    Write-Host "`n=== Configuration SSH ===" -ForegroundColor Cyan
    
    # Vérifier si OpenSSH est installé
    $sshService = Get-Service -Name "sshd" -ErrorAction SilentlyContinue
    
    if ($null -eq $sshService) {
        Write-Host "OpenSSH Server n'est pas installé." -ForegroundColor Yellow
        Write-Host "Installation d'OpenSSH Server..." -ForegroundColor Cyan
        
        try {
            Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0
            Write-Host "✓ OpenSSH Server installé" -ForegroundColor Green
        }
        catch {
            Write-Host "ERREUR: Impossible d'installer OpenSSH Server" -ForegroundColor Red
            Write-Host $_.Exception.Message -ForegroundColor Red
        }
    }
    else {
        Write-Host "✓ OpenSSH Server déjà installé" -ForegroundColor Green
    }
    
    # Démarrer et configurer le service SSH
    try {
        Start-Service sshd
        Set-Service -Name sshd -StartupType 'Automatic'
        Write-Host "✓ Service SSH démarré et configuré en démarrage automatique" -ForegroundColor Green
        
        # Configurer le pare-feu
        $firewallRule = Get-NetFirewallRule -Name "OpenSSH-Server-In-TCP" -ErrorAction SilentlyContinue
        if ($null -eq $firewallRule) {
            New-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' -DisplayName 'OpenSSH Server (sshd)' -Enabled True -Direction Inbound -Protocol TCP -Action Allow -LocalPort $SSHPort
            Write-Host "✓ Règle de pare-feu créée pour le port $SSHPort" -ForegroundColor Green
        }
        else {
            Write-Host "✓ Règle de pare-feu déjà configurée" -ForegroundColor Green
        }
        
    }
    catch {
        Write-Host "ERREUR lors de la configuration SSH:" -ForegroundColor Red
        Write-Host $_.Exception.Message -ForegroundColor Red
    }
}

# Configuration Neo4j pour A11
Write-Host "`n=== Configuration Neo4j pour A11 ===" -ForegroundColor Cyan

$envPath = "D:\projets\funesterie\a11\backend\apps\server\.env.local"
if (Test-Path $envPath) {
    Write-Host "Vérification de .env.local..." -ForegroundColor Yellow
    $envContent = Get-Content $envPath -Raw
    
    # Vérifier la configuration Neo4j
    if ($envContent -match "NEO4J_URI=bolt://localhost:7687") {
        Write-Host "✓ Configuration Neo4j correcte dans .env.local" -ForegroundColor Green
    }
    else {
        Write-Host "⚠ Configuration Neo4j à vérifier dans .env.local" -ForegroundColor Yellow
    }
    
    # Afficher la configuration actuelle
    Write-Host "`nConfiguration actuelle:" -ForegroundColor Cyan
    $envContent -split "`n" | Where-Object { $_ -match "NEO4J_" } | ForEach-Object {
        Write-Host "  $_" -ForegroundColor Gray
    }
}

# Créer un script de tunnel SSH pour accès distant
if ($EnableSSH) {
    $tunnelScript = @"
# Script de tunnel SSH pour Neo4j
# Usage: .\neo4j-ssh-tunnel.ps1 -RemoteHost <hostname>

param(
    [Parameter(Mandatory=`$true)]
    [string]`$RemoteHost,
    [int]`$LocalPort = 7687,
    [int]`$RemotePort = 7687,
    [string]`$SSHUser = "$SSHUser"
)

Write-Host "Création du tunnel SSH vers Neo4j..." -ForegroundColor Cyan
Write-Host "Local: localhost:`$LocalPort -> Remote: `$RemoteHost:`$RemotePort" -ForegroundColor Yellow

ssh -L `${LocalPort}:localhost:`${RemotePort} `${SSHUser}@`${RemoteHost}
"@
    
    $tunnelScriptPath = Join-Path $Neo4jDesktopPath "neo4j-ssh-tunnel.ps1"
    Set-Content -Path $tunnelScriptPath -Value $tunnelScript
    Write-Host "`n✓ Script de tunnel SSH créé: $tunnelScriptPath" -ForegroundColor Green
}

# Résumé final
Write-Host "`n=== Résumé de la configuration ===" -ForegroundColor Cyan
Write-Host "Neo4j Desktop: $neo4jExe" -ForegroundColor White
Write-Host "Connexion locale: bolt://localhost:7687" -ForegroundColor White
Write-Host "Credentials par défaut: neo4j / neo4j" -ForegroundColor White

if ($EnableSSH) {
    Write-Host "`nSSH activé:" -ForegroundColor Green
    Write-Host "  Port: $SSHPort" -ForegroundColor Gray
    Write-Host "  User: $SSHUser" -ForegroundColor Gray
    Write-Host "  Tunnel: ssh -L 7687:localhost:7687 ${SSHUser}@localhost" -ForegroundColor Gray
}

Write-Host "`n=== Prochaines étapes ===" -ForegroundColor Cyan
Write-Host "1. Lancez Neo4j Desktop" -ForegroundColor White
Write-Host "2. Créez un nouveau projet 'A11'" -ForegroundColor White
Write-Host "3. Créez une base de données locale '$DatabaseName'" -ForegroundColor White
Write-Host "4. Démarrez la base de données" -ForegroundColor White
Write-Host "5. Testez la connexion depuis A11 backend" -ForegroundColor White

Write-Host "`nPour tester la connexion:" -ForegroundColor Cyan
Write-Host "cd a11/backend/apps/server" -ForegroundColor Gray
Write-Host "npm run test:neo4j" -ForegroundColor Gray
