param(
  [string]$DesktopControlPath = (Join-Path $PSScriptRoot "Desktop-Control.ps1"),
  [string]$ScreenshotPath = (Join-Path (Split-Path -Parent $PSScriptRoot) ".codex-tmp\desktop-control-test.png"),
  [switch]$RealScreenshot,
  [switch]$Json
)

$ErrorActionPreference = "Stop"

function Invoke-DesktopControl {
  param([string[]]$ArgumentList)
  $output = & powershell -NoProfile -ExecutionPolicy Bypass -File $DesktopControlPath @ArgumentList
  if ($LASTEXITCODE -ne 0) {
    throw "Desktop-Control failed: $($ArgumentList -join ' ')"
  }
  return ($output -join "`n")
}

if (-not (Test-Path -LiteralPath $DesktopControlPath)) {
  throw "Desktop-Control.ps1 not found: $DesktopControlPath"
}

$script:checks = @()

function Add-Check {
  param(
    [string]$Name,
    [scriptblock]$Body
  )
  $started = Get-Date
  try {
    $result = & $Body
    $script:checks += [pscustomobject]@{
      name = $Name
      ok = $true
      durationMs = [int]((Get-Date) - $started).TotalMilliseconds
      result = $result
    }
  } catch {
    $script:checks += [pscustomobject]@{
      name = $Name
      ok = $false
      durationMs = [int]((Get-Date) - $started).TotalMilliseconds
      error = $_.Exception.Message
    }
  }
}

Add-Check "help" {
  $text = Invoke-DesktopControl -ArgumentList @("help")
  if ($text -notmatch "Desktop-Control") { throw "Help output missing title." }
  "ok"
}

Add-Check "list-windows" {
  $json = Invoke-DesktopControl -ArgumentList @("list-windows", "-Json")
  $payload = $json | ConvertFrom-Json
  $windows = @($payload)
  if (($windows | Measure-Object).Count -lt 1) { throw "No visible windows returned." }
  "windows=$(($windows | Measure-Object).Count)"
}

Add-Check "foreground" {
  $json = Invoke-DesktopControl -ArgumentList @("foreground", "-Json")
  $payload = $json | ConvertFrom-Json
  if (-not $payload.handle) { throw "No foreground handle returned." }
  $payload.handle
}

Add-Check "cursor" {
  $json = Invoke-DesktopControl -ArgumentList @("cursor", "-Json")
  $payload = $json | ConvertFrom-Json
  if ($null -eq $payload.x -or $null -eq $payload.y) { throw "Cursor coordinates missing." }
  "$($payload.x),$($payload.y)"
}

Add-Check "hotkey-dry-run" {
  $json = Invoke-DesktopControl -ArgumentList @("hotkey", "-Keys", "CTRL+L", "-DryRun", "-Json")
  $payload = $json | ConvertFrom-Json
  if (-not $payload.dryRun) { throw "Hotkey dryRun flag missing." }
  $payload.keys
}

Add-Check "mouse-dry-run" {
  $json = Invoke-DesktopControl -ArgumentList @("click", "-X", "10", "-Y", "10", "-DryRun", "-Json")
  $payload = $json | ConvertFrom-Json
  if (-not $payload.dryRun) { throw "Click dryRun flag missing." }
  "$($payload.x),$($payload.y)"
}

Add-Check "scroll-dry-run" {
  $json = Invoke-DesktopControl -ArgumentList @("scroll", "-Delta", "-240", "-DryRun", "-Json")
  $payload = $json | ConvertFrom-Json
  if (-not $payload.dryRun) { throw "Scroll dryRun flag missing." }
  $payload.delta
}

Add-Check "alt-tab-dry-run" {
  $json = Invoke-DesktopControl -ArgumentList @("alt-tab", "-Count", "1", "-DryRun", "-Json")
  $payload = $json | ConvertFrom-Json
  if (-not $payload.dryRun) { throw "Alt-tab dryRun flag missing." }
  $payload.count
}

Add-Check "run-json-dry-run" {
  $jsonInputPath = Join-Path (Split-Path -Parent $ScreenshotPath) "desktop-control-run-json-test.json"
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $jsonInputPath) | Out-Null
  '[{"action":"wait","ms":1},{"action":"hotkey","keys":"CTRL+L"}]' | Set-Content -LiteralPath $jsonInputPath -Encoding UTF8
  $json = Invoke-DesktopControl -ArgumentList @("run-json", "-InputPath", $jsonInputPath, "-DryRun", "-Json")
  $payload = $json | ConvertFrom-Json
  if (($payload | Measure-Object).Count -lt 2) { throw "run-json returned fewer than two results." }
  "items=$(($payload | Measure-Object).Count)"
}

Add-Check "screenshot" {
  $args = @("screenshot", "-Path", $ScreenshotPath, "-Json")
  if (-not $RealScreenshot) {
    $args += "-DryRun"
  }
  $json = Invoke-DesktopControl -ArgumentList $args
  $payload = $json | ConvertFrom-Json
  if (-not $payload.path) { throw "Screenshot path missing." }
  if ($RealScreenshot -and -not (Test-Path -LiteralPath $payload.path)) { throw "Screenshot file was not created." }
  $payload.path
}

$summary = [pscustomobject]@{
  ok = -not ($script:checks | Where-Object { -not $_.ok })
  checkedAt = (Get-Date).ToString("o")
  desktopControlPath = $DesktopControlPath
  checks = $script:checks
}

if ($Json) {
  $summary | ConvertTo-Json -Depth 8
} else {
  $summary
}

if (-not $summary.ok) {
  exit 1
}
