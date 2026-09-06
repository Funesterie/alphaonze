# ============================================================
# FIX-CLAUDE-DNS.ps1
# Corrige les erreurs de Claude Desktop (UNKNOWN_CERTIFICATE_VERIFICATION_ERROR,
# ECONNRESET, ConnectionRefused, ENOTFOUND) causees par:
#   1. DNS en IPv6 link-local uniquement (hotspot iPhone) - Node.js ne peut pas faire
#      de requetes UDP DNS vers fe80::... 
#   2. Instabilite du hotspot mobile (ECONNRESET, TLS interrompu)
#
# Ce script:
#   - Configure des serveurs DNS IPv4 fiables (Google + Cloudflare) sur le Wi-Fi
#   - Desactive IPv6 sur le Wi-Fi (evite les changements de prefix mobile)
#   - Vide le cache DNS
#
# A lancer en tant qu'administrateur (clic droit > Executer en tant qu'admin)
# ============================================================

#Requires -RunAsAdministrator

Write-Host "`n=== FIX CLAUDE DESKTOP - ERREURS RESEAU ===" -ForegroundColor Cyan
Write-Host "Hotspot iPhone detecte - correction DNS + IPv6`n"

# 1. Set DNS servers on Wi-Fi to reliable public DNS
Write-Host "[1/4] Configuration des serveurs DNS sur Wi-Fi..." -ForegroundColor Yellow
try {
    Set-DnsClientServerAddress -InterfaceAlias "Wi-Fi" -ServerAddresses ("8.8.8.8","1.1.1.1") -Confirm:$false -ErrorAction Stop
    Write-Host "  OK: DNS IPv4 = 8.8.8.8 + 1.1.1.1" -ForegroundColor Green
} catch {
    Write-Host "  ERREUR: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "  Verifiez que l'adaptateur Wi-Fi existe et reessayez." -ForegroundColor Red
}

# 2. Disable IPv6 on Wi-Fi to avoid rapidly changing mobile carrier IPv6 prefixes
Write-Host "`n[2/4] Desactivation IPv6 sur Wi-Fi (evite les changements de prefix mobile)..." -ForegroundColor Yellow
try {
    Disable-NetAdapterBinding -Name "Wi-Fi" -ComponentID ms_tcpip6 -ErrorAction Stop
    Write-Host "  OK: IPv6 desactive sur Wi-Fi" -ForegroundColor Green
} catch {
    Write-Host "  ERREUR: $($_.Exception.Message)" -ForegroundColor Red
}

# 3. Flush DNS cache
Write-Host "`n[3/4] Vidage du cache DNS..." -ForegroundColor Yellow
ipconfig /flushdns | Out-Null
Write-Host "  OK: Cache DNS vide" -ForegroundColor Green

# 4. Register DNS
Write-Host "`n[4/4] Reenregistrement DNS..." -ForegroundColor Yellow
ipconfig /registerdns | Out-Null
Write-Host "  OK" -ForegroundColor Green

# Verification
Write-Host "`n=== VERIFICATION ===" -ForegroundColor Cyan
$dns = Get-DnsClientServerAddress -InterfaceAlias "Wi-Fi" -AddressFamily IPv4 -ErrorAction SilentlyContinue
Write-Host "DNS IPv4: $($dns.ServerAddresses -join ', ')"
$ipv6 = Get-NetAdapterBinding -Name "Wi-Fi" -ComponentID ms_tcpip6 -ErrorAction SilentlyContinue
Write-Host "IPv6 active: $($ipv6.Enabled)"

Write-Host "`n=== TERMINÉ ===" -ForegroundColor Green
Write-Host "Redemarrez Claude Desktop pour que les changements prennent effet."
Write-Host "Si les erreurs ECONNRESET persistent, c'est la stabilite du hotspot"
Write-Host "mobile qui est en cause - essayez un cable USB ou un vrai Wi-Fi."
Write-Host "`nAppuyez sur une touche pour fermer..." -ForegroundColor DarkGray
$null = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')
