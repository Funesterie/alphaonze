@echo off
setlocal
pwsh -NoLogo -NoProfile -ExecutionPolicy Bypass -File "D:\funesterie\deploy-a11-prod.ps1" %*
set EXITCODE=%ERRORLEVEL%
if not "%EXITCODE%"=="0" (
  echo.
  echo Le deploy prod A11 a echoue. Code=%EXITCODE%
  pause
  exit /b %EXITCODE%
)
echo.
pause
