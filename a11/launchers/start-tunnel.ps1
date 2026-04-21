param([switch]$NoPause)

$ErrorActionPreference = 'Stop'

$configPath = "$env:USERPROFILE\.cloudflared\config.yml"
$tunnelName = 'funesterie-cerbere-local'

Write-Host "[TUNNEL] Demarrage du tunnel $tunnelName..."
Write-Host "[TUNNEL] api.funesterie.me -> http://localhost:3000"
Write-Host "[TUNNEL] cerbere.funesterie.me -> http://localhost:4545"
Write-Host "[TUNNEL] sd.funesterie.me -> http://localhost:3000"
Write-Host ""

cloudflared tunnel --config $configPath run $tunnelName

if (-not $NoPause) {
  [void](Read-Host 'Tunnel arrete. Appuie sur Entree pour fermer')
}
