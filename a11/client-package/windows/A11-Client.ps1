param(
  [string]$Url = "https://a11.funesterie.pro",
  [string]$ProfileName = "A11Client"
)

$ErrorActionPreference = "Stop"

function Find-Browser {
  $candidates = @(
    "$env:LOCALAPPDATA\BraveSoftware\Brave-Browser\Application\brave.exe",
    "$env:PROGRAMFILES\BraveSoftware\Brave-Browser\Application\brave.exe",
    "${env:PROGRAMFILES(X86)}\Microsoft\Edge\Application\msedge.exe",
    "$env:PROGRAMFILES\Microsoft\Edge\Application\msedge.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
    "$env:PROGRAMFILES\Google\Chrome\Application\chrome.exe",
    "${env:PROGRAMFILES(X86)}\Google\Chrome\Application\chrome.exe"
  )

  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path -LiteralPath $candidate)) {
      return $candidate
    }
  }

  return $null
}

$browser = Find-Browser
if (-not $browser) {
  Start-Process $Url
  exit 0
}

$safeProfileName = ($ProfileName -replace '[^a-zA-Z0-9._-]', '')
if (-not $safeProfileName) {
  $safeProfileName = "A11Client"
}

$profileDir = Join-Path $env:LOCALAPPDATA "$safeProfileName\BrowserProfile"
New-Item -ItemType Directory -Force -Path $profileDir | Out-Null

$args = @(
  "--app=$Url",
  "--user-data-dir=$profileDir",
  "--no-first-run"
)

Start-Process -FilePath $browser -ArgumentList $args
