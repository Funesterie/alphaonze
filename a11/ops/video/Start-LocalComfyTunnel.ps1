param(
  [string]$TunnelName = "a11-local-video",
  [string]$Hostname = "sd.funesterie.me",
  [string]$RunnerHost = "127.0.0.1",
  [int]$RunnerPort = 17881,
  [switch]$SkipDnsRoute,
  [switch]$SelfTest
)

$ErrorActionPreference = "Stop"
if (Get-Variable -Name PSNativeCommandUseErrorActionPreference -Scope Global -ErrorAction SilentlyContinue) {
  $global:PSNativeCommandUseErrorActionPreference = $false
}

function Test-HttpOk([string]$Url) {
  try {
    $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 8
    return [int]$response.StatusCode -ge 200 -and [int]$response.StatusCode -lt 500
  } catch {
    return $false
  }
}

function Get-CloudflaredPath() {
  $command = Get-Command cloudflared -ErrorAction SilentlyContinue
  if (-not $command) {
    throw "cloudflared introuvable dans PATH"
  }
  return $command.Source
}

function Invoke-CloudflaredQuiet([string[]]$Arguments) {
  $cloudflared = Get-CloudflaredPath
  $stdout = [IO.Path]::GetTempFileName()
  $stderr = [IO.Path]::GetTempFileName()
  try {
    $process = Start-Process -FilePath $cloudflared `
      -WindowStyle Hidden `
      -ArgumentList $Arguments `
      -RedirectStandardOutput $stdout `
      -RedirectStandardError $stderr `
      -PassThru `
      -Wait
    $output = @()
    if (Test-Path -LiteralPath $stdout) {
      $output += Get-Content -LiteralPath $stdout -ErrorAction SilentlyContinue
    }
    if (Test-Path -LiteralPath $stderr) {
      $output += Get-Content -LiteralPath $stderr -ErrorAction SilentlyContinue
    }
    if ($process.ExitCode -ne 0) {
      throw (($output -join "`n").Trim())
    }
    return $output
  } finally {
    Remove-Item -LiteralPath $stdout -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $stderr -Force -ErrorAction SilentlyContinue
  }
}

function Test-TunnelExists([string]$Name) {
  $list = Invoke-CloudflaredQuiet @("tunnel", "list")
  return ($list -join "`n") -match "(?m)\s$([regex]::Escape($Name))\s"
}

function Get-TunnelProcesses([string]$Name) {
  $escaped = [regex]::Escape($Name)
  $processes = Get-CimInstance Win32_Process -Filter "Name = 'cloudflared.exe'" -ErrorAction SilentlyContinue
  $foundProcesses = @()
  foreach ($process in $processes) {
    if ([string]::IsNullOrEmpty($process.CommandLine)) { continue }
    if ($process.CommandLine -match $escaped -and $process.CommandLine -match "\btunnel\b" -and $process.CommandLine -match "\brun\b") {
      $foundProcesses += $process
    }
  }
  return $foundProcesses
}

function Test-TunnelProcess([string]$Name, [string]$ExpectedUrl) {
  $processes = @(Get-TunnelProcesses $Name)
  foreach ($process in $processes) {
    if ($process.CommandLine -match [regex]::Escape($ExpectedUrl)) {
      return $true
    }
  }
  return $false
}

$cloudflared = Get-CloudflaredPath
$runnerUrl = "http://$RunnerHost`:$RunnerPort"
$healthUrl = "$runnerUrl/health"
$publicHealthUrl = "https://$Hostname/health"

if (-not (Test-HttpOk $healthUrl)) {
  throw "Runner video local introuvable: $healthUrl. Lance Start-LocalComfyMochi.ps1 ou Start-LocalComfyWanApi.ps1 avant le tunnel."
}

if (-not (Test-TunnelExists $TunnelName)) {
  Invoke-CloudflaredQuiet @("tunnel", "create", $TunnelName) | Out-Null
}

if (-not $SkipDnsRoute) {
  Invoke-CloudflaredQuiet @("tunnel", "route", "dns", "--overwrite-dns", $TunnelName, $Hostname) | Out-Null
}

$staleProcesses = Get-TunnelProcesses $TunnelName | Where-Object {
  $_.CommandLine -notmatch [regex]::Escape($runnerUrl)
}
foreach ($process in $staleProcesses) {
  Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
}

if (-not (Test-TunnelProcess $TunnelName $runnerUrl)) {
  Start-Process -FilePath $cloudflared `
    -WindowStyle Hidden `
    -ArgumentList @(
      "tunnel",
      "--no-autoupdate",
      "--url", $runnerUrl,
      "run", $TunnelName
    ) | Out-Null

  $deadline = (Get-Date).AddSeconds(60)
  do {
    Start-Sleep -Seconds 3
    if (Test-TunnelProcess $TunnelName $runnerUrl) { break }
  } while ((Get-Date) -lt $deadline)
}

if (-not (Test-TunnelProcess $TunnelName $runnerUrl)) {
  throw "Tunnel Cloudflare non demarre: $TunnelName"
}

if ($SelfTest) {
  $deadline = (Get-Date).AddSeconds(90)
  do {
    Start-Sleep -Seconds 3
    if (Test-HttpOk $publicHealthUrl) { break }
  } while ((Get-Date) -lt $deadline)

  if (-not (Test-HttpOk $publicHealthUrl)) {
    throw "Tunnel lance, mais health public indisponible: $publicHealthUrl"
  }
}

Write-Host "A11 Comfy tunnel pret"
Write-Host "  Host:   https://$Hostname"
Write-Host "  Runner: $runnerUrl"
Write-Host "  Health: $publicHealthUrl"
