param(
  [Parameter(Position = 0)][string]$Command = "help",
  [Parameter(Position = 1)][string]$Name = "",
  [Parameter(ValueFromRemainingArguments = $true)][string[]]$Rest = @(),
  [string]$Value = "",
  [string]$Url = "",
  [switch]$ShowSecret
)

$ErrorActionPreference = "Stop"

$installDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$configPath = Join-Path $installDir "client.config.json"
$tokensDir = Join-Path $installDir "tokens"

function Read-KaenConfig {
  if (Test-Path -LiteralPath $configPath) {
    return Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
  }
  return [pscustomobject]@{
    appName = "Kaen44"
    url = "https://a11.funesterie.me/?persona=kaen44"
  }
}

function Write-KaenConfig {
  param([Parameter(Mandatory = $true)]$Config)
  $Config | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $configPath -Encoding UTF8
}

function Protect-Text {
  param([Parameter(Mandatory = $true)][string]$PlainText)
  $secure = ConvertTo-SecureString -String $PlainText -AsPlainText -Force
  return ConvertFrom-SecureString -SecureString $secure
}

function Unprotect-Text {
  param([Parameter(Mandatory = $true)][string]$CipherText)
  $secure = ConvertTo-SecureString -String $CipherText
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  }
}

function Normalize-TokenName {
  param([string]$RawName)
  $normalized = ($RawName -replace '[^a-zA-Z0-9._-]', '-').Trim("-")
  if (-not $normalized) {
    throw "Token name is required."
  }
  return $normalized.ToLowerInvariant()
}

function Get-TokenPath {
  param([Parameter(Mandatory = $true)][string]$TokenName)
  New-Item -ItemType Directory -Force -Path $tokensDir | Out-Null
  return Join-Path $tokensDir "$TokenName.token.json"
}

function Show-Help {
  @"
Kaen44 CLI

Usage:
  kaen44 open
  kaen44 modules
  kaen44 accessibility
  kaen44 setup auto
  kaen44 status
  kaen44 guard status
  kaen44 guard enable
  kaen44 guard disable
  kaen44 config url <url>
  kaen44 token set <name>
  kaen44 token set <name> -Value <token>
  kaen44 token list
  kaen44 token show <name>
  kaen44 token remove <name>

Aliases:
  k44 works the same as kaen44.

Security:
  Tokens are encrypted with Windows DPAPI for the current user.
  Do not use -ShowSecret unless you are debugging locally.

Autonomous setup:
  Run PowerShell as Administrator, then:
  kaen44 setup auto
"@ | Write-Host
}

function Open-Kaen44 {
  $config = Read-KaenConfig
  $launcher = Join-Path $installDir "A11-Client.ps1"
  if (Test-Path -LiteralPath $launcher) {
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File $launcher -Url $config.url -ProfileName "Kaen44"
    return
  }
  Start-Process $config.url
}

function Open-Kaen44Path {
  param([string]$Query)
  $config = Read-KaenConfig
  $baseUrl = [string]$config.url
  $separator = if ($baseUrl.Contains("?")) { "&" } else { "?" }
  $targetUrl = "$baseUrl$separator$Query"
  $launcher = Join-Path $installDir "A11-Client.ps1"
  if (Test-Path -LiteralPath $launcher) {
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File $launcher -Url $targetUrl -ProfileName "Kaen44"
    return
  }
  Start-Process $targetUrl
}

function Open-AccessibilitySettings {
  Start-Process "ms-settings:easeofaccess"
  Write-Host "Windows accessibility settings opened."
  Write-Host "Kaen44 assistive screen control requires explicit local permission and a local helper."
}

function Show-Status {
  $config = Read-KaenConfig
  $tokenCount = 0
  if (Test-Path -LiteralPath $tokensDir) {
    $tokenCount = @(Get-ChildItem -LiteralPath $tokensDir -Filter "*.token.json").Count
  }
  [pscustomobject]@{
    app = $config.appName
    url = $config.url
    installDir = $installDir
    tokens = $tokenCount
    cli = $MyInvocation.MyCommand.Path
  } | Format-List
}

function Set-Url {
  param([string]$NewUrl)
  if (-not $NewUrl) {
    throw "URL is required."
  }
  $config = Read-KaenConfig
  $config.url = $NewUrl
  Write-KaenConfig -Config $config
  Write-Host "Kaen44 URL updated."
}

function Ensure-GuardConfig {
  $config = Read-KaenConfig
  if (-not ($config.PSObject.Properties.Name -contains "guard")) {
    $config | Add-Member -NotePropertyName guard -NotePropertyValue ([pscustomobject]@{
      enabled = $true
      mode = "transparent_limit"
      abusePlanPriceEur = 5
      adminEmail = "cellaurojeffrey@gmail.com"
      notifyAdminOnLimit = $true
      message = "Usage eleve detecte. Kaen44 passe en mode limite et peut proposer l'option Plus a 5 EUR."
    })
    Write-KaenConfig -Config $config
  }
  return $config
}

function Show-GuardStatus {
  $config = Ensure-GuardConfig
  $config.guard | Format-List
}

