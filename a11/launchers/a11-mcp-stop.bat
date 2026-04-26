@echo off
title A11 MCP - Arret

echo [A11] Arret du backend sur le port 3000...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":3000 " ^| findstr "LISTENING"') do (
    echo [A11] Arret PID %%p
    taskkill /PID %%p /F
)

echo [A11] Backend arrete.
timeout /t 2 /nobreak >nul
