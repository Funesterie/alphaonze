$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Resolve-Path (Join-Path $ScriptDir "..\..")
$LogDir = Join-Path $RepoRoot "a11\logs"
$LogFile = Join-Path $LogDir "orchestrator-worker-loop.log"
$PidFile = Join-Path $LogDir "orchestrator-worker-loop.pid"

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

if (Test-Path -LiteralPath $PidFile) {
  $oldPid = (Get-Content -LiteralPath $PidFile -Raw).Trim()
  if ($oldPid -match '^\d+$') {
    $existing = Get-Process -Id ([int]$oldPid) -ErrorAction SilentlyContinue
    if ($existing) {
      $stamp = Get-Date -Format "yyyy-MM-ddTHH:mm:ssK"
      "[$stamp] orchestrator loop already running pid=$oldPid" | Out-File -FilePath $LogFile -Append -Encoding utf8
      exit 0
    }
  }
}

Set-Content -LiteralPath $PidFile -Value $PID -Encoding ascii
Set-Location $RepoRoot

try {
  $stamp = Get-Date -Format "yyyy-MM-ddTHH:mm:ssK"
  "[$stamp] orchestrator loop start pid=$PID cwd=$RepoRoot" | Out-File -FilePath $LogFile -Append -Encoding utf8
  & cmd.exe /d /c "npm.cmd run worker:orchestrator:loop >> `"$LogFile`" 2>&1"
  $exit = $LASTEXITCODE
  $stamp = Get-Date -Format "yyyy-MM-ddTHH:mm:ssK"
  "[$stamp] orchestrator loop exit=$exit" | Out-File -FilePath $LogFile -Append -Encoding utf8
  exit $exit
} finally {
  Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
}
