param(
  [string]$Version,
  [string]$DownloadUrl,
  [string]$Sha256,
  [string]$Notes = "Funesterie Desktop update",
  [string]$McpUrl = "https://mcp.funesterie.me/mcp",
  [string]$EnvFile = "D:\projets\funesterie\a11mcp\.env",
  [string]$BucketKey = "public/desktop/update-manifest.json"
)

$ErrorActionPreference = "Stop"

function Read-EnvValue {
  param([string]$Path, [string]$Key)
  if (-not (Test-Path -LiteralPath $Path)) { return $null }
  $line = Get-Content -LiteralPath $Path | Where-Object { $_ -match "^\s*$Key\s*=" } | Select-Object -First 1
  if (-not $line) { return $null }
  return ($line -replace "^\s*$Key\s*=\s*", "").Trim().Trim('"').Trim("'")
}

function Get-PackageVersion {
  $pkg = Join-Path (Get-Location) "package.json"
  if (-not (Test-Path -LiteralPath $pkg)) { return "1.0.0" }
  return ((Get-Content -Raw -LiteralPath $pkg | ConvertFrom-Json).version)
}

if (-not $Version) {
  $Version = Get-PackageVersion
}

if (-not $DownloadUrl) {
  $DownloadUrl = "https://files.funesterie.me/public/desktop/Funesterie-Desktop-$Version-x64.exe"
}

$manifest = [ordered]@{
  version = $Version
  downloadUrl = $DownloadUrl
  sha256 = $Sha256
  notes = $Notes
  publishedAt = (Get-Date).ToUniversalTime().ToString("o")
  channel = "stable"
  minSupportedVersion = "1.0.0"
}

$manifestJson = ($manifest | ConvertTo-Json -Depth 5)
$localOut = Join-Path (Get-Location) "update-manifest.json"
Set-Content -LiteralPath $localOut -Value $manifestJson -Encoding UTF8

$token = Read-EnvValue -Path $EnvFile -Key "MCP_AUTH_TOKEN"
if (-not $token) { $token = $env:MCP_AUTH_TOKEN }
if (-not $token) {
  Write-Host "Manifest ecrit localement: $localOut"
  throw "MCP_AUTH_TOKEN introuvable, publication bucket annulee."
}

$body = @{
  jsonrpc = "2.0"
  id = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  method = "tools/call"
  params = @{
    name = "generated_bucket_put_text"
    arguments = @{
      key = $BucketKey
      text = $manifestJson
      contentType = "application/json; charset=utf-8"
      source = "funesterie-desktop"
    }
  }
} | ConvertTo-Json -Depth 12

$headers = @{
  Authorization = "Bearer $token"
  Accept = "application/json, text/event-stream"
  "Content-Type" = "application/json"
}

$response = Invoke-WebRequest -Uri $McpUrl -Method Post -Headers $headers -Body $body -UseBasicParsing
Write-Host "Manifest local: $localOut"
Write-Host "Publication demandee vers $BucketKey (HTTP $($response.StatusCode)). Token non affiche."
