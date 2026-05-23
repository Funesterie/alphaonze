param(
  [string]$SecretPath = "D:\agent-bus\rubixgate\vault\npm-publish\npm-publish-token.dpapi.txt",
  [string]$MetadataPath = "",
  [string]$TokenEnv = "",
  [switch]$Force
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Convert-SecureStringToPlainText {
  param([Security.SecureString]$Secure)

  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secure)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  } finally {
    if ($bstr -ne [IntPtr]::Zero) {
      [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }
  }
}

if ([string]::IsNullOrWhiteSpace($MetadataPath)) {
  $MetadataPath = [IO.Path]::ChangeExtension($SecretPath, ".meta.json")
}

if ((Test-Path -LiteralPath $SecretPath) -and -not $Force) {
  throw "A publish token already exists at $SecretPath. Re-run with -Force to replace it."
}

if ([string]::IsNullOrWhiteSpace($TokenEnv)) {
  Write-Host ""
  Write-Host "NOSSEN npm publish token import" -ForegroundColor Cyan
  Write-Host "Paste the full npm token here. Input is hidden and never printed." -ForegroundColor Yellow
  Write-Host ""
  Write-Host "Expected npm token settings:" -ForegroundColor Cyan
  Write-Host "  - Granular access token"
  Write-Host "  - Bypass two-factor authentication enabled"
  Write-Host "  - Packages/scopes permission: Read and write"
  Write-Host "  - Selected package scopes: @nossen and @funeste"
  Write-Host "  - Organization permission alone is not enough to publish packages"
  Write-Host ""
  $secureToken = Read-Host -AsSecureString "Full npm token"
  $plainToken = Convert-SecureStringToPlainText -Secure $secureToken
} else {
  $plainToken = [Environment]::GetEnvironmentVariable($TokenEnv)
}

try {
  $plainToken = [string]::new($plainToken).Trim()
  if ($plainToken -notmatch "^npm_[A-Za-z0-9]{20,}$") {
    throw "The provided value does not look like a full npm token."
  }

  $secretDir = Split-Path -Parent $SecretPath
  New-Item -ItemType Directory -Force -Path $secretDir | Out-Null
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $MetadataPath) | Out-Null

  $encrypted = ConvertTo-SecureString $plainToken -AsPlainText -Force | ConvertFrom-SecureString
  Set-Content -LiteralPath $SecretPath -Encoding ascii -Value $encrypted

  $metadata = [ordered]@{
    schema = "nossen.local-secret.dpapi.v1"
    name = "npm-publish-token"
    createdAt = (Get-Date).ToUniversalTime().ToString("o")
    storage = "Windows DPAPI current user encrypted string"
    secretPath = $SecretPath
    tokenValuePrinted = $false
    expectedScopes = @("@nossen", "@funeste")
    packagePermission = "read-write"
    bypass2fa = $true
  }
  $metadata | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $MetadataPath -Encoding utf8

  [pscustomobject]@{
    ok = $true
    secretPath = $SecretPath
    metadataPath = $MetadataPath
    tokenValuePrinted = $false
  } | ConvertTo-Json -Depth 4
} finally {
  if ($null -ne $plainToken) {
    $plainToken = ""
  }
}
