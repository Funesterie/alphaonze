param(
  [string]$EnvFile = "D:\projets\funesterie\a11mcp\.env",
  [string[]]$Targets = @(
    "D:\agent-bus\mcp-token-current.txt",
    "$env:APPDATA\Funesterie\mcp-token.txt"
  )
)

$ErrorActionPreference = "Stop"

function Read-EnvValue {
  param([string]$Path, [string]$Key)
  if (-not (Test-Path -LiteralPath $Path)) { return $null }
  $line = Get-Content -LiteralPath $Path | Where-Object { $_ -match "^\s*$Key\s*=" } | Select-Object -First 1
  if (-not $line) { return $null }
  return ($line -replace "^\s*$Key\s*=\s*", "").Trim().Trim('"').Trim("'")
}

$token = Read-EnvValue -Path $EnvFile -Key "MCP_AUTH_TOKEN"
if (-not $token) {
  $token = $env:MCP_AUTH_TOKEN
}

if (-not $token) {
  throw "MCP_AUTH_TOKEN introuvable dans $EnvFile ou l'environnement."
}

$written = @()
foreach ($target in $Targets) {
  if ([string]::IsNullOrWhiteSpace($target)) { continue }
  $parent = Split-Path -Parent $target
  if (-not (Test-Path -LiteralPath $parent)) {
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
  }
  Set-Content -LiteralPath $target -Value $token -Encoding UTF8 -NoNewline
  $written += $target
}

Write-Host ("Token MCP synchronise vers {0} fichier(s). Valeur non affichee." -f $written.Count)
foreach ($path in $written) {
  Write-Host (" - {0}" -f $path)
}
