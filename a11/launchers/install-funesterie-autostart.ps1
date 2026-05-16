Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$Launcher = "D:\projets\funesterie\a11\launchers\funesterie-autostart.ps1"
$TaskName = "Funesterie Auto Start"
$TaskPath = "\Funesterie\"

if (-not (Test-Path -LiteralPath $Launcher)) {
  throw "Launcher introuvable: $Launcher"
}

$action = New-ScheduledTaskAction `
  -Execute "powershell.exe" `
  -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$Launcher`""

$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 5) `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 45)

$principal = New-ScheduledTaskPrincipal `
  -UserId $env:USERNAME `
  -LogonType Interactive `
  -RunLevel Limited

$task = New-ScheduledTask `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Principal $principal `
  -Description "Demarre A11, Kaen44, le frontend local, a11mcp, Neo4j Podman, la synchro Codex/Neo4j, la memoire A11 Aura/local, le backup Seagate si disponible et le bridge RomStation/Qflush a l'ouverture de session."

Register-ScheduledTask `
  -TaskName $TaskName `
  -TaskPath $TaskPath `
  -InputObject $task `
  -Force | Out-Null

Get-ScheduledTask -TaskName $TaskName -TaskPath $TaskPath |
  Select-Object TaskPath, TaskName, State
