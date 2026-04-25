$ErrorActionPreference = "Stop"

$listenAddress = "0.0.0.0"
$listenPort = 80
$connectAddress = "127.0.0.1"
$connectPort = 8088

$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).
  IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
  throw "Run this script from an elevated PowerShell session."
}

$ipHelper = Get-Service iphlpsvc
if ($ipHelper.Status -ne "Running") {
  Start-Service iphlpsvc
}

netsh interface portproxy delete v4tov4 listenaddress=$listenAddress listenport=$listenPort | Out-Null
netsh interface portproxy add v4tov4 listenaddress=$listenAddress listenport=$listenPort connectaddress=$connectAddress connectport=$connectPort

$rule = Get-NetFirewallRule -DisplayName "AlphaOnze AFK HTTP 80" -ErrorAction SilentlyContinue
if (-not $rule) {
  New-NetFirewallRule -DisplayName "AlphaOnze AFK HTTP 80" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 80 -Profile Any | Out-Null
}

$innerRule = Get-NetFirewallRule -DisplayName "AlphaOnze AFK 8088" -ErrorAction SilentlyContinue
if (-not $innerRule) {
  New-NetFirewallRule -DisplayName "AlphaOnze AFK 8088" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8088 -Profile Any | Out-Null
}

netsh interface portproxy show v4tov4
