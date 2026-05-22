param(
  [ValidateSet('plan', 'compose-path', 'health')]
  [string]$Action = 'plan',
  [switch]$Json,
  [switch]$PreferDocker
)

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\Funesterie.Container.ps1"

$composePath = Join-Path $PSScriptRoot 'thousand-shiny.compose.yml'
$engine = Get-FunesterieContainerEngine -PreferDocker:$PreferDocker

$plan = [ordered]@{
  name = 'Thousand Shiny'
  purpose = 'Funesterie local container dock for A11, voice, memory services, MCP helpers, and optional local agents.'
  engine = $engine.Name
  engineReady = $engine.DaemonReady
  composePath = $composePath
  defaultMode = 'dry-run first, no secrets in repo, no destructive volume operations'
  services = @(
    [ordered]@{ name = 'a11-backend'; profile = 'core'; role = 'API and agent runtime'; port = '3000/tcp' },
    [ordered]@{ name = 'a11-voice'; profile = 'core'; role = 'local voice synthesis module'; port = '5002/tcp internal' },
    [ordered]@{ name = 'a11-memory-postgres'; profile = 'memory'; role = 'pgvector memory store'; port = '127.0.0.1:5437->5432' },
    [ordered]@{ name = 'a11-neo4j-sync'; profile = 'memory'; role = 'local Neo4j mirror/cache'; port = '127.0.0.1:17474/17687' },
    [ordered]@{ name = 'a11-mcp'; profile = 'mcp'; role = 'local MCP bridge'; port = '8787/tcp' },
    [ordered]@{ name = 'a11-mcp-aura'; profile = 'mcp'; role = 'Aura MCP bridge'; port = '8788/tcp' },
    [ordered]@{ name = 'a11-mcp-cloudflared'; profile = 'edge'; role = 'public MCP tunnel'; port = 'tunnel only' },
    [ordered]@{ name = 'redis'; profile = 'optional'; role = 'small local queue/cache when needed'; port = '6379/tcp' },
    [ordered]@{ name = 'ollama'; profile = 'optional'; role = 'local model runtime when needed'; port = '11434/tcp' }
  )
  safety = @(
    'No token or password is committed.',
    'Volumes are named and never deleted by this script.',
    'Podman is the current stable engine; Docker Desktop can be used explicitly with -PreferDocker.',
    'Red Hat registry access is checked separately through redhat-health.ps1.'
  )
}

if ($Action -eq 'compose-path') {
  if ($Json) { @{ composePath = $composePath } | ConvertTo-Json; exit 0 }
  $composePath
  exit 0
}

if ($Action -eq 'health') {
  if ($Json) {
    $container = & "$PSScriptRoot\health.ps1" -Json -PreferDocker:$PreferDocker | ConvertFrom-Json
    $redHat = & "$PSScriptRoot\redhat-health.ps1" -Json | ConvertFrom-Json
    [ordered]@{
      name = 'Thousand Shiny'
      container = $container
      redHat = $redHat
      secretPrinted = $false
    } | ConvertTo-Json -Depth 8
    exit 0
  }

  Write-Host '== Container ==' -ForegroundColor Cyan
  & "$PSScriptRoot\health.ps1" -PreferDocker:$PreferDocker
  Write-Host ''
  Write-Host '== Red Hat ==' -ForegroundColor Cyan
  & "$PSScriptRoot\redhat-health.ps1"
  exit 0
}

if ($Json) {
  $plan | ConvertTo-Json -Depth 8
  exit 0
}

[pscustomobject]$plan | Format-List
