@echo off
cd /d "D:\projets\funesterie\a11\launchers"
start "A11 Stop" pwsh.exe -File "stop-all-a11.ps1" -NoPause
