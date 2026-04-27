@echo off
title A11 MCP - Arret

echo [A11] Arret backend (port 3000)...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":3000 " ^| findstr "LISTENING" 2^>nul') do (
    echo   Arret PID %%p
    taskkill /PID %%p /F >nul 2>&1
)

echo [A11] Arret frontend (port 5173)...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":5173 " ^| findstr "LISTENING" 2^>nul') do (
    echo   Arret PID %%p
    taskkill /PID %%p /F >nul 2>&1
)

echo [A11] Services arretes.
timeout /t 2 /nobreak >nul
