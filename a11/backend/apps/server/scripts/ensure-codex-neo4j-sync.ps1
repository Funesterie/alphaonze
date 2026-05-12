param(
  [string]$ContainerName = "a11-neo4j-sync",
  [string]$Image = "docker.io/library/neo4j:2025",
  [int]$HttpPort = 17474,
  [int]$BoltPort = 17687,
  [string]$Database = "neo4j",
  [switch]$SkipSync
)

$ErrorActionPreference = "Stop"

function Test-LocalPort {
  param([int]$Port)
  $result = Test-NetConnection 127.0.0.1 -Port $Port -WarningAction SilentlyContinue
  return [bool]$result.TcpTestSucceeded
}

function Wait-LocalPort {
  param(
    [int]$Port,
    [int]$TimeoutSeconds = 120
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-LocalPort -Port $Port) {
      return
    }
    Start-Sleep -Seconds 2
  }

  throw "Timed out waiting for 127.0.0.1:$Port"
}

$podman = Get-Command podman -ErrorAction SilentlyContinue
if (-not $podman) {
  throw "podman is not available in PATH"
}

$exists = $false
try {
  podman inspect $ContainerName *> $null
  $exists = $true
} catch {
  $exists = $false
}

if (-not $exists) {
  Write-Host "[codex-neo4j-sync] Creating $ContainerName"
  podman run -d `
    --name $ContainerName `
    -p "127.0.0.1:$HttpPort`:7474" `
    -p "127.0.0.1:$BoltPort`:7687" `
    -e NEO4J_AUTH=none `
    -e NEO4J_server_memory_heap_initial__size=512m `
    -e NEO4J_server_memory_heap_max__size=1G `
    -e NEO4J_server_memory_pagecache_size=512m `
    -v "$ContainerName-data:/data" `
    $Image | Out-Host
} else {
  $running = (podman inspect -f "{{.State.Running}}" $ContainerName).Trim()
  if ($running -ne "true") {
    Write-Host "[codex-neo4j-sync] Starting $ContainerName"
    podman start $ContainerName | Out-Host
  } else {
    Write-Host "[codex-neo4j-sync] $ContainerName already running"
  }
}

Wait-LocalPort -Port $BoltPort
Write-Host "[codex-neo4j-sync] Bolt ready on bolt://127.0.0.1:$BoltPort"
Write-Host "[codex-neo4j-sync] Browser ready on http://127.0.0.1:$HttpPort"

if (-not $SkipSync) {
  $script = Join-Path $PSScriptRoot "sync-codex-vs-neo4j.cjs"
  $env:NEO4J_URI = "bolt://127.0.0.1:$BoltPort"
  $env:NEO4J_DATABASE = $Database
  if (-not $env:CODEX_SYNC_RUN_ID) {
    $env:CODEX_SYNC_RUN_ID = "codex-vs-sync-$(Get-Date -Format 'yyyyMMddHHmmss')"
  }
  if (-not $env:CODEX_SYNC_UPDATED_AT) {
    $env:CODEX_SYNC_UPDATED_AT = (Get-Date).ToString("o")
  }

  Write-Host "[codex-neo4j-sync] Running sync script"
  node $script
}
