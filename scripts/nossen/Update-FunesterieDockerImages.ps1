[CmdletBinding()]
param(
  [string]$DockerContext = "desktop-linux",
  [string[]]$Images = @(
    "cloudflare/cloudflared:latest",
    "caddy:2-alpine",
    "neo4j:latest"
  ),
  [switch]$Pull,
  [switch]$SetDockerContext,
  [switch]$EnsureWslDefault,
  [string]$WslDefault = "docker-desktop",
  [switch]$RecreateKnownContainers,
  [switch]$InstallScheduledTask,
  [string]$TaskName = "Funesterie Docker Image Daily Update",
  [string]$At = "09:15",
  [string]$ReportPath
)

Set-StrictMode -Version Latest

$ErrorActionPreference = "Stop"
$RepoRoot = Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..")
$RuntimeDir = Join-Path $RepoRoot "a11\runtime"
if (-not $ReportPath) {
  $ReportPath = Join-Path $RuntimeDir "docker-image-update-report.json"
}

function Test-CommandExists {
  param([Parameter(Mandatory = $true)][string]$Name)
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Invoke-LoggedCommand {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [Parameter(Mandatory = $true)][string[]]$Arguments,
    [string]$WorkingDirectory = $RepoRoot
  )

  Push-Location $WorkingDirectory
  try {
    $output = & $FilePath @Arguments 2>&1
    $exit = $LASTEXITCODE
    return [pscustomobject]@{
      ok = ($exit -eq 0)
      exitCode = $exit
      output = (($output | Out-String).Trim())
    }
  } finally {
    Pop-Location
  }
}

function Get-ImageDigests {
  param([Parameter(Mandatory = $true)][string]$Image)
  $result = Invoke-LoggedCommand -FilePath "docker" -Arguments @("--context", $DockerContext, "image", "inspect", $Image, "--format", "{{json .RepoDigests}}")
  if (-not $result.ok -or [string]::IsNullOrWhiteSpace($result.output)) {
    return @()
  }
  try {
    $digests = $result.output | ConvertFrom-Json
    if ($null -eq $digests) { return @() }
    return @($digests)
  } catch {
    return @()
  }
}

function Get-WslDefaultDistro {
  if (-not (Test-CommandExists "wsl.exe")) { return $null }
  $raw = (& wsl.exe -l -v 2>$null | Out-String) -replace "`0", ""
  foreach ($line in $raw -split "`r?`n") {
    if ($line.TrimStart().StartsWith("*")) {
      $parts = ($line -replace "^\s*\*\s*", "").Trim() -split "\s+"
      if ($parts.Count -gt 0) { return $parts[0] }
    }
  }
  return $null
}

function Test-WslDistroExists {
  param([Parameter(Mandatory = $true)][string]$Name)
  if (-not (Test-CommandExists "wsl.exe")) { return $false }
  $raw = (& wsl.exe -l -q 2>$null | Out-String) -replace "`0", ""
  return @($raw -split "`r?`n" | ForEach-Object { $_.Trim() }) -contains $Name
}

