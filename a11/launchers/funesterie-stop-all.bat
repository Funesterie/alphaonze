@echo off
setlocal
where pwsh >nul 2>nul
if %ERRORLEVEL% EQU 0 (
  pwsh -NoProfile -ExecutionPolicy Bypass -File "%~dp0funesterie-stop-all.ps1" %*
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0funesterie-stop-all.ps1" %*
)
set "EXIT_CODE=%ERRORLEVEL%"
endlocal & exit /b %EXIT_CODE%
