param(
  [switch]$Json,
  [string]$UsernamePath = "$env:USERPROFILE\.funesterie\secrets\redhat-registry-A11.username.txt",
  [string]$PasswordPath = "$env:USERPROFILE\.funesterie\secrets\redhat-registry-A11-password.dpapi.txt"
)

$ErrorActionPreference = 'Stop'

function Read-FunesterieDpapiSecret {
  param([Parameter(Mandatory = $true)][string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) {
    return $null
  }

  $encrypted = (Get-Content -LiteralPath $Path -Raw).Trim()
  $secure = $encrypted | ConvertTo-SecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  }
}

function Invoke-RegistryLogin {
  param(
    [Parameter(Mandatory = $true)][string]$Tool,
    [Parameter(Mandatory = $true)][string]$Username,
    [Parameter(Mandatory = $true)][string]$Password
  )

  $output = $Password | & $Tool login registry.redhat.io --username $Username --password-stdin 2>&1
  [pscustomobject]@{
    ok = ($LASTEXITCODE -eq 0)
    output = (($output | Out-String) `
      -replace [regex]::Escape($Username), '[redacted-user]' `
      -replace [regex]::Escape($Password), '[redacted-password]').Trim()
  }
}

$username = $null
if (Test-Path -LiteralPath $UsernamePath) {
  $username = (Get-Content -LiteralPath $UsernamePath -Raw).Trim()
}
$password = Read-FunesterieDpapiSecret -Path $PasswordPath

$result = [ordered]@{
  usernameStored = -not [string]::IsNullOrWhiteSpace($username)
  passwordStored = -not [string]::IsNullOrWhiteSpace($password)
  podmanLoginOk = $false
  dockerLoginOk = $false
  secretPrinted = $false
  note = $null
}

if (-not $username -or -not $password) {
  $result.note = 'Missing Red Hat registry DPAPI credentials. Re-import A11-auth.json from Downloads.'
} else {
  $podman = Invoke-RegistryLogin -Tool 'podman' -Username $username -Password $password
  $docker = Invoke-RegistryLogin -Tool 'docker' -Username $username -Password $password
  $result.podmanLoginOk = $podman.ok
  $result.dockerLoginOk = $docker.ok
  if (-not $podman.ok -or -not $docker.ok) {
    $result.note = (($podman.output, $docker.output) | Where-Object { $_ }) -join ' | '
  }
}

if ($Json) {
  $result | ConvertTo-Json -Depth 5
  exit 0
}

[pscustomobject]$result | Format-List