function Register-DailyTask {
  $scriptPath = $PSCommandPath
  if (-not $scriptPath) {
    throw "Cannot install scheduled task without a script path."
  }

  $arguments = @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", "`"$scriptPath`"",
    "-Pull",
    "-SetDockerContext",
    "-EnsureWslDefault"
  ) -join " "

  $time = [datetime]::ParseExact($At, "HH:mm", [Globalization.CultureInfo]::InvariantCulture)
  $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $arguments -WorkingDirectory $RepoRoot
  $trigger = New-ScheduledTaskTrigger -Daily -At $time
  $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 45)

  Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Description "Pulls the canonical Funesterie Docker images and keeps Docker Desktop as the runtime context." `
    -Force | Out-Null

  return [pscustomobject]@{
    name = $TaskName
    at = $At
    command = "powershell.exe $arguments"
  }
}

if (-not (Test-CommandExists "docker")) {
  throw "docker command not found. Start Docker Desktop or repair PATH first."
}

New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null

$report = [ordered]@{
  schema = "funesterie.docker-image-update.v1"
  generatedAt = (Get-Date).ToString("o")
  dockerContext = $DockerContext
  pull = [bool]$Pull
  setDockerContext = [bool]$SetDockerContext
  ensureWslDefault = [bool]$EnsureWslDefault
  recreateKnownContainers = [bool]$RecreateKnownContainers
  images = @()
  actions = @()
}

if ($SetDockerContext) {
  $contextResult = Invoke-LoggedCommand -FilePath "docker" -Arguments @("context", "use", $DockerContext)
  $report.actions += [pscustomobject]@{
    name = "docker-context-use"
    ok = $contextResult.ok
    detail = $contextResult.output
  }
  if (-not $contextResult.ok) { throw "Docker context switch failed: $($contextResult.output)" }
}

if ($EnsureWslDefault) {
  $before = Get-WslDefaultDistro
  $changed = $false
  $message = "unchanged"
  if (-not (Test-WslDistroExists $WslDefault)) {
    $message = "target distro missing"
  } elseif ($before -ne $WslDefault) {
    $setResult = Invoke-LoggedCommand -FilePath "wsl.exe" -Arguments @("--set-default", $WslDefault)
    $changed = $setResult.ok
    $message = $setResult.output
    if (-not $setResult.ok) { throw "WSL default switch failed: $($setResult.output)" }
  }
  $after = Get-WslDefaultDistro
  $report.actions += [pscustomobject]@{
    name = "wsl-default"
    ok = ($after -eq $WslDefault)
    before = $before
    after = $after
    changed = $changed
    detail = $message
  }
}

foreach ($image in $Images) {
  $beforeDigests = Get-ImageDigests -Image $image
  $pullResult = $null
  if ($Pull) {
    $pullResult = Invoke-LoggedCommand -FilePath "docker" -Arguments @("--context", $DockerContext, "pull", $image)
    if (-not $pullResult.ok) {
      $report.images += [pscustomobject]@{
        image = $image
        ok = $false
        before = $beforeDigests
        after = @()
        changed = $false
        detail = $pullResult.output
      }
      continue
    }
  } else {
    $pullResult = Invoke-LoggedCommand -FilePath "docker" -Arguments @("--context", $DockerContext, "manifest", "inspect", $image)
  }
  $afterDigests = Get-ImageDigests -Image $image
  $changed = (($beforeDigests -join "|") -ne ($afterDigests -join "|"))
  $detail = if ($Pull -or -not $pullResult.ok) {
    $pullResult.output
  } else {
    "remote manifest available"
  }
  $report.images += [pscustomobject]@{
    image = $image
    ok = $pullResult.ok
    before = $beforeDigests
    after = $afterDigests
    changed = $changed
    detail = $detail
  }
}

if ($RecreateKnownContainers) {
  $a11McpRoot = Join-Path $RepoRoot "a11mcp"
  $mcpCompose = Join-Path $a11McpRoot "docker-compose.yml"
  $tunnelCompose = Join-Path $a11McpRoot "docker-compose.tunnel.yml"
  if ((Test-Path -LiteralPath $mcpCompose) -and (Test-Path -LiteralPath $tunnelCompose)) {
    $result = Invoke-LoggedCommand `
      -FilePath "docker" `
      -Arguments @("--context", $DockerContext, "compose", "-f", $mcpCompose, "-f", $tunnelCompose, "up", "-d", "cloudflared") `
      -WorkingDirectory $a11McpRoot
    $report.actions += [pscustomobject]@{
      name = "recreate-a11-mcp-cloudflared"
      ok = $result.ok
      detail = $result.output
    }
  }

  $neo4jExtensionCompose = Join-Path $env:APPDATA "Docker\extensions\ajeetraina_neo4j-docker-extension\vm\docker-compose.yaml"
  if (Test-Path -LiteralPath $neo4jExtensionCompose) {
    $neo4jDir = Split-Path -Parent $neo4jExtensionCompose
    $result = Invoke-LoggedCommand `
      -FilePath "docker" `
      -Arguments @("--context", $DockerContext, "compose", "-f", $neo4jExtensionCompose, "up", "-d") `
      -WorkingDirectory $neo4jDir
    $report.actions += [pscustomobject]@{
      name = "recreate-docker-desktop-neo4j-extension"
      ok = $result.ok
      detail = $result.output
    }
  }
}

if ($InstallScheduledTask) {
  $task = Register-DailyTask
  $report.actions += [pscustomobject]@{
    name = "install-scheduled-task"
    ok = $true
    detail = $task
  }
}

$report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $ReportPath -Encoding UTF8
$summary = [pscustomobject]@{
  ok = (-not (@($report.images) | Where-Object { -not $_.ok })) -and (-not (@($report.actions) | Where-Object { $_.PSObject.Properties.Name -contains "ok" -and -not $_.ok }))
  reportPath = $ReportPath
  images = @($report.images | ForEach-Object { [pscustomobject]@{ image = $_.image; ok = $_.ok; changed = $_.changed } })
  actions = @($report.actions | ForEach-Object { [pscustomobject]@{ name = $_.name; ok = $_.ok } })
}
$summary | ConvertTo-Json -Depth 5
