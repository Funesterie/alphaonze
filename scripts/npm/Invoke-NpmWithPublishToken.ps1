[CmdletBinding(PositionalBinding = $false)]
param(
  [string]$SecretPath = "D:\agent-bus\rubixgate\vault\npm-publish\npm-publish-token.dpapi.txt",
  [string]$WorkDir = "",
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$NpmArgs
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

if (-not (Test-Path -LiteralPath $SecretPath)) {
  throw "No encrypted npm publish token found at $SecretPath. Run scripts/npm/Import-NpmPublishToken.ps1 first."
}

if (-not $NpmArgs -or $NpmArgs.Count -eq 0) {
  throw "No npm arguments provided. Example: -WorkDir packages/nossen/logic-reduce publish --access public"
}

if ([string]::IsNullOrWhiteSpace($WorkDir)) {
  $WorkDir = (Get-Location).Path
}

$encryptedSecret = (Get-Content -LiteralPath $SecretPath -Raw).Trim()
$secureText = $encryptedSecret | ConvertTo-SecureString
$token = Convert-SecureStringToPlainText -Secure $secureText
$tempNpmrc = Join-Path $env:TEMP ("nossen-npm-publish-" + [guid]::NewGuid().ToString("N") + ".npmrc")
$previousUserConfig = [Environment]::GetEnvironmentVariable("NPM_CONFIG_USERCONFIG", "Process")
$previousToken = [Environment]::GetEnvironmentVariable("NOSSEN_NPM_TOKEN", "Process")
$previousNodeAuthToken = [Environment]::GetEnvironmentVariable("NODE_AUTH_TOKEN", "Process")

try {
  $token = [string]::new($token).Trim()
  if ($token -notmatch "^npm_[A-Za-z0-9]{20,}$") {
    throw "The encrypted token does not look like a full npm token."
  }

  Set-Content -LiteralPath $tempNpmrc -Encoding ascii -Value @(
    "registry=https://registry.npmjs.org/"
    "@nossen:registry=https://registry.npmjs.org/"
    "@funeste:registry=https://registry.npmjs.org/"
    "//registry.npmjs.org/:_authToken=`${NOSSEN_NPM_TOKEN}"
  )

  [Environment]::SetEnvironmentVariable("NOSSEN_NPM_TOKEN", $token, "Process")
  [Environment]::SetEnvironmentVariable("NODE_AUTH_TOKEN", $token, "Process")
  [Environment]::SetEnvironmentVariable("NPM_CONFIG_USERCONFIG", $tempNpmrc, "Process")

  Push-Location -LiteralPath $WorkDir
  try {
    & npm @NpmArgs
    $exitCode = $LASTEXITCODE
  } finally {
    Pop-Location
  }

  exit $exitCode
} finally {
  if ($null -eq $previousUserConfig) {
    Remove-Item Env:\NPM_CONFIG_USERCONFIG -ErrorAction SilentlyContinue
  } else {
    [Environment]::SetEnvironmentVariable("NPM_CONFIG_USERCONFIG", $previousUserConfig, "Process")
  }
  if ($null -eq $previousToken) {
    Remove-Item Env:\NOSSEN_NPM_TOKEN -ErrorAction SilentlyContinue
  } else {
    [Environment]::SetEnvironmentVariable("NOSSEN_NPM_TOKEN", $previousToken, "Process")
  }
  if ($null -eq $previousNodeAuthToken) {
    Remove-Item Env:\NODE_AUTH_TOKEN -ErrorAction SilentlyContinue
  } else {
    [Environment]::SetEnvironmentVariable("NODE_AUTH_TOKEN", $previousNodeAuthToken, "Process")
  }
  if (Test-Path -LiteralPath $tempNpmrc) {
    Remove-Item -LiteralPath $tempNpmrc -Force
  }
  if ($null -ne $token) {
    $token = ""
  }
}
