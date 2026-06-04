param(
  [Parameter(ValueFromRemainingArguments = $true, Position = 0)]
  [string[]]$RunComfyArgs,
  [string]$Distro = "podman-a11-wsl"
)

$ErrorActionPreference = "Stop"

if (-not $RunComfyArgs -or $RunComfyArgs.Count -eq 0) {
  $RunComfyArgs = @("whoami")
}

function Quote-BashArg {
  param([string]$Value)
  return "'" + ($Value -replace "'", "'\''") + "'"
}

$quotedArgs = ($RunComfyArgs | ForEach-Object { Quote-BashArg $_ }) -join " "
$bash = @"
set -e
mkdir -p /mnt/e/Funesterie/outputs/runcomfy /mnt/e/Funesterie/runtime/runcomfy
exec runcomfy $quotedArgs
"@

wsl.exe -d $Distro -- bash -lc $bash
