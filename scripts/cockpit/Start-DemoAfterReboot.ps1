param(
  [switch]$SkipAutostart
)

$ErrorActionPreference = "Continue"

$RepoRoot = "D:\projets\funesterie"
$Autostart = Join-Path $RepoRoot "a11\launchers\funesterie-autostart.ps1"

function Write-Step {
  param([string]$Message)
  Write-Host ("[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $Message)
}

function Test-Http {
  param(
    [string]$Url,
    [int]$TimeoutSec = 10
  )
  try {
    $res = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec $TimeoutSec
    return [int]$res.StatusCode -ge 200 -and [int]$res.StatusCode -lt 400
  } catch {
    return $false
  }
}

Write-Step "Demo rescue start"

if (-not $SkipAutostart) {
  if (Test-Path -LiteralPath $Autostart) {
    Write-Step "Starting Funesterie local services..."
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $Autostart
  } else {
    Write-Step "Autostart script missing: $Autostart"
  }
}

$checks = @(
  @{ Label = "A11 public"; Url = "https://a11.funesterie.pro/api/health" },
  @{ Label = "Kaen44 public"; Url = "https://funesterie.me/" },
  @{ Label = "Agent link"; Url = "https://mcp.funesterie.me/health" }
)

foreach ($check in $checks) {
  $ok = Test-Http -Url $check.Url
  Write-Step ("{0}: {1} - {2}" -f $check.Label, ($(if ($ok) { "OK" } else { "CHECK" })), $check.Url)
}

Write-Step "If the public cockpit was deployed with Netlify, open the latest deploy URL printed by netlify deploy."
Write-Step "Demo rescue done"
