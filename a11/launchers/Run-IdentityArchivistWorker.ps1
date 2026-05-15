param(
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Resolve-Path (Join-Path $ScriptDir "..\..")
$LogDir = Join-Path $RepoRoot "a11\logs"
$LogFile = Join-Path $LogDir "identity-archivist-worker.log"

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
Set-Location $RepoRoot

$stamp = Get-Date -Format "yyyy-MM-ddTHH:mm:ssK"
"[$stamp] identity-archivist start dryRun=$DryRun cwd=$RepoRoot" | Out-File -FilePath $LogFile -Append -Encoding utf8

$command = "npm.cmd run worker:archivist"
if ($DryRun) {
  $command = "npm.cmd run worker:archivist:dry-run"
}
& cmd.exe /d /c "$command >> `"$LogFile`" 2>&1"

$exit = $LASTEXITCODE
$stamp = Get-Date -Format "yyyy-MM-ddTHH:mm:ssK"
"[$stamp] identity-archivist exit=$exit" | Out-File -FilePath $LogFile -Append -Encoding utf8
exit $exit
