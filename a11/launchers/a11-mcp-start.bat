@echo off
title A11 MCP - Backend

:: Verifier si le backend tourne deja sur le port 3000
netstat -ano | findstr ":3000 " | findstr "LISTENING" >nul 2>&1
if %errorlevel% == 0 (
    echo [A11] Backend deja actif sur le port 3000.
    echo [A11] Relancement...
    for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":3000 " ^| findstr "LISTENING"') do (
        taskkill /PID %%p /F >nul 2>&1
    )
    timeout /t 2 /nobreak >nul
)

echo [A11] Demarrage du backend...
cd /d "D:\projets\funesterie\a11\backend\apps\server"
node server.cjs
