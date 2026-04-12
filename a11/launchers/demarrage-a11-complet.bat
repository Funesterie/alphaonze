@echo off
setlocal
call "%~dp0start-prod-a11-full.bat" %*
set "EXIT_CODE=%ERRORLEVEL%"
endlocal & exit /b %EXIT_CODE%
