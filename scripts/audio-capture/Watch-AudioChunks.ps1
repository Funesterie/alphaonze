<#
.SYNOPSIS
  Watch-AudioChunks - Surveille les chunks WAV et les envoie a Vivy/Qflush
  Bridge entre la capture audio locale et le pipeline STT MCP.
#>
param(
    [string]$ChunksDir = "D:\projets\funesterie\scripts\audio-capture\chunks",
    [string]$McpUrl = "https://mcp.funesterie.me/mcp",
    [int]$PollSeconds = 3
)

$processed = @{}

Write-Host "[BRIDGE] Surveillance des chunks dans: $ChunksDir" -ForegroundColor Cyan
Write-Host "[BRIDGE] Envoi vers: $McpUrl" -ForegroundColor Cyan

while ($true) {
    $files = Get-ChildItem $ChunksDir -Filter "*.wav" -Recurse -ErrorAction SilentlyContinue |
        Where-Object { -not $processed.ContainsKey($_.FullName) -and $_.Length -gt 1000 }
    
    foreach ($file in $files) {
        $processed[$file.FullName] = $true
        $source = if ($file.Name -match "^mic_") { "mic" } else { "loopback" }
        
        # Copier le dernier chunk comme "latest" pour Vivy
        $latestPath = "$ChunksDir\latest_$source.wav"
        Copy-Item $file.FullName $latestPath -Force -ErrorAction SilentlyContinue
        
        Write-Host "[CHUNK] $source : $($file.Name) ($([math]::Round($file.Length/1024))KB)" -ForegroundColor Gray
    }
    
    Start-Sleep -Seconds $PollSeconds
}
