$PidFile = "D:\projets\funesterie\a11\logs\ekko\ekko.pid"

if (Test-Path $PidFile) {
  $pid = Get-Content $PidFile -Raw
  try {
    Stop-Process -Id ([int]$pid) -Force -ErrorAction Stop
    Write-Host "[Ekko] PID $pid arrêté."
  } catch {
    Write-Host "[Ekko] Processus $pid déjà terminé ou introuvable."
  }
  Remove-Item $PidFile -Force
} else {
  # Fallback : kill tous les python main.py ekko
  Get-Process -Name python -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowTitle -eq "" } |
    ForEach-Object {
      $cmdline = (Get-WmiObject Win32_Process -Filter "ProcessId=$($_.Id)").CommandLine
      if ($cmdline -match "ekko") {
        Stop-Process -Id $_.Id -Force
        Write-Host "[Ekko] Arrêt PID $($_.Id)"
      }
    }
}
