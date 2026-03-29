@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-prod-a11.ps1" %*
set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" (
  echo.
  echo [A11 PROD] Echec du lanceur ^(code %EXIT_CODE%^). Consulte les logs dans runtime\logs.
  pause
)
endlocal & exit /b %EXIT_CODE%