function Set-GuardEnabled {
  param([bool]$Enabled)
  $config = Ensure-GuardConfig
  $config.guard.enabled = $Enabled
  $updatedAt = (Get-Date).ToString("o")
  if ($config.guard.PSObject.Properties.Name -contains "updatedAt") {
    $config.guard.updatedAt = $updatedAt
  } else {
    $config.guard | Add-Member -NotePropertyName updatedAt -NotePropertyValue $updatedAt
  }
  Write-KaenConfig -Config $config
  Write-Host "Kaen44 guard mode: $(if ($Enabled) { 'enabled' } else { 'disabled' })"
}

function Start-AutonomousSetup {
  $installer = Join-Path $installDir "Install-Kaen44-Autonomous.ps1"
  if (-not (Test-Path -LiteralPath $installer)) {
    throw "Install-Kaen44-Autonomous.ps1 not found in $installDir."
  }
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File $installer -AcceptAll
}

function Set-Token {
  param(
    [string]$TokenName,
    [string]$TokenValue
  )
  $safeName = Normalize-TokenName $TokenName
  if (-not $TokenValue) {
    $secure = Read-Host "Token for $safeName" -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try {
      $TokenValue = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    } finally {
      [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }
  }
  if (-not $TokenValue) {
    throw "Empty token rejected."
  }
  $payload = [ordered]@{
    name = $safeName
    encryptedValue = Protect-Text $TokenValue
    createdAt = (Get-Date).ToString("o")
    updatedAt = (Get-Date).ToString("o")
    storage = "windows-dpapi-current-user"
  }
  $path = Get-TokenPath $safeName
  $payload | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $path -Encoding UTF8
  Write-Host "Token '$safeName' saved."
}

function List-Tokens {
  if (-not (Test-Path -LiteralPath $tokensDir)) {
    Write-Host "No tokens saved."
    return
  }
  $items = Get-ChildItem -LiteralPath $tokensDir -Filter "*.token.json" | Sort-Object Name
  if (-not $items) {
    Write-Host "No tokens saved."
    return
  }
  foreach ($item in $items) {
    $payload = Get-Content -LiteralPath $item.FullName -Raw | ConvertFrom-Json
    [pscustomobject]@{
      name = $payload.name
      updatedAt = $payload.updatedAt
      storage = $payload.storage
    }
  }
}

function Show-Token {
  param([string]$TokenName)
  $safeName = Normalize-TokenName $TokenName
  $path = Get-TokenPath $safeName
  if (-not (Test-Path -LiteralPath $path)) {
    throw "Token '$safeName' not found."
  }
  $payload = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
  if ($ShowSecret) {
    Write-Host (Unprotect-Text $payload.encryptedValue)
    return
  }
  [pscustomobject]@{
    name = $payload.name
    updatedAt = $payload.updatedAt
    storage = $payload.storage
    secret = "hidden; use -ShowSecret only for local debugging"
  } | Format-List
}

function Remove-Token {
  param([string]$TokenName)
  $safeName = Normalize-TokenName $TokenName
  $path = Get-TokenPath $safeName
  if (Test-Path -LiteralPath $path) {
    Remove-Item -LiteralPath $path -Force
    Write-Host "Token '$safeName' removed."
    return
  }
  Write-Host "Token '$safeName' was not present."
}

$cmd = ([string]$Command).Trim().ToLowerInvariant()
if (-not $cmd) { $cmd = "help" }

switch ($cmd) {
  "help" { Show-Help }
  "--help" { Show-Help }
  "-h" { Show-Help }
  "open" { Open-Kaen44 }
  "modules" { Open-Kaen44Path -Query "view=modules" }
  "accessibility" { Open-AccessibilitySettings }
  "assist" { Open-AccessibilitySettings }
  "setup" {
    $sub = ([string]$Name).Trim().ToLowerInvariant()
    if ($sub -eq "auto" -or $sub -eq "autonomous") {
      Start-AutonomousSetup
    } else {
      throw "Unknown setup command. Use: kaen44 setup auto"
    }
  }
  "status" { Show-Status }
  "guard" {
    $parts = @($Rest)
    $sub = ([string]$Name).Trim().ToLowerInvariant()
    switch ($sub) {
      "status" { Show-GuardStatus }
      "enable" { Set-GuardEnabled -Enabled $true }
      "disable" { Set-GuardEnabled -Enabled $false }
      default { throw "Unknown guard command. Use status/enable/disable." }
    }
  }
  "config" {
    $sub = ([string]$Name).Trim().ToLowerInvariant()
    if ($sub -eq "url") {
      $newUrl = if ($Url) { $Url } elseif ($Rest.Count -gt 0) { [string]$Rest[0] } else { "" }
      Set-Url -NewUrl $newUrl
    } else {
      throw "Unknown config command. Use: kaen44 config url -Url <url>"
    }
  }
  "token" {
    $parts = @($Rest)
    $sub = ([string]$Name).Trim().ToLowerInvariant()
    $tokenName = if ($parts.Count -gt 0) { [string]$parts[0] } else { "" }
    switch ($sub) {
      "set" { Set-Token -TokenName $tokenName -TokenValue $Value }
      "list" { List-Tokens }
      "show" { Show-Token -TokenName $tokenName }
      "remove" { Remove-Token -TokenName $tokenName }
      default { throw "Unknown token command. Use set/list/show/remove." }
    }
  }
  default { Show-Help }
}
