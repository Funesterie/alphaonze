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
  purpose = 'Funesterie local container dock for A11, NOSSEN memory services, MCP helpers, and future agents.'
  engine = $engine.Name
  engineReady = $engine.DaemonReady
  composePath = $composePath
  defaultMode = 'dry-run first, no secrets in repo, no destructive volume operations'
  services = @(
    [ordered]@{ name = 'a11-backend'; profile = 'core'; role = 'API and agent runtime image' },
    [ordered]@{ name = 'redis'; profile = 'core'; role = 'small local queue/cache' },
    [ordered]@{ name = 'neo4j-local-mirror'; profile = 'memory'; role = 'optional local mirror/cache, Aura stays primary' },
    [ordered]@{ name = 'ollama'; profile = 'llm'; role = 'optional local model runtime' },
    [ordered]@{ name = 'mcp-router'; profile = 'mcp'; role = 'placeholder for NOSSEN/MCP routing service' }
  )
  safety = @(
    'No token or password is committed.',
    'Volumes are named and never deleted by this script.',
    'Docker Desktop is optional; Podman is the current stable engine.',
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
