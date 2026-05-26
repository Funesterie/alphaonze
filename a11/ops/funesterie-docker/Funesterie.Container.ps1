Set-StrictMode -Version Latest

$script:FunesterieDockerBin = 'C:\Program Files\Docker\Docker\resources\bin'
$script:FunesterieDockerExe = Join-Path $script:FunesterieDockerBin 'docker.exe'

function Add-FunesterieDockerPath {
  if ((Test-Path -LiteralPath $script:FunesterieDockerBin) -and ($env:Path -notlike "*$script:FunesterieDockerBin*")) {
    $env:Path = "$script:FunesterieDockerBin;$env:Path"
  }
}

function Test-FunesterieCommand {
  param(
    [Parameter(Mandatory = $true)][string]$Command,
    [string[]]$Arguments = @('--version')
  )

  try {
    $output = & $Command @Arguments 2>&1
    return [pscustomobject]@{
      Ok = ($LASTEXITCODE -eq 0)
      Output = ($output | Out-String).Trim()
    }
  } catch {
    return [pscustomobject]@{
      Ok = $false
      Output = $_.Exception.Message
    }
  }
}

function Get-FunesterieContainerEngine {
  param([switch]$PreferDocker)

  Add-FunesterieDockerPath

  $dockerVersion = $null
  $dockerDaemon = $false
  if (Test-Path -LiteralPath $script:FunesterieDockerExe) {
    $dockerVersion = Test-FunesterieCommand -Command $script:FunesterieDockerExe -Arguments @('--version')
    $dockerInfo = Test-FunesterieCommand -Command $script:FunesterieDockerExe -Arguments @('info', '--format', '{{.ServerVersion}}')
    $dockerDaemon = $dockerInfo.Ok -and -not [string]::IsNullOrWhiteSpace($dockerInfo.Output)
  }

  $podman = Get-Command podman -ErrorAction SilentlyContinue
  $podmanVersion = $null
  $podmanDaemon = $false
  if ($podman) {
    $podmanVersion = Test-FunesterieCommand -Command $podman.Source -Arguments @('--version')
    $podmanInfo = Test-FunesterieCommand -Command $podman.Source -Arguments @('info', '--format', '{{.Host.Arch}}')
    $podmanDaemon = $podmanInfo.Ok -and -not [string]::IsNullOrWhiteSpace($podmanInfo.Output)
  }

  if ($PreferDocker -and $dockerDaemon) {
    return [pscustomobject]@{
      Name = 'docker'
      Command = $script:FunesterieDockerExe
      DaemonReady = $true
      Version = $dockerVersion.Output
      Fallback = $null
    }
  }

  if ($podmanDaemon) {
    return [pscustomobject]@{
      Name = 'podman'
      Command = $podman.Source
      DaemonReady = $true
      Version = $podmanVersion.Output
      Fallback = if ($dockerVersion) { $dockerVersion.Output } else { $null }
    }
  }

  if ($dockerDaemon) {
    return [pscustomobject]@{
      Name = 'docker'
      Command = $script:FunesterieDockerExe
      DaemonReady = $true
      Version = $dockerVersion.Output
      Fallback = $null
    }
  }

  return [pscustomobject]@{
    Name = 'none'
    Command = $null
    DaemonReady = $false
    Version = $null
    Fallback = if ($dockerVersion) { $dockerVersion.Output } else { $null }
  }
}

function Invoke-FunesterieContainer {
  param(
    [Parameter(Mandatory = $true)][object]$Engine,
    [Parameter(Mandatory = $true)][string[]]$Arguments,
    [string]$WorkingDirectory = (Get-Location).Path,
    [switch]$DryRun
  )

  if (-not $Engine.Command) {
    throw 'No container engine is available. Start Podman or Docker Desktop first.'
  }

  $display = "$($Engine.Command) $($Arguments -join ' ')"
  if ($DryRun) {
    Write-Host "[dry-run] $display" -ForegroundColor Yellow
    return
  }

  Push-Location $WorkingDirectory
  try {
    Write-Host $display -ForegroundColor DarkGray
    & $Engine.Command @Arguments
    if ($LASTEXITCODE -ne 0) {
      throw "Container command failed with exit code $LASTEXITCODE"
    }
  } finally {
    Pop-Location
  }
}
