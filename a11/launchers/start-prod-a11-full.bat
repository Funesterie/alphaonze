@echo off
setlocal
call "%~dp0start-prod-a11.bat" --with-llm --with-ollama --with-cerbere --with-tunnel %*
set "EXIT_CODE=%ERRORLEVEL%"
endlocal & exit /b %EXIT_CODE%
