@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-cerbere-cloudflare-tunnel.ps1" %*
set "EXIT_CODE=%ERRORLEVEL%"
endlocal & exit /b %EXIT_CODE%
