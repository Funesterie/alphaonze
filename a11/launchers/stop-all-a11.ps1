param()

$ErrorActionPreference = 'Stop'

function Stop-CerbereTunnel {
  $matching = @(
    Get-CimInstance Win32_Process -Filter "Name = 'cloudflared.exe'" -ErrorAction SilentlyContinue |
      Where-Object {
        ($_.CommandLine -like "*funesterie-cerbere-local*") -or
        ($_.CommandLine -like "*cloudflared-cerbere.yml*")
      }
  )

  foreach ($proc in $matching) {
    try {
      Stop-Process -Id $proc.ProcessId -Force -ErrorAction Stop
      Write-Host "[A11 STOP] Tunnel Cerbere arrete (PID $($proc.ProcessId))."
    } catch {
      Write-Host "[A11 STOP] Echec arret tunnel PID $($proc.ProcessId): $($_.Exception.Message)" -ForegroundColor Yellow
    }
  }
}

$launcherRoot = Split-Path -Parent $PSCommandPath
$localLauncher = Join-Path $launcherRoot 'a11-local.ps1'

& $localLauncher stop -NoPause
Stop-CerbereTunnel

exit $LASTEXITCODE
